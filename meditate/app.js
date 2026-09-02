import {
	SOUND_PATHS,
	clamp,
	createSession,
	formatClock,
	formatDuration,
	normalizeApiUrl,
	removeFromOutbox,
	upsertOutbox,
	validateSyncSettings,
} from "./core.js";

const PREFERENCES_KEY = "still.preferences.v1";
const SYNC_SETTINGS_KEY = "still.sync-settings.v1";
const OUTBOX_KEY = "still.health-outbox.v1";

const elements = {
	app: document.querySelector("#app"),
	setupView: document.querySelector("#setupView"),
	timerView: document.querySelector("#timerView"),
	completeView: document.querySelector("#completeView"),
	settingsButton: document.querySelector("#settingsButton"),
	startButton: document.querySelector("#startButton"),
	finishButton: document.querySelector("#finishButton"),
	confirmFinishButton: document.querySelector("#confirmFinishButton"),
	againButton: document.querySelector("#againButton"),
	retryButton: document.querySelector("#retryButton"),
	modeButtons: [...document.querySelectorAll("[data-mode]")],
	presetButtons: [...document.querySelectorAll("[data-minutes]")],
	durationSection: document.querySelector("#durationSection"),
	customMinutes: document.querySelector("#customMinutes"),
	startSound: document.querySelector("#startSound"),
	endSound: document.querySelector("#endSound"),
	previewButtons: [...document.querySelectorAll("[data-preview]")],
	healthToggle: document.querySelector("#healthToggle"),
	wakeSupport: document.querySelector("#wakeSupport"),
	timerLabel: document.querySelector("#timerLabel"),
	timerValue: document.querySelector("#timerValue"),
	progressRing: document.querySelector("#progressRing"),
	awakeStatus: document.querySelector("#awakeStatus"),
	awakeStatusText: document.querySelector("#awakeStatusText"),
	blackoutSurface: document.querySelector("#blackoutSurface"),
	completeTitle: document.querySelector("#completeTitle"),
	sessionTotal: document.querySelector("#sessionTotal"),
	queueResult: document.querySelector("#queueResult"),
	queueMessage: document.querySelector("#queueMessage"),
	settingsDialog: document.querySelector("#settingsDialog"),
	settingsForm: document.querySelector("#settingsForm"),
	apiUrl: document.querySelector("#apiUrl"),
	writeToken: document.querySelector("#writeToken"),
	settingsMessage: document.querySelector("#settingsMessage"),
	testConnectionButton: document.querySelector("#testConnectionButton"),
	finishDialog: document.querySelector("#finishDialog"),
	toast: document.querySelector("#toast"),
};

const defaultPreferences = {
	mode: "countdown",
	minutes: 15,
	startSound: "soft-bell",
	endSound: "deep-gong",
	healthEnabled: false,
};

let preferences = { ...defaultPreferences, ...readStorage(PREFERENCES_KEY, {}) };
let currentSession = null;
let timerInterval = null;
let wakeLock = null;
let toastTimeout = null;
let blackoutTimeout = null;

class SoundBank {
	constructor(paths) {
		this.paths = paths;
		this.context = null;
		this.rawAudio = new Map();
		this.buffers = new Map();
		this.activeSources = new Set();
	}

	preload() {
		for (const [name, path] of Object.entries(this.paths)) {
			fetch(path)
				.then((response) => {
					if (!response.ok) throw new Error(`Could not load ${name}`);
					return response.arrayBuffer();
				})
				.then((data) => this.rawAudio.set(name, data))
				.catch(() => {});
		}
	}

	async unlock() {
		const AudioContext = window.AudioContext || window.webkitAudioContext;
		if (!AudioContext) return false;
		if (!this.context) this.context = new AudioContext();
		if (this.context.state === "suspended") await this.context.resume();
		return this.context.state === "running";
	}

	async getBuffer(name) {
		if (this.buffers.has(name)) return this.buffers.get(name);

		let data = this.rawAudio.get(name);
		if (!data) {
			const response = await fetch(this.paths[name]);
			if (!response.ok) throw new Error("The sound could not be loaded.");
			data = await response.arrayBuffer();
			this.rawAudio.set(name, data);
		}

		const buffer = await this.context.decodeAudioData(data.slice(0));
		this.buffers.set(name, buffer);
		return buffer;
	}

