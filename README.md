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

Then <http://127.0.0.1:8770>. On GitHub Pages there is one thing to do, once:
set *Settings → Pages → Build and deployment → Source* to **GitHub Actions**.
Until that is done the deploy step fails with *Get Pages site failed*, however
many times it is pushed — and `configure-pages`'s `enablement` flag does not
help, because the workflow's own token may not create the site. After that
click, `.github/workflows/pages.yml` runs the tests and publishes the
repository as it stands on every push. It lives in the `music-visualizer` repository, which
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

Six, chosen by picture rather than by name — tap one and the whole app
follows, the stage and the panels together.

| | |
|---|---|
| **Boomwhacker** | the colours of the tubes in her hand |
| **Big and plain** | for a projector, or for eyes that need it |
| **Calm** | nothing shouts. For a child who has had enough |
| **Sweet shop** | fat, round and far apart — easy to aim at |
| **Deep sea** | dark room, bright reef. Good at bedtime |
| **Blackboard** | chalk on slate. The one that looks like school |

A design is a small JSON file: colours, a few proportions, two switches.
**Change the colours** opens pickers and sliders for all of it, and the result
saves as a file.

To add one for good, put it in `themes/` and name it in `themes/index.json`:

```json
{ "themes": ["boomwhacker.json", "big-and-plain.json", "calm.json",
             "sweet-shop.json", "deep-sea.json", "blackboard.json"] }
```

It appears in the picker next time the page loads, **with a picture of
itself** — the previews are drawn with the same code as the stage, so a new
design needs no artwork. Anything missing from a design file falls back to the
defaults, so a file with nothing but a name and two colours is a valid design.

Whatever you change by hand is remembered in the browser until you press
*Start again*.

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
