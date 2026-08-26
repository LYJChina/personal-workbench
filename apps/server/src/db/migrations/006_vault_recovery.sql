CREATE TABLE IF NOT EXISTS vault_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt BLOB NOT NULL CHECK (typeof(salt) = 'blob' AND length(salt) = 16),
  verifier_nonce BLOB NOT NULL CHECK (typeof(verifier_nonce) = 'blob' AND length(verifier_nonce) = 12),
  verifier_ciphertext BLOB NOT NULL CHECK (typeof(verifier_ciphertext) = 'blob' AND length(verifier_ciphertext) = 31),
  verifier_tag BLOB NOT NULL CHECK (typeof(verifier_tag) = 'blob' AND length(verifier_tag) = 16),
  scrypt_n INTEGER NOT NULL,
  scrypt_r INTEGER NOT NULL,
  scrypt_p INTEGER NOT NULL,
  scrypt_maxmem INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vault_secrets (
  name TEXT PRIMARY KEY CHECK (length(trim(name)) > 0),
  nonce BLOB NOT NULL CHECK (typeof(nonce) = 'blob' AND length(nonce) = 12),
  ciphertext BLOB NOT NULL CHECK (typeof(ciphertext) = 'blob' AND length(ciphertext) > 0),
  auth_tag BLOB NOT NULL CHECK (typeof(auth_tag) = 'blob' AND length(auth_tag) = 16),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vault_key_wrappers (
  kind TEXT PRIMARY KEY CHECK (kind IN ('password', 'recovery', 'smtp_recovery')),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  salt BLOB NOT NULL CHECK (typeof(salt) = 'blob' AND length(salt) = 16),
  kdf_n INTEGER NOT NULL,
  kdf_r INTEGER NOT NULL,
  kdf_p INTEGER NOT NULL,
  kdf_maxmem INTEGER NOT NULL,
  nonce BLOB NOT NULL CHECK (typeof(nonce) = 'blob' AND length(nonce) = 12),
  ciphertext BLOB NOT NULL CHECK (typeof(ciphertext) = 'blob' AND length(ciphertext) > 0),
  auth_tag BLOB NOT NULL CHECK (typeof(auth_tag) = 'blob' AND length(auth_tag) = 16),
  active INTEGER NOT NULL CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vault_recovery (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT,
  state TEXT NOT NULL DEFAULT 'disabled' CHECK (state IN ('disabled', 'pending', 'active')),
  confirmation_digest BLOB,
  confirmation_expires_at TEXT,
  confirmation_attempts INTEGER NOT NULL DEFAULT 0 CHECK (confirmation_attempts >= 0),
  resend_available_at TEXT,
  smtp_health TEXT NOT NULL DEFAULT 'unknown' CHECK (smtp_health IN ('unknown', 'valid', 'invalid', 'unreachable')),
  smtp_checked_at TEXT,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0)
);

INSERT OR IGNORE INTO vault_recovery (id) VALUES (1);
