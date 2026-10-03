/* MusicXML, partwise or timewise, including the compressed .mxl container.
 *
 * Only what a player needs is read: pitches, lengths, rests, chords, ties,
 * the time signature and whatever tempo the file admits to. Slurs, dynamics,
 * lyrics and layout are ignored on purpose — there is nothing here that draws
 * them.
 */

import { scoreFrom } from "../core/score.js";

export function parseMusicXML(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const bad = doc.querySelector("parsererror");
  if (bad) throw new Error("that file is not readable XML");
  const root = doc.documentElement;
  if (!/score-partwise|score-timewise/i.test(root.nodeName)) throw new Error("that XML is not MusicXML");
  if (/timewise/i.test(root.nodeName)) throw new Error("timewise MusicXML is not supported — export partwise");

  const warnings = [];
  const meta = {
    title: text1(doc, "work-title") || text1(doc, "movement-title") || "MusicXML piece",
    composer: creator(doc, "composer"),
    tempo: 96,
    time: { beats: 4, unit: 4 },
    source: "musicxml",
    warnings,
  };

  const names = {};
  for (const sp of doc.querySelectorAll("part-list score-part")) {
    names[sp.getAttribute("id")] = (sp.querySelector("part-name")?.textContent || "").trim();
  }

  const parts = {};
  let tempoFound = null, timeFound = null;

  for (const part of doc.querySelectorAll("score-partwise > part, part")) {
    const id = part.getAttribute("id") || "P1";
    let divisions = 1;
    let beat = 0;                               // where we are, in beats
    let lastEvents = {};                        // staff → the event before, for ties and chords
    const staves = {};

    for (const measure of part.querySelectorAll("measure")) {
      const measureStart = beat;
      let maxEnd = beat;

      for (const node of measure.children) {
        const tag = node.nodeName.toLowerCase();

        if (tag === "attributes") {
          const d = parseFloat(node.querySelector("divisions")?.textContent);
          if (d > 0) divisions = d;
          const t = node.querySelector("time");
          if (t && !timeFound) {
            const b = parseInt(t.querySelector("beats")?.textContent, 10);
            const u = parseInt(t.querySelector("beat-type")?.textContent, 10);
            if (b > 0 && u > 0) timeFound = { beats: b, unit: u };
          }
        } else if (tag === "direction" || tag === "sound") {
          const sound = tag === "sound" ? node : node.querySelector("sound");
          const t = parseFloat(sound?.getAttribute("tempo"));
          if (t > 0 && !tempoFound) tempoFound = t;
          const per = node.querySelector?.("metronome per-minute");
          if (per && !tempoFound) {
            const n = parseFloat(per.textContent);
            if (n > 0) tempoFound = n;
          }
        } else if (tag === "backup") {
          beat -= quarters(node, divisions);
        } else if (tag === "forward") {
          beat += quarters(node, divisions);
        } else if (tag === "note") {
          const staff = node.querySelector("staff")?.textContent?.trim() || "1";
          const beats = quarters(node, divisions);
          const isChord = !!node.querySelector("chord");
          const isRest = !!node.querySelector("rest");
          const isGrace = !!node.querySelector("grace");
          if (isGrace) continue;                 // no time of its own

          if (isChord) beat -= lastLength(lastEvents[staff]);

          if (!isRest) {
            const midi = pitchToMidi(node.querySelector("pitch"));
            if (midi === null) {
              warnings.push(`${names[id] || id}: a note without a readable pitch was skipped`);
            } else {
              const tieStop = node.querySelector('tie[type="stop"], tied[type="stop"]');
              const prev = lastEvents[staff];
              if (tieStop && prev && prev.midis.includes(midi) && Math.abs(prev.beat + prev.beats - beat) < 1e-6) {
                prev.beats += beats;             // a tied note is one sound
              } else if (isChord && prev && Math.abs(prev.beat - beat) < 1e-6) {
                prev.midis.push(midi);
              } else {
                const event = { beat, beats, midis: [midi], fingers: [] };
                (staves[staff] = staves[staff] || []).push(event);
                lastEvents[staff] = event;
              }
            }
          }
          beat += beats;
          maxEnd = Math.max(maxEnd, beat);
        }
      }
      beat = Math.max(maxEnd, measureStart);
    }

    const staffNames = Object.keys(staves);
    for (const staff of staffNames) {
      const label = partLabel(names[id], staff, staffNames.length, Object.keys(parts).length);
      parts[label] = { events: staves[staff], warnings: [] };
    }
  }

  if (tempoFound) meta.tempo = Math.min(300, Math.max(20, tempoFound));
  else warnings.push("no tempo in the file — 96 is assumed, change it with the tempo control");
  if (timeFound) meta.time = timeFound;

  if (!Object.keys(parts).length) throw new Error("that MusicXML has no notes");
  return scoreFrom(meta, parts);
}

/* .mxl is a zip: stored or deflated entries, which is all the container
 * holds. DecompressionStream does the inflating, so nothing is vendored. */
export async function readMXL(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  for (let i = 0; i < bytes.length - 3; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const method = view.getUint16(i + 8, true);
    const compressed = view.getUint32(i + 18, true);
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const start = i + 30 + nameLen + extraLen;
    entries.push({
      name: new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen)),
      method,
      data: bytes.subarray(start, start + compressed),
    });
  }
  const want = entries.find((e) => /\.musicxml$/i.test(e.name) && !e.name.startsWith("META-INF"))
    || entries.find((e) => /\.xml$/i.test(e.name) && !e.name.startsWith("META-INF"));
  if (!want) throw new Error("no score inside that .mxl");
  const bytesOut = want.method === 0 ? want.data : await inflate(want.data);
  return parseMusicXML(new TextDecoder().decode(bytesOut));
}

async function inflate(data) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("this browser cannot open a compressed .mxl — unzip it and open the .musicxml");
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function quarters(node, divisions) {
  const d = parseFloat(node.querySelector("duration")?.textContent);
  return d > 0 ? d / divisions : 0;
}

function lastLength(event) {
  return event ? event.beats : 0;
}

function pitchToMidi(pitch) {
  if (!pitch) return null;
  const step = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[pitch.querySelector("step")?.textContent?.trim()];
  const octave = parseInt(pitch.querySelector("octave")?.textContent, 10);
  if (step === undefined || Number.isNaN(octave)) return null;
  const alter = parseFloat(pitch.querySelector("alter")?.textContent) || 0;
  return (octave + 1) * 12 + step + Math.round(alter);
}

function partLabel(name, staff, staffCount, already) {
  const clean = (name || "").trim();
  if (staffCount > 1) {
    const hand = staff === "1" ? "right" : staff === "2" ? "left" : `staff ${staff}`;
    return clean && !/piano/i.test(clean) ? `${clean} ${hand}` : hand;
  }
  return clean || (already ? `part ${already + 1}` : "melody");
}

function text1(doc, tag) {
  return doc.querySelector(tag)?.textContent?.trim() || "";
}

function creator(doc, type) {
  for (const node of doc.querySelectorAll("identification creator")) {
    if ((node.getAttribute("type") || "").toLowerCase() === type) return node.textContent.trim();
  }
  return "";
}
