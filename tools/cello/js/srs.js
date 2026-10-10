// Leitner-style scheduling for the note cards. Each note has a box from 0 to 5.
// A fast correct answer moves it up a box, a slow one keeps it in place, and a
// mistake drops it two boxes. Low boxes and slow notes come up more often.

import { NOTES } from "./notes.js";

const KEY = "cello-notes:v1";
export const FAST_MS = 3000;
const BOX_WEIGHT = [10, 6, 4, 2.5, 1.5, 1];

function blank() {
  return { box: 0, seen: 0, right: 0, times: [] };
}

export function loadState() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {}
  const cards = {};
  for (const n of NOTES) cards[n.id] = { ...blank(), ...(saved.cards?.[n.id] || {}) };
  return {
    stage: saved.stage || 1,
    showNames: saved.showNames ?? false,
    answerMode: saved.answerMode || "where",
    sound: saved.sound ?? true,
    hints: saved.hints ?? false,
    days: saved.days || {},
    cards,
  };
}

export function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

export function record(state, id, correct, ms) {
  const c = state.cards[id];
  c.seen++;
  if (correct) {
    c.right++;
    c.times.push(ms);
    if (c.times.length > 8) c.times.shift();
    if (ms <= FAST_MS) c.box = Math.min(5, c.box + 1);
  } else {
    c.box = Math.max(0, c.box - 2);
  }
  const day = new Date().toISOString().slice(0, 10);
  state.days[day] = (state.days[day] || 0) + 1;
}

export function pickNext(state, pool, lastId) {
  const options = pool.length > 1 ? pool.filter((n) => n.id !== lastId) : pool;
  const weights = options.map((n) => {
    const c = state.cards[n.id];
    const t = median(c.times);
    const slow = t ? Math.min(2, Math.max(1, t / FAST_MS)) : 1.3;
    return BOX_WEIGHT[c.box] * slow;
  });
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < options.length; i++) {
    r -= weights[i];
    if (r <= 0) return options[i];
  }
  return options[options.length - 1];
}

// 0..1 for the progress grid.
export function mastery(card) {
  return card.seen ? card.box / 5 : null;
}