	async play(name) {
		if (!name || name === "none" || !this.paths[name]) return;
		if (!(await this.unlock())) return;

		const buffer = await this.getBuffer(name);
		const source = this.context.createBufferSource();
		const gain = this.context.createGain();
		gain.gain.value = 0.92;
		source.buffer = buffer;
		source.connect(gain);
		gain.connect(this.context.destination);
		source.addEventListener("ended", () => this.activeSources.delete(source), { once: true });
		this.activeSources.add(source);
		source.start();
	}

	stop() {
		for (const source of this.activeSources) {
			try {
				source.stop();
			} catch {
				// The source may have ended between iteration and stop().
			}
		}
		this.activeSources.clear();
	}
}

const soundBank = new SoundBank(SOUND_PATHS);

function readStorage(key, fallback) {
	try {
		const value = window.localStorage.getItem(key);
		return value ? JSON.parse(value) : fallback;
	} catch {
		return fallback;
	}
}

function writeStorage(key, value) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

function createId() {
	if (window.crypto?.randomUUID) return window.crypto.randomUUID();
	const random = window.crypto?.getRandomValues
		? window.crypto.getRandomValues(new Uint32Array(2)).join("")
		: String(Math.random()).slice(2);
	return `session-${Date.now()}-${random}`;
}

function persistPreferences() {
	writeStorage(PREFERENCES_KEY, preferences);
}

function syncSetupControls() {
	preferences.mode = preferences.mode === "open" ? "open" : "countdown";
	preferences.minutes = clamp(Number(preferences.minutes) || 15, 1, 720);
	if (!(preferences.startSound in SOUND_PATHS) && preferences.startSound !== "none") {
		preferences.startSound = defaultPreferences.startSound;
	}
	if (!(preferences.endSound in SOUND_PATHS) && preferences.endSound !== "none") {
		preferences.endSound = defaultPreferences.endSound;
	}

	for (const button of elements.modeButtons) {
		const active = button.dataset.mode === preferences.mode;
		button.classList.toggle("active", active);
		button.setAttribute("aria-pressed", String(active));
	}

	const presetExists = elements.presetButtons.some(
		(button) => Number(button.dataset.minutes) === preferences.minutes,
	);
	for (const button of elements.presetButtons) {
		button.classList.toggle(
			"active",
			preferences.mode === "countdown" &&
				Number(button.dataset.minutes) === preferences.minutes &&
				!elements.customMinutes.value,
		);
	}

	if (!presetExists && preferences.mode === "countdown") {
		elements.customMinutes.value = String(preferences.minutes);
	}

	elements.durationSection.classList.toggle("inactive", preferences.mode === "open");
	elements.startSound.value = preferences.startSound;
	elements.endSound.value = preferences.endSound;
	elements.healthToggle.checked = Boolean(preferences.healthEnabled);
}

function setView(name) {
	elements.setupView.hidden = name !== "setup";
	elements.timerView.hidden = name !== "timer";
	elements.completeView.hidden = name !== "complete";
	elements.settingsButton.hidden = name === "timer";
	elements.app.classList.toggle("running", name === "timer");
}

function showDialog(dialog) {
	if (typeof dialog.showModal === "function") {
		if (!dialog.open) dialog.showModal();
		return;
	}
	dialog.setAttribute("open", "");
}

function closeDialog(dialog) {
	if (typeof dialog.close === "function") dialog.close();
	else dialog.removeAttribute("open");
}

function showToast(message) {
	window.clearTimeout(toastTimeout);
	elements.toast.textContent = message;
	elements.toast.hidden = false;
	toastTimeout = window.setTimeout(() => {
		elements.toast.hidden = true;
	}, 3200);
}

function updateWakeStatus(active, message) {
	elements.awakeStatus.classList.toggle("warning", !active);
	elements.awakeStatusText.textContent = message;
}

