import {
  NOTES, STAGES, STRINGS, LANDMARK, keyFits, keysFor, notesUpTo, describe,
  fingerLabel, midiName, noteForMidi, openNote,
} from "./notes.js";
import { renderStaff } from "./staff.js";
import { Listener, NoteTracker } from "./pitch.js";
import { playNote, playSequence, startDrone, stopDrone, droneMidi } from "./synth.js";
import { loadState, saveState, record, pickNext, median, FAST_MS } from "./srs.js";

const $ = (id) => document.getElementById(id);
const state = loadState();
const FINGERS = [0, 1, 3, 4];
const SESSION = 20;

function pick(xs) {
  return xs[Math.floor(Math.random() * xs.length)];
}

function weighted(items, weights) {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) if ((r -= weights[i]) <= 0) return items[i];
  return items[items.length - 1];
}

function pool() {
  return notesUpTo(state.stage);
}

// Pieces in the book are mostly in D and G major, a few in C.
function keyFor(note) {
  const keys = keysFor(note);
  return weighted(keys, keys.map((k) => ({ D: 3, G: 3, C: 2 })[k]));
}

/* ---------- Stage picker and tabs ---------- */

function initStage() {
  const sel = $("stage");
  sel.innerHTML = STAGES.map(
    (s) => `<option value="${s.id}">${s.name} (${s.pieces})</option>`
  ).join("");
  sel.value = state.stage;
  sel.addEventListener("change", () => {
    state.stage = +sel.value;
    saveState(state);
    newSession();
    renderGrid();
    newLine();
  });
}

let view = "read";

function initTabs() {
  document.querySelectorAll("nav button").forEach((b) =>
    b.addEventListener("click", () => {
      view = b.dataset.view;
      document.querySelectorAll("nav button").forEach((x) => x.classList.toggle("active", x === b));
      document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== view));
      if (view !== "play") stopPlayMic();
      if (view !== "tune") stopTuner();
    })
  );
}

/* ---------- Read: flash cards ---------- */

let session;
let card;
let advanceTimer;

function newSession() {
  session = { n: 0, right: 0, times: [], misses: {} };
  $("summary").hidden = true;
  document.querySelector("#read .card").hidden = false;
  nextCard();
}

function nextCard() {
  clearTimeout(advanceTimer);
  if (session.n >= SESSION) return showSummary();
  const note = pickNext(state, pool(), card?.note.id);
  card = { note, key: keyFor(note), shown: performance.now(), done: false };
  session.n++;
  $("count").textContent = `${session.n} / ${SESSION}`;
  $("cardstaff").innerHTML = renderStaff({ key: card.key, notes: [{ step: note.step, cls: "" }], minWidth: 150 });
  $("prompt").textContent =
    state.answerMode === "where" ? "Where do you play this note?" : "What is this note called?";
  $("prompt").hidden = false;
  $("reveal").hidden = true;
  $("cardbuttons").hidden = true;
  renderAnswerPad();
}

function renderAnswerPad() {
  const unlocked = new Set(pool().map((n) => n.id));
  if (state.answerMode === "where") {
    let html = `<div class="board"><span></span>`;
    html += STRINGS.map((s) => `<span class="head">${s}</span>`).join("");
    // Only the fingers learnt so far, so the pad stays small at the start.
    for (const f of FINGERS.filter((f) => pool().some((n) => n.finger === f))) {
      if (f === 3) html += `<span></span><span class="gap">(no 2nd finger in this book)</span>`;
      html += `<span class="rowlabel">${f === 0 ? "open" : fingerLabel(f).replace(" finger", "")}</span>`;
      for (const s of STRINGS) {
        const n = NOTES.find((x) => x.string === s && x.finger === f);
        const ok = unlocked.has(n.id);
        html += `<button data-id="${n.id}" ${ok ? "" : "disabled"}><span>${state.showNames && ok ? n.name : ""}</span></button>`;
      }
    }
    $("answer").innerHTML = html + `</div>`;
  } else {
    const order = ["C", "C♯", "D", "E", "F", "F♯", "G", "A", "B"];
    const names = order.filter((name) => pool().some((n) => n.name === name));
    $("answer").innerHTML =
      `<div class="names">` + names.map((n) => `<button data-name="${n}">${n}</button>`).join("") + `</div>`;
  }
  $("answer").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => answer(b)));
}

