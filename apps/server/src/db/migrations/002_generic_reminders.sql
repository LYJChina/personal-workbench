BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS generic_reminders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  lifecycle TEXT NOT NULL CHECK (lifecycle IN ('once', 'finite', 'recurring')),
  schedule_type TEXT NOT NULL CHECK (schedule_type IN ('once', 'daily', 'workday', 'weekly', 'monthly')),
  start_date TEXT NOT NULL,
  local_time TEXT NOT NULL,
  weekdays_json TEXT NOT NULL DEFAULT '[]',
  month_day INTEGER,
  total_occurrences INTEGER,
  successful_occurrences INTEGER NOT NULL DEFAULT 0,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS generic_reminder_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reminder_id TEXT REFERENCES generic_reminders(id) ON DELETE SET NULL,
  reminder_name TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure', 'skipped')),
  error_category TEXT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  UNIQUE(reminder_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS generic_reminder_attempts_time_idx
  ON generic_reminder_attempts(attempted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS generic_reminder_claims (
  reminder_id TEXT NOT NULL REFERENCES generic_reminders(id) ON DELETE CASCADE,
  scheduled_for TEXT NOT NULL,
  claim_token TEXT NOT NULL UNIQUE,
  claimed_at TEXT NOT NULL,
  claim_expires_at TEXT NOT NULL,
  PRIMARY KEY(reminder_id, scheduled_for)
);

CREATE TABLE IF NOT EXISTS holiday_calendar_days (
  local_date TEXT PRIMARY KEY,
  day_type TEXT NOT NULL CHECK (day_type IN ('holiday', 'makeup_workday')),
  name TEXT NOT NULL,
  source_year INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS holiday_calendar_syncs (
  year INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'failure')),
  synchronized_at TEXT NOT NULL
);

COMMIT;