async function requestWakeLock() {
	if (!("wakeLock" in navigator)) {
		updateWakeStatus(false, "Wake lock is unavailable on this iPad");
		return;
	}

	if (wakeLock && !wakeLock.released) return;

	try {
		wakeLock = await navigator.wakeLock.request("screen");
		updateWakeStatus(true, "Keeping the screen awake");
		wakeLock.addEventListener(
			"release",
			() => {
				if (currentSession) {
					updateWakeStatus(false, "The iPad released the wake lock");
				}
			},
			{ once: true },
		);
	} catch {
		wakeLock = null;
		updateWakeStatus(false, "The iPad refused the wake lock");
	}
}

async function releaseWakeLock() {
	const activeLock = wakeLock;
	wakeLock = null;
	if (activeLock && !activeLock.released) {
		try {
			await activeLock.release();
		} catch {
			// A system release can race with this request.
		}
	}
}

function blackout() {
	if (!currentSession || document.body.classList.contains("blacked-out")) return;
	window.clearTimeout(blackoutTimeout);
	elements.blackoutSurface.hidden = false;
	document.body.classList.add("blacked-out");
}

function restoreScreen() {
	window.clearTimeout(blackoutTimeout);
	document.body.classList.remove("blacked-out");
	blackoutTimeout = window.setTimeout(() => {
		elements.blackoutSurface.hidden = true;
	}, 1100);
}

function updateTimer() {
	if (!currentSession) return;

	const now = Date.now();
	if (currentSession.mode === "countdown") {
		const remaining = Math.max(0, currentSession.targetAt - now);
		const ratio = remaining / currentSession.plannedDuration;
		elements.timerValue.textContent = formatClock(remaining, true);
		elements.progressRing.style.setProperty("--progress", `${clamp(ratio, 0, 1) * 360}deg`);

		if (remaining <= 0) {
			void completeSession(currentSession.targetAt, false);
		}
		return;
	}

	elements.timerValue.textContent = formatClock(now - currentSession.startAt);
}

async function startSession() {
	if (preferences.healthEnabled) {
		try {
			validateSyncSettings(readStorage(SYNC_SETTINGS_KEY, {}));
		} catch (error) {
			openSettings(error.message);
			return;
		}
	}

	await soundBank.unlock().catch(() => false);
	const startAt = Date.now();
	currentSession = {
		id: createId(),
		mode: preferences.mode,
		startAt,
		plannedDuration: preferences.mode === "countdown" ? preferences.minutes * 60_000 : null,
		targetAt: preferences.mode === "countdown" ? startAt + preferences.minutes * 60_000 : null,
		healthEnabled: preferences.healthEnabled,
	};

	elements.timerLabel.textContent = preferences.mode === "countdown" ? "Time remaining" : "Time sitting";
	elements.progressRing.classList.toggle("open-ended", preferences.mode === "open");
	elements.progressRing.style.setProperty("--progress", preferences.mode === "countdown" ? "360deg" : "0deg");
	elements.timerValue.textContent = preferences.mode === "countdown"
		? formatClock(currentSession.plannedDuration, true)
		: "0:00";
	updateWakeStatus(true, "Keeping the screen awake");
	setView("timer");

	void requestWakeLock();
	void soundBank.play(preferences.startSound).catch(() => {
		showToast("The starting sound could not play.");
	});

	window.clearInterval(timerInterval);
	timerInterval = window.setInterval(updateTimer, 200);
	updateTimer();
}

async function completeSession(endAt, endedEarly) {
	if (!currentSession) return;
	const finishingSession = currentSession;
	currentSession = null;
	window.clearInterval(timerInterval);
	timerInterval = null;
	restoreScreen();
	await releaseWakeLock();

	const safeEndAt = Math.max(finishingSession.startAt + 1000, Math.round(endAt));
	const session = createSession({
		id: finishingSession.id,
		startAt: finishingSession.startAt,
		endAt: safeEndAt,
		mode: finishingSession.mode,
	});

	elements.completeTitle.textContent = endedEarly ? "Session closed." : "Welcome back.";
	elements.sessionTotal.textContent = formatDuration(session.endAt - session.startAt);
	elements.queueResult.hidden = true;
	elements.retryButton.hidden = true;
	setView("complete");

	void soundBank.play(preferences.endSound).catch(() => {
		showToast("The ending sound could not play.");
	});

	if (finishingSession.healthEnabled) {
		await addToHealthOutbox(session, true);
	}
}

