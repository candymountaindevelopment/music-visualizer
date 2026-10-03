# Writing a tune for Danas Bouncing Ball

You are writing a short piece for a web page that plays it on a xylophone.
The notes run along a lane under the instrument and a ball leaps from note to
note, landing on each one at the moment it sounds. Someone is going to try to
play along, so write something a beginner can follow.

Give back **the script and nothing else** — no explanation around it, no
code fence. The person pastes it into the app's **Music** box and presses
*Load this*.

---

## The shape of a script

    title Twinkle, Twinkle
    composer Traditional
    tempo 96
    time 4/4
    right: C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2
    left:  C3:2 F3:2  | C3:2 G3:2  | C3:2 F3:2  | G3:2 C3:2

Every header is optional, and so is the part name: the smallest script that
works is one line of notes.

| Header | Means |
|---|---|
| `title` | what the piece is called |
| `composer` | who wrote it — leave it out for your own tunes |
| `tempo` | beats a minute, 20–300. Write the real speed; the player has a tempo control |
| `time` | `4/4`, `3/4`, `6/8` … four-four if you do not say |
| `step` | what a bare note lasts — `1/4` (a quarter note) unless you say otherwise |
| `key` | `C`, `G`, `F`, `Bb` … used only to spell black notes as sharps or flats |

A part is a line beginning with a name and a colon: `right:`, `left:`,
`melody:`. Lines after it with no name of their own belong to the same part.
The first part is the one the ball follows, so **write the melody first**.

## The notes

| Token | Means |
|---|---|
| `C4` | middle C, for one step (a quarter note by default) |
| `F#4`, `Bb3` | sharps and flats |
| `C4:2` | two steps — a half note |
| `C4:0.5`, `C4:1/8` | half a step — an eighth note. `:1/4.` is a dotted quarter |
| `[C3 E3 G3]` | a chord: all of it together, one event |
| `.` | a rest of one step; `.:2` rests for two |
| `-` | hold: the note before lasts one step longer |
| `\|` | a bar line. It takes no time — write them, they keep you honest |
| `(3)` | a finger number, as in `C4(3)`. Read from Piano Tutor lessons, ignored here |

Middle C is `C4`. Lengths are **beats**, where one beat is a quarter note: in
4/4 at 96 bpm, a half note is `:2`.

## What makes a good piece here

- **One note at a time in the melody.** The ball can only land in one place.
  Chords are fine in the left hand, and are drawn stacked.
- **Keep the melody inside about two octaves**, roughly `C4`–`C6`. The app
  draws the instrument to fit the piece, and a wide piece means thin bars.
- **Stepwise beats leaps.** The ball's arc is the pleasure of the thing; a
  jump of more than an octave throws it off the top of the lane.
- **Make every bar add up** to the time signature. A bar that is short makes
  the loop stumble, and the app will say so.
- **Short is better.** Sixteen to thirty-two bars. The piece repeats, and a
  long one is a long wait to hear your part again.
- Use **public-domain or original** music.

## Worked example

    title Ode to Joy
    composer Beethoven
    tempo 96
    time 4/4
    right: E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2
    right: E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2
    left:  C3:4 | G3:2 G3:2 | C3:4 | G3:2 C3:2
    left:  C3:4 | G3:2 G3:2 | C3:4 | G3:2 C3:2

## The other things the app will open

You do not have to write a script. The app also reads, from a file or the
same box:

- **Danas Piano Tutor lessons** — the `raw.author` JSON, exactly as the tutor
  takes it. A document with several lessons becomes a list to pick from.
- **MusicXML** — `.musicxml`, `.xml`, or zipped `.mxl`, as exported by
  MuseScore, Sibelius, Finale or the tutor itself.
- **MIDI** — `.mid`. Note lengths are rounded to a sixteenth and the first
  tempo in the file is used throughout.

If you are writing a tutor lesson instead of a script, follow the tutor's own
format document — the note language is the same one described above.
