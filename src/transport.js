/* The beat clock: count-in, repeats, a section to loop, and a tempo that can
 * change while it plays without losing the place.
 *
 * One rule holds the whole thing together: the position is always derived
 * from the audio clock —
 *
 *     runBeat = (now - t0) / secondsPerBeat - countInBeats
 *
 * Nothing counts frames, so the lane, the ball, the strike and the sound can
 * only ever agree. Everything that changes the speed or the place does it by
 * moving t0 and then re-deriving the cursors (seek), so there is one way for
 * the transport to be wrong and it is easy to test.
 */

const LOOKAHEAD = 0.25;             // seconds of sound scheduled in advance

export class Transport {
  constructor(audio, { onNote = () => {}, onClick = () => {}, onEnd = () => {} } = {}) {
    this.audio = audio;
    this.onNote = onNote;
    this.onClick = onClick;
    this.onEnd = onEnd;

    this.score = null;
    this.events = [];               // one pass, sorted, beats relative to `from`
    this.parts = [];
    this.lead = null;
    this.tempo = 96;
    this.repeats = 1;               // Infinity is allowed
    this.countInBars = 1;
    this.transpose = 0;
    this.metronome = true;
    this.muted = false;             // the notes, not the clicks: for playing along
    this.from = 0;
    this.to = 0;

    this.playing = false;
    this.t0 = 0;
    this.pausedAt = null;           // run beat where it was paused
    this.cursor = 0;
    this.pass = 0;
    this.clickBeat = 0;
    this.pending = [];              // notes handed to the synth, waiting for their moment
  }

  load(score, { parts = null, lead = null, tempo = null, from = 0, to = null } = {}) {
    this.score = score;
    this.parts = parts || score.partNames;
    this.lead = lead || this.parts[0] || score.leadName;
    this.tempo = tempo || score.tempo;
    this.from = from;
    this.to = to == null ? score.beats : to;
    this.rebuild();
    this.stop();
  }

  rebuild() {
    if (!this.score) { this.events = []; return; }
    this.events = this.score.events(this.parts)
      .filter((e) => e.beat >= this.from - 1e-6 && e.beat < this.to - 1e-6)
      .map((e, i) => ({ ...e, index: i, at: e.beat - this.from }));
  }

  setSection(from, to) {
    const beats = this.score ? this.score.beats : 0;
    this.from = Math.max(0, Math.min(from, beats - this.beatsPerBar));
    this.to = Math.max(this.from + this.beatsPerBar, Math.min(to, beats));
    this.rebuild();
    this.seek(0);
  }

  setParts(parts, lead) {
    this.parts = parts.length ? parts : this.score ? [this.score.leadName] : [];
    if (lead) this.lead = lead;
    if (!this.parts.includes(this.lead)) this.lead = this.parts[0];
    this.rebuild();
    this.seek(this.position);
  }

  setTempo(bpm) {
    const where = this.position;
    this.tempo = Math.max(20, Math.min(300, bpm));
    this.seek(where);
  }

  get secondsPerBeat() { return 60 / this.tempo; }
  get beatsPerBar() { return this.score ? this.score.beatsPerBar : 4; }
  get countInBeats() { return this.countInBars * this.beatsPerBar; }
  get passBeats() { return Math.max(this.beatsPerBar, this.to - this.from); }
  get totalBeats() { return this.passBeats * (this.repeats === Infinity ? 1 : this.repeats); }

  /** Where we are, in beats from the first beat of the section. Negative
   *  during the count-in. */
  get position() {
    if (!this.playing) return this.pausedAt == null ? 0 : this.pausedAt;
    return (this.audio.time - this.t0) / this.secondsPerBeat - this.countInBeats;
  }

  /** Which pass, and where inside it. */
  get place() {
    const p = this.position;
    if (p < 0) return { pass: 0, beat: p, countingIn: true };
    const pass = Math.floor(p / this.passBeats);
    return { pass, beat: p - pass * this.passBeats, countingIn: false };
  }

  get finished() {
    return this.repeats !== Infinity && this.position >= this.totalBeats;
  }

