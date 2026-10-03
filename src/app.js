/* The app: panels, settings, and the frame loop that ties the clock to the
 * drawing. Everything that decides *when* lives in transport.js; everything
 * that decides *where* lives in instrument.js and lane.js. This file is the
 * wiring between them and the page. */

import { Audio } from "./audio.js";
import { Transport } from "./transport.js";
import { Listener } from "./listen.js";
import { midiToNote } from "./core/notes.js";
import { openFile, parseText, SOURCE_NAMES } from "./parse/open.js";
import { toScript } from "./parse/script.js";
import * as Theme from "./theme.js";
import * as Instrument from "./instrument.js";
import * as Lane from "./lane.js";

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = "dbb.settings";
const PIECE_KEY = "dbb.piece";

const audio = new Audio();
const listener = new Listener(audio);

const state = {
  theme: Theme.normalise(Theme.DEFAULT_THEME),
  library: [],
  score: null,
  loaded: [],                 // every score from the file that was opened
  bars: [], ladder: false,
  ripples: [], labels: [],
  marks: new Set(),
  low: 60, octaves: 2,
  octavesChoice: "auto",
  listening: false,
  canvasSize: [0, 0],
};

const transport = new Transport(audio, {
  onNote: (event) => {
    for (const midi of event.midis) strikeBar(midi, event.part === transport.lead);
  },
  onEnd: () => {
    $("play").textContent = "Play";
    say("Finished.");
  },
});

/* ------------------------------------------------------------------ boot */

boot();

async function boot() {
  const saved = Theme.load();
  if (saved) state.theme = saved;
  Theme.applyToPage(state.theme);
  buildDesignPanel();

  state.library = await Theme.loadLibrary();
  fillThemeList();

  restoreSettings();
  wire();
  fillExamples();
  loadGuide();

  const last = localStorage.getItem(PIECE_KEY);
  if (last) {
    try {
      $("script").value = last;
      loadScores(parseText(last), { quiet: true });
      say(`${state.score.title} — where you left off. Press Play.`);
    } catch (e) { void e; }
  }
  if (!state.score) say("Open Music to paste a tune, load a lesson or try an example.");
  fit();
  requestAnimationFrame(frame);
}

/* --------------------------------------------------------------- loading */

function loadScores(scores, { quiet = false, name = "" } = {}) {
  if (!scores.length) throw new Error("nothing to play in that");
  state.loaded = scores;
  fillLoadedList(scores, name);
  applyScore(scores[0], { quiet });
  if (scores.length > 1 && !quiet) {
    say(`${scores.length} pieces in that file — pick one from the list in Music.`);
  }
}

function applyScore(score, { quiet = false } = {}) {
  state.score = score;
  state.marks.clear();
  transport.load(score, { tempo: score.tempo });
  transport.countInBars = Number($("countin").value);
  transport.repeats = repeatsValue();
  transport.metronome = $("metronome").checked;
  transport.muted = !$("sound").checked;
  transport.transpose = Number($("transpose").value || 0);

  $("piece-title").textContent = score.title + (score.composer ? ` — ${score.composer}` : "");
  $("piece-note").textContent =
    `${SOURCE_NAMES[score.source] || score.source} · ${score.bars} bars · ${score.time.beats}/${score.time.unit} · written ${Math.round(score.tempo)} bpm`;

  setTempo(score.tempo);
  fillParts(score);
  $("bar-from").value = 1;
  $("bar-from").max = score.bars;
  $("bar-to").value = score.bars;
  $("bar-to").max = score.bars;
  chooseInstrument();
  showWarnings(score);
  if (!quiet) say(`Loaded ${score.title}. Press Play.`);
  fit();
}

function showWarnings(score) {
  const button = $("warnings");
  if (!score.warnings.length) { button.classList.add("hidden"); return; }
  button.classList.remove("hidden");
  button.textContent = `${score.warnings.length} note${score.warnings.length > 1 ? "s" : ""} on this file`;
  button.onclick = () => {
    openSheet("sheet-open");
    message("open-msg", score.warnings.join("\n"), "bad");
  };
}

