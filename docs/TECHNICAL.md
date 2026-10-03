# Danas Bouncing Ball — technical document

A static web page that reads a piece of music, plays it on a drawn xylophone,
and runs a ball along a lane of the notes so that the ball lands on each one
at the moment it sounds.

About 2,000 lines of JavaScript across fourteen modules, no dependencies, no
build step, nothing uploaded. This document is for whoever has to change it.

- [1. Shape of the thing](#1-shape-of-the-thing)
- [2. The model](#2-the-model)
- [3. The note language](#3-the-note-language)
- [4. The readers](#4-the-readers)
- [5. The transport](#5-the-transport)
- [6. Drawing](#6-drawing)
- [7. Listening](#7-listening)
- [8. Designs](#8-designs)
- [9. What is remembered](#9-what-is-remembered)
- [10. Tests](#10-tests)
- [11. Serving and deployment](#11-serving-and-deployment)
- [12. Limits, and what would come next](#12-limits-and-what-would-come-next)

---

## 1. Shape of the thing

`index.html` loads `src/app.js` as an ES module; everything else is imported
from there. There is no bundler and no transpiler, which is why the page needs
a server rather than a `file://` address — that, and the microphone, which no
browser will open on a file.

| File | Lines | What it owns |
|---|---:|---|
| `src/core/notes.js` | 149 | note names, note lengths, and the token reader for one hand |
| `src/core/score.js` | 91 | the `Score`: parts of events, bars, range |
| `src/parse/script.js` | 117 | the tune script, and writing a score back out as one |
| `src/parse/lesson.js` | 101 | Danas Piano Tutor `raw.author` lessons |
| `src/parse/musicxml.js` | 193 | MusicXML, partwise, and the `.mxl` container |
| `src/parse/midi.js` | 158 | standard MIDI files, format 0 and 1 |
| `src/parse/open.js` | 60 | one door: sniffs the bytes, picks a reader |
| `src/transport.js` | 230 | the beat clock, scheduling, repeats, sections |
| `src/audio.js` | 91 | the mallet, the click, the output gain |
| `src/instrument.js` | 199 | where the bars are, and drawing them |
| `src/lane.js` | 172 | the lane of tiles, and the ball |
| `src/listen.js` | 120 | YIN on the microphone |
| `src/theme.js` | 195 | designs: schema, merging, CSS variables, library |
| `src/app.js` | 760 | panels, settings, the frame loop, everything wired |

The split that matters: **`transport.js` decides *when*, `instrument.js` and
`lane.js` decide *where*, and `app.js` is the only file that touches the
DOM.** The three parser directories know nothing about any of them — they
produce a `Score` and stop. That is what lets the readers be tested in Node
with no browser at all.

```
 file or paste
      │
      ▼
 parse/open.js ──► parse/{script,lesson,musicxml,midi}.js ──► core/score.js
                                                                   │
                                                                   ▼
                                                             transport.js  ◄── audio.js
                                                                   │
                                        app.js frame loop ─────────┤
                                                                   ▼
                                                    instrument.js + lane.js  ──► canvas
```

---

## 2. The model

A **`Score`** is `{ title, composer, tempo, time, parts, source, flats,
warnings }`, where `parts` is `{ name: [event, ...] }`.

An **event** is one thing that happens at one moment:

```js
{ beat: 4, beats: 1.5, midis: [60, 64, 67], fingers: [5, 3, 1] }
```

A chord is **one event with several pitches**, not several events. That is a
deliberate choice and the ball is the reason: the ball can only land in one
place, so it needs one target per moment. Chords are drawn stacked and the
ball takes the highest note.

**Everything is counted in beats, and one beat is a quarter note.** Not
seconds, not ticks, not divisions: each reader converts into this on the way
in, and nothing downstream knows what a division or a tick was. `score.beats`
rounds the end up to a whole bar, which is what makes a repeat land on the
beat rather than half way through one.

Part names are free text (`right`, `left`, `melody`, `track 2`, `Flute`).
`score.partNames` sorts them so the melody comes first, because the first part
is the one the ball follows.

---

## 3. The note language

The token language is Danas Piano Tutor's, unchanged. A lesson written for the
tutor plays here without translation, and a chatbot that has been told one
format has been told both. `parseHand()` in `core/notes.js` is the only place
that reads it, and both the script reader and the lesson reader call it.

| Token | Means |
|---|---|
| `C4`, `F#4`, `Bb3` | a note, for one step |
| `C4:2` | two steps |
| `C4:1/8`, `C4:1/4.` | an explicit note value; a trailing dot is a dotted note |
| `[C3 E3 G3]` | a chord — one event |
| `(3)`, `(5,3,1)` | fingers, kept on the event, not used for sound |
| `.`, `.:2` | a rest |
| `-` | a hold: the thing before lasts one step longer |
| `\|` | a bar line, which carries no time |

Two details that are easy to get wrong when editing this code:

- **A step is not always a beat.** `step` (default `1/4`) says what a bare
  token lasts. `lengthToBeats("2", stepBeats)` multiplies, `lengthToBeats("1/8", …)`
  does not — a value with a slash is an absolute note value, in beats, where a
  quarter is 1.
- **A hold after a rest extends the rest.** `. - -` is a three-step rest.
  Only a hold with nothing at all before it is reported as a mistake.

Nothing throws. A token that cannot be read is pushed onto `warnings` and
skipped, and the piece still plays — the same bargain the tutor makes, because
a piece that will not load tells you nothing about what is wrong with it. The
warnings appear in the footer as *n notes on this file*.

---

## 4. The readers

All four end at `scoreFrom()`, and all four are reached through
`parse/open.js`, which decides by **what is in the file first and its name
second**: `MThd` is MIDI whatever it is called, `PK` is a zip, `<` is XML, `{`
or `[` is JSON, and anything else is a script. People rename things.

### 4.1 Script (`parse/script.js`)

Headers (`title`, `composer`, `tempo`, `time`, `step`, `key`), then parts.
A part is a line that begins with a name and a colon; lines after it with no
name of their own continue it. Headers are read in a first pass because `step`
has to be known before any notes are.

One ambiguity is worth naming: `right:` is a part and `C4:2` is a note, and
both are `word colon rest`. A part name is only a part name when it does not
look like a note with a length.

`toScript()` goes the other way — a score written back out as a script, with
bar lines inserted from the lengths. It is what **Copy this piece** produces,
so a MIDI file or a MusicXML export can be turned into something a person (or
a chatbot) can edit. The round trip is tested.

### 4.2 Lesson (`parse/lesson.js`)

The `raw.author` JSON: `lessons[]`, each with `tempo`, `time`, `step`, `key`,
and `right`/`left` as a string or `{notes, fingers}`. A separate `fingers`
line is zipped onto the events, and inline fingering wins, which is the rule
the tutor states. A document with several lessons returns several scores and
the app lists them. Flat keys set `score.flats`, so a piece in F spells its
black notes `Bb` rather than `A#` on the bars and the tiles.

### 4.3 MusicXML (`parse/musicxml.js`)

Partwise only, through `DOMParser` — a timewise file is refused with a message
saying to export partwise. Read: `divisions`, `time`, tempo from
`<sound tempo>` or `<metronome><per-minute>`, pitches with `alter`, rests,
`<chord/>`, `<backup>`/`<forward>`, and ties (`tie`/`tied` with
`type="stop"` extends the previous event instead of starting a new one).
Grace notes are dropped — they have no time of their own. Staff 1 and 2 of one
part become `right` and `left`.

`.mxl` is a zip. Entries are found by scanning for the local file header
signature, and deflated entries go through `DecompressionStream("deflate-raw")`,
so there is no zip library to vendor. An ancient browser without it gets a
message telling it to unzip the file.

### 4.4 MIDI (`parse/midi.js`)

Format 0 and 1, with running status, variable-length quantities, meta events
and system exclusive stepped over. SMPTE division is refused. Note lengths are
snapped to a sixteenth, because a performance has lengths like 0.98 beats and
a lane full of tiles a thousandth apart is unreadable. **The first tempo
wins** — a piece that speeds up and slows down is played at one speed here.
Notes that start together become one chord event. Format 0 splits by channel,
format 1 by track, and exactly two groups are named `right` and `left` by
their mean pitch.

---

## 5. The transport

One rule holds the whole thing together:

```
runBeat = (now - t0) / secondsPerBeat - countInBeats
```

`now` is `AudioContext.currentTime`. **Nothing counts frames.** The lane, the
ball, the strike and the sound are all derived from that one number, so they
cannot disagree with each other; the worst a slow frame can do is draw the
same correct picture twice.

- `position` is the run beat, negative during the count-in.
- `place` splits it into `{ pass, beat, countingIn }`.
- `passBeats` is `to − from`, never less than a bar, so a half-finished bar
  does not shorten the loop.

**Scheduling.** `tick()` runs once a frame. Notes whose moment falls inside
`now + 0.25 s` are handed to the synth with that exact time, which is how they
land on the beat regardless of when the frame happened. The event is then put
in `pending`, and `onNote` fires when the moment actually arrives — so the bar
rings when the ear hears it, not a frame early. Anything that turns out to be
more than a quarter second late (the tab was busy, or was not being drawn) is
dropped rather than fired in a heap.

**Seek is the only way to move.** Play, pause, resume, tempo change and
section change all end at `seek(runBeat)`, which sets `t0` and re-derives the
cursors from it:

```js
this.t0 = audio.time - (beat + countInBeats) * secondsPerBeat;
this.clickBeat = Math.ceil(beat);
this.pass = Math.floor(beat / passBeats);
this.cursor = events.findIndex((e) => e.at >= within);
```

That is why changing the tempo mid-piece neither repeats a note nor drops
one — there is one way for the transport to be wrong, and
`test/transport.test.mjs` watches it.

**Repeats** are a pass counter, not a copied list: `repeats` may be
`Infinity`, and `visible(from, to)` walks whatever passes overlap the window
the lane can see. **The section** is `from`/`to` in beats, set from the bar
boxes. **Count-in** is whole bars of clicks before beat 0, and the clicks keep
going through the piece unless the metronome is off, accented on the first
beat of each bar.

`muted` silences the notes but not the clicks and not `onNote`, which is what
*Piece sounds* off means: you play it, the lane still shows you where you are.
`transpose` moves what sounds and what rings, and leaves the score alone — the
lane still draws the piece as written.

---

## 6. Drawing

One canvas, one `requestAnimationFrame` loop in `app.js`. The stage is split
by the design: the lane takes `laneHeight` of the height (clamped to 74–190
px) and the instrument gets the rest.

### 6.1 Canvas sizing

```js
canvas.style.width = `${w}px`;
canvas.style.height = `${h}px`;
canvas.width = Math.round(w * dpr);
canvas.height = Math.round(h * dpr);
ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
```

The CSS size is written out explicitly and not left to `inset: 0`. A canvas
carries its backing store in `width`/`height` attributes, and those are a
*specified* size that beats a stretched box — set them without setting the CSS
size and the canvas is twice as large as its parent on a HiDPI screen.

### 6.2 The instrument

`chooseRange()` picks the lowest C at or below the piece and enough octaves to
cover it (1–4), unless *Keys* says otherwise.

*Upright* is chromatic: naturals in a row, accidentals overlapping their tops
by `OVERHANG` (0.72) of their own length, where an accidental is `BACK` (0.42)
of a natural. Those two fractions decide how much height the front row can
have, so the row is solved rather than fixed:

```
frontMax = (h - foot) / (1 + BACK × OVERHANG)      capped at barWidth × 6
```

Solving it fills a phone in landscape — the first version used fixed
fractions and left a third of the screen empty above the bars — and the cap
stops a tall desktop window from drawing slats instead of a xylophone.

*Ladder* is the toy: horizontal bars, longest at the top, white notes only.
*Auto* picks ladder when the stage is taller than it is wide, because that is
a phone held upright, and the ladder is the shape of that screen.

The rails are drawn **through every bar's cord holes** rather than as two
straight lines, so they follow the bars as the bars shorten. It is a small
thing that does most of the work of making the drawing read as an instrument.

A struck bar sets `hit = 1`, which decays by `× 0.9` a frame and drives the
dip, the halo, the ripple and the floating note name.

### 6.3 The lane and the ball

A note is drawn at `nowX + (runBeat − position) × pixelsPerBeat`, with
`pixelsPerBeat = width / beatsOnScreen`. Pitch becomes height within the
window of what is on screen. The leading part is full strength; the others are
drawn thinner in one colour, to be seen and not followed.

The ball's arc runs between the position of the note it left and the note it
is going to — **the same numbers the sound was scheduled with**, which is why
the landing cannot drift away from what is heard.

The one piece of real arithmetic here: both ends of the arc scroll leftwards
at the same rate, so a straight interpolation cancels exactly and the ball
hangs motionless over the now line. (With `x(t) = x₀ + (x₁ − x₀)·t` and
`x₀ = nowX − t·gap·ppb`, `x₁ = nowX + (1−t)·gap·ppb`, every `t` gives `nowX`.)
The fix is an asymmetric ease:

```js
const e = 1 - Math.pow(1 - t, 4);
x = x0 + (x1 - x0) * e;
y = y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * arc;
```

Leaving fast and arriving slowly makes the ball leap forward onto the note
coming in and ride it down. `e(1) = 1` exactly, so the landing is still the
note's own moment — measured at nought pixels from the now line.

---

## 7. Listening

`listen.js` is YIN (de Cheveigné & Kawahara, 2002) on a 4096-sample window:
cumulative mean normalised difference, first dip under 0.15, parabolic
interpolation. A reading counts when clarity ≥ 0.6 and the window is above the
gate (−55 dB).

Two rules earn their place. A note is reported only when **two frames in a row
agree**, so a wobble does not set off a row of bars. And a window that is
quiet where YIN looks but loud at its end — a strike caught by its tail — is
thrown away, because digital silence is perfectly periodic and reads as a
confident low note.

`app.js` turns a heard note into a mark: the nearest unmarked note of the
leading part within **0.45 beats** of the current position, which turns its
tile green. Marks are keyed `pass:index`, so getting a note right in the
second pass does not light it in the third.

The metronome click is **noise, not a tone**, highpassed at 1.1–1.4 kHz. This
is not fussiness: a pitched click is heard by the detector as a note, and
raising its pitch or stacking partials only moves the problem, because the ear
and the detector both find the difference frequency. Noise above the
instrument has no pitch to find.

---

## 8. Designs

A design is a JSON file of colours, proportions and two switches:

```json
{
  "name": "Night",
  "colours": { "bg": "#0b1016", "accent": "#46d7a1",
               "bars": ["#e5484d", "…seven or more…"], "ball": "#ffe9a8" },
  "shape": { "instrument": "auto", "roundness": 10, "laneHeight": 0.3,
             "ballSize": 1, "barWidth": 0.84, "beatsOnScreen": 7 },
  "text": { "noteNames": true, "fontScale": 1 }
}
```

`normalise()` deep-merges over the defaults, so **a design may contain nothing
but a name and one colour** and still be valid. That is the property that
makes designs safe to hand-edit and safe to add to.

Two paths out of the theme object: `applyToPage()` writes CSS custom
properties on `:root`, which colours the panels, buttons and text; the canvas
reads the object directly. `barColour()` maps a pitch to the palette by scale
step, so a palette of any length works and a tune in C starts on the first
colour.

The library is `themes/*.json` listed in `themes/index.json`, fetched at
startup. **Adding a design is adding a file** — no code changes. Whatever the
panel edits is saved under `dbb.theme`; *Save as a file* writes the same shape
back out, and *Load a design* reads one.

---

## 9. What is remembered

| Key | What |
|---|---|
| `dbb.theme` | the live design, as edited |
| `dbb.settings` | tempo, repeats, count-in, metronome, piece sounds, volume, keys |
| `dbb.piece` | the text of the last piece opened, so the next visit opens it |

A MIDI file is not remembered — it is binary, and the box holds text. Every
read and write is wrapped, because a private window throws rather than
returning nothing, and none of this is worth an error.

The section and the part chooser are deliberately **not** remembered: they
belong to a piece, not to the person.

---

## 10. Tests

```bash
node --test test/*.test.mjs        # 27 tests
```

`test/parse.test.mjs` covers the note language, the script reader (including
the round trip through `toScript`), the lesson reader — run against Danas
Piano Tutor's own example lessons when that repository is beside this one, and
skipped when it is not — and a MIDI file built byte by byte in the test.

`test/transport.test.mjs` drives the transport with a **fake audio clock**:
`{ now }` that the test moves forward in 1/60 s steps while calling `tick()`.
Playback is the part that cannot be checked by looking at it, so this is where
count-in, repeats, endless repeat, section loops, pause and resume, tempo
change mid-piece, muting, two hands and transposition are each pinned down —
every note of every pass, at the right moment, once each.

What is **not** covered by Node: anything that needs a DOM or a canvas — the
MusicXML reader (`DOMParser`), the drawing, the listener. Those are checked in
a browser; the MusicXML reader has been exercised on divisions, ties across a
bar line, `alter`, `backup` and two staves.

---

## 11. Serving and deployment

`serve.py` is a development server with the right media types and
`microphone=(self)`. Any static server does; it must be a server.

GitHub Pages is the published home, through
`.github/workflows/pages.yml` — it runs the tests, then uploads the repository
as it stands. There is nothing to build. The repository is `music-visualizer`,
so the address is
<https://candymountaindevelopment.github.io/music-visualizer/>.

Every fetch the page makes is **relative** (`themes/`, `examples/`,
`docs/SCRIPT_GUIDE.md`), which is what lets it live under a repository path
rather than at a domain root.

`docs/SCRIPT_GUIDE.md` is fetched at runtime and shown in the **Guide** panel,
so the document a chatbot is handed and the document in the repository cannot
drift apart.

---

## 12. Limits, and what would come next

- **The detector hears one pitch at a time.** Playing along with chords scores
  the top note only. MIDI input (Web MIDI) would remove the limit entirely and
  is the obvious next thing.
- **One tempo per piece.** A MusicXML or MIDI file that changes speed is
  played at its first marking.
- **No key signature on screen** and no engraved stave: this is a lane of
  tiles, not sheet music. Accidentals are spelled from `key`.
- **No swing, no triplets.** Triplet lengths can be written (`:1/3`) but
  nothing draws them as triplets.
- **The whole piece is in memory and drawn per frame.** A 600-note file is
  fine; a symphony is not what this is for, and a warning says so.
- **Audio starts on a gesture**, as every browser requires, so the first Play
  is what creates the context.
- A page that is not on screen is not animated, so playback pauses itself on
  `visibilitychange` rather than running on in silence.
