CREATE INDEX IF NOT EXISTS model_digest_runs_history_idx
  ON model_digest_runs(deleted_at, created_at DESC, id DESC);