function chooseInstrument() {
  if (!state.score) return;
  const [lo, hi] = state.score.range(transport.parts);
  const fit = Instrument.chooseRange([lo + transport.transpose, hi + transport.transpose]);
  state.low = fit.low;
  state.octaves = state.octavesChoice === "auto" ? fit.octaves : Number(state.octavesChoice);
  if (state.octavesChoice !== "auto") {
    // Keep the piece inside the keys it asked for, as far as it can.
    const top = state.low + state.octaves * 12;
    if (hi + transport.transpose > top) state.low = Math.max(12, Math.floor((hi + transport.transpose) / 12) * 12 - (state.octaves - 1) * 12);
  }
}

/* ----------------------------------------------------------------- frame */

function frame() {
  const canvas = $("stage");
  const box = canvas.parentElement;
  if (state.canvasSize[0] !== box.clientWidth || state.canvasSize[1] !== box.clientHeight) fit();

  transport.tick();
  if (state.listening) {
    const midi = listener.read();
    if (midi !== null) played(midi);
  }

  const g = canvas.getContext("2d");
  const w = box.clientWidth, h = box.clientHeight;
  g.clearRect(0, 0, w, h);
  g.fillStyle = state.theme.colours.bg;
  g.fillRect(0, 0, w, h);

  Instrument.draw(g, { bars: state.bars, ladder: state.ladder }, {
    theme: state.theme,
    ripples: state.ripples,
    labels: state.labels,
    flats: state.score ? state.score.flats : false,
  });
  state.ripples = state.ripples.filter((r) => r.life > 0);
  state.labels = state.labels.filter((l) => l.life > 0);

  if (state.score) {
    Lane.draw(g, w, h, {
      theme: state.theme,
      transport,
      position: transport.position,
      marks: state.marks,
      flats: state.score.flats,
    });
    updatePlace();
  }
  requestAnimationFrame(frame);
}

function fit() {
  const canvas = $("stage");
  const box = canvas.parentElement;
  const w = Math.max(1, box.clientWidth), h = Math.max(1, box.clientHeight);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  // The CSS size is written out: a canvas carries its backing store in a
  // width/height attribute, and that would otherwise decide its layout size.
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.getContext("2d").setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  state.canvasSize = [box.clientWidth, box.clientHeight];

  const band = state.score ? Lane.laneGeometry(w, h, state.theme, transport).band : 0;
  const laid = Instrument.layout(w, h - band, {
    low: state.low,
    octaves: state.octaves,
    shape: state.theme.shape.instrument,
    theme: state.theme,
  });
  state.bars = laid.bars;
  state.ladder = laid.ladder;
}

function updatePlace() {
  const place = transport.place;
  const bar = Math.floor(Math.max(0, place.beat) / transport.beatsPerBar) + Math.round(transport.from / transport.beatsPerBar) + 1;
  const total = transport.repeats === Infinity ? "∞" : transport.repeats;
  const text = !transport.playing && transport.pausedAt == null ? ""
    : place.countingIn ? `counting in… ${Math.max(1, Math.ceil(-place.beat))}`
    : `bar ${bar} · pass ${place.pass + 1} of ${total}`;
  $("place").textContent = text;
}

/* ---------------------------------------------------------------- strike */

function strikeBar(midi, lead = true) {
  const bar = Instrument.barFor(state.bars, midi + transport.transpose);
  if (!bar) return;
  bar.hit = 1;
  const colour = bar.row === "front" ? bar.colour : Theme.mix(state.theme.colours.ink, bar.colour, 0.4);
  state.ripples.push({ x: bar.x + bar.w / 2, y: bar.y + bar.h / 2, r: bar.w * 0.4, life: 1, colour });
  if (lead) {
    state.labels.push({
      x: bar.x + bar.w / 2, y: bar.y - 10,
      text: midiToNote(bar.midi, state.score ? state.score.flats : false),
      life: 1, colour,
    });
  }
}

/** A note the person played: mark the tile if it was the right one, now. */
function played(midi) {
  strikeBar(midi - transport.transpose, true);
  if (!state.score || !transport.playing) return;
  const position = transport.position;
  let best = null, closest = 0.45;
  for (const { event, runBeat, pass } of transport.visible(position - 1, position + 1)) {
    if (event.part !== transport.lead) continue;
    const key = Lane.markKey(pass, event);
    if (state.marks.has(key)) continue;
    const distance = Math.abs(runBeat - position);
    if (distance < closest && event.midis.some((m) => m + transport.transpose === midi)) {
      best = key; closest = distance;
    }
  }
  if (best) state.marks.add(best);
}

