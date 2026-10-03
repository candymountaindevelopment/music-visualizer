/* The xylophone: where the bars are, and how they are drawn.
 *
 * Two shapes. *Upright* is a chromatic instrument seen from the front, the
 * naturals in a row with the accidentals overlapping their tops. *Ladder* is
 * the toy: horizontal bars, longest at the top, white notes only. *Auto*
 * picks by the proportions of the space, because a phone held upright is the
 * wrong shape for a row of bars and the right shape for the ladder.
 */

import { isBlack, midiToNote } from "./core/notes.js";
import { barColour, shade, alpha } from "./theme.js";

const BACK = 0.42;          // an accidental, as a fraction of a natural
const OVERHANG = 0.72;      // how much of itself it hangs above the front row

export function chooseRange([lo, hi], max = 4) {
  const low = Math.floor(lo / 12) * 12;
  const high = Math.ceil((hi + 1) / 12) * 12;
  const octaves = Math.max(1, Math.min(max, Math.round((high - low) / 12)));
  return { low, octaves };
}

export function layout(w, h, { low = 60, octaves = 2, shape = "auto", theme }) {
  const naturals = [];
  for (let i = 0; i <= octaves * 12; i++) {
    const midi = low + i;
    if (!isBlack(midi)) naturals.push(midi);
  }
  const ladder = shape === "ladder" || (shape === "auto" && h > w * 1.1);
  const bars = ladder ? ladderBars(w, h, naturals, theme) : uprightBars(w, h, naturals, theme);
  return { bars, ladder };
}

function uprightBars(w, h, naturals, theme) {
  const bars = [];
  const pad = Math.max(10, w * 0.025);
  const slot = (w - pad * 2) / naturals.length;
  const barW = Math.min(slot * theme.shape.barWidth, 104);

  // The accidentals' overhang decides the gap above, so the row fills a short
  // screen; a tall one is capped at a believable length and centred.
  const foot = Math.max(8, h * 0.05);
  const frontMax = Math.min((h - foot) / (1 + BACK * OVERHANG), barW * 6);
  const block = frontMax * (1 + BACK * OVERHANG);
  const frontTop = (h - block) / 2 + frontMax * BACK * OVERHANG;

  naturals.forEach((midi, i) => {
    const t = naturals.length > 1 ? i / (naturals.length - 1) : 0;
    bars.push({
      midi, row: "front", hit: 0,
      x: pad + i * slot + (slot - barW) / 2, y: frontTop,
      w: barW, h: frontMax * (1 - 0.34 * t),
      colour: barColour(theme, midi),
    });
  });

  for (let i = 0; i < naturals.length - 1; i++) {
    const midi = naturals[i] + 1;
    if (!isBlack(midi)) continue;
    const t = i / Math.max(1, naturals.length - 1);
    const len = frontMax * BACK * (1 - 0.3 * t);
    const bw = barW * 0.74;
    bars.push({
      midi, row: "back", hit: 0,
      x: pad + (i + 0.5) * slot + (slot - bw) / 2, y: frontTop - len * OVERHANG,
      w: bw, h: len,
      colour: theme.colours.accidental,
    });
  }
  return bars;
}

function ladderBars(w, h, naturals, theme) {
  const bars = [];
  const padY = Math.max(8, h * 0.04);
  const slot = (h - padY * 2) / naturals.length;
  const barH = Math.min(slot * 0.78, 46);
  const longest = Math.min(w * 0.86, 900);

  naturals.forEach((midi, i) => {
    const t = naturals.length > 1 ? i / (naturals.length - 1) : 0;
    const len = longest * (1 - 0.45 * t);
    bars.push({
      midi, row: "front", hit: 0,
      x: (w - len) / 2, y: padY + i * slot + (slot - barH) / 2,
      w: len, h: barH,
      colour: barColour(theme, midi),
    });
  });
  return bars;
}

export function barFor(bars, midi) {
  return bars.find((b) => b.midi === midi) || null;
}

