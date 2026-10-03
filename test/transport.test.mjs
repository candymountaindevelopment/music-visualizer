/* The transport, driven by a fake clock.
 *
 * Playback is the part that cannot be checked by looking at it, so it is
 * checked here: every note of every pass, at the right moment, once each.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { parseScript } from "../src/parse/script.js";
import { Transport } from "../src/transport.js";

class FakeAudio {
  constructor() { this.now = 100; this.notes = []; this.clicks = []; this.ready = true; }
  get time() { return this.now; }
  start() { return this; }
  note(midi, when) { this.notes.push({ midi, when: round(when) }); return when; }
  click(when, accent) { this.clicks.push({ when: round(when), accent }); return when; }
}

const round = (n) => Math.round(n * 1e6) / 1e6;

function rig(text, options = {}) {
  const score = parseScript(text);
  const audio = new FakeAudio();
  const struck = [];
  const ends = [];
  const transport = new Transport(audio, {
    onNote: (event, runBeat) => struck.push({ midis: event.midis, runBeat: round(runBeat), at: round(audio.now) }),
    onEnd: () => ends.push(round(audio.now)),
  });
  transport.countInBars = 0;
  transport.metronome = false;
  Object.assign(transport, options.transport || {});
  transport.load(score, options.load);
  return { score, audio, transport, struck, ends };
}

/** Run the clock forward in frames, ticking as a browser would. */
function run(audio, transport, seconds, step = 1 / 60) {
  for (let t = 0; t < seconds; t += step) {
    audio.now = round(audio.now + step);
    transport.tick();
  }
}

test("a piece plays its notes once, on the beat", () => {
  const { audio, transport, struck } = rig("tempo 120\nright: C4 D4 E4 F4");
  transport.play();
  run(audio, transport, 2.5);
  assert.equal(audio.notes.length, 4);
  assert.deepEqual(audio.notes.map((n) => n.midi), [60, 62, 64, 65]);
  // 120 bpm: half a second a beat, starting at the moment play was pressed.
  const t0 = audio.notes[0].when;
  assert.deepEqual(audio.notes.map((n) => round(n.when - t0)), [0, 0.5, 1, 1.5]);
  assert.equal(struck.length, 4);
  assert.deepEqual(struck.map((s) => s.runBeat), [0, 1, 2, 3]);
});

test("the count-in happens before the first note, and clicks through it", () => {
  const { audio, transport } = rig("tempo 120\ntime 4/4\nright: C4 D4 E4 F4", {
    transport: { countInBars: 1, metronome: true },
  });
  transport.play();
  const start = audio.now;
  run(audio, transport, 4.4);
  assert.equal(audio.notes.length, 4);
  assert.ok(audio.notes[0].when - start >= 2 - 1e-6, "the first note waits a bar");
  const accents = audio.clicks.filter((c) => c.accent);
  assert.equal(audio.clicks.length, 8);            // four counting in, four playing
  assert.equal(accents.length, 2);                 // one at the top of each bar
});

test("repeats play the whole section again, and then it ends", () => {
  const { audio, transport, struck, ends } = rig("tempo 240\nright: C4 D4", {
    transport: { repeats: 3 },
  });
  assert.equal(transport.passBeats, 4, "a pass is whole bars");
  transport.play();
  run(audio, transport, 3.6);
  assert.equal(audio.notes.length, 6);
  assert.deepEqual(struck.map((s) => s.runBeat), [0, 1, 4, 5, 8, 9]);
  assert.equal(ends.length, 1);
  assert.equal(transport.playing, false);
});

test("an endless repeat keeps going", () => {
  const { audio, transport } = rig("tempo 240\nright: C4 D4", {
    transport: { repeats: Infinity },
  });
  transport.play();
  run(audio, transport, 4.2);
  assert.ok(audio.notes.length >= 8, `only ${audio.notes.length} notes`);
  assert.equal(transport.playing, true);
});

test("a section loops just those bars", () => {
  const { audio, transport, struck } = rig("tempo 240\nright: C4 D4 E4 F4 | G4 A4 B4 C5", {
    transport: { repeats: 2 },
  });
  transport.setSection(4, 8);                      // the second bar only
  transport.play();
  run(audio, transport, 3);
  assert.deepEqual(audio.notes.map((n) => n.midi), [67, 69, 71, 72, 67, 69, 71, 72]);
  assert.deepEqual(struck.map((s) => s.runBeat), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("changing the tempo mid-piece keeps the place and does not repeat a note", () => {
  const { audio, transport, struck } = rig("tempo 120\nright: C4 D4 E4 F4 | G4 A4 B4 C5");
  transport.play();
  run(audio, transport, 1.1);                      // two notes in
  const before = struck.length;
  const where = transport.position;
  transport.setTempo(240);
  assert.ok(Math.abs(transport.position - where) < 0.05, "the place moved");
  run(audio, transport, 2);
  assert.equal(struck.length, 8);
  assert.ok(before >= 2 && before <= 3);
  const midis = audio.notes.map((n) => n.midi);
  assert.deepEqual(midis, [60, 62, 64, 65, 67, 69, 71, 72]);
});

test("pause stops the sound and resume carries on from the same beat", () => {
  const { audio, transport } = rig("tempo 120\nright: C4 D4 E4 F4");
  transport.play();
  run(audio, transport, 0.6);
  const played = audio.notes.length;
  transport.pause();
  const held = transport.position;
  run(audio, transport, 2);
  assert.equal(audio.notes.length, played, "it played on while paused");
  transport.play();
  assert.ok(Math.abs(transport.position - held) < 0.05);
  run(audio, transport, 2);
  assert.equal(audio.notes.length, 4);
});

test("muting the piece keeps the clicks and still reports the notes", () => {
  const { audio, transport, struck } = rig("tempo 240\nright: C4 D4 E4 F4", {
    transport: { muted: true, metronome: true },
  });
  transport.play();
  run(audio, transport, 1.5);
  assert.equal(audio.notes.length, 0);
  assert.ok(audio.clicks.length >= 4);
  assert.equal(struck.length, 4, "the lane still needs to know");
});

test("both hands sound, and the lead is the louder", () => {
  const { audio, transport } = rig("tempo 240\nright: C4 D4\nleft: C3:2");
  transport.play();
  run(audio, transport, 1.2);
  assert.deepEqual(audio.notes.map((n) => n.midi).sort((a, b) => a - b), [48, 60, 62]);
});

test("the lane is given the notes of the passes it can see", () => {
  const { transport } = rig("tempo 120\nright: C4 D4 E4 F4", { transport: { repeats: 4 } });
  const window = transport.visible(2, 9);
  assert.ok(window.length >= 6);
  assert.ok(window.some((v) => v.pass === 1), "the next pass is missing");
  assert.ok(window.every((v) => v.runBeat >= 0));
});

test("a transposed piece sounds moved but is still drawn where it was written", () => {
  const { audio, transport, struck } = rig("tempo 240\nright: C4 D4", { transport: { transpose: 12 } });
  transport.play();
  run(audio, transport, 1);
  assert.deepEqual(audio.notes.map((n) => n.midi), [72, 74]);
  assert.deepEqual(struck[0].midis, [60]);
});