/* ------------------------------------------------------------------ wire */

function wire() {
  $("play").onclick = () => {
    if (!state.score) { openSheet("sheet-open"); return; }
    audio.start();
    if (transport.playing) { transport.pause(); $("play").textContent = "Play"; }
    else { transport.play(); $("play").textContent = "Pause"; say(""); }
  };
  $("stop").onclick = () => {
    transport.stop();
    state.marks.clear();
    $("play").textContent = "Play";
    $("place").textContent = "";
  };

  $("tempo").oninput = () => {
    const bpm = Number($("tempo").value);
    $("tempo-out").textContent = bpm;
    transport.setTempo(bpm);
    saveSettings();
  };
  $("tempo-reset").onclick = () => { if (state.score) setTempo(state.score.tempo); };

  $("repeats").onchange = () => { transport.repeats = repeatsValue(); saveSettings(); };
  $("countin").onchange = () => { transport.countInBars = Number($("countin").value); saveSettings(); };
  $("metronome").onchange = () => { transport.metronome = $("metronome").checked; saveSettings(); };
  $("sound").onchange = () => { transport.muted = !$("sound").checked; saveSettings(); };
  $("volume").oninput = () => { audio.setVolume(Number($("volume").value)); saveSettings(); };

  $("part").onchange = () => {
    const value = $("part").value;
    const parts = value === "*" ? state.score.partNames : [value];
    transport.setParts(parts, parts[0]);
    chooseInstrument(); fit(); saveSettings();
  };
  $("transpose").onchange = () => {
    transport.transpose = Number($("transpose").value);
    chooseInstrument(); fit(); saveSettings();
  };

  const section = () => {
    if (!state.score) return;
    const bar = transport.beatsPerBar;
    const from = Math.max(1, Math.min(Number($("bar-from").value) || 1, state.score.bars));
    const to = Math.max(from, Math.min(Number($("bar-to").value) || state.score.bars, state.score.bars));
    $("bar-from").value = from; $("bar-to").value = to;
    transport.setSection((from - 1) * bar, to * bar);
    state.marks.clear();
  };
  $("bar-from").onchange = section;
  $("bar-to").onchange = section;
  $("bars-all").onclick = () => {
    if (!state.score) return;
    $("bar-from").value = 1; $("bar-to").value = state.score.bars; section();
  };

  $("listen").onclick = toggleListening;

  // Panels.
  $("open-panel").onclick = () => openSheet("sheet-open");
  $("design-panel").onclick = () => openSheet("sheet-design");
  $("help-panel").onclick = () => openSheet("sheet-help");
  for (const node of document.querySelectorAll("[data-close]")) {
    node.onclick = () => closeSheets();
  }
  for (const sheet of document.querySelectorAll(".sheet")) {
    sheet.addEventListener("pointerdown", (e) => { if (e.target === sheet) closeSheets(); });
  }

  // Music panel.
  $("use-script").onclick = () => {
    const text = $("script").value;
    try {
      loadScores(parseText(text));
      remember(text);
      message("open-msg", "Loaded.", "good");
      closeSheets();
    } catch (e) {
      message("open-msg", e.message, "bad");
    }
  };
  $("clear-script").onclick = () => { $("script").value = ""; message("open-msg", ""); };
  $("file-open").onclick = () => $("file").click();
  $("file").onchange = async () => {
    const file = $("file").files[0];
    if (file) await openOne(file);
    $("file").value = "";
  };
  $("copy-script").onclick = () => {
    if (!state.score) return message("open-msg", "Nothing is loaded.", "bad");
    const text = toScript(state.score, { midiToNote });
    $("script").value = text;
    copy(text, "open-msg", "This piece, as a script", $("script"));
  };
  $("examples").onchange = async () => {
    const value = $("examples").value;
    if (!value) return;
    if (value.startsWith("loaded:")) {
      applyScore(state.loaded[Number(value.slice(7))]);
      closeSheets();
      return;
    }
    try {
      const response = await fetch(value, { cache: "no-cache" });
      const text = await response.text();
      $("script").value = text;
      loadScores(parseText(text));
      remember(text);
      closeSheets();
    } catch (e) {
      message("open-msg", `Could not open that example: ${e.message}`, "bad");
    }
  };

  // Guide.
  $("copy-guide").onclick = () => copy($("guide").textContent, "help-msg", "The guide", $("guide"));

  // Drag and drop, anywhere.
  const drop = $("drop");
  let depth = 0;
  window.addEventListener("dragenter", (e) => { e.preventDefault(); if (++depth === 1) drop.hidden = false; });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; drop.hidden = true; } });
  window.addEventListener("drop", async (e) => {
    e.preventDefault();
    depth = 0; drop.hidden = true;
    const file = e.dataTransfer?.files?.[0];
    if (file) await openOne(file);
  });

  // Keys.
  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input, textarea, select")) return;
    if (e.key === "Escape") return closeSheets();
    if (e.key === " ") { e.preventDefault(); $("play").click(); }
    else if (e.key.toLowerCase() === "s") $("stop").click();
    else if (e.key.toLowerCase() === "l") toggleListening();
    else if (e.key === "[") nudgeTempo(-4);
    else if (e.key === "]") nudgeTempo(4);
  });

  // A tap on a bar plays it, which is how you check the instrument is alive.
  const canvas = $("stage");
  canvas.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const bar = Instrument.barAt(state.bars, e.clientX - r.left, e.clientY - r.top);
    if (!bar) return;
    audio.start();
    audio.note(bar.midi, audio.time);
    strikeBar(bar.midi - transport.transpose);
    played(bar.midi);
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  let refit = 0;
  const refitSoon = () => { clearTimeout(refit); refit = setTimeout(fit, 120); };
  window.addEventListener("resize", () => { fit(); refitSoon(); });
  window.addEventListener("orientationchange", refitSoon);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", refitSoon);

  // A page that is not on screen is not animated, so the piece waits for it
  // instead of running on in silence.
  document.addEventListener("visibilitychange", () => {
    if (!transport.playing) return;
    if (document.hidden) { transport.pause(); $("play").textContent = "Play"; }
  });
}

