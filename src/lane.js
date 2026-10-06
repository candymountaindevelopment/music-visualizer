/* The lane under the instrument, and the ball that lands on every note.
 *
 * Notes come in from the right towards the now line. The ball leaves the note
 * it is on and arrives at the next one exactly when that note sounds, so the
 * jump is the count-in for the note. Both ends of its arc are the notes' own
 * positions, and those come from the same beat the sound is scheduled with,
 * so the landing cannot drift away from what is heard.
 */

import { midiToNote } from "./core/notes.js";
import { barColour, alpha, mix } from "./theme.js";
import { roundRect, FONT } from "./instrument.js";

export function laneGeometry(w, h, theme, transport) {
  const band = Math.max(74, Math.min(190, h * theme.shape.laneHeight));
  const ppb = Math.max(26, Math.min(160, w / theme.shape.beatsOnScreen));
  const nowX = Math.max(48, Math.min(w * 0.22, 150));
  return { band, top: h - band, ppb, nowX, h, w };
}

export function draw(g, w, h, { theme, transport, position, marks, flats = false }) {
  const geo = laneGeometry(w, h, theme, transport);
  const { band, top, ppb, nowX } = geo;
  const lead = transport.lead;

  const from = position - nowX / ppb;
  const to = position + (w - nowX) / ppb;
  const notes = transport.visible(from, to);

  const [lo, hi] = pitchWindow(transport);
  const span = Math.max(1, hi - lo);
  const tileH = Math.max(10, Math.min(22, band * 0.15));
  const zoneTop = top + band * 0.34, zoneBot = h - Math.max(8, band * 0.12) - tileH;
  const xFor = (beat) => nowX + (beat - position) * ppb;
  // A row belongs to a pitch for the whole section, so the rows never move
  // under the ball. A note from another part that falls outside the leading
  // part's range is held at the edge rather than stretching everything.
  const yFor = (midi) =>
    Math.max(zoneTop, Math.min(zoneBot, zoneBot - ((midi - lo) / span) * (zoneBot - zoneTop)));

  g.fillStyle = theme.colours.lane;
  g.fillRect(0, top, w, band);
  g.strokeStyle = theme.colours.hairline;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, top + 0.5); g.lineTo(w, top + 0.5); g.stroke();

  drawBarLines(g, geo, transport, position, from, to, theme);

  // Tiles. The part the ball follows is drawn full strength; the others are
  // there to be seen, not followed.
  g.textBaseline = "middle";
  for (const { event, runBeat, pass } of notes) {
    const isLead = event.part === lead;
    const x = xFor(runBeat);
    const tw = Math.max(9, event.beats * ppb - 5);
    const played = marks.has(markKey(pass, event));
    const past = runBeat + event.beats < position;

    const sounding = isLead && runBeat <= position && position < runBeat + event.beats;
    for (const midi of event.midis) {
      const y = yFor(midi);
      const height = isLead ? tileH : tileH * 0.68;
      g.globalAlpha = past && !sounding ? 0.3 : isLead ? 1 : 0.65;
      g.fillStyle = played ? theme.colours.hit : isLead ? barColour(theme, midi) : theme.colours.other;
      roundRect(g, x, y + (isLead ? 0 : (tileH - height) / 2), tw, height, Math.min(6, height / 2));
      g.fill();
      if (sounding) {                       // the one the ball is standing on
        g.strokeStyle = theme.colours.ink;
        g.lineWidth = 2;
        roundRect(g, x - 1.5, y - 1.5, tw + 3, height + 3, Math.min(7, height / 2 + 2));
        g.stroke();
      }
      if (isLead && theme.text.noteNames && tw > 24 && event.midis.length < 4) {
        g.fillStyle = alpha("#000000", 0.62);
        g.textAlign = "center";
        g.font = `600 ${Math.max(9, Math.min(12, tileH * 0.72) * theme.text.fontScale)}px ${FONT}`;
        g.fillText(midiToNote(midi, flats), x + tw / 2, y + height / 2 + 0.5);
      }
      g.globalAlpha = 1;
    }
  }
  g.textBaseline = "alphabetic";

  // The now line, and the ball on it.
  g.strokeStyle = alpha(theme.colours.ink, 0.22);
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(nowX, top + 5); g.lineTo(nowX, h - 3); g.stroke();

  const ball = ballAt(transport, position, { nowX, yFor, band, zoneBot, theme });
  if (ball) drawBall(g, ball, theme);
  return { geo, ball };
}

