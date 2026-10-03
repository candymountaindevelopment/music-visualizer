/* Standard MIDI files, format 0 and 1.
 *
 * A MIDI file is a performance, not a score: it has no bar lines of its own
 * beyond the time signature, and its note lengths are whatever was played.
 * Lengths are rounded to a sixteenth so the lane does not fill with tiles
 * that are a thousandth of a beat apart, and the first tempo wins — a piece
 * that speeds up and slows down is played at one speed here.
 */

import { scoreFrom } from "../core/score.js";

const GRID = 0.25;                            // a sixteenth note

export function parseMIDI(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 14 || str(bytes, 0, 4) !== "MThd") throw new Error("that file is not a MIDI file");

  const format = view.getUint16(8);
  const trackCount = view.getUint16(10);
  const division = view.getUint16(12);
  if (division & 0x8000) throw new Error("SMPTE-timed MIDI files are not supported");
  const ticksPerBeat = division;

  const warnings = [];
  const meta = { title: "", composer: "", tempo: 0, time: { beats: 4, unit: 4 }, source: "midi", warnings };
  const tracks = [];
  let at = 14;

  for (let t = 0; t < trackCount && at < bytes.length; t++) {
    if (str(bytes, at, 4) !== "MTrk") break;
    const length = view.getUint32(at + 4);
    tracks.push(readTrack(bytes, view, at + 8, at + 8 + length, meta, ticksPerBeat));
    at += 8 + length;
  }

  // Format 0 keeps everything on one track, so channels become the parts.
  let groups = [];
  if (format === 0 || tracks.length === 1) {
    const byChannel = {};
    for (const note of tracks.flatMap((t) => t.notes)) {
      (byChannel[note.channel] = byChannel[note.channel] || []).push(note);
    }
    groups = Object.entries(byChannel).map(([ch, notes]) => ({ name: `channel ${+ch + 1}`, notes }));
  } else {
    groups = tracks.filter((t) => t.notes.length).map((t, i) => ({ name: t.name || `track ${i + 1}`, notes: t.notes }));
  }
  if (!groups.length) throw new Error("that MIDI file has no notes");

  // Two groups that look like two hands get called so, which is what the
  // part chooser and the ball's default want.
  if (groups.length === 2) {
    const mean = (g) => g.notes.reduce((s, n) => s + n.midi, 0) / g.notes.length;
    const [a, b] = groups;
    const names = mean(a) >= mean(b) ? ["right", "left"] : ["left", "right"];
    a.name = names[0]; b.name = names[1];
  } else if (groups.length === 1) {
    groups[0].name = "melody";
  }

  const parts = {};
  for (const group of groups) {
    parts[group.name] = { events: toEvents(group.notes, ticksPerBeat), warnings: [] };
  }

  if (!meta.tempo) { meta.tempo = 96; warnings.push("no tempo in the file — 96 is assumed"); }
  if (!meta.title) meta.title = "MIDI piece";
  const score = scoreFrom(meta, parts);
  if (score.noteCount > 600) warnings.push(`${score.noteCount} notes — a long piece; use the section loop to work on part of it`);
  return score;
}

function readTrack(bytes, view, start, end, meta, ticksPerBeat) {
  const notes = [];
  const sounding = new Map();                 // channel:midi → start tick
  let at = start, tick = 0, status = 0, name = "";

  while (at < end) {
    const [delta, next] = varInt(bytes, at);
    tick += delta;
    at = next;
    let byte = bytes[at];
    if (byte & 0x80) { status = byte; at++; } // running status keeps the last one
    const type = status & 0xf0;
    const channel = status & 0x0f;

    if (status === 0xff) {                    // meta
      const kind = bytes[at++];
      const [len, afterLen] = varInt(bytes, at);
      at = afterLen;
      const data = bytes.subarray(at, at + len);
      if (kind === 0x03 && !name) name = new TextDecoder().decode(data).trim();
      else if (kind === 0x01 && !meta.title) meta.title = new TextDecoder().decode(data).trim();
      else if (kind === 0x51 && !meta.tempo && len === 3) {
        const usPerBeat = (data[0] << 16) | (data[1] << 8) | data[2];
        if (usPerBeat > 0) meta.tempo = Math.min(300, Math.max(20, Math.round(60000000 / usPerBeat)));
      } else if (kind === 0x58 && len >= 2) {
        meta.time = { beats: data[0], unit: Math.pow(2, data[1]) };
      }
      at += len;
      continue;
    }
    if (status === 0xf0 || status === 0xf7) { // system exclusive
      const [len, afterLen] = varInt(bytes, at);
      at = afterLen + len;
      continue;
    }

    if (type === 0x90 || type === 0x80) {
      const midi = bytes[at++], velocity = bytes[at++];
      const key = `${channel}:${midi}`;
      if (type === 0x90 && velocity > 0) {
        sounding.set(key, tick);
      } else {
        const from = sounding.get(key);
        if (from !== undefined) {
          sounding.delete(key);
          notes.push({ midi, channel, tick: from, ticks: Math.max(1, tick - from) });
        }
      }
    } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) at += 2;
    else if (type === 0xc0 || type === 0xd0) at += 1;
    else at++;                                 // something unexpected: step over it
  }
  void ticksPerBeat;
  return { name, notes };
}

function toEvents(notes, ticksPerBeat) {
  const byBeat = new Map();
  for (const note of notes.sort((a, b) => a.tick - b.tick)) {
    const beat = snap(note.tick / ticksPerBeat);
    const beats = Math.max(GRID, snap(note.ticks / ticksPerBeat));
    const key = `${beat}`;
    const event = byBeat.get(key);
    if (event) {                               // notes that start together are one chord
      event.midis.push(note.midi);
      event.beats = Math.max(event.beats, beats);
    } else {
      byBeat.set(key, { beat, beats, midis: [note.midi], fingers: [] });
    }
  }
  return [...byBeat.values()].sort((a, b) => a.beat - b.beat);
}

const snap = (beats) => Math.round(beats / GRID) * GRID;

function varInt(bytes, at) {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const byte = bytes[at++];
    value = (value << 7) | (byte & 0x7f);
    if (!(byte & 0x80)) break;
  }
  return [value, at];
}

const str = (bytes, at, len) => String.fromCharCode(...bytes.subarray(at, at + len));