function queueStatus(kind, message) {
	elements.queueResult.classList.remove("warning", "error");
	if (kind !== "success") elements.queueResult.classList.add(kind);
	elements.queueMessage.textContent = message;
	elements.queueResult.hidden = false;
}

function getOutbox() {
	return readStorage(OUTBOX_KEY, []);
}

function setOutbox(outbox) {
	writeStorage(OUTBOX_KEY, outbox);
	return outbox;
}

async function postSession(session, settings) {
	const response = await fetch(`${settings.apiUrl}/api/sessions`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${settings.writeToken}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(session),
	});

	if (!response.ok) {
		let message = "The Health queue rejected this session.";
		try {
			const data = await response.json();
			if (data.error) message = data.error;
		} catch {
			// Keep the generic message for a non-JSON response.
		}
		throw new Error(message);
	}
}

async function addToHealthOutbox(session, showResult) {
	setOutbox(upsertOutbox(getOutbox(), session));
	if (showResult) queueStatus("warning", "Saving to your Health queue…");

	let settings;
	try {
		settings = validateSyncSettings(readStorage(SYNC_SETTINGS_KEY, {}));
		await postSession(session, settings);
		setOutbox(removeFromOutbox(getOutbox(), session.id));
		if (showResult) queueStatus("success", "Ready to import on your Apple device");
	} catch (error) {
		if (showResult) {
			queueStatus("error", "Saved on this iPad. The queue is currently unreachable.");
			elements.retryButton.hidden = false;
		}
		return { ok: false, error };
	}

	return { ok: true };
}

async function flushOutbox(showResult = false) {
	const sessions = getOutbox();
	if (!sessions.length) return true;

	let settings;
	try {
		settings = validateSyncSettings(readStorage(SYNC_SETTINGS_KEY, {}));
	} catch {
		return false;
	}

	if (showResult) queueStatus("warning", `Retrying ${sessions.length === 1 ? "session" : `${sessions.length} sessions`}…`);

	for (const session of sessions) {
		try {
			await postSession(session, settings);
			setOutbox(removeFromOutbox(getOutbox(), session.id));
		} catch {
			if (showResult) {
				queueStatus("error", "The queue is still unreachable. This iPad kept a local copy.");
				elements.retryButton.hidden = false;
			}
			return false;
		}
	}

	if (showResult) {
		queueStatus("success", "Ready to import on your Apple device");
		elements.retryButton.hidden = true;
	}
	return true;
}

function openSettings(message = "") {
	const settings = readStorage(SYNC_SETTINGS_KEY, {});
	elements.apiUrl.value = settings.apiUrl || "";
	elements.writeToken.value = settings.writeToken || "";
	elements.settingsMessage.textContent = message;
	elements.settingsMessage.className = message ? "form-message error" : "form-message";
	showDialog(elements.settingsDialog);
}

function getSettingsFromForm() {
	return validateSyncSettings({
		apiUrl: elements.apiUrl.value,
		writeToken: elements.writeToken.value,
	});
}

async function testConnection() {
	elements.testConnectionButton.disabled = true;
	elements.settingsMessage.textContent = "Testing…";
	elements.settingsMessage.className = "form-message";

	try {
		const settings = getSettingsFromForm();
		const response = await fetch(`${settings.apiUrl}/api/auth/write/test`, {
			method: "POST",
			headers: { Authorization: `Bearer ${settings.writeToken}` },
		});
		if (!response.ok) throw new Error(response.status === 401 ? "The iPad write key is not valid." : "The queue service did not respond correctly.");
		elements.settingsMessage.textContent = "Connection works. This iPad has write-only access.";
		elements.settingsMessage.className = "form-message success";
	} catch (error) {
		elements.settingsMessage.textContent = error.message;
		elements.settingsMessage.className = "form-message error";
	} finally {
		elements.testConnectionButton.disabled = false;
	}
}

