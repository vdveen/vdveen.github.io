CREATE TABLE IF NOT EXISTS sessions (
	id TEXT PRIMARY KEY,
	start_at INTEGER NOT NULL,
	end_at INTEGER NOT NULL,
	mode TEXT NOT NULL CHECK (mode IN ('countdown', 'open')),
	created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_start_at_idx ON sessions (start_at);