function answer(btn) {
  if (card.done) return;
  card.done = true;
  const ms = performance.now() - card.shown;
  const note = card.note;
  const correct =
    state.answerMode === "where" ? btn.dataset.id === note.id : btn.dataset.name === note.name;
  record(state, note.id, correct, ms);
  saveState(state);
  if (correct) {
    session.right++;
    session.times.push(ms);
  } else {
    session.misses[note.id] = (session.misses[note.id] || 0) + 1;
  }
  btn.classList.add(correct ? "right" : "wrong");
  if (!correct) {
    const sel = state.answerMode === "where" ? `[data-id="${note.id}"]` : `[data-name="${note.name}"]`;
    $("answer").querySelector(sel)?.classList.add("right");
  }
  showReveal(correct, ms);
  if (state.sound) playNote(note.midi);
  if (correct) advanceTimer = setTimeout(nextCard, ms > FAST_MS ? 2600 : 1500);
  renderGrid();
}

function explain(note) {
  const home = openNote(note.string);
  let why;
  if (note.finger === 0) {
    why = `The open ${note.string} string is the ${LANDMARK[note.string]}.`;
  } else {
    const steps = note.step - home.step;
    why =
      `Count up from the open ${note.string} string (${LANDMARK[note.string]}): ` +
      `${steps} step${steps > 1 ? "s" : ""} up is the ${fingerLabel(note.finger)}.`;
  }
  if (note.sharp) why += ` The key signature makes it ${note.name}.`;
  return why;
}

// After an answer the staff adds the open string the note is counted from,
// and the explanation takes the place of the question.
function showReveal(correct, ms) {
  const note = card.note;
  const home = openNote(note.string);
  const notes =
    note.finger === 0
      ? [{ step: note.step, label: note.name }]
      : [{ step: home.step, cls: "landmark", label: home.name }, { step: note.step, label: note.name }];
  $("cardstaff").innerHTML = renderStaff({ key: card.key, notes, minWidth: 150 });
  const secs = (ms / 1000).toFixed(1);
  $("prompt").hidden = true;
  $("reveal").innerHTML =
    `<div class="verdict ${correct ? "good" : "bad"}">${correct ? `Yes! ${secs}s` : "Not quite"}</div>` +
    `<div><b>${note.name}</b>: ${describe(note)}</div>` +
    `<p class="why">${explain(note)}</p>`;
  $("reveal").hidden = false;
  $("cardbuttons").hidden = false;
}

function showSummary() {
  const acc = Math.round((100 * session.right) / SESSION);
  const med = median(session.times);
  const trouble = Object.entries(session.misses)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => NOTES.find((n) => n.id === id));
  document.querySelector("#read .card").hidden = true;
  const s = $("summary");
  s.hidden = false;
  s.innerHTML =
    `<h2>Round done</h2>` +
    `<div class="stats"><div><b>${acc}%</b><span>right</span></div>` +
    `<div><b>${med ? (med / 1000).toFixed(1) + "s" : "–"}</b><span>typical answer time</span></div></div>` +
    (trouble.length
      ? `<p>Look again at: ${trouble.map((n) => `<b>${n.name}</b> (${describe(n)})`).join(", ")}.</p>`
      : `<p>No mistakes.</p>`) +
    `<p class="small">Aim for under three seconds a note. After that, the Play tab is the next step:
      reading a line while you play it.</p>` +
    `<div class="row"><button id="again2" class="primary">Another round</button></div>`;
  $("again2").addEventListener("click", newSession);
}

function renderGrid() {
  const unlocked = new Set(pool().map((n) => n.id));
  let html = `<span></span>` + STRINGS.map((s) => `<span class="head">${s}</span>`).join("");
  for (const f of FINGERS) {
    html += `<span class="rowlabel">${f === 0 ? "open" : fingerLabel(f).replace(" finger", "")}</span>`;
    for (const s of STRINGS) {
      const n = NOTES.find((x) => x.string === s && x.finger === f);
      const c = state.cards[n.id];
      const level = c.seen ? c.box / 5 : 0;
      const bg = `color-mix(in srgb, var(--good) ${Math.round(level * 85)}%, var(--card))`;
      html += `<div class="cell ${unlocked.has(n.id) ? "" : "locked"}" style="background:${bg};${level > 0.5 ? "color:#fff" : ""}">${n.name}</div>`;
    }
  }
  $("grid").innerHTML = html;
}

