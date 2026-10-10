// Monophonic pitch detection with the McLeod Pitch Method (normalised square
// difference function + peak picking). It copes with the weak fundamental of
// the low cello strings better than a plain FFT peak.

const MIN_FREQ = 55; // a little below the open C string (65.4 Hz)
const MAX_FREQ = 1000;

export function detectPitch(buf, sampleRate, threshold = 0.9) {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < 0.004) return { freq: 0, clarity: 0, rms };

  const maxLag = Math.min(Math.floor(sampleRate / MIN_FREQ), n >> 1);
  const minLag = Math.floor(sampleRate / MAX_FREQ);
  const nsdf = new Float32Array(maxLag + 1);
  for (let tau = 0; tau <= maxLag; tau++) {
    let acf = 0;
    let m = 0;
    for (let i = 0, len = n - tau; i < len; i++) {
      const a = buf[i];
      const b = buf[i + tau];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // Key maxima: the highest point between each positive-going and
  // negative-going zero crossing.
  const peaks = [];
  let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++;
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau < maxLag && nsdf[tau] > 0) {
      if (tau >= minLag && (best < 0 || nsdf[tau] > nsdf[best])) best = tau;
      tau++;
    }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return { freq: 0, clarity: 0, rms };

  let highest = 0;
  for (const p of peaks) highest = Math.max(highest, nsdf[p]);
  const cutoff = threshold * highest;
  const chosen = peaks.find((p) => nsdf[p] >= cutoff);

  // Parabolic interpolation around the chosen lag.
  const a = nsdf[chosen - 1];
  const b = nsdf[chosen];
  const c = nsdf[chosen + 1] ?? b;
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = chosen + shift;
  return { freq: sampleRate / period, clarity: b, rms };
}

// Halves the sample rate by averaging pairs. The cello notes in first position
// stay below 300 Hz, so the lost top octave doesn't matter, and the detector
// runs four times faster.
export function halve(src, dst) {
  for (let i = 0; i < dst.length; i++) dst[i] = 0.5 * (src[2 * i] + src[2 * i + 1]);
  return dst;
}

// Opens the microphone and calls onPitch({ freq, clarity, rms }) about 30
// times a second until stop() is called.
export class Listener {
  constructor(onPitch) {
    this.onPitch = onPitch;
    this.running = false;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // The browser's speech filters smear or cut sustained instrument tones.
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    // About 85 ms of audio at 48 kHz: five periods of the open C string.
    this.analyser.fftSize = 4096;
    source.connect(this.analyser);
    this.buf = new Float32Array(this.analyser.fftSize);
    this.half = new Float32Array(this.analyser.fftSize / 2);
    this.running = true;
    this.lastRun = 0;
    const tick = (t) => {
      if (!this.running) return;
      if (t - this.lastRun > 30) {
        this.lastRun = t;
        this.analyser.getFloatTimeDomainData(this.buf);
        this.onPitch(detectPitch(halve(this.buf, this.half), this.ctx.sampleRate / 2));
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = this.ctx = null;
  }
}

// Turns a noisy stream of estimates into steady notes. A note counts once it
// has held the same semitone for `holdMs`; the cents value is the median of
// that window so a scratchy bow start doesn't skew it.
export class NoteTracker {
  constructor({ holdMs = 180, minClarity = 0.85 } = {}) {
    this.holdMs = holdMs;
    this.minClarity = minClarity;
    this.reset();
  }

  reset() {
    this.semi = null;
    this.since = 0;
    this.samples = [];
    this.silentSince = null;
  }

  // Returns { midi, cents, stable, silent }.
  push({ freq, clarity }, now = performance.now()) {
    if (!freq || clarity < this.minClarity) {
      if (this.silentSince === null) this.silentSince = now;
      if (now - this.silentSince > 150) {
        this.semi = null;
        this.samples = [];
      }
      return { silent: true };
    }
    this.silentSince = null;
    const midi = 69 + 12 * Math.log2(freq / 440);
    const semi = Math.round(midi);
    if (semi !== this.semi) {
      this.semi = semi;
      this.since = now;
      this.samples = [];
    }
    this.samples.push(midi);
    if (this.samples.length > 40) this.samples.shift();
    const sorted = [...this.samples].sort((x, y) => x - y);
    const med = sorted[sorted.length >> 1];
    return {
      midi: semi,
      cents: Math.round((med - semi) * 100),
      stable: now - this.since >= this.holdMs,
      silent: false,
    };
  }
}
