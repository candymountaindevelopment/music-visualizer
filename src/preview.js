/* A small picture of a design.
 *
 * The board this came from says it plainly: "Tap a picture. The names are for
 * grown-ups — the picture is the choice." So the picker shows what each
 * design looks like, and it has to be the truth — the preview is drawn with
 * the same layout and the same drawing code as the stage, on a short piece
 * made up for the purpose. A design file added to themes/ gets an honest
 * picture without anyone drawing one.
 */

import * as Instrument from "./instrument.js";
import { barColour, alpha } from "./theme.js";

// A rising phrase, as [step above the lowest bar, beats].
const PHRASE = [[0, 1], [4, 1], [7, 1], [12, 1], [9, 1], [5, 1]];

export function drawPreview(canvas, theme, { low = 60, octaves = 1 } = {}) {
  const w = canvas.clientWidth || 260;
  const h = canvas.clientHeight || 150;
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);

  g.fillStyle = theme.colours.bg;
  g.fillRect(0, 0, w, h);

  const band = Math.max(26, h * theme.shape.laneHeight);
  const laid = Instrument.layout(w, h - band, { low, octaves, shape: theme.shape.instrument, theme });
  // The preview is small, so the names would be a smear; everything else is
  // exactly what the stage would draw.
  const quiet = { ...theme, text: { ...theme.text, noteNames: false } };
  Instrument.draw(g, laid, { theme: quiet, ripples: [], labels: [] });

  drawLaneStrip(g, w, h, band, theme, low);
}

function drawLaneStrip(g, w, h, band, theme, low) {
  const top = h - band;
  g.fillStyle = theme.colours.lane;
  g.fillRect(0, top, w, band);
  g.strokeStyle = theme.colours.hairline;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, top + 0.5); g.lineTo(w, top + 0.5); g.stroke();

  const nowX = Math.max(22, w * 0.16);
  const ppb = Math.max(18, w / (theme.shape.beatsOnScreen + 1));
  const tileH = Math.max(6, Math.min(13, band * 0.22));
  const steps = PHRASE.map(([step]) => step);
  const lo = Math.min(...steps), hi = Math.max(...steps);
  const zoneTop = top + band * 0.42, zoneBot = h - Math.max(5, band * 0.16) - tileH;

  let beat = 0;
  const placed = PHRASE.map(([step, beats]) => {
    const tile = {
      x: nowX + beat * ppb,
      y: zoneBot - ((step - lo) / Math.max(1, hi - lo)) * (zoneBot - zoneTop),
      w: beats * ppb - 4,
      midi: low + step,
    };
    beat += beats;
    return tile;
  });

  for (const tile of placed) {
    if (tile.x > w) continue;
    g.fillStyle = barColour(theme, tile.midi);
    Instrument.roundRect(g, tile.x, tile.y, Math.min(tile.w, w - tile.x - 2), tileH,
                         Math.min(theme.shape.roundness, tileH / 2));
    g.fill();
  }

  // The ball, mid-leap between the first two notes — the picture of the thing.
  const from = placed[0], to = placed[1];
  const r = Math.max(5, Math.min(11, band * 0.2)) * theme.shape.ballSize;
  const t = 0.45;
  const x = from.x + (to.x - from.x) * (1 - Math.pow(1 - t, 4));
  const y = (from.y + (to.y - from.y) * t) - r - Math.sin(Math.PI * t) * band * 0.3;

  g.fillStyle = alpha("#000000", 0.3);
  g.beginPath(); g.ellipse(from.x + r, zoneBot + 2, r * 0.85, r * 0.26, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = theme.colours.ball;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = theme.colours.ballEdge;
  g.lineWidth = Math.max(1.5, r * 0.18);
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
}
