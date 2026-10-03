/* Danas Piano Tutor lessons: the `raw.author` JSON the tutor itself reads.
 *
 * A document can hold several lessons; this returns one score per lesson, so
 * a set of exercises arrives as a small library rather than one long piece.
 */

import { parseHand, lengthToBeats } from "../core/notes.js";
import { scoreFrom } from "../core/score.js";

const FLAT_KEYS = ["F", "Bb", "Eb", "Ab", "Db", "Gb", "Cb", "Dm", "Gm", "Cm", "Fm", "Bbm", "Ebm"];

/** Accepts the parsed JSON (or text). Returns an array of scores. */
export function parseLessonDoc(input) {
  const doc = typeof input === "string" ? JSON.parse(input) : input;
  if (!doc || typeof doc !== "object") throw new Error("that file is not a lesson document");

  const lessons = Array.isArray(doc.lessons) ? doc.lessons
    : doc.lesson ? [doc.lesson]
    : (doc.right || doc.left || doc.notes) ? [doc]            // a bare lesson
    : null;
  if (!lessons || !lessons.length) throw new Error("no lessons in that file");

  return lessons.map((lesson) => parseLesson(lesson, doc));
}

export function parseLesson(lesson, doc = {}) {
  const warnings = [];
  const time = readTime(lesson.time, warnings);
  const stepBeats = lesson.step ? (lengthToBeats(lesson.step, 1) || 1) : 1;
  if (lesson.step && !lengthToBeats(lesson.step, 1)) warnings.push(`step "${lesson.step}" is not a note value`);

  const meta = {
    title: lesson.title || lesson.name || doc.project?.name || "Lesson",
    composer: lesson.composer || "",
    tempo: clampTempo(lesson.tempo, warnings),
    time,
    source: "lesson",
    flats: FLAT_KEYS.includes(String(lesson.key || "").trim()),
    warnings,
  };

  const parts = {};
  for (const name of ["right", "left"]) {
    const hand = lesson[name];
    if (!hand) continue;
    const notes = typeof hand === "string" ? hand : hand.notes;
    if (!notes) { warnings.push(`${name}: no notes`); continue; }
    const read = parseHand(notes, { stepBeats, where: name });
    applyFingers(read, typeof hand === "object" ? hand.fingers : null);
    parts[name] = read;
  }
  if (!Object.keys(parts).length && lesson.notes) {
    parts.melody = parseHand(lesson.notes, { stepBeats, where: "notes" });
  }

  const score = scoreFrom(meta, parts);
  checkBars(score);
  return score;
}

function applyFingers(read, fingers) {
  if (!fingers) return;
  const groups = String(fingers).trim().split(/\s+/);
  read.events.forEach((event, i) => {
    if (event.fingers.length || !groups[i]) return;           // written inline wins
    event.fingers = groups[i].split(",").map((f) => parseInt(f, 10)).filter((f) => f >= 1 && f <= 5);
  });
}

function readTime(text, warnings) {
  if (!text) return { beats: 4, unit: 4 };
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(String(text).trim());
  if (!m) { warnings.push(`time "${text}" is not a time signature`); return { beats: 4, unit: 4 }; }
  return { beats: parseInt(m[1], 10), unit: parseInt(m[2], 10) };
}

function clampTempo(tempo, warnings) {
  const n = Number(tempo);
  if (!n) return 80;
  if (n < 20 || n > 300) { warnings.push(`tempo ${tempo} is outside 20–300`); return Math.min(300, Math.max(20, n)); }
  return n;
}

/* The tutor reports bars that do not add up, and so does this: a piece that
 * loops is where a missing beat is most obvious. */
function checkBars(score) {
  const bar = score.beatsPerBar;
  for (const name of score.partNames) {
    let at = 0, index = 1, counted = 0;
    for (const e of score.parts[name]) {
      counted = e.beat + e.beats;
    }
    at = counted;
    if (Math.abs(at / bar - Math.round(at / bar)) > 0.01) {
      score.warnings.push(`${name}: the last bar is ${trim(at % bar)} beat(s), the time signature wants ${trim(bar)}`);
    }
    void index;
  }
}

const trim = (n) => String(Math.round(n * 100) / 100);
