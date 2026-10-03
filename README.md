# Danas Bouncing Ball

**<https://candymountaindevelopment.github.io/music-visualizer/>**

Play a piece on a xylophone and watch a ball land on every note.

Give it a **Danas Piano Tutor lesson**, a **tune script**, a **MusicXML**
export or a **MIDI file**. The notes run along a lane under the instrument,
the ball leaps from one to the next and lands on each at the moment it
sounds, and the bar rings. Set the speed, how many times it repeats, which
bars to work on and which hand to follow — then play along, and the notes you
get right turn green.

It is a static web page. No build, no dependencies, nothing uploaded: the
music you open is read in the browser and stays there.

## Opening it

Any static server will do, and it must be a server rather than a `file://`
address — the page is built from ES modules, and a browser will not open a
microphone on a file either.

```bash
python serve.py
```

Then <http://127.0.0.1:8770>. On GitHub Pages it needs no configuration at
all: push, set *Settings → Pages → Source* to **GitHub Actions**, and the
workflow in `.github/workflows/pages.yml` runs the tests and publishes the
repository as it stands. It lives in the `music-visualizer` repository, which
is why the published address does not carry the app's own name.

## The controls

| | |
|---|---|
| **Play / Stop** | space plays and pauses, `S` stops |
| **Tempo** | 30–208 beats a minute, and *written* puts it back to the piece's own mark. `[` and `]` nudge it |
| **Repeat** | once, a number of times, or keep going |
| **Count-in** | a bar or two of clicks before the first note |
| **Bars** | the section to loop — bar 5 to bar 8 while you learn it |
| **Part** | which hand sounds, and which one the ball follows (the first) |
| **Key** | transpose by semitones; the instrument moves with it |
| **Metronome / Piece sounds** | the clicks, and the notes. Turn the notes off to play them yourself |
| **Listen** | opens the microphone and marks the notes you play in time |
| **Music** | paste, open a file, pick an example, or copy the piece back out as a script |
| **Design** | the look, see below |
| **Guide** | the script format, with a button that copies it for a chatbot |

## The music it reads

- **Piano Tutor lessons** (`.json`, the `raw.author` format) — several
  lessons in one document become a list to pick from. Fingering is read and
  kept; chords stay whole.
- **Tune scripts** (`.txt`) — the tutor's own note language with a few
  header lines. The whole format is in
  [docs/SCRIPT_GUIDE.md](docs/SCRIPT_GUIDE.md), which the **Guide** button
  copies for handing to a chatbot.
- **MusicXML** (`.musicxml`, `.xml`, `.mxl`) — pitches, lengths, rests,
  chords, ties, the time signature and the tempo. Two staves become two
  hands.
- **MIDI** (`.mid`) — tracks become parts, lengths are rounded to a
  sixteenth, and the first tempo in the file is used throughout.

Drop a file anywhere on the page, or use **Music → Open a file**.

## Designs

A design is a small JSON file: colours, a few proportions, two switches.
**Design** has colour pickers and sliders for all of it, and the result can be
saved as a file.

To add one to the app for good, put it in `themes/` and name it in
`themes/index.json`:

```json
{ "themes": ["night.json", "daylight.json", "toy.json", "neon.json", "paper.json"] }
```

It appears in the menu next time the page loads. The five that ship are a
starting point, not a limit — the shape of the file is in
[themes/night.json](themes/night.json), and anything missing from a design
falls back to the defaults, so a file with nothing but a name and two colours
is a valid design.

Whatever you change by hand is remembered in the browser until you press
*Start again*.

## How it keeps time

The beat comes from the audio clock, never from a frame counter:

    runBeat = (now - t0) / secondsPerBeat - countInBeats

Notes are handed to the audio scheduler a quarter of a second early and the
bar is rung when that moment actually arrives. The lane places a note at
`nowX + (noteBeat - runBeat) × pixelsPerBeat`, and the ball's arc runs between
the positions of the note it left and the note it is going to — the same
numbers the sound was scheduled with, so the landing cannot drift away from
what is heard. Changing the speed, pausing, looping a section and jumping
between repeats all work by moving `t0` and re-deriving the cursors, so there
is one way for the transport to be wrong, and
[test/transport.test.mjs](test/transport.test.mjs) checks it.

## How it is built

[docs/TECHNICAL.md](docs/TECHNICAL.md) is the document for whoever has to
change it: the module map, the model every reader produces, what each format
reader handles and refuses, the transport's one rule, the drawing maths
(including why the ball needs an asymmetric ease), the design schema, and the
limits.

## Tests

```bash
node --test test/*.test.mjs
```

The note language, the script and lesson readers, the MIDI reader and the
whole transport are covered, including against Danas Piano Tutor's own
example lessons when that repository is beside this one.

## Licence

MIT, see [LICENSE](LICENSE). The example pieces are traditional or
public-domain melodies.