async function openOne(file) {
  try {
    const scores = await openFile(file);
    loadScores(scores, { name: file.name });
    // Anything that arrived as text can come back next time; a MIDI file
    // cannot, so the box is left alone and nothing is remembered.
    if (scores[0].source !== "midi" && file.size < 400000) {
      const text = await file.text();
      $("script").value = text;
      remember(text);
    } else {
      localStorage.removeItem(PIECE_KEY);
    }
    message("open-msg", `Loaded ${file.name}.`, "good");
    closeSheets();
  } catch (e) {
    openSheet("sheet-open");
    message("open-msg", `${file.name}: ${e.message}`, "bad");
  }
}

async function toggleListening() {
  if (state.listening) {
    listener.stop();
    state.listening = false;
    $("listen").classList.remove("on");
    say("Stopped listening.");
    return;
  }
  try {
    const label = await listener.start();
    state.listening = true;
    $("listen").classList.add("on");
    say(`Listening on "${label}". Play along — the notes you get right turn green.`);
  } catch (e) {
    say(e.name === "NotAllowedError"
      ? "The microphone was refused. Allow it in the address bar, or serve the page over https or from localhost."
      : `Could not open the microphone: ${e.message}`);
  }
}

function nudgeTempo(by) {
  const tempo = Math.max(30, Math.min(208, Number($("tempo").value) + by));
  setTempo(tempo);
}

function setTempo(bpm) {
  const value = Math.round(Math.max(30, Math.min(208, bpm)));
  $("tempo").value = value;
  $("tempo-out").textContent = value;
  transport.setTempo(value);
  saveSettings();
}

const repeatsValue = () => ($("repeats").value === "Infinity" ? Infinity : Number($("repeats").value));

/* --------------------------------------------------------------- choices */

function fillParts(score) {
  const select = $("part");
  select.innerHTML = "";
  const names = score.partNames;
  if (names.length > 1) select.append(new Option("both hands", "*"));
  for (const name of names) select.append(new Option(name, name));
  select.value = names.length > 1 ? "*" : names[0] || "";
  const parts = select.value === "*" ? names : [select.value];
  transport.setParts(parts, parts[0]);

  const transposeSelect = $("transpose");
  if (!transposeSelect.options.length) {
    for (let i = -12; i <= 12; i++) {
      transposeSelect.append(new Option(i === 0 ? "as written" : `${i > 0 ? "+" : ""}${i} semitone${Math.abs(i) > 1 ? "s" : ""}`, String(i)));
    }
    transposeSelect.value = "0";
  }
}

