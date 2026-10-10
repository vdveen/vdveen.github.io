// A small bowed-string voice for reference notes and drones.

import { midiToFreq } from "./notes.js";

let ctx = null;

function audio() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function voice(midi, gain) {
  const ac = audio();
  const f = midiToFreq(midi);
  const out = ac.createGain();
  out.gain.value = 0;
  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = Math.min(4000, f * 9);
  filter.Q.value = 0.7;
  filter.connect(out);
  out.connect(ac.destination);

  const oscs = [-4, 4].map((detune) => {
    const o = ac.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(filter);
    return o;
  });
  // Gentle vibrato.
  const lfo = ac.createOscillator();
  const depth = ac.createGain();
  lfo.frequency.value = 5;
  depth.gain.value = f * 0.003;
  lfo.connect(depth);
  oscs.forEach((o) => depth.connect(o.frequency));

  const now = ac.currentTime;
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(gain, now + 0.08);
  [...oscs, lfo].forEach((o) => o.start(now));

  return {
    stop(at = ac.currentTime) {
      out.gain.cancelScheduledValues(at);
      out.gain.setValueAtTime(out.gain.value, at);
      out.gain.linearRampToValueAtTime(0, at + 0.15);
      [...oscs, lfo].forEach((o) => o.stop(at + 0.2));
    },
    at: now,
  };
}

export function playNote(midi, seconds = 0.9) {
  const v = voice(midi, 0.18);
  v.stop(v.at + seconds);
}

export function playSequence(midis, beat = 0.6) {
  const ac = audio();
  midis.forEach((m, i) => {
    setTimeout(() => playNote(m, beat * 0.9), i * beat * 1000);
  });
  return midis.length * beat * 1000;
}

let drone = null;

export function startDrone(midi) {
  stopDrone();
  drone = { midi, v: voice(midi, 0.12) };
}

export function stopDrone() {
  drone?.v.stop();
  drone = null;
}

export function droneMidi() {
  return drone?.midi ?? null;
}
