import type Database from "better-sqlite3";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { EncryptedValue } from "./vault.crypto.js";

export interface VaultMetadata {
  salt: Buffer;
  verifier: EncryptedValue;
  scrypt: { n: number; r: number; p: number; maxmem: number };
}

interface MetadataRow {
  salt: Buffer;
  verifier_nonce: Buffer;
  verifier_ciphertext: Buffer;
  verifier_tag: Buffer;
  scrypt_n: number;
  scrypt_r: number;
  scrypt_p: number;
  scrypt_maxmem: number;
}

interface SecretRow {
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
}

export class VaultRepository {
  public constructor(private readonly database: Database.Database) {}

  public isConfigured(): boolean {
    return this.database.prepare("SELECT 1 FROM vault_metadata WHERE id = 1").get() !== undefined;
  }

  public readMetadata(): VaultMetadata | null {
    const row = this.database.prepare(`SELECT salt, verifier_nonce, verifier_ciphertext, verifier_tag,
      scrypt_n, scrypt_r, scrypt_p, scrypt_maxmem FROM vault_metadata WHERE id = 1`).get() as MetadataRow | undefined;
    if (!row) return null;
    return {
      salt: row.salt,
      verifier: { nonce: row.verifier_nonce, ciphertext: row.verifier_ciphertext, authTag: row.verifier_tag },
      scrypt: { n: row.scrypt_n, r: row.scrypt_r, p: row.scrypt_p, maxmem: row.scrypt_maxmem }
    };
  }

  public initialize(metadata: VaultMetadata, secrets: ReadonlyMap<string, EncryptedValue>): void {
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO vault_metadata
        (id, salt, verifier_nonce, verifier_ciphertext, verifier_tag, scrypt_n, scrypt_r, scrypt_p, scrypt_maxmem)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        metadata.salt, metadata.verifier.nonce, metadata.verifier.ciphertext, metadata.verifier.authTag,
        metadata.scrypt.n, metadata.scrypt.r, metadata.scrypt.p, metadata.scrypt.maxmem
      );
      const insert = this.database.prepare(`INSERT INTO vault_secrets (name, nonce, ciphertext, auth_tag)
        VALUES (?, ?, ?, ?)`);
      for (const [name, value] of secrets) insert.run(name, value.nonce, value.ciphertext, value.authTag);
    })();
  }

  public upsertSecret(name: string, value: EncryptedValue): void {
    this.database.prepare(`INSERT INTO vault_secrets (name, nonce, ciphertext, auth_tag)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET nonce = excluded.nonce, ciphertext = excluded.ciphertext,
        auth_tag = excluded.auth_tag, updated_at = CURRENT_TIMESTAMP`).run(name, value.nonce, value.ciphertext, value.authTag);
  }

  public readSecret(name: string): EncryptedValue | null {
    const row = this.database.prepare("SELECT nonce, ciphertext, auth_tag FROM vault_secrets WHERE name = ?").get(name) as SecretRow | undefined;
    return row ? { nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag } : null;
  }
}

export type VaultRepositoryProvider = <T>(operation: (repository: VaultRepository) => T) => T;

export function createVaultRepositoryProvider(paths: AppPaths): VaultRepositoryProvider {
  return <T>(operation: (repository: VaultRepository) => T): T => {
    const database = openDatabase(paths);
    try {
      return operation(new VaultRepository(database));
    } finally {
      database.close();
    }
  };
}
