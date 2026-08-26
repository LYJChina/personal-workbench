CREATE TABLE ai_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  protocol TEXT NOT NULL CHECK (protocol IN ('openai', 'anthropic')),
  base_url TEXT NOT NULL CHECK (length(base_url) BETWEEN 1 AND 2000),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 200),
  secret_name TEXT NOT NULL UNIQUE,
  is_default INTEGER NOT NULL CHECK (is_default IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX ai_connections_single_default_idx
  ON ai_connections(is_default)
  WHERE is_default = 1;

INSERT INTO ai_connections
  (id, name, protocol, base_url, model, secret_name, is_default)
VALUES (
  'legacy-deepseek',
  'DeepSeek',
  'openai',
  COALESCE((SELECT value FROM app_settings WHERE key = 'deepseek.base_url'), 'https://api.deepseek.com'),
  COALESCE((SELECT value FROM app_settings WHERE key = 'deepseek.model'), 'deepseek-chat'),
  'deepseek-api-key',
  1
);