export function barAt(bars, x, y) {
  const rows = [bars.filter((b) => b.row === "back"), bars.filter((b) => b.row === "front")];
  for (const row of rows) {
    for (const b of row) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

export function draw(g, { bars, ladder }, { theme, ripples = [], labels = [], flats = false }) {
  const front = bars.filter((b) => b.row === "front");
  const round = theme.shape.roundness;

  if (front.length) {                       // the rails, through every bar's holes
    g.strokeStyle = shade(theme.colours.hairline, 1.1);
    g.lineWidth = 6; g.lineCap = "round"; g.lineJoin = "round";
    for (const f of ladder ? [0.14, 0.86] : [0.18, 0.84]) {
      g.beginPath();
      front.forEach((bar, i) => {
        const px = ladder ? bar.x + bar.w * f : bar.x + bar.w / 2;
        const py = ladder ? bar.y + bar.h / 2 : bar.y + bar.h * f;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      });
      g.stroke();
    }
  }

  for (const bar of [...bars.filter((b) => b.row === "back"), ...front]) {
    const hit = bar.hit;
    const x = bar.x, y = bar.y + hit * 4, bw = bar.w, bh = bar.h;

    if (hit > 0.01) {                       // a halo while it rings
      g.save();
      g.shadowColor = bar.colour;
      g.shadowBlur = 26 * hit;
      g.fillStyle = bar.colour;
      roundRect(g, x, y, bw, bh, round); g.fill();
      g.restore();
    }

    const grad = g.createLinearGradient(x, y, ladder ? x + bw : x, ladder ? y : y + bh);
    grad.addColorStop(0, shade(bar.colour, 1.12 + 0.25 * hit));
    grad.addColorStop(1, shade(bar.colour, 0.74 + 0.2 * hit));
    g.fillStyle = grad;
    roundRect(g, x, y, bw, bh, round); g.fill();

    g.fillStyle = alpha("#ffffff", 0.1 + 0.45 * hit);
    if (ladder) roundRect(g, x + 5, y + bh * 0.16, Math.max(3, bw * 0.02), bh * 0.68, 3);
    else roundRect(g, x + bw * 0.12, y + 4, bw * 0.76, Math.max(3, bh * 0.05), 3);
    g.fill();

    g.fillStyle = alpha("#000000", 0.45);
    const holes = ladder
      ? [[x + bw * 0.14, y + bh / 2], [x + bw * 0.86, y + bh / 2]]
      : [[x + bw / 2, y + bh * 0.18], [x + bw / 2, y + bh * 0.84]];
    const holeR = Math.max(1.5, (ladder ? bh : bw) * 0.09);
    for (const [hx, hy] of holes) { g.beginPath(); g.arc(hx, hy, holeR, 0, Math.PI * 2); g.fill(); }

    if (theme.text.noteNames) {
      g.fillStyle = bar.row === "front" ? alpha("#000000", 0.6) : alpha("#ffffff", 0.55);
      g.textAlign = "center"; g.textBaseline = "middle";
      const size = (ladder ? Math.min(18, bh * 0.5) : Math.min(16, bw * 0.34)) * theme.text.fontScale;
      g.font = `600 ${Math.max(9, size)}px ${FONT}`;
      g.fillText(midiToNote(bar.midi, flats), ladder ? x + bw * 0.5 : x + bw / 2,
                 ladder ? y + bh / 2 : y + bh * 0.51);
      g.textBaseline = "alphabetic";
    }

    bar.hit *= 0.9;
    if (bar.hit < 0.004) bar.hit = 0;
  }

  for (const r of ripples) {
    g.strokeStyle = r.colour;
    g.globalAlpha = Math.max(0, r.life);
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(r.x, r.y, r.r, 0, Math.PI * 2); g.stroke();
    r.r += 3.2; r.life -= 0.035;
  }
  g.globalAlpha = 1;

  for (const l of labels) {
    g.globalAlpha = Math.max(0, l.life);
    g.fillStyle = l.colour;
    g.textAlign = "center";
    g.font = `700 ${(20 + 10 * (1 - l.life)) * theme.text.fontScale}px ${FONT}`;
    g.fillText(l.text, l.x, l.y);
    l.y -= 1.1; l.life -= 0.02;
  }
  g.globalAlpha = 1;
}

export const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

export function roundRect(g, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y); g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr); g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h); g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr); g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}
