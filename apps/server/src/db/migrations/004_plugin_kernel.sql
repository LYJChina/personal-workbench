CREATE TABLE installed_plugins (
  plugin_id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'third-party')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  runtime_status TEXT NOT NULL CHECK (runtime_status IN ('stopped', 'starting', 'running', 'failed', 'safe-mode')),
  last_error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE plugin_permissions (
  plugin_id TEXT NOT NULL REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plugin_id, permission)
);
CREATE TABLE plugin_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'denied', 'failure')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plugin_audit_plugin_created_idx ON plugin_audit_events(plugin_id, created_at DESC, id DESC);
CREATE TABLE plugin_runtime_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
