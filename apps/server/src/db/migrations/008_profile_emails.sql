CREATE TABLE IF NOT EXISTS profile_emails (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 80),
  address TEXT NOT NULL CHECK (length(trim(address)) BETWEEN 3 AND 320),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(profile_id, position)
);

CREATE UNIQUE INDEX IF NOT EXISTS profile_emails_address_unique
  ON profile_emails(profile_id, lower(address));
