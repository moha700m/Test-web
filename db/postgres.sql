CREATE TABLE IF NOT EXISTS challenges (
 id text PRIMARY KEY, session text NOT NULL, origin text NOT NULL, url text NOT NULL,
 token text NOT NULL, expires bigint NOT NULL, verified bigint NOT NULL DEFAULT 0,
 used integer NOT NULL DEFAULT 0, attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS challenges_session_idx ON challenges(session);
CREATE INDEX IF NOT EXISTS challenges_expires_idx ON challenges(expires);
CREATE TABLE IF NOT EXISTS hosts (
 origin text PRIMARY KEY, verify_at bigint NOT NULL DEFAULT 0,
 last_started bigint NOT NULL DEFAULT 0, locked_until bigint NOT NULL DEFAULT 0, run_id text
);
CREATE TABLE IF NOT EXISTS runs (
 id text PRIMARY KEY, session text NOT NULL, origin text NOT NULL, started bigint NOT NULL,
 stopped integer NOT NULL DEFAULT 0, finished integer NOT NULL DEFAULT 0, result text
);
