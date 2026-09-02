import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputDirectory = dirname(fileURLToPath(import.meta.url));
const sampleRate = 44_100;

const sounds = [
	{
		name: "soft-bell",
		duration: 4.8,
		base: 659.25,
		strike: 0.08,
		partials: [
			[1, 1, 1.9, 0],
			[2.01, 0.36, 1.35, 0.3],
			[2.64, 0.2, 1.05, 1.1],
			[4.08, 0.09, 0.65, 0.7],
		],
	},
	{
		name: "temple-bell",
		duration: 6.8,
		base: 392,
		strike: 0.12,
		partials: [
			[1, 1, 3.1, 0.1],
			[1.51, 0.48, 2.35, 1.7],
			[2.01, 0.29, 1.75, 0.9],
			[2.97, 0.17, 1.18, 2.1],
			[4.18, 0.08, 0.78, 0.4],
		],
	},
	{
		name: "singing-bowl",
		duration: 8.2,
		base: 256,
		strike: 0.06,
		partials: [
			[1, 1, 4.8, 0],
			[1.004, 0.5, 4.6, 1.4],
			[2.01, 0.31, 3.2, 0.8],
			[2.72, 0.16, 2.1, 2.3],
			[4.05, 0.08, 1.35, 0.2],
		],
	},
	{
		name: "deep-gong",
		duration: 10.5,
		base: 110,
		strike: 0.18,
		partials: [
			[1, 0.86, 5.8, 0.2],
			[1.36, 0.67, 4.7, 2.1],
			[1.98, 0.5, 4.1, 0.9],
			[2.73, 0.31, 3.25, 1.6],
			[3.88, 0.2, 2.25, 0.4],
			[5.42, 0.1, 1.3, 2.8],
		],
	},
];

function seededNoise(seed) {
	let state = seed >>> 0;
	return () => {
		state = (state * 1_664_525 + 1_013_904_223) >>> 0;
		return state / 0xffff_ffff * 2 - 1;
	};
}

function synthesize(specification, seed) {
	const frameCount = Math.floor(specification.duration * sampleRate);
	const samples = new Float64Array(frameCount);
	const noise = seededNoise(seed);
	let smoothedNoise = 0;

	for (let index = 0; index < frameCount; index += 1) {
		const time = index / sampleRate;
		const attack = 1 - Math.exp(-time / 0.0035);
		const finalFade = Math.min(1, (specification.duration - time) / 0.28);
		let sample = 0;

		for (const [ratio, amplitude, decay, phase] of specification.partials) {
			const frequency = specification.base * ratio;
			const shimmer = 0.0015 * Math.sin(2 * Math.PI * 0.37 * time + phase);
			const angle = 2 * Math.PI * frequency * (1 + shimmer) * time + phase;
			sample += Math.sin(angle) * amplitude * Math.exp(-time / decay);
		}

		smoothedNoise = smoothedNoise * 0.82 + noise() * 0.18;
		const strikeEnvelope = Math.exp(-time / specification.strike);
		const strike = smoothedNoise * strikeEnvelope * 0.34;
		samples[index] = Math.tanh((sample * attack + strike) * 0.9) * Math.max(0, finalFade);
	}

	let peak = 0;
	for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
	const gain = peak > 0 ? 0.86 / peak : 1;
	const pcm = new Int16Array(frameCount);
	for (let index = 0; index < frameCount; index += 1) {
		pcm[index] = Math.round(samples[index] * gain * 32_767);
	}
	return pcm;
}

function wavBuffer(samples) {
	const bytesPerSample = 2;
	const dataLength = samples.length * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataLength);
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write("WAVE", 8);
	buffer.write("fmt ", 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
	buffer.writeUInt16LE(bytesPerSample, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(dataLength, 40);

	for (let index = 0; index < samples.length; index += 1) {
		buffer.writeInt16LE(samples[index], 44 + index * bytesPerSample);
	}
	return buffer;
}

await mkdir(outputDirectory, { recursive: true });
for (const [index, specification] of sounds.entries()) {
	const samples = synthesize(specification, 41_337 + index * 997);
	await writeFile(join(outputDirectory, `${specification.name}.wav`), wavBuffer(samples));
}
