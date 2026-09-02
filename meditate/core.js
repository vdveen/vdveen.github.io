export const SOUND_PATHS = Object.freeze({
	"soft-bell": "audio/soft-bell.wav",
	"temple-bell": "audio/temple-bell.wav",
	"singing-bowl": "audio/singing-bowl.wav",
	"deep-gong": "audio/deep-gong.wav",
});

export function clamp(value, minimum, maximum) {
	return Math.min(Math.max(value, minimum), maximum);
}

export function formatClock(milliseconds, roundUp = false) {
	const safeMilliseconds = Math.max(0, Number(milliseconds) || 0);
	const totalSeconds = roundUp
		? Math.ceil(safeMilliseconds / 1000)
		: Math.floor(safeMilliseconds / 1000);
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
	}

	return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDuration(milliseconds) {
	const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;

	if (hours > 0) {
		const hourLabel = hours === 1 ? "hour" : "hours";
		const minutePart = minutes > 0 ? ` ${minutes} min` : "";
		return `${hours} ${hourLabel}${minutePart}`;
	}

	if (minutes > 0) {
		const roundedMinutes = seconds >= 30 ? minutes + 1 : minutes;
		const minuteLabel = roundedMinutes === 1 ? "minute" : "minutes";
		return `${roundedMinutes} ${minuteLabel}`;
	}

	return `${seconds} ${seconds === 1 ? "second" : "seconds"}`;
}

export function normalizeApiUrl(value) {
	const input = String(value || "").trim();
	if (!input) return "";

	let url;
	try {
		url = new URL(input);
	} catch {
		throw new Error("Enter a complete queue service URL.");
	}

	if (url.protocol !== "https:" && url.hostname !== "localhost") {
		throw new Error("The queue service must use HTTPS.");
	}

	url.pathname = url.pathname.replace(/\/+$/, "");
	url.search = "";
	url.hash = "";
	return url.toString().replace(/\/$/, "");
}

export function validateSyncSettings(settings) {
	const apiUrl = normalizeApiUrl(settings?.apiUrl);
	const writeToken = String(settings?.writeToken || "").trim();

	if (!apiUrl || !writeToken) {
		throw new Error("Add the queue service URL and iPad write key first.");
	}

	if (writeToken.length < 24) {
		throw new Error("The iPad write key is too short.");
	}

	return { apiUrl, writeToken };
}

export function createSession({ id, startAt, endAt, mode }) {
	const start = Math.round(Number(startAt));
	const end = Math.round(Number(endAt));

	if (!id || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
		throw new Error("The meditation session has invalid timestamps.");
	}

	if (mode !== "countdown" && mode !== "open") {
		throw new Error("The meditation session has an invalid timer mode.");
	}

	return {
		id: String(id),
		startAt: start,
		endAt: end,
		mode,
	};
}

export function upsertOutbox(outbox, session) {
	const otherSessions = Array.isArray(outbox)
		? outbox.filter((item) => item?.id !== session.id)
		: [];
	return [...otherSessions, session];
}

export function removeFromOutbox(outbox, id) {
	return Array.isArray(outbox) ? outbox.filter((item) => item?.id !== id) : [];
}