function fillLoadedList(scores, name) {
  const select = $("examples");
  for (const group of select.querySelectorAll('optgroup[data-loaded]')) group.remove();
  if (scores.length < 2) return;
  const group = document.createElement("optgroup");
  group.label = name ? `In ${name}` : "In this file";
  group.dataset.loaded = "1";
  scores.forEach((score, i) => group.append(new Option(score.title, `loaded:${i}`)));
  select.insertBefore(group, select.firstChild.nextSibling);
}

async function fillExamples() {
  try {
    const list = await fetch("examples/index.json", { cache: "no-cache" }).then((r) => r.json());
    const group = document.createElement("optgroup");
    group.label = "Examples";
    for (const item of list) group.append(new Option(item.title, `examples/${item.file}`));
    $("examples").append(group);
  } catch (e) { void e; }
}

async function loadGuide() {
  try {
    const text = await fetch("docs/SCRIPT_GUIDE.md", { cache: "no-cache" }).then((r) => r.text());
    $("guide").textContent = text;
  } catch (e) {
    void e;
    $("guide").textContent = "The guide lives in docs/SCRIPT_GUIDE.md beside this page.";
  }
}

/* ---------------------------------------------------------------- design */

function buildDesignPanel() {
  const host = $("design-controls");
  host.innerHTML = "";
  for (const control of Theme.CONTROLS) {
    const label = document.createElement("label");
    label.textContent = control.label;
    let input;
    if (control.type === "colour") {
      input = document.createElement("input");
      input.type = "color";
      input.value = toHex(Theme.get(state.theme, control.path));
      input.oninput = () => changeTheme(control.path, input.value);
    } else if (control.type === "switch") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!Theme.get(state.theme, control.path);
      input.onchange = () => changeTheme(control.path, input.checked);
    } else {
      input = document.createElement("input");
      input.type = "range";
      input.min = control.min; input.max = control.max; input.step = control.step;
      input.value = Theme.get(state.theme, control.path);
      input.oninput = () => changeTheme(control.path, Number(input.value));
    }
    input.dataset.path = control.path;
    label.append(input);
    host.append(label);
  }
  buildPalette();

  $("shape").value = state.theme.shape.instrument;
  $("shape").onchange = () => changeTheme("shape.instrument", $("shape").value);
  $("octaves").onchange = () => {
    state.octavesChoice = $("octaves").value;
    chooseInstrument(); fit(); saveSettings();
  };
  $("theme-list").onchange = () => {
    const chosen = state.library[Number($("theme-list").value)];
    if (!chosen) return;
    state.theme = Theme.normalise(chosen);
    afterThemeChange();
    message("design-msg", `${state.theme.name}.`, "good");
  };
  $("theme-export").onclick = () => {
    const blob = new Blob([JSON.stringify(state.theme, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.theme.name.toLowerCase().replace(/\W+/g, "-") || "design"}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    message("design-msg", "Saved.", "good");
  };
  $("theme-import-btn").onclick = () => $("theme-import").click();
  $("theme-import").onchange = async () => {
    const file = $("theme-import").files[0];
    if (!file) return;
    try {
      state.theme = Theme.normalise(JSON.parse(await file.text()));
      afterThemeChange();
      message("design-msg", `${state.theme.name} loaded.`, "good");
    } catch (e) {
      message("design-msg", `That design will not read: ${e.message}`, "bad");
    }
    $("theme-import").value = "";
  };
  $("theme-reset").onclick = () => {
    Theme.forget();
    state.theme = Theme.normalise(Theme.DEFAULT_THEME);
    afterThemeChange();
    message("design-msg", "Back to the first design.", "good");
  };
}

function buildPalette() {
  const host = $("palette");
  host.innerHTML = "";
  state.theme.colours.bars.forEach((colour, i) => {
    const input = document.createElement("input");
    input.type = "color";
    input.value = toHex(colour);
    input.title = `Colour ${i + 1}`;
    input.oninput = () => {
      state.theme.colours.bars[i] = input.value;
      afterThemeChange({ rebuild: false });
    };
    host.append(input);
  });
  $("palette-add").onclick = () => {
    state.theme.colours.bars.push("#8bc34a");
    afterThemeChange();
  };
  $("palette-remove").onclick = () => {
    if (state.theme.colours.bars.length > 1) state.theme.colours.bars.pop();
    afterThemeChange();
  };
}

function changeTheme(path, value) {
  Theme.set(state.theme, path, value);
  afterThemeChange({ rebuild: false });
}

function afterThemeChange({ rebuild = true } = {}) {
  Theme.applyToPage(state.theme);
  Theme.save(state.theme);
  if (rebuild) {
    buildDesignPanel();
    fillThemeList();
  }
  fit();
}

function fillThemeList() {
  const select = $("theme-list");
  select.innerHTML = "";
  if (!state.library.length) {
    select.append(new Option("this one", "-1"));
    select.disabled = true;
    return;
  }
  select.disabled = false;
  state.library.forEach((theme, i) => select.append(new Option(theme.name, String(i))));
  const match = state.library.findIndex((t) => t.name === state.theme.name);
  select.value = String(match < 0 ? 0 : match);
}

function toHex(colour) {
  const text = String(colour || "#000000");
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) return "#" + [...text.slice(1)].map((c) => c + c).join("");
  const m = /rgba?\(([^)]+)\)/i.exec(text);
  if (m) {
    const [r, g, b] = m[1].split(",").map((v) => Math.max(0, Math.min(255, Math.round(parseFloat(v)))));
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  }
  return "#000000";
}

