/* Sound: a mallet, a click, and one clock for both.
 *
 * Nothing here is scheduled by a timer. Everything is handed to the audio
 * context with the time it should happen, which is the only clock in a
 * browser that does not stutter when the page is busy drawing.
 */

import { midiToHz } from "./core/notes.js";

export class Audio {
  constructor() {
    this.ctx = null;
    this.out = null;
    this.volume = 0.8;
    this.clickVolume = 0.5;
  }

  /** Must be called from a click or a tap the first time. */
  start() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = this.volume;
      this.out.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === "running";
  }

  setVolume(value) {
    this.volume = Math.max(0, Math.min(1, value));
    if (this.out) this.out.gain.setTargetAtTime(this.volume, this.time, 0.02);
  }

  /** A struck bar: a fundamental and two inharmonic partials, decaying fast. */
  note(midi, when = 0, { gain = 1, length = 1.1 } = {}) {
    const ctx = this.start();
    const at = Math.max(ctx.currentTime, when);
    const peak = Math.max(0.0005, 0.35 * gain);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, at + length);
    env.connect(this.out);
    for (const [mult, level] of [[1, 1], [4.01, 0.28], [9.2, 0.1]]) {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = midiToHz(midi) * mult;
      g.gain.value = level;
      osc.connect(g); g.connect(env);
      osc.start(at);
      osc.stop(at + length + 0.1);
    }
    return at;
  }

  /* The click is noise, not a tone, and for a reason: a pitched click is
   * heard by the listener as a note — and raising its pitch or stacking
   * partials only moves the problem, because the ear and the detector both
   * find the difference. Noise above the instrument has no pitch to find. */
  click(when = 0, accent = false) {
    const ctx = this.start();
    const at = Math.max(ctx.currentTime, when);
    const length = 0.035;
    const frames = Math.ceil(ctx.sampleRate * length);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / frames, 2.5);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = accent ? 1400 : 1100;
    const g = ctx.createGain();
    g.gain.value = (accent ? 1 : 0.62) * this.clickVolume;
    source.connect(filter); filter.connect(g); g.connect(this.out);
    source.start(at);
    return at;
  }
}
