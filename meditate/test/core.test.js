import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
	createSession,
	formatClock,
	formatDuration,
	normalizeApiUrl,
	removeFromOutbox,
	upsertOutbox,
	validateSyncSettings,
} from "../core.js";

describe("timer formatting", () => {
	it("formats countdown and open-ended values", () => {
		assert.equal(formatClock(0), "0:00");
		assert.equal(formatClock(60_001), "1:00");
		assert.equal(formatClock(60_001, true), "1:01");
		assert.equal(formatClock(3_661_000), "1:01:01");
	});

	it("formats session totals", () => {
		assert.equal(formatDuration(1_000), "1 second");
		assert.equal(formatDuration(59_000), "59 seconds");
		assert.equal(formatDuration(60_000), "1 minute");
		assert.equal(formatDuration(90_000), "2 minutes");
		assert.equal(formatDuration(3_900_000), "1 hour 5 min");
	});
});

describe("sync configuration", () => {
	it("normalizes a secure queue URL", () => {
		assert.equal(normalizeApiUrl(" https://queue.example///?ignored=true "), "https://queue.example");
		assert.equal(normalizeApiUrl("http://localhost:8787/"), "http://localhost:8787");
	});

	it("rejects insecure remote URLs and short keys", () => {
		assert.throws(() => normalizeApiUrl("http://queue.example"), /must use HTTPS/);
		assert.throws(
			() => validateSyncSettings({ apiUrl: "https://queue.example", writeToken: "too-short" }),
			/too short/,
		);
	});
});

describe("session outbox", () => {
	it("creates valid sessions", () => {
		assert.deepEqual(
			createSession({ id: "session-123", startAt: 1_000, endAt: 2_000, mode: "open" }),
			{ id: "session-123", startAt: 1_000, endAt: 2_000, mode: "open" },
		);
	});

	it("replaces duplicate IDs and removes acknowledged sessions", () => {
		const first = { id: "session-1", startAt: 1, endAt: 2, mode: "open" };
		const replacement = { ...first, endAt: 3 };
		const outbox = upsertOutbox(upsertOutbox([], first), replacement);
		assert.deepEqual(outbox, [replacement]);
		assert.deepEqual(removeFromOutbox(outbox, first.id), []);
	});
});
