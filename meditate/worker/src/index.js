const JSON_HEADERS = {
	"Cache-Control": "no-store",
	"Content-Type": "application/json; charset=utf-8",
	"X-Content-Type-Options": "nosniff",
};

function allowedOrigins(env) {
	return String(env.ALLOWED_ORIGINS || "")
		.split(",")
		.map((origin) => origin.trim())
		.filter(Boolean);
}

function corsHeaders(request, env) {
	const origin = request.headers.get("Origin");
	if (!origin) return {};
	if (!allowedOrigins(env).includes(origin)) return null;

	return {
		"Access-Control-Allow-Headers": "Authorization, Content-Type",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
}

function json(request, env, data, status = 200) {
	const cors = corsHeaders(request, env);
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...JSON_HEADERS, ...(cors || {}) },
	});
}

function textEncoderBytes(value) {
	return new TextEncoder().encode(String(value || ""));
}

function tokensMatch(provided, expected) {
	const left = textEncoderBytes(provided);
	const right = textEncoderBytes(expected);
	let difference = left.length ^ right.length;
	const length = Math.max(left.length, right.length);

	for (let index = 0; index < length; index += 1) {
		difference |= (left[index] || 0) ^ (right[index] || 0);
	}

	return difference === 0 && right.length >= 24;
}

function bearerToken(request) {
	const authorization = request.headers.get("Authorization") || "";
	return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
}

function authorized(request, expectedToken) {
	return tokensMatch(bearerToken(request), expectedToken);
}

async function requestJson(request) {
	const contentLength = Number(request.headers.get("Content-Length") || 0);
	if (contentLength > 4096) throw new Error("Request body is too large.");
	const body = await request.text();
	if (body.length > 4096) throw new Error("Request body is too large.");
	try {
		return JSON.parse(body);
	} catch {
		throw new Error("Request body must be valid JSON.");
	}
}

function validateSession(input, now = Date.now()) {
	const id = String(input?.id || "");
	const startAt = Math.round(Number(input?.startAt));
	const endAt = Math.round(Number(input?.endAt));
	const mode = input?.mode;

	if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
		throw new Error("Session ID is invalid.");
	}
	if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt)) {
		throw new Error("Session timestamps must be integers.");
	}
	if (endAt <= startAt) {
		throw new Error("Session end time must follow its start time.");
	}
	if (endAt - startAt > 12 * 60 * 60 * 1000) {
		throw new Error("A session cannot exceed 12 hours.");
	}
	if (startAt < now - 366 * 24 * 60 * 60 * 1000) {
		throw new Error("A session cannot be more than one year old.");
	}
	if (endAt > now + 5 * 60 * 1000) {
		throw new Error("A session cannot end in the future.");
	}
	if (mode !== "countdown" && mode !== "open") {
		throw new Error("Session mode must be countdown or open.");
	}

	return { id, startAt, endAt, mode };
}

async function enqueueSession(request, env) {
	if (!authorized(request, env.WRITE_TOKEN)) {
		return json(request, env, { error: "The iPad write key is not valid." }, 401);
	}

	let session;
	try {
		session = validateSession(await requestJson(request));
	} catch (error) {
		return json(request, env, { error: error.message }, 400);
	}

	const result = await env.DB.prepare(
		"INSERT OR IGNORE INTO sessions (id, start_at, end_at, mode, created_at) VALUES (?, ?, ?, ?, ?)",
	)
		.bind(session.id, session.startAt, session.endAt, session.mode, Date.now())
		.run();
	const created = Number(result.meta?.changes || 0) > 0;
	return json(request, env, { ok: true, created, id: session.id }, created ? 201 : 200);
}

async function listSessions(request, env) {
	if (!authorized(request, env.IMPORT_TOKEN)) {
		return json(request, env, { error: "The import key is not valid." }, 401);
	}

	const query = await env.DB.prepare(
		"SELECT id, start_at AS startAt, end_at AS endAt, mode FROM sessions ORDER BY start_at ASC LIMIT 100",
	).all();
	const sessions = (query.results || []).map((session) => ({
		...session,
		startDate: new Date(session.startAt).toISOString(),
		endDate: new Date(session.endAt).toISOString(),
		durationSeconds: Math.round((session.endAt - session.startAt) / 1000),
	}));
	return json(request, env, { sessions });
}

async function acknowledgeSession(request, env, id) {
	if (!authorized(request, env.IMPORT_TOKEN)) {
		return json(request, env, { error: "The import key is not valid." }, 401);
	}
	if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) {
		return json(request, env, { error: "Session ID is invalid." }, 400);
	}

	const result = await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
	return json(request, env, { ok: true, removed: Number(result.meta?.changes || 0) > 0 });
}

async function handleRequest(request, env) {
	const cors = corsHeaders(request, env);
	if (cors === null) return json(request, env, { error: "This origin is not allowed." }, 403);

	if (request.method === "OPTIONS") {
		return new Response(null, { status: 204, headers: cors });
	}

	const url = new URL(request.url);
	const path = url.pathname.replace(/\/+$/, "") || "/";

	if (path === "/api/health" && request.method === "GET") {
		return json(request, env, { ok: true, service: "meditation-queue" });
	}

	if (path === "/api/auth/write/test" && request.method === "POST") {
		if (!authorized(request, env.WRITE_TOKEN)) {
			return json(request, env, { error: "The iPad write key is not valid." }, 401);
		}
		return json(request, env, { ok: true, access: "write-only" });
	}

	if (path === "/api/sessions" && request.method === "POST") {
		return enqueueSession(request, env);
	}

	if (path === "/api/sessions" && request.method === "GET") {
		return listSessions(request, env);
	}

	const acknowledgment = path.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)\/imported$/);
	if (acknowledgment && request.method === "POST") {
		return acknowledgeSession(request, env, acknowledgment[1]);
	}

	return json(request, env, { error: "Not found." }, 404);
}

export { handleRequest, tokensMatch, validateSession };

export default {
	async fetch(request, env) {
		try {
			return await handleRequest(request, env);
		} catch (error) {
			console.error("Meditation queue request failed", error);
			return json(request, env, { error: "The queue service encountered an error." }, 500);
		}
	},
};