function initRead() {
  $("next").addEventListener("click", nextCard);
  $("again").addEventListener("click", () => {
    clearTimeout(advanceTimer);
    playNote(card.note.midi);
  });
  document.querySelectorAll("#mode button").forEach((b) => {
    b.classList.toggle("on", b.dataset.mode === state.answerMode);
    b.addEventListener("click", () => {
      state.answerMode = b.dataset.mode;
      saveState(state);
      document.querySelectorAll("#mode button").forEach((x) => x.classList.toggle("on", x === b));
      if (!card.done) renderAnswerPad();
      $("prompt").textContent =
        state.answerMode === "where" ? "Where do you play this note?" : "What is this note called?";
    });
  });
  for (const id of ["showNames", "sound"]) {
    $(id).checked = state[id];
    $(id).addEventListener("change", () => {
      state[id] = $(id).checked;
      saveState(state);
      if (id === "showNames" && !card.done) renderAnswerPad();
    });
  }
  $("resetProgress").addEventListener("click", () => {
    if (!confirm("Forget all progress?")) return;
    for (const id in state.cards) state.cards[id] = { box: 0, seen: 0, right: 0, times: [] };
    saveState(state);
    renderGrid();
  });
  renderGrid();
  newSession();
}

/* ---------- Play: read a line, play it, get feedback ---------- */

let line;
let playListener = null;
let tracker = new NoteTracker({ holdMs: 200 });
let wrongShownFor = null;

// A short melody from the unlocked notes in one key. It moves mostly by step,
// sometimes skips, sometimes jumps back to an open string, and never repeats a
// note straight away, so a held note can't count twice.
function makeLine(len = 6) {
  const keys = ["D", "G", "C"].filter((k) => pool().filter((n) => keyFits(k, n)).length >= 3);
  const key = weighted(keys, keys.map((k) => ({ D: 3, G: 3, C: 2 })[k]));
  const notes = pool().filter((n) => keyFits(key, n)).sort((a, b) => a.midi - b.midi);
  const opens = notes.map((n, i) => (n.finger === 0 ? i : -1)).filter((i) => i >= 0);
  let i = pick(opens);
  const out = [notes[i]];
  while (out.length < len) {
    let j;
    if (Math.random() < 0.15) j = pick(opens);
    else j = i + weighted([-2, -1, 1, 2], [1, 3, 3, 1]);
    j = Math.max(0, Math.min(notes.length - 1, j));
    if (j === i) continue;
    i = j;
    out.push(notes[i]);
  }
  return { key, notes: out };
}

function newLine() {
  line = makeLine();
  line.idx = 0;
  line.results = line.notes.map(() => ({ hit: false, missed: false, cents: null }));
  wrongShownFor = null;
  tracker.reset();
  $("playsummary").hidden = true;
  setPlayMsg(playListener ? "Listening…" : "Press Start and play the line. It waits for each note.");
  renderLine();
}

function renderLine(ghost = null) {
  const notes = line.notes.map((n, i) => {
    const r = line.results[i];
    let cls = "";
    if (i === line.idx && line.idx < line.notes.length) cls = "current";
    else if (r.hit) cls = r.missed ? "missed" : "done";
    return { step: n.step, cls, label: state.hints ? `${n.string} ${n.finger}` : "" };
  });
  $("linestaff").innerHTML = renderStaff({ key: line.key, notes, spacing: 40, ghost });
}

function setPlayMsg(text, cls = "") {
  const m = $("playmsg");
  m.textContent = text;
  m.className = "prompt " + cls;
}

async function startPlayMic() {
  try {
    playListener = new Listener(onPlayPitch);
    await playListener.start();
    $("mic").textContent = "Stop listening";
    setPlayMsg("Listening…");
  } catch (e) {
    playListener = null;
    setPlayMsg("The microphone didn't start: " + e.message, "bad");
  }
}

function stopPlayMic() {
  playListener?.stop();
  playListener = null;
  $("mic").textContent = "Start listening";
  $("level").style.width = "0";
}

function onPlayPitch(p) {
  $("level").style.width = Math.min(100, p.rms * 900) + "%";
  if (line.idx >= line.notes.length) return;
  const t = tracker.push(p);
  if (t.silent || !t.stable) return;
  const target = line.notes[line.idx];
  const r = line.results[line.idx];

  if (t.midi === target.midi) {
    r.hit = true;
    r.cents = t.cents;
    line.idx++;
    wrongShownFor = null;
    tracker.reset();
    renderLine();
    if (line.idx >= line.notes.length) return finishLine();
    setPlayMsg(r.missed ? "Got it." : "Yes!", "good");
    return;
  }

  // A wrong note: say which one it was, once it has been held a moment.
  if (t.midi < 30 || t.midi > 80 || wrongShownFor === t.midi) return;
  wrongShownFor = t.midi;
  r.missed = true;
  const played = noteForMidi(t.midi);
  const what = played ? `${played.name} (${describe(played)})` : midiName(t.midi).replace(/\d+$/, "");
  let hint;
  if (Math.abs(t.midi - target.midi) === 12) hint = `Right name, wrong octave. Try ${t.midi > target.midi ? "lower" : "higher"}.`;
  else hint = `The written note is ${t.midi < target.midi ? "higher" : "lower"}.`;
  setPlayMsg(`That's ${what}. ${hint}`, "bad");
  renderLine(played ? { step: played.step, index: line.idx } : null);
}