  play() {
    if (!this.score || this.playing) return;
    this.audio.start();
    this.seek(this.pausedAt == null || this.finished ? -this.countInBeats : this.pausedAt, true);
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.position;
    this.playing = false;
    this.pending = [];
  }

  stop() {
    this.playing = false;
    this.pausedAt = null;
    this.pending = [];
    this.cursor = 0;
    this.pass = 0;
    this.clickBeat = -this.countInBeats;
  }

  /** Put the clock at a run beat and line every cursor up with it. */
  seek(runBeat, start = this.playing) {
    const beat = Math.max(-this.countInBeats, runBeat);
    this.t0 = this.audio.time - (beat + this.countInBeats) * this.secondsPerBeat;
    this.pending = [];
    this.clickBeat = Math.ceil(beat - 1e-6);
    const pass = beat <= 0 ? 0 : Math.floor(beat / this.passBeats);
    const within = beat <= 0 ? 0 : beat - pass * this.passBeats;
    this.pass = pass;
    this.cursor = this.events.findIndex((e) => e.at >= within - 1e-6);
    if (this.cursor < 0) { this.cursor = this.events.length; }
    if (start) { this.playing = true; this.pausedAt = null; }
    else if (!this.playing) this.pausedAt = beat;
  }

  /** Called every frame. Schedules what is nearly due and fires what is due. */
  tick() {
    if (!this.playing || !this.audio.ready) return;
    const now = this.audio.time;
    const horizon = now + LOOKAHEAD;
    const spb = this.secondsPerBeat;

    // Notes.
    while (this.repeats === Infinity || this.pass < this.repeats) {
      if (this.cursor >= this.events.length) {
        this.pass++;
        this.cursor = 0;
        if (this.repeats !== Infinity && this.pass >= this.repeats) break;
        if (!this.events.length) break;
        continue;
      }
      const event = this.events[this.cursor];
      const runBeat = this.pass * this.passBeats + event.at;
      const when = this.t0 + (runBeat + this.countInBeats) * spb;
      if (when > horizon) break;
      this.cursor++;
      if (when < now - 0.25) continue;                 // long past: let it go
      if (!this.muted) {
        for (const midi of event.midis) {
          this.audio.note(midi + this.transpose, when, { gain: event.part === this.lead ? 1 : 0.55 });
        }
      }
      this.pending.push({ when, event, runBeat });
    }

    // Clicks, including through the count-in.
    if (this.metronome) {
      const lastBeat = this.repeats === Infinity ? Infinity : this.totalBeats;
      while (this.clickBeat < lastBeat) {
        const when = this.t0 + (this.clickBeat + this.countInBeats) * spb;
        if (when > horizon) break;
        if (when >= now - 0.1) {
          const inBar = ((this.clickBeat % this.beatsPerBar) + this.beatsPerBar) % this.beatsPerBar;
          this.audio.click(when, Math.abs(inBar) < 1e-6);
        }
        this.clickBeat++;
      }
    }

    // What has actually sounded by now is reported, so the drawing rings the
    // bar at the moment the ear hears it rather than a frame early.
    const due = [];
    this.pending = this.pending.filter((p) => {
      if (p.when > now) return true;
      due.push(p);
      return false;
    });
    for (const p of due) this.onNote(p.event, p.runBeat);

    if (this.finished) {
      this.playing = false;
      this.pausedAt = null;
      this.cursor = 0;
      this.pass = 0;
      this.clickBeat = -this.countInBeats;
      this.onEnd();
    }
  }

  /** The notes the lane should draw, as run beats, for a window ahead. */
  visible(fromBeat, toBeat) {
    if (!this.events.length) return [];
    const out = [];
    const first = Math.max(0, Math.floor(fromBeat / this.passBeats));
    const last = this.repeats === Infinity
      ? Math.floor(toBeat / this.passBeats)
      : Math.min(this.repeats - 1, Math.floor(toBeat / this.passBeats));
    for (let pass = first; pass <= last; pass++) {
      const offset = pass * this.passBeats;
      for (const event of this.events) {
        const runBeat = offset + event.at;
        if (runBeat + event.beats < fromBeat || runBeat > toBeat) continue;
        out.push({ event, runBeat, pass });
      }
    }
    return out;
  }
}
