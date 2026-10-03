/* One door for every kind of file.
 *
 * What a file is, is decided by what is inside it first and by its name
 * second: people rename things, and a lesson saved as .txt is still a lesson.
 */

import { parseScript } from "./script.js";
import { parseLessonDoc } from "./lesson.js";
import { parseMusicXML, readMXL } from "./musicxml.js";
import { parseMIDI } from "./midi.js";

export const ACCEPT = ".json,.txt,.tune,.musicxml,.xml,.mxl,.mid,.midi";

/** Reads a File (or Blob with a name) and returns an array of scores. */
export async function openFile(file) {
  const name = file.name || "";
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || "").toLowerCase();

  if (ext === "mid" || ext === "midi") return [parseMIDI(await file.arrayBuffer())];
  if (ext === "mxl") return [await readMXL(await file.arrayBuffer())];

  // Everything else is text — but a mis-named MIDI file is binary, and it is
  // kinder to say so than to show a page of mojibake.
  const buffer = await file.arrayBuffer();
  const head = new Uint8Array(buffer.slice(0, 4));
  if (String.fromCharCode(...head) === "MThd") return [parseMIDI(buffer)];
  if (head[0] === 0x50 && head[1] === 0x4b) return [await readMXL(buffer)];

  const text = new TextDecoder().decode(buffer);
  const scores = parseText(text, { name });
  for (const score of scores) score.fileName = name;
  return scores;
}

/** Text from a file, a paste or the clipboard. */
export function parseText(text, { name = "" } = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("there is nothing to read");

  if (trimmed.startsWith("<")) return [parseMusicXML(trimmed)];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let doc;
    try {
      doc = JSON.parse(trimmed);
    } catch (e) {
      throw new Error(`that JSON will not parse: ${e.message}`);
    }
    return parseLessonDoc(doc);
  }
  void name;
  return [parseScript(trimmed)];
}

/** What to call a format in the open. */
export const SOURCE_NAMES = {
  script: "tune script",
  lesson: "Piano Tutor lesson",
  musicxml: "MusicXML",
  midi: "MIDI",
};