function saveSettings() {
	try {
		const settings = getSettingsFromForm();
		writeStorage(SYNC_SETTINGS_KEY, settings);
		closeDialog(elements.settingsDialog);
		showToast("Health queue settings saved.");
		void flushOutbox(false);
		return true;
	} catch (error) {
		elements.settingsMessage.textContent = error.message;
		elements.settingsMessage.className = "form-message error";
		return false;
	}
}

for (const button of elements.modeButtons) {
	button.addEventListener("click", () => {
		preferences.mode = button.dataset.mode;
		persistPreferences();
		syncSetupControls();
	});
}

for (const button of elements.presetButtons) {
	button.addEventListener("click", () => {
		preferences.minutes = Number(button.dataset.minutes);
		elements.customMinutes.value = "";
		persistPreferences();
		syncSetupControls();
	});
}

elements.customMinutes.addEventListener("input", () => {
	const value = Number(elements.customMinutes.value);
	if (Number.isFinite(value) && value >= 1) {
		preferences.minutes = clamp(Math.round(value), 1, 720);
		for (const button of elements.presetButtons) button.classList.remove("active");
		persistPreferences();
	}
});

elements.customMinutes.addEventListener("blur", () => {
	if (elements.customMinutes.value) {
		preferences.minutes = clamp(Math.round(Number(elements.customMinutes.value) || 1), 1, 720);
		elements.customMinutes.value = String(preferences.minutes);
		persistPreferences();
	}
});

elements.startSound.addEventListener("change", () => {
	preferences.startSound = elements.startSound.value;
	persistPreferences();
});

elements.endSound.addEventListener("change", () => {
	preferences.endSound = elements.endSound.value;
	persistPreferences();
});

for (const button of elements.previewButtons) {
	button.addEventListener("click", async () => {
		const sound = button.dataset.preview === "start" ? elements.startSound.value : elements.endSound.value;
		soundBank.stop();
		try {
			await soundBank.play(sound);
		} catch {
			showToast("That sound could not play.");
		}
	});
}

elements.healthToggle.addEventListener("change", () => {
	preferences.healthEnabled = elements.healthToggle.checked;
	persistPreferences();
	if (preferences.healthEnabled) {
		try {
			validateSyncSettings(readStorage(SYNC_SETTINGS_KEY, {}));
		} catch {
			openSettings();
		}
	}
});

elements.startButton.addEventListener("click", () => void startSession());
elements.finishButton.addEventListener("click", () => showDialog(elements.finishDialog));
elements.confirmFinishButton.addEventListener("click", (event) => {
	event.preventDefault();
	closeDialog(elements.finishDialog);
	void completeSession(Date.now(), true);
});

elements.againButton.addEventListener("click", () => {
	soundBank.stop();
	setView("setup");
});

elements.retryButton.addEventListener("click", () => void flushOutbox(true));
elements.settingsButton.addEventListener("click", () => openSettings());
elements.testConnectionButton.addEventListener("click", () => void testConnection());

elements.settingsForm.addEventListener("submit", (event) => {
	if (event.submitter?.value === "cancel") return;
	event.preventDefault();
	saveSettings();
});

elements.blackoutSurface.addEventListener("click", restoreScreen);

document.addEventListener("click", (event) => {
	if (!currentSession || document.body.classList.contains("blacked-out")) return;
	if (event.target instanceof Element && event.target.closest("button, a, input, select, dialog")) return;
	blackout();
});

document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "visible" && currentSession) void requestWakeLock();
});

window.addEventListener("online", () => void flushOutbox(false));

if (!("wakeLock" in navigator)) {
	elements.wakeSupport.textContent = "This browser cannot prevent sleep. Use Safari on iPadOS 16.4 or later.";
} else if (!window.isSecureContext) {
	elements.wakeSupport.textContent = "Screen wake lock requires HTTPS.";
}

syncSetupControls();
soundBank.preload();
void flushOutbox(false);

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker.register("service-worker.js").catch(() => {});
	});
}
