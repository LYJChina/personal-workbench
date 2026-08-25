CREATE TABLE IF NOT EXISTS password_manager_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  format_version INTEGER NOT NULL CHECK (format_version = 1),
  salt BLOB NOT NULL CHECK (typeof(salt) = 'blob' AND length(salt) = 16),
  kdf_n INTEGER NOT NULL CHECK (kdf_n BETWEEN 2 AND 131072 AND (kdf_n & (kdf_n - 1)) = 0),
  kdf_r INTEGER NOT NULL CHECK (kdf_r BETWEEN 1 AND 16),
  kdf_p INTEGER NOT NULL CHECK (kdf_p BETWEEN 1 AND 4),
  kdf_maxmem INTEGER NOT NULL CHECK (
    kdf_maxmem BETWEEN 16777216 AND 268435456
    AND kdf_maxmem >= (128 * kdf_n * kdf_r) + (128 * kdf_r * kdf_p) + 1048576
  ),
  wrapper_nonce BLOB NOT NULL CHECK (typeof(wrapper_nonce) = 'blob' AND length(wrapper_nonce) = 12),
  wrapped_dek BLOB NOT NULL CHECK (typeof(wrapped_dek) = 'blob' AND length(wrapped_dek) = 32),
  wrapper_tag BLOB NOT NULL CHECK (typeof(wrapper_tag) = 'blob' AND length(wrapper_tag) = 16),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS password_manager_entries (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  format_version INTEGER NOT NULL CHECK (format_version = 1),
  nonce BLOB NOT NULL CHECK (typeof(nonce) = 'blob' AND length(nonce) = 12),
  ciphertext BLOB NOT NULL CHECK (typeof(ciphertext) = 'blob' AND length(ciphertext) > 0),
  auth_tag BLOB NOT NULL CHECK (typeof(auth_tag) = 'blob' AND length(auth_tag) = 16),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS password_manager_layouts (
  entry_id TEXT PRIMARY KEY REFERENCES password_manager_entries(id) ON DELETE CASCADE,
  x INTEGER NOT NULL CHECK (x >= 0),
  y INTEGER NOT NULL CHECK (y >= 0),
  w INTEGER NOT NULL CHECK (w BETWEEN 1 AND 16),
  h INTEGER NOT NULL CHECK (h BETWEEN 1 AND 100),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS password_manager_entries_updated_idx
  ON password_manager_entries(updated_at DESC, id);