function drawBarLines(g, geo, transport, position, from, to, theme) {
  const { top, h, ppb, nowX } = geo;
  const bar = transport.beatsPerBar;
  const first = Math.floor(from / bar) * bar;
  for (let beat = first; beat <= to; beat += bar) {
    const x = nowX + (beat - position) * ppb;
    if (x < -2 || x > geo.w + 2) continue;
    const startOfPass = Math.abs(((beat % transport.passBeats) + transport.passBeats) % transport.passBeats) < 1e-6;
    g.strokeStyle = alpha(theme.colours.ink, startOfPass ? 0.22 : 0.09);
    g.lineWidth = startOfPass ? 2 : 1;
    g.beginPath(); g.moveTo(x, top + 4); g.lineTo(x, h); g.stroke();
  }
}

/* The ball stays on the now line and moves only up and down: the note under
 * it is the note being played, with nothing to read into its sideways drift.
 * It leaves the row of the note it is on and arrives at the row of the next
 * one exactly when that note sounds. During the count-in it drops in at the
 * pitch of the first note; at the end of a pass it is already on its way to
 * the first note of the next one, which is the same point the clock comes
 * round to. */
function ballAt(transport, position, { nowX, yFor, band, zoneBot, theme }) {
  const lead = leadNeighbours(transport, position);
  if (!lead) return null;
  const { from, to } = lead;
  const gap = Math.max(0.001, to.runBeat - from.runBeat);
  const t = Math.max(0, Math.min(1, (position - from.runBeat) / gap));
  const r = Math.max(6, Math.min(15, band * 0.11)) * theme.shape.ballSize;

  const y0 = yFor(from.midi) - r, y1 = yFor(to.midi) - r;
  // High enough to be seen leaving, never so high it leaves the lane; a long
  // gap earns a bigger hop, which is the only hint of how long the wait is.
  const arc = Math.min(band * 0.32, 14 + gap * 16);
  return {
    x: nowX,
    y: y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * arc,
    r, t, shadowY: zoneBot + 3,
    squash: 1 - 0.3 * Math.max(0, 1 - Math.min(t, 1 - t) * 9),
  };
}

function leadNeighbours(transport, position) {
  const events = transport.events.filter((e) => e.part === transport.lead);
  if (!events.length) return null;
  const pass = Math.max(0, Math.floor(Math.max(0, position) / transport.passBeats));
  const flat = [];
  for (let p = Math.max(0, pass - 1); p <= pass + 1; p++) {
    if (transport.repeats !== Infinity && p >= transport.repeats) break;
    for (const e of events) flat.push({ runBeat: p * transport.passBeats + e.at, midi: Math.max(...e.midis) });
  }
  flat.sort((a, b) => a.runBeat - b.runBeat);
  const index = flat.findIndex((n) => n.runBeat > position + 1e-9);
  if (index < 0) {
    const last = flat[flat.length - 1];
    return { from: last, to: { ...last, runBeat: last.runBeat + transport.beatsPerBar } };
  }
  const to = flat[index];
  const from = index === 0
    ? { midi: to.midi, runBeat: to.runBeat - Math.min(transport.countInBeats || 2, 4) }
    : flat[index - 1];
  return { from, to };
}

function drawBall(g, ball, theme) {
  const { x, y, r, squash } = ball;
  g.fillStyle = alpha("#000000", 0.35);
  g.beginPath(); g.ellipse(x, ball.shadowY, r * 0.9, r * 0.28, 0, 0, Math.PI * 2); g.fill();

  const grad = g.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.15, x, y, r);
  grad.addColorStop(0, mix(theme.colours.ball, "#ffffff", 0.75));
  grad.addColorStop(0.55, theme.colours.ball);
  grad.addColorStop(1, theme.colours.ballEdge);
  g.fillStyle = grad;
  g.beginPath(); g.ellipse(x, y, r, r * squash, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = alpha("#ffffff", 0.5);
  g.lineWidth = 1;
  g.beginPath(); g.ellipse(x, y, r, r * squash, 0, 0, Math.PI * 2); g.stroke();
}

/* The rows come from the section, not from what happens to be on screen.
 * Taking them from the visible notes meant the whole mapping shifted every
 * time a note scrolled in or out, and a ball that lands correctly on a row
 * that has just moved looks exactly like a ball landing on the wrong note.
 * The leading part sets the scale, because it is the one being followed. */
function pitchWindow(transport) {
  const lead = transport.events.filter((e) => e.part === transport.lead);
  const notes = (lead.length ? lead : transport.events).flatMap((e) => e.midis);
  if (!notes.length) return [60, 72];
  let lo = Math.min(...notes), hi = Math.max(...notes);
  if (hi - lo < 7) {                               // a narrow tune still uses the band
    const middle = (lo + hi) / 2;
    lo = middle - 3.5;
    hi = middle + 3.5;
  }
  return [lo, hi];
}

export const markKey = (pass, event) => `${pass}:${event.index}`;
