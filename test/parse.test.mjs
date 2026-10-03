/* Tests for the parts that need no browser: the note language, the script
 * and the lesson reader, run against the tutor's own example lessons.
 *
 *   node --test test/
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

import { noteToMidi, midiToNote, lengthToBeats, parseHand } from "../src/core/notes.js";
import { parseScript, toScript } from "../src/parse/script.js";
import { parseLessonDoc } from "../src/parse/lesson.js";
import { parseMIDI } from "../src/parse/midi.js";

test("note names go both ways", () => {
  assert.equal(noteToMidi("C4"), 60);
  assert.equal(noteToMidi("A0"), 21);
  assert.equal(noteToMidi("F#4"), 66);
  assert.equal(noteToMidi("Gb4"), 66);
  assert.equal(noteToMidi("H4"), null);
  assert.equal(midiToNote(60), "C4");
  assert.equal(midiToNote(66), "F#4");
  assert.equal(midiToNote(66, true), "Gb4");
});

test("lengths are counted in beats, a beat being a quarter", () => {
  assert.equal(lengthToBeats("2", 1), 2);
  assert.equal(lengthToBeats("1/8", 1), 0.5);
  assert.equal(lengthToBeats("1/4.", 1), 1.5);
  assert.equal(lengthToBeats("1.5", 1), 1.5);
  assert.equal(lengthToBeats("2", 0.5), 1);      // two eighth-note steps
  assert.equal(lengthToBeats("0", 1), null);
});

test("a hand reads notes, lengths, fingers, chords, rests and holds", () => {
  const { events, warnings, beats } = parseHand("E4(3) D4 C4:2 | [C3 E3 G3]:2(5,3,1) - . G4:1/8");
  assert.deepEqual(warnings, []);
  assert.deepEqual(events[0], { beat: 0, beats: 1, midis: [64], fingers: [3] });
  assert.deepEqual(events[2].midis, [60]);
  assert.equal(events[2].beats, 2);
  assert.deepEqual(events[3].midis, [48, 52, 55]);
  assert.deepEqual(events[3].fingers, [5, 3, 1]);
  assert.equal(events[3].beats, 3);             // :2 plus the hold after it
  assert.equal(events[4].midis[0], 67);
  assert.equal(events[4].beat, 8);              // after the chord, its hold and a rest
  assert.equal(events[4].beats, 0.5);
  assert.equal(beats, 8.5);
});

test("a bad token is reported and the rest still plays", () => {
  const { events, warnings } = parseHand("C4 H4 D4");
  assert.equal(events.length, 2);
  assert.match(warnings[0], /"H4" is not a note/);
});

test("a script needs nothing but notes", () => {
  const score = parseScript("C4 D4 E4 F4");
  assert.equal(score.noteCount, 4);
  assert.equal(score.tempo, 96);
  assert.equal(score.leadName, "right");
});

test("a script reads its headers and both hands", () => {
  const score = parseScript([
    "# a comment",
    "title Twinkle, Twinkle",
    "tempo 84",
    "time 3/4",
    "right: C4 C4 G4 | G4 A4 A4",
    "left: C3:3 | F3:3",
  ].join("\n"));
  assert.equal(score.title, "Twinkle, Twinkle");
  assert.equal(score.tempo, 84);
  assert.deepEqual(score.time, { beats: 3, unit: 3 * 0 + 4 });
  assert.deepEqual(score.partNames, ["right", "left"]);
  assert.equal(score.beatsPerBar, 3);
  assert.equal(score.bars, 2);
  assert.deepEqual(score.range(), [48, 69]);
});

test("a note with a length is not mistaken for a part name", () => {
  const score = parseScript("C4:2 D4:2");
  assert.equal(score.noteCount, 2);
  assert.deepEqual(score.partNames, ["right"]);
});

test("the step changes what a bare token lasts", () => {
  const score = parseScript("step 1/8\nC4 D4 E4 F4");
  assert.equal(score.parts.right[1].beat, 0.5);
});

test("a script survives the round trip", () => {
  const first = parseScript("title Round\ntempo 100\nright: C4 D4 E4:2 | [C4 E4 G4]:4");
  const text = toScript(first, { midiToNote });
  const again = parseScript(text);
  assert.equal(again.title, "Round");
  assert.equal(again.tempo, 100);
  assert.equal(again.noteCount, first.noteCount);
  assert.deepEqual(again.parts.right.map((e) => e.beat), first.parts.right.map((e) => e.beat));
});

const EXAMPLES = "C:/Users/alpha/OneDrive/Desktop/New/Dev/RetroAudioWorkstation/docs/examples/lessons";

test("the tutor's own lessons load", { skip: !existsSync(EXAMPLES) }, () => {
  const files = [
    "02_hot_cross_buns.json", "03_mary_had_a_little_lamb.json",
    "04_twinkle_twinkle.json", "05_ode_to_joy.json", "06_jingle_bells.json",
    "07_minuet_in_g.json", "01_five_finger_warmups.json",
  ];
  for (const file of files) {
    const scores = parseLessonDoc(readFileSync(`${EXAMPLES}/${file}`, "utf8"));
    assert.ok(scores.length >= 1, file);
    for (const score of scores) {
      assert.ok(score.noteCount > 0, `${file}: no notes`);
      assert.ok(score.tempo >= 20 && score.tempo <= 300, `${file}: tempo`);
      assert.deepEqual(score.warnings.filter((w) => /is not a note|cannot read/.test(w)), [], `${file}: ${score.warnings}`);
    }
  }
});

test("Ode to Joy comes out with the right shape", { skip: !existsSync(EXAMPLES) }, () => {
  const [score] = parseLessonDoc(readFileSync(`${EXAMPLES}/05_ode_to_joy.json`, "utf8"));
  assert.equal(score.title, "Ode to Joy");
  assert.equal(score.composer, "L. van Beethoven");
  assert.equal(score.tempo, 96);
  assert.deepEqual(score.partNames, ["right", "left"]);
  assert.equal(score.bars, 8);
  assert.equal(score.beats, 32);
  assert.deepEqual(score.parts.right.slice(0, 4).map((e) => e.midis[0]), [64, 64, 65, 67]);
  assert.deepEqual(score.parts.right[12], { beat: 12, beats: 1.5, midis: [64], fingers: [] });
  assert.equal(score.parts.right[13].beats, 0.5);
});

test("a chord lesson keeps its chords whole", { skip: !existsSync(EXAMPLES) }, () => {
  const scores = parseLessonDoc(readFileSync(`${EXAMPLES}/03_mary_had_a_little_lamb.json`, "utf8"));
  const withChords = scores.find((s) => s.events(["left"]).some((e) => e.midis.length > 1));
  assert.ok(withChords, "no chords found");
  const chords = withChords.events(["left"]).filter((e) => e.midis.length > 1);
  assert.equal(chords.length, 8);               // one in every bar
  assert.deepEqual(chords[0].midis, [48, 52, 55]);
  assert.deepEqual(chords[0].fingers, [5, 3, 1]);
  assert.equal(chords[0].beats, 4);             // all three notes, one event, four beats
});

test("a lesson document with several lessons gives several scores", { skip: !existsSync(EXAMPLES) }, () => {
  const scores = parseLessonDoc(readFileSync(`${EXAMPLES}/01_five_finger_warmups.json`, "utf8"));
  assert.equal(scores.length, 4);
  assert.ok(scores.every((s) => s.noteCount > 0));
});

test("a bare lesson object is accepted too", () => {
  const scores = parseLessonDoc({ name: "x", title: "Bare", right: "C4 D4 E4" });
  assert.equal(scores.length, 1);
  assert.equal(scores[0].title, "Bare");
});

test("nonsense is refused with something to read", () => {
  assert.throws(() => parseLessonDoc({ hello: "world" }), /no lessons/);
  assert.throws(() => parseMIDI(new Uint8Array([1, 2, 3, 4]).buffer), /not a MIDI file/);
});

test("a MIDI file built by hand plays back", () => {
  // Two quarter notes, C4 then E4, on one track at 120 bpm.
  const midi = buildMidi();
  const score = parseMIDI(midi.buffer);
  assert.equal(score.source, "midi");
  assert.equal(score.tempo, 120);
  assert.equal(score.noteCount, 2);
  const events = score.events();
  assert.deepEqual(events.map((e) => [e.beat, e.beats, e.midis[0]]), [[0, 1, 60], [1, 1, 64]]);
});

function buildMidi() {
  const bytes = [];
  const push = (...v) => bytes.push(...v);
  const str = (s) => push(...[...s].map((c) => c.charCodeAt(0)));
  str("MThd"); push(0, 0, 0, 6, 0, 0, 0, 1, 0, 96);          // format 0, 1 track, 96 ppq
  const track = [];
  const t = (...v) => track.push(...v);
  t(0, 0xff, 0x51, 3, 0x07, 0xa1, 0x20);                      // 500000 us a beat = 120 bpm
  t(0, 0x90, 60, 100); t(96, 0x80, 60, 0);
  t(0, 0x90, 64, 100); t(96, 0x80, 64, 0);
  t(0, 0xff, 0x2f, 0);
  str("MTrk");
  push((track.length >> 24) & 255, (track.length >> 16) & 255, (track.length >> 8) & 255, track.length & 255);
  push(...track);
  return new Uint8Array(bytes);
}