// After the line, one look at intonation per finger instead of a live needle.
function finishLine() {
  const total = line.notes.length;
  const clean = line.results.filter((r) => !r.missed).length;
  const byFinger = {};
  line.notes.forEach((n, i) => {
    const c = line.results[i].cents;
    if (c === null) return;
    const key = n.finger === 0 ? `open ${n.string}` : fingerLabel(n.finger);
    (byFinger[key] ||= []).push(c);
  });
  const tips = [];
  for (const [k, cs] of Object.entries(byFinger)) {
    const avg = Math.round(cs.reduce((a, b) => a + b, 0) / cs.length);
    if (Math.abs(avg) < 15) continue;
    const dir = avg < 0 ? "flat" : "sharp";
    if (k.startsWith("open"))
      tips.push(`Your ${k} string sounds ${Math.abs(avg)} cents ${dir}. It may need tuning (see the Tune tab).`);
    else
      tips.push(
        `Your ${k} was ${Math.abs(avg)} cents ${dir} on average: place it a little ${avg < 0 ? "closer to the bridge" : "further from the bridge"}.`
      );
  }
  setPlayMsg("Line done!", "good");
  const s = $("playsummary");
  s.hidden = false;
  s.innerHTML =
    `<h2>Line done</h2>` +
    `<div class="stats"><div><b>${clean}/${total}</b><span>right first time</span></div></div>` +
    (tips.length
      ? tips.map((t) => `<p class="tend">${t}</p>`).join("")
      : `<p class="tend">Intonation looked good: every finger was within 15 cents on average.</p>`) +
    `<p class="small">Orange notes needed a second try.</p>` +
    `<div class="row"><button id="again3" class="primary">Next line</button></div>`;
  $("again3").addEventListener("click", newLine);
}

function initPlay() {
  $("mic").addEventListener("click", () => (playListener ? stopPlayMic() : startPlayMic()));
  $("newline").addEventListener("click", newLine);
  $("hear").addEventListener("click", () => playSequence(line.notes.map((n) => n.midi)));
  $("hints").checked = state.hints;
  $("hints").addEventListener("change", () => {
    state.hints = $("hints").checked;
    saveState(state);
    renderLine();
  });
  newLine();
}

/* ---------- Tune: tuner and drones ---------- */

let tuner = null;
const tuneTracker = new NoteTracker({ holdMs: 60, minClarity: 0.8 });

function onTunePitch(p) {
  const t = tuneTracker.push(p);
  const ptr = $("tneedle");
  if (t.silent || !t.stable) {
    ptr.classList.remove("live");
    return;
  }
  const n = noteForMidi(t.midi);
  $("tnote").innerHTML = midiName(t.midi).replace(/(-?\d+)$/, `<small style="font-size:24px">$1</small>`);
  $("twhere").textContent =
    (n ? describe(n) : "not a first-position note") + ` · ${t.cents > 0 ? "+" : ""}${t.cents} cents`;
  ptr.style.left = 50 + Math.max(-50, Math.min(50, t.cents)) + "%";
  ptr.classList.add("live");
  $("tunestaff").innerHTML = n
    ? renderStaff({ key: keysFor(n)[0], notes: [{ step: n.step }], minWidth: 120 })
    : "";
}

async function startTuner() {
  try {
    tuner = new Listener(onTunePitch);
    await tuner.start();
    $("tmic").textContent = "Stop tuner";
  } catch (e) {
    tuner = null;
    $("twhere").textContent = "The microphone didn't start: " + e.message;
  }
}

function stopTuner() {
  tuner?.stop();
  tuner = null;
  $("tmic").textContent = "Start tuner";
  $("tneedle").classList.remove("live");
}

function initTune() {
  $("tmic").addEventListener("click", () => (tuner ? stopTuner() : startTuner()));
  const box = $("drones");
  box.innerHTML = STRINGS.map((s) => {
    const n = openNote(s);
    return `<button data-midi="${n.midi}">${s}</button>`;
  }).join("");
  box.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      const m = +b.dataset.midi;
      if (droneMidi() === m) stopDrone();
      else startDrone(m);
      box.querySelectorAll("button").forEach((x) => x.classList.toggle("on", +x.dataset.midi === droneMidi()));
    })
  );
}

initStage();
initTabs();
initRead();
initPlay();
initTune();
