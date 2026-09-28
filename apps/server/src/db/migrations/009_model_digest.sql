CREATE TABLE IF NOT EXISTS model_digest_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  recipient_ids_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO model_digest_settings (id, enabled, recipient_ids_json) VALUES (1, 0, '[]');

CREATE TABLE IF NOT EXISTS model_digest_runs (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  run_type TEXT NOT NULL CHECK (run_type IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'fetching', 'summarizing', 'sending', 'succeeded', 'failed')),
  scheduled_local_date TEXT CHECK (scheduled_local_date IS NULL OR length(scheduled_local_date) = 10),
  source_snapshots_json TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  recipient_ids_json TEXT NOT NULL DEFAULT '[]',
  send_email INTEGER NOT NULL DEFAULT 0 CHECK (send_email IN (0, 1)),
  email_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (email_status IN ('not_requested', 'pending', 'sent', 'failed')),
  error_category TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  finished_at TEXT,
  UNIQUE(run_type, scheduled_local_date)
);

CREATE INDEX IF NOT EXISTS model_digest_runs_created_idx
  ON model_digest_runs(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS model_digest_runs_status_idx
  ON model_digest_runs(status, created_at DESC);
