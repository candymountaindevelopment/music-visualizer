/* Note names, and the one note language this app reads.
 *
 * The language is Danas Piano Tutor's: a hand is a string of tokens, a token
 * is a note with an optional length and finger, and bar lines are written but
 * carry no time of their own. Keeping the same tokens means a lesson written
 * for the tutor plays here without translation, and a chatbot that has been
 * told one format has been told both.
 *
 * Everything in this app is counted in beats, where one beat is a quarter
 * note. A lesson's `step` (a quarter by default) is what a bare token lasts.
 */

const STEPS = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

export const isBlack = (midi) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);
export const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/** "C4" / "F#3" / "Bb5" / "C♯4" → MIDI number, or null. Middle C is C4 = 60. */
export function noteToMidi(text) {
  const m = /^([A-Ga-g])([#b♯♭x]?)(-?\d{1,2})$/.exec(String(text).trim());
  if (!m) return null;
  const alter = m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "x" ? 2 : m[2] ? -1 : 0;
  const midi = (parseInt(m[3], 10) + 1) * 12 + STEPS[m[1].toLowerCase()] + alter;
  return midi >= 0 && midi <= 127 ? midi : null;
}

/** MIDI → "C4". Flats are used in flat keys so the name matches the page. */
export function midiToNote(midi, flats = false) {
  const names = flats ? FLAT_NAMES : SHARP_NAMES;
  return names[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

/** "1/8", "1/4.", "3", "1.5" → beats, given what one bare step is worth. */
export function lengthToBeats(text, stepBeats) {
  const raw = String(text).trim();
  const dotted = raw.endsWith(".") && /\d\s*\.$/.test(raw) && raw.includes("/");
  const body = dotted ? raw.slice(0, -1) : raw;
  let beats;
  if (body.includes("/")) {
    const [a, b] = body.split("/");
    const num = parseFloat(a), den = parseFloat(b);
    if (!(num > 0) || !(den > 0)) return null;
    beats = (num / den) * 4;                 // a note value: 1/4 is one beat
  } else {
    const n = parseFloat(body);
    if (!(n > 0)) return null;
    beats = n * stepBeats;                   // a count of steps
  }
  if (dotted) beats *= 1.5;
  return beats;
}

/**
 * Read one hand.
 *
 *   E4(3) D4(2) C4:2 | [C3 E3 G3]:4(5,3,1) | . - G4:1/8
 *
 * Returns { events, warnings }. An event is
 * { beat, beats, midis: [..], fingers: [..] } — a chord is one event, which
 * is what lets the ball land in one place.
 */
export function parseHand(text, { stepBeats = 1, where = "notes" } = {}) {
  const events = [];
  const warnings = [];
  let beat = 0;
  let last = null;

  const tokens = String(text || "")
    .replace(/\s*\|\s*/g, " ")               // bar lines carry no time
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  // A chord spans several whitespace-separated words, so they are rejoined.
  const joined = [];
  for (const tok of tokens) {
    if (joined.length && joined[joined.length - 1].open) {
      const cur = joined[joined.length - 1];
      cur.text += " " + tok;
      if (tok.includes("]")) cur.open = false;
      continue;
    }
    joined.push({ text: tok, open: tok.startsWith("[") && !tok.includes("]") });
  }

  for (const { text: tok } of joined) {
    if (tok === "-") {                        // hold: whatever came before lasts longer
      if (!last && beat === 0) { warnings.push(`${where}: a hold (-) with nothing before it`); continue; }
      if (last) last.beats += stepBeats;       // after a rest there is only time to add
      beat += stepBeats;
      continue;
    }
    if (tok[0] === ".") {                      // a rest
      const len = tok.length > 1 ? lengthToBeats(tok.slice(1).replace(/^:/, ""), stepBeats) : stepBeats;
      if (len === null) { warnings.push(`${where}: "${tok}" is not a rest I understand`); continue; }
      beat += len;
      last = null;
      continue;
    }

    const parsed = parseToken(tok, stepBeats, where, warnings);
    if (!parsed) continue;
    const event = { beat, beats: parsed.beats, midis: parsed.midis, fingers: parsed.fingers };
    events.push(event);
    beat += parsed.beats;
    last = event;
  }
  return { events, warnings, beats: beat };
}

function parseToken(tok, stepBeats, where, warnings) {
  // [C3 E3 G3]:4(5,3,1) — the brackets first, then length and fingers in
  // either order, which is how the tutor's own lessons are written.
  let body = tok, fingers = [], beats = stepBeats;
  const fingerMatch = /\(([^)]*)\)/.exec(body);
  if (fingerMatch) {
    fingers = fingerMatch[1].split(",").map((f) => parseInt(f, 10)).filter((f) => f >= 1 && f <= 5);
    body = body.replace(fingerMatch[0], "");
  }
  const lenMatch = /:([^:()]+)$/.exec(body);
  if (lenMatch) {
    const len = lengthToBeats(lenMatch[1], stepBeats);
    if (len === null) {
      warnings.push(`${where}: "${tok}" has a length I cannot read`);
      return null;
    }
    beats = len;
    body = body.slice(0, lenMatch.index);
  }

  let names;
  if (body.startsWith("[")) {
    if (!body.endsWith("]")) { warnings.push(`${where}: "${tok}" is missing its ]`); return null; }
    names = body.slice(1, -1).trim().split(/[\s,]+/).filter(Boolean);
  } else {
    names = [body];
  }

  const midis = [];
  for (const name of names) {
    const midi = noteToMidi(name);
    if (midi === null) { warnings.push(`${where}: "${name}" is not a note`); continue; }
    midis.push(midi);
  }
  if (!midis.length) return null;
  return { midis, beats, fingers };
}
