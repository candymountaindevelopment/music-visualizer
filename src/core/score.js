/* A piece, ready to play: parts of events laid on a grid of beats.
 *
 * Every parser in src/parse ends here, so the rest of the app knows one
 * shape and does not care whether a piece arrived as a lesson, a script, a
 * MusicXML export or a MIDI file.
 */

const PART_ORDER = ["right", "melody", "left", "part 2", "part 3"];

export class Score {
  constructor({ title = "Untitled", composer = "", tempo = 96, time = { beats: 4, unit: 4 },
                parts = {}, source = "", warnings = [], flats = false } = {}) {
    this.title = title;
    this.composer = composer;
    this.tempo = tempo;                     // the written tempo, in beats a minute
    this.time = time;
    this.parts = parts;                     // { name: [event, ...] }
    this.source = source;                   // which format it came from
    this.warnings = warnings;
    this.flats = flats;                     // spell the names with flats
    for (const name of Object.keys(this.parts)) {
      this.parts[name].sort((a, b) => a.beat - b.beat);
    }
  }

  get partNames() {
    const names = Object.keys(this.parts).filter((n) => this.parts[n].length);
    return names.sort((a, b) => {
      const ia = PART_ORDER.indexOf(a), ib = PART_ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
  }

  /** The part the ball follows unless told otherwise: the melody. */
  get leadName() {
    return this.partNames[0] || null;
  }

  events(names = this.partNames) {
    const out = [];
    for (const name of names) for (const e of this.parts[name] || []) out.push({ ...e, part: name });
    return out.sort((a, b) => a.beat - b.beat);
  }

  get beatsPerBar() {
    return (this.time.beats * 4) / this.time.unit;
  }

  /** Where the last sound stops, rounded up to a whole bar. */
  get beats() {
    let end = 0;
    for (const name of Object.keys(this.parts)) {
      for (const e of this.parts[name]) end = Math.max(end, e.beat + e.beats);
    }
    const bar = this.beatsPerBar;
    return Math.max(bar, Math.ceil(end / bar - 1e-6) * bar);
  }

  get bars() {
    return Math.round(this.beats / this.beatsPerBar);
  }

  range(names = this.partNames) {
    let lo = 127, hi = 0;
    for (const e of this.events(names)) for (const m of e.midis) { lo = Math.min(lo, m); hi = Math.max(hi, m); }
    return lo > hi ? [60, 72] : [lo, hi];
  }

  get noteCount() {
    let n = 0;
    for (const name of Object.keys(this.parts)) for (const e of this.parts[name]) n += e.midis.length;
    return n;
  }

  /** An empty piece is a real possibility — a file can parse and say nothing. */
  get isEmpty() {
    return this.noteCount === 0;
  }
}

/** Build a score from parts given as { name: {events, warnings} }. */
export function scoreFrom(meta, parts) {
  const warnings = [...(meta.warnings || [])];
  const kept = {};
  for (const [name, hand] of Object.entries(parts)) {
    if (!hand) continue;
    for (const w of hand.warnings || []) warnings.push(w);
    if (hand.events && hand.events.length) kept[name] = hand.events;
  }
  return new Score({ ...meta, parts: kept, warnings });
}
