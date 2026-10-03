/* Designs.
 *
 * A design is a JSON file: colours, proportions and a few switches. The ones
 * in themes/ are listed in themes/index.json and fetched at startup, so
 * adding a design to the repository is adding a file — nothing here needs to
 * change. Anything the panel edits is saved in the browser, and can be
 * exported as a file of exactly the same shape.
 */

const KEY = "dbb.theme";

export const DEFAULT_THEME = {
  name: "Night",
  colours: {
    bg: "#0b1016",
    panel: "#10171e",
    ink: "#eef3f6",
    quiet: "#8b98a3",
    hairline: "#1d262e",
    accent: "#46d7a1",
    warn: "#e9b44c",
    bad: "#f08079",
    bars: ["#e5484d", "#f76b15", "#f5c518", "#8bc34a", "#25b2a5", "#3d8ff5", "#8b5cf6"],
    accidental: "#26313f",
    lane: "#141b22",
    ball: "#ffe9a8",
    ballEdge: "#f2a93b",
    hit: "#46d7a1",
    missed: "#f08079",
    other: "#55606c",
  },
  shape: {
    instrument: "auto",        // auto | upright | ladder
    roundness: 10,             // px at the corners of a bar
    laneHeight: 0.30,          // of the stage
    ballSize: 1,               // × the natural size
    barWidth: 0.84,            // of its slot
    beatsOnScreen: 7,          // how far ahead the lane shows
  },
  text: {
    noteNames: true,
    fontScale: 1,
  },
};

/** Every value the panel may change, with how to show it. */
export const CONTROLS = [
  { path: "colours.bg", label: "Background", type: "colour" },
  { path: "colours.panel", label: "Panels", type: "colour" },
  { path: "colours.ink", label: "Text", type: "colour" },
  { path: "colours.accent", label: "Accent", type: "colour" },
  { path: "colours.lane", label: "Lane", type: "colour" },
  { path: "colours.ball", label: "Ball", type: "colour" },
  { path: "colours.ballEdge", label: "Ball edge", type: "colour" },
  { path: "colours.accidental", label: "Black bars", type: "colour" },
  { path: "colours.hit", label: "Note played", type: "colour" },
  { path: "colours.other", label: "Other part", type: "colour" },
  { path: "shape.roundness", label: "Corners", type: "range", min: 0, max: 26, step: 1, unit: "px" },
  { path: "shape.laneHeight", label: "Lane height", type: "range", min: 0.15, max: 0.5, step: 0.01, percent: true },
  { path: "shape.ballSize", label: "Ball size", type: "range", min: 0.6, max: 2, step: 0.05, unit: "×" },
  { path: "shape.barWidth", label: "Bar width", type: "range", min: 0.5, max: 1, step: 0.02, percent: true },
  { path: "shape.beatsOnScreen", label: "Beats ahead", type: "range", min: 3, max: 16, step: 0.5 },
  { path: "text.fontScale", label: "Text size", type: "range", min: 0.8, max: 1.6, step: 0.05, unit: "×" },
  { path: "text.noteNames", label: "Note names", type: "switch" },
];

export function get(theme, path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), theme);
}

export function set(theme, path, value) {
  const keys = path.split(".");
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] = o[k] || {}), theme);
  target[last] = value;
  return theme;
}

/** A theme read from a file may be missing anything; the defaults fill in. */
export function normalise(theme) {
  const out = deepCopy(DEFAULT_THEME);
  merge(out, theme || {});
  out.name = (theme && theme.name) || out.name;
  if (!Array.isArray(out.colours.bars) || !out.colours.bars.length) {
    out.colours.bars = [...DEFAULT_THEME.colours.bars];
  }
  out.colours.bars = out.colours.bars.map(String).slice(0, 12);
  out.shape.instrument = ["auto", "upright", "ladder"].includes(out.shape.instrument)
    ? out.shape.instrument : "auto";
  return out;
}

/** Colours the page's own chrome, so panels follow the design too. */
export function applyToPage(theme, root = document.documentElement) {
  const c = theme.colours;
  const vars = {
    "--bg": c.bg, "--panel": c.panel, "--ink": c.ink, "--quiet": c.quiet,
    "--hairline": c.hairline, "--accent": c.accent, "--warn": c.warn, "--bad": c.bad,
    "--font-scale": String(theme.text.fontScale),
    "--round": `${Math.max(4, theme.shape.roundness)}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.style.setProperty("--ink-dim", mix(c.ink, c.bg, 0.45));
}

export function save(theme) {
  try { localStorage.setItem(KEY, JSON.stringify(theme)); } catch (e) { void e; }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalise(JSON.parse(raw)) : null;
  } catch (e) { void e; return null; }
}

export function forget() {
  try { localStorage.removeItem(KEY); } catch (e) { void e; }
}

/** The designs that ship with the app. A missing list is not an error. */
export async function loadLibrary(base = "themes/") {
  try {
    const index = await fetch(`${base}index.json`, { cache: "no-cache" }).then((r) => r.json());
    const names = Array.isArray(index) ? index : index.themes || [];
    const themes = await Promise.all(names.map(async (file) => {
      try {
        return normalise(await fetch(`${base}${file}`, { cache: "no-cache" }).then((r) => r.json()));
      } catch (e) { void e; return null; }
    }));
    return themes.filter(Boolean);
  } catch (e) {
    void e;
    return [];
  }
}

/* The bar colours run by the scale step, so a tune in C starts on the first
 * colour; black keys take the one colour, as on a real instrument. */
export function barColour(theme, midi) {
  const step = [0, 2, 4, 5, 7, 9, 11].indexOf(((midi % 12) + 12) % 12);
  if (step < 0) return theme.colours.accidental;
  return theme.colours.bars[step % theme.colours.bars.length];
}

export function mix(a, b, amount) {
  const pa = rgb(a), pb = rgb(b);
  if (!pa || !pb) return a;
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * amount));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function alpha(colour, a) {
  const p = rgb(colour);
  return p ? `rgba(${p[0]},${p[1]},${p[2]},${a})` : colour;
}

export function shade(colour, factor) {
  const p = rgb(colour);
  if (!p) return colour;
  const c = p.map((v) => Math.max(0, Math.min(255, Math.round(v * factor))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function rgb(colour) {
  const text = String(colour || "").trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((ch) => ch + ch).join("") : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (fn) {
    const parts = fn[1].split(",").map((v) => parseFloat(v));
    if (parts.length >= 3) return parts.slice(0, 3).map((v) => Math.round(v));
  }
  return null;
}

function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

function merge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      target[key] = target[key] && typeof target[key] === "object" ? target[key] : {};
      merge(target[key], value);
    } else if (value !== undefined) {
      target[key] = value;
    }
  }
  return target;
}