/* -------------------------------------------------------------- settings */

function saveSettings() {
  const settings = {
    tempo: Number($("tempo").value),
    repeats: $("repeats").value,
    countin: $("countin").value,
    metronome: $("metronome").checked,
    sound: $("sound").checked,
    volume: Number($("volume").value),
    transpose: $("transpose").value,
    octaves: state.octavesChoice,
  };
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { void e; }
}

function restoreSettings() {
  let settings = null;
  try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch (e) { void e; }
  if (settings) {
    if (settings.repeats) $("repeats").value = settings.repeats;
    if (settings.countin != null) $("countin").value = settings.countin;
    if (settings.metronome != null) $("metronome").checked = settings.metronome;
    if (settings.sound != null) $("sound").checked = settings.sound;
    if (settings.volume != null) $("volume").value = settings.volume;
    if (settings.octaves) state.octavesChoice = settings.octaves;
  }
  $("octaves").value = state.octavesChoice;
  audio.setVolume(Number($("volume").value));
  transport.repeats = repeatsValue();
  transport.countInBars = Number($("countin").value);
  transport.metronome = $("metronome").checked;
  transport.muted = !$("sound").checked;
}

/* ----------------------------------------------------------------- bits */

function openSheet(id) {
  closeSheets();
  $(id).hidden = false;
}

function closeSheets() {
  for (const sheet of document.querySelectorAll(".sheet")) sheet.hidden = true;
}

function remember(text) {
  try { localStorage.setItem(PIECE_KEY, text); } catch (e) { void e; }   // a quota is not an error here
}

function say(text) {
  $("status").textContent = text;
}

function message(id, text, kind = "") {
  const node = $(id);
  node.textContent = text;
  node.className = `msg ${kind}`;
}

async function copy(text, msgId, what, fallbackNode = null) {
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("no clipboard");
    await navigator.clipboard.writeText(text);
    message(msgId, `${what} is on the clipboard.`, "good");
  } catch (e) {
    void e;
    const box = document.createElement("textarea");
    box.value = text;
    box.style.cssText = "position:fixed;opacity:0";
    document.body.append(box);
    box.select();
    let done = false;
    try { done = document.execCommand("copy"); } catch (_) { void _; }
    box.remove();
    if (done) return message(msgId, `${what} is on the clipboard.`, "good");
    if (fallbackNode) {
      if (fallbackNode.select) fallbackNode.select();
      else {
        const range = document.createRange();
        range.selectNodeContents(fallbackNode);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    message(msgId, "This browser will not give a page the clipboard — the text is selected, press Ctrl+C.", "bad");
  }
}

// For the console, and for anything that wants to drive this from a test.
window.ball = { state, transport, audio, listener, applyScore, parseText, Theme };
