BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL DEFAULT '',
  birthday TEXT NOT NULL DEFAULT '',
  employee_number TEXT NOT NULL DEFAULT '',
  photo_filename TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS profile_custom_fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(profile_id, position)
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  completed TEXT NOT NULL,
  risks TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_polish_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('daily_report', 'leadership', 'translation', 'general', 'custom')),
  primary_text TEXT NOT NULL,
  secondary_text TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ai_polish_records_kind_created_idx
  ON ai_polish_records(kind, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS ai_polish_prompts (
  kind TEXT PRIMARY KEY CHECK (kind IN ('daily_report', 'leadership', 'translation', 'general', 'custom')),
  system_prompt TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  module_id TEXT PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS navigation_items (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  path TEXT NOT NULL,
  position INTEGER NOT NULL,
  visible INTEGER NOT NULL DEFAULT 1,
  disabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  weekday INTEGER NOT NULL,
  local_time TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  last_delivered_on TEXT,
  last_failure_category TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reminder_delivery_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  error_category TEXT,
  attempted_at TEXT NOT NULL,
  UNIQUE(reminder_id, local_date)
);

CREATE INDEX IF NOT EXISTS reminder_delivery_attempts_status_idx
  ON reminder_delivery_attempts(reminder_id, status, attempted_at DESC);

CREATE TABLE IF NOT EXISTS reminder_delivery_claims (
  reminder_id TEXT NOT NULL REFERENCES reminders(id) ON DELETE CASCADE,
  local_date TEXT NOT NULL,
  claim_token TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL,
  claim_expires_at TEXT NOT NULL,
  PRIMARY KEY(reminder_id, local_date)
);

CREATE INDEX IF NOT EXISTS reminder_delivery_claims_expiry_idx
  ON reminder_delivery_claims(claim_expires_at);

CREATE TABLE IF NOT EXISTS reminder_scheduler_state (
  reminder_id TEXT PRIMARY KEY REFERENCES reminders(id) ON DELETE CASCADE,
  synchronized_local_time TEXT NOT NULL,
  synchronized_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO profile (id) VALUES (1);

COMMIT;
