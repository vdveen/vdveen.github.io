import assert from "node:assert/strict";
import { describe, it } from "node:test";

import worker, { tokensMatch, validateSession } from "../src/index.js";

const WRITE_TOKEN = "write-token-12345678901234567890";
const IMPORT_TOKEN = "import-token-1234567890123456789";
const ORIGIN = "https://veenspace.com";

class FakeDatabase {
	constructor() {
		this.sessions = new Map();
	}

	prepare(sql) {
		return new FakeStatement(this, sql);
	}
}

class FakeStatement {
	constructor(database, sql) {
		this.database = database;
		this.sql = sql;
		this.values = [];
	}

	bind(...values) {
		this.values = values;
		return this;
	}

	async run() {
		if (this.sql.startsWith("INSERT OR IGNORE")) {
			const [id, startAt, endAt, mode, createdAt] = this.values;
			if (this.database.sessions.has(id)) return { meta: { changes: 0 } };
			this.database.sessions.set(id, { id, startAt, endAt, mode, createdAt });
			return { meta: { changes: 1 } };
		}

		if (this.sql.startsWith("DELETE FROM")) {
			return { meta: { changes: this.database.sessions.delete(this.values[0]) ? 1 : 0 } };
		}

		throw new Error(`Unexpected SQL: ${this.sql}`);
	}

	async all() {
		if (!this.sql.startsWith("SELECT id")) throw new Error(`Unexpected SQL: ${this.sql}`);
		return {
			results: [...this.database.sessions.values()]
				.sort((left, right) => left.startAt - right.startAt)
				.slice(0, 100)
				.map(({ id, startAt, endAt, mode }) => ({ id, startAt, endAt, mode })),
		};
	}
}

function environment() {
	return {
		ALLOWED_ORIGINS: ORIGIN,
		DB: new FakeDatabase(),
		WRITE_TOKEN,
		IMPORT_TOKEN,
	};
}

function apiRequest(path, options = {}) {
	const headers = new Headers(options.headers);
	if (options.token) headers.set("Authorization", `Bearer ${options.token}`);
	if (options.origin) headers.set("Origin", options.origin);
	if (options.body) headers.set("Content-Type", "application/json");
	return new Request(`https://queue.example${path}`, {
		method: options.method || "GET",
		headers,
		body: options.body ? JSON.stringify(options.body) : undefined,
	});
}

async function responseJson(response) {
	return JSON.parse(await response.text());
}

describe("meditation queue worker", () => {
	it("compares tokens without accepting short secrets", () => {
		assert.equal(tokensMatch(WRITE_TOKEN, WRITE_TOKEN), true);
		assert.equal(tokensMatch(`${WRITE_TOKEN}x`, WRITE_TOKEN), false);
		assert.equal(tokensMatch("short", "short"), false);
	});

	it("validates session ranges", () => {
		const now = Date.now();
		assert.deepEqual(
			validateSession({ id: "session_1234", startAt: now - 60_000, endAt: now, mode: "open" }, now),
			{ id: "session_1234", startAt: now - 60_000, endAt: now, mode: "open" },
		);
		assert.throws(
			() => validateSession({ id: "bad", startAt: now, endAt: now - 1, mode: "open" }, now),
			/Session ID is invalid/,
		);
	});

	it("accepts only configured browser origins", async () => {
		const env = environment();
		const denied = await worker.fetch(apiRequest("/api/health", { origin: "https://attacker.example" }), env);
		assert.equal(denied.status, 403);

		const accepted = await worker.fetch(apiRequest("/api/health", { origin: ORIGIN }), env);
		assert.equal(accepted.status, 200);
		assert.equal(accepted.headers.get("Access-Control-Allow-Origin"), ORIGIN);
	});

	it("keeps writer and importer permissions separate", async () => {
		const env = environment();
		const now = Date.now();
		const session = {
			id: "session_12345678",
			startAt: now - 15 * 60_000,
			endAt: now,
			mode: "countdown",
		};

		const unauthorizedWrite = await worker.fetch(
			apiRequest("/api/sessions", { method: "POST", body: session, origin: ORIGIN }),
			env,
		);
		assert.equal(unauthorizedWrite.status, 401);

		const write = await worker.fetch(
			apiRequest("/api/sessions", { method: "POST", body: session, token: WRITE_TOKEN, origin: ORIGIN }),
			env,
		);
		assert.equal(write.status, 201);
		assert.equal((await responseJson(write)).created, true);

		const duplicate = await worker.fetch(
			apiRequest("/api/sessions", { method: "POST", body: session, token: WRITE_TOKEN, origin: ORIGIN }),
			env,
		);
		assert.equal(duplicate.status, 200);
		assert.equal((await responseJson(duplicate)).created, false);

		const writerRead = await worker.fetch(apiRequest("/api/sessions", { token: WRITE_TOKEN }), env);
		assert.equal(writerRead.status, 401);

		const importerRead = await worker.fetch(apiRequest("/api/sessions", { token: IMPORT_TOKEN }), env);
		assert.equal(importerRead.status, 200);
		const listed = await responseJson(importerRead);
		assert.equal(listed.sessions.length, 1);
		assert.equal(listed.sessions[0].durationSeconds, 900);
		assert.match(listed.sessions[0].startDate, /^\d{4}-\d{2}-\d{2}T/);

		const acknowledgment = await worker.fetch(
			apiRequest(`/api/sessions/${session.id}/imported`, { method: "POST", token: IMPORT_TOKEN }),
			env,
		);
		assert.equal(acknowledgment.status, 200);
		assert.equal((await responseJson(acknowledgment)).removed, true);

		const emptyRead = await worker.fetch(apiRequest("/api/sessions", { token: IMPORT_TOKEN }), env);
		assert.deepEqual((await responseJson(emptyRead)).sessions, []);
	});

	it("tests the write key without exposing queue contents", async () => {
		const env = environment();
		const response = await worker.fetch(
			apiRequest("/api/auth/write/test", { method: "POST", token: WRITE_TOKEN, origin: ORIGIN }),
			env,
		);
		assert.equal(response.status, 200);
		assert.deepEqual(await responseJson(response), { ok: true, access: "write-only" });
	});
});
