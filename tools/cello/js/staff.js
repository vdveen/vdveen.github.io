// Draws a bass-clef staff as SVG. One staff space is 10 units; the bottom line
// (G2, step 18) sits at y = 40 and each diatonic step moves 5 units.

import { KEYS } from "./notes.js";

const BOTTOM_STEP = 18;
const TOP_STEP = 26;
const MIDDLE_STEP = 22;
const SHARP_STEP = { F: 24, C: 21 };

const yOf = (step) => 40 - (step - BOTTOM_STEP) * 5;

const CLEF =
  `<path d="M3.5,10.5 C2.5,2 11,-1.5 17,1.2 C24.5,4.6 24.2,15 18.5,22.5 ` +
  `C13.8,28.8 7.5,34.2 1,38.5 C7,33 13.4,27 16.2,20 C19,13 18.4,3.8 12,3.6 ` +
  `C7.4,3.4 5.6,6.6 6.6,9 Z"/>` +
  `<circle cx="5.6" cy="10" r="3.4"/><circle cx="24.5" cy="5" r="1.7"/>` +
  `<circle cx="24.5" cy="15" r="1.7"/>`;

function sharp(x, y) {
  return (
    `<g class="acc"><line x1="${x - 1.6}" y1="${y - 8}" x2="${x - 1.6}" y2="${y + 9}"/>` +
    `<line x1="${x + 1.6}" y1="${y - 9}" x2="${x + 1.6}" y2="${y + 8}"/>` +
    `<line class="thick" x1="${x - 4}" y1="${y - 1.8}" x2="${x + 4}" y2="${y - 4.2}"/>` +
    `<line class="thick" x1="${x - 4}" y1="${y + 4.2}" x2="${x + 4}" y2="${y + 1.8}"/></g>`
  );
}

function ledgers(x, step) {
  const out = [];
  for (let s = BOTTOM_STEP - 2; s >= step; s -= 2) out.push(s);
  for (let s = TOP_STEP + 2; s <= step; s += 2) out.push(s);
  return out
    .map((s) => `<line class="ledger" x1="${x - 10}" y1="${yOf(s)}" x2="${x + 10}" y2="${yOf(s)}"/>`)
    .join("");
}

function noteGlyph(x, step, cls, label) {
  const y = yOf(step);
  const up = step < MIDDLE_STEP;
  const stem = up
    ? `<line class="stem" x1="${x + 5.6}" y1="${y - 1.5}" x2="${x + 5.6}" y2="${y - 34}"/>`
    : `<line class="stem" x1="${x - 5.6}" y1="${y + 1.5}" x2="${x - 5.6}" y2="${y + 34}"/>`;
  const text = label
    ? `<text class="label" x="${x}" y="86" text-anchor="middle">${label}</text>`
    : "";
  return (
    `<g class="note ${cls || ""}">${ledgers(x, step)}` +
    `<ellipse cx="${x}" cy="${y}" rx="6.2" ry="4.4" transform="rotate(-22 ${x} ${y})"/>` +
    `${stem}${text}</g>`
  );
}

// notes: [{ step, cls?, label? }]; ghost: optional { step, label } drawn faintly
// next to the current note to show what was actually played.
export function renderStaff({ key = "C", notes = [], spacing = 34, minWidth = 0, ghost = null }) {
  const sharps = KEYS[key].sharps;
  const keyWidth = sharps.length * 9;
  const startX = 44 + keyWidth + 14;
  const width = Math.max(minWidth, startX + notes.length * spacing + 6);

  const lines = [0, 10, 20, 30, 40]
    .map((y) => `<line x1="0" y1="${y}" x2="${width}" y2="${y}"/>`)
    .join("");
  const keySig = sharps.map((l, i) => sharp(36 + i * 9, yOf(SHARP_STEP[l]))).join("");
  const body = notes
    .map((n, i) => noteGlyph(startX + i * spacing + spacing / 2, n.step, n.cls, n.label))
    .join("");

  let ghostSvg = "";
  if (ghost) {
    const gi = ghost.index ?? 0;
    ghostSvg = noteGlyph(startX + gi * spacing + spacing / 2 + 12, ghost.step, "ghost", "");
  }

  const bottom = notes.some((n) => n.label) ? 90 : 70;
  return (
    `<svg class="staff" viewBox="-6 -64 ${width + 12} ${64 + bottom}" preserveAspectRatio="xMidYMid meet" ` +
    `xmlns="http://www.w3.org/2000/svg" role="img">` +
    `<g class="lines">${lines}</g><g class="clef" transform="translate(4 0)">${CLEF}</g>` +
    `${keySig}${body}${ghostSvg}</svg>`
  );
}
