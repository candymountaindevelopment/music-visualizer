/* Hearing the player: YIN on the microphone, one note at a time.
 *
 * de Cheveigné & Kawahara (2002): a cumulative-mean normalised difference
 * function, the first dip under the threshold, then parabolic interpolation.
 * Two rules keep it from flickering — a note counts only when two frames in
 * a row agree, and a window that is quiet where YIN looks but loud at its end
 * is thrown away, because digital silence is perfectly periodic and would
 * otherwise read as a confident low note.
 */

const FFT = 4096;

export function detectPitch(buf, sampleRate, { minHz = 60, maxHz = 2200, threshold = 0.15, win = 2048 } = {}) {
  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(Math.floor(sampleRate / minHz), buf.length - win - 1);
  if (tauMax <= tauMin) return null;

  const cmnd = new Float32Array(tauMax + 1);
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < win; i++) {
      const d = buf[i] - buf[i + tau];
      sum += d * d;
    }
    running += sum;
    cmnd[tau] = running ? (sum * tau) / running : 1;
  }

  let tau = -1;
  for (let i = tauMin; i <= tauMax; i++) {
    if (cmnd[i] < threshold) {
      while (i + 1 <= tauMax && cmnd[i + 1] < cmnd[i]) i++;
      tau = i;
      break;
    }
  }
  if (tau < 0) return null;

  let period = tau;
  if (tau > 0 && tau < tauMax) {
    const a = cmnd[tau - 1], b = cmnd[tau], c = cmnd[tau + 1];
    const den = a - 2 * b + c;
    if (den !== 0) period = tau + (0.5 * (a - c)) / den;
  }
  return { hz: sampleRate / period, clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

export function rmsDb(buf, from = 0, to = buf.length) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += buf[i] * buf[i];
  return 20 * Math.log10(Math.sqrt(sum / Math.max(1, to - from)) + 1e-12);
}

export class Listener {
  constructor(audio) {
    this.audio = audio;
    this.analyser = null;
    this.stream = null;
    this.buf = new Float32Array(FFT);
    this.gateDb = -55;
    this.clarityFloor = 0.6;
    this.reading = null;      // { midi, hz, cents, clarity }
    this.candidate = null;
    this.sounding = null;
    this.silent = 0;
    this.running = false;
  }

  async start() {
    const ctx = this.audio.start();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const source = ctx.createMediaStreamSource(this.stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = FFT;
    source.connect(this.analyser);
    this.running = true;
    return this.stream.getAudioTracks()[0]?.label || "microphone";
  }

  stop() {
    this.running = false;
    this.reading = null;
    this.sounding = null;
    if (this.stream) for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
    this.analyser = null;
  }

  /** Call once a frame. Returns a MIDI number when a new note starts. */
  read() {
    if (!this.running || !this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.buf);
    const level = rmsDb(this.buf, 0, 2048);
    const tail = rmsDb(this.buf, this.buf.length - 512);

    if (level < this.gateDb || (level < this.gateDb + 6 && tail > level + 14)) {
      this.reading = null;
      if (++this.silent > 6) { this.sounding = null; this.candidate = null; }
      return null;
    }
    this.silent = 0;

    const found = detectPitch(this.buf, this.audio.ctx.sampleRate);
    if (!found || found.clarity < this.clarityFloor) { this.reading = null; return null; }

    const exact = 69 + 12 * Math.log2(found.hz / 440);
    const midi = Math.round(exact);
    this.reading = { midi, hz: found.hz, cents: (exact - midi) * 100, clarity: found.clarity };

    if (this.candidate === midi && this.sounding !== midi) {
      this.sounding = midi;
      return midi;
    }
    this.candidate = midi;
    return null;
  }
}
