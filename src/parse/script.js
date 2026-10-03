/* The tune script: a few header lines, then notes in the tutor's language.
 *
 *   title Twinkle, Twinkle
 *   tempo 96
 *   time 4/4
 *   right: C4 C4 G4 G4 | A4 A4 G4:2
 *   left:  C3:4 | F3:4
 *
 * A line with no part name belongs to the part before it, so the simplest
 * script a chatbot can write is one line of notes.
 */

import { parseHand, lengthToBeats } from "../core/notes.js";
import { scoreFrom } from "../core/score.js";

const HEADERS = ["title", "composer", "tempo", "time", "step", "key"];

export function parseScript(text) {
  const meta = { title: "", composer: "", tempo: 96, time: { beats: 4, unit: 4 }, source: "script", warnings: [] };
  let stepBeats = 1;
  const lines = String(text || "").split(/\r?\n/);
  const hands = {};
  let current = "right";
  let stepLine = null;

  // The step has to be known before any notes are read, so headers go first.
  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) return;
    const head = /^([a-z]+)\s+(.+)$/i.exec(raw);
    if (!head || !HEADERS.includes(head[1].toLowerCase())) return;
    const key = head[1].toLowerCase(), value = head[2].trim();
    if (key === "title") meta.title = value;
    else if (key === "composer") meta.composer = value;
    else if (key === "key") meta.flats = /b|^(F|Dm|Gm|Cm|Fm|Bbm)$/i.test(value) && !/#/.test(value);
    else if (key === "tempo") {
      const n = parseFloat(value);
      if (n >= 20 && n <= 300) meta.tempo = n;
      else meta.warnings.push(`line ${i + 1}: tempo ${value} is outside 20–300`);
    } else if (key === "time") {
      const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
      if (m) meta.time = { beats: parseInt(m[1], 10), unit: parseInt(m[2], 10) };
      else meta.warnings.push(`line ${i + 1}: "${value}" is not a time signature`);
    } else if (key === "step") {
      stepLine = { value, line: i + 1 };
    }
  });
  if (stepLine) {
    const beats = lengthToBeats(stepLine.value, 1);
    if (beats) stepBeats = beats;
    else meta.warnings.push(`line ${stepLine.line}: "${stepLine.value}" is not a note value`);
  }

  lines.forEach((line, i) => {
    const raw = line.trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("//")) return;
    const head = /^([a-z]+)\s+(.+)$/i.exec(raw);
    if (head && HEADERS.includes(head[1].toLowerCase())) return;

    let body = raw;
    const part = /^([A-Za-z][A-Za-z0-9 ]*)\s*:\s*(.*)$/.exec(raw);
    // "right: C4 ..." names a part — but "C4:2 D4" is notes, so a part name
    // is only a part name when it is not a note with a length.
    if (part && !/^[A-Ga-g][#b♯♭x]?-?\d/.test(part[1].trim())) {
      current = part[1].trim().toLowerCase();
      body = part[2];
    }
    if (!body.trim()) return;
    hands[current] = (hands[current] || "") + " " + body;
  });

  const parts = {};
  for (const [name, body] of Object.entries(hands)) {
    parts[name] = parseHand(body, { stepBeats, where: name });
  }
  if (!Object.keys(parts).length) meta.warnings.push("no notes found");
  if (!meta.title) meta.title = "Pasted tune";
  return scoreFrom(meta, parts);
}

/** The other way round: a score written back out as a script. */
export function toScript(score, { midiToNote }) {
  const out = [`title ${score.title}`];
  if (score.composer) out.push(`composer ${score.composer}`);
  out.push(`tempo ${Math.round(score.tempo)}`);
  out.push(`time ${score.time.beats}/${score.time.unit}`);
  const bar = score.beatsPerBar;
  for (const name of score.partNames) {
    const events = score.parts[name];
    let beat = 0, line = [], bars = [];
    for (const e of events) {
      if (e.beat > beat + 1e-6) bars.push(...rest(e.beat - beat));
      const names = e.midis.map((m) => midiToNote(m, score.flats));
      const head = names.length > 1 ? `[${names.join(" ")}]` : names[0];
      bars.push(e.beats === 1 ? head : `${head}:${trim(e.beats)}`);
      beat = e.beat + e.beats;
    }
    // Bar lines every beatsPerBar, counted from the lengths written.
    let at = 0;
    line = [];
    for (const tok of bars) {
      line.push(tok);
      at += tokenBeats(tok);
      if (at >= bar - 1e-6) { line.push("|"); at -= bar; }
    }
    while (line[line.length - 1] === "|") line.pop();
    out.push(`${name}: ${line.join(" ")}`);
  }
  return out.join("\n") + "\n";

  function rest(beats) { return [`.:${trim(beats)}`]; }
  function trim(n) { return String(Math.round(n * 1000) / 1000); }
  function tokenBeats(tok) {
    const m = /:([\d.]+)$/.exec(tok);
    return m ? parseFloat(m[1]) : tok === "|" ? 0 : 1;
  }
}
