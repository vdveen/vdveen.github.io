// The notes of Cello Time Joggers, all in first position with the 0-1-34 hand
// shape. The book introduces them in four stages: open strings, then the 1st,
// 3rd and 4th finger.

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export const STRINGS = ["C", "G", "D", "A"];

export const STAGES = [
  { id: 1, name: "Open strings", pieces: "pieces 1–9" },
  { id: 2, name: "+ 1st finger", pieces: "pieces 10–20" },
  { id: 3, name: "+ 3rd finger", pieces: "pieces 21–30" },
  { id: 4, name: "+ 4th finger", pieces: "piece 31 on" },
];

// [letter, sharp, octave, string, finger]
const TABLE = [
  ["C", 0, 2, "C", 0], ["D", 0, 2, "C", 1], ["E", 0, 2, "C", 3], ["F", 0, 2, "C", 4],
  ["G", 0, 2, "G", 0], ["A", 0, 2, "G", 1], ["B", 0, 2, "G", 3], ["C", 0, 3, "G", 4],
  ["D", 0, 3, "D", 0], ["E", 0, 3, "D", 1], ["F", 1, 3, "D", 3], ["G", 0, 3, "D", 4],
  ["A", 0, 3, "A", 0], ["B", 0, 3, "A", 1], ["C", 1, 4, "A", 3], ["D", 0, 4, "A", 4],
];

const STAGE_OF_FINGER = { 0: 1, 1: 2, 3: 3, 4: 4 };

export const NOTES = TABLE.map(([letter, sharp, octave, string, finger]) => {
  const midi = 12 * (octave + 1) + SEMITONE[letter] + sharp;
  return {
    id: `${string}${finger}`,
    letter,
    sharp: !!sharp,
    octave,
    name: letter + (sharp ? "♯" : ""),
    sci: letter + (sharp ? "♯" : "") + octave,
    string,
    finger,
    stage: STAGE_OF_FINGER[finger],
    midi,
    // Diatonic step number: C0 = 0, so G2 (bottom line of the bass staff) = 18.
    step: octave * 7 + LETTERS.indexOf(letter),
  };
});

export const NOTE_BY_ID = Object.fromEntries(NOTES.map((n) => [n.id, n]));

export function notesUpTo(stage) {
  return NOTES.filter((n) => n.stage <= stage);
}

export function fingerLabel(finger) {
  return finger === 0 ? "open" : ["", "1st", "2nd", "3rd", "4th"][finger] + " finger";
}

export function describe(note) {
  return note.finger === 0
    ? `open ${note.string} string`
    : `${note.string} string, ${fingerLabel(note.finger)}`;
}

// The book uses three key signatures: C major (none), G major (F♯) and
// D major (F♯ C♯). It never writes accidentals on the first-position notes, so
// a note can only be shown in a key whose signature yields that exact pitch.
export const KEYS = {
  C: { name: "C major", sharps: [] },
  G: { name: "G major", sharps: ["F"] },
  D: { name: "D major", sharps: ["F", "C"] },
};

export function keyFits(key, note) {
  return KEYS[key].sharps.includes(note.letter) === note.sharp;
}

export function keysFor(note) {
  return Object.keys(KEYS).filter((k) => keyFits(k, note));
}

// Where each open string sits on the bass staff. These are the landmarks the
// other notes are read from.
export const LANDMARK = {
  C: "second ledger line below the staff",
  G: "bottom line",
  D: "middle line",
  A: "top line",
};

export function openNote(string) {
  return NOTE_BY_ID[`${string}0`];
}

// Equal temperament, A4 = 440 Hz.
export function midiToFreq(midi) {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function freqToMidi(freq) {
  return 69 + 12 * Math.log2(freq / 440);
}

const PITCH_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

export function midiName(midi) {
  const m = Math.round(midi);
  return PITCH_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

// The first-position note for a played pitch, if there is one.
export function noteForMidi(midi) {
  const m = Math.round(midi);
  return NOTES.find((n) => n.midi === m) || null;
}
