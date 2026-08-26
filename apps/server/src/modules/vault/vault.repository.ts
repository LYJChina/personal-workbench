import type Database from "better-sqlite3";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { EncryptedValue } from "./vault.crypto.js";
import type { DekWrapper, WrapperKind } from "./vault-recovery.crypto.js";

export interface VaultMetadata {
  formatVersion: 1 | 2;
  salt: Buffer;
  verifier: EncryptedValue;
  scrypt: { n: number; r: number; p: number; maxmem: number };
}

interface MetadataRow {
  format_version: number;
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

interface WrapperRow extends SecretRow {
  kind: WrapperKind;
  generation: number;
  salt: Buffer;
  kdf_n: number;
  kdf_r: number;
  kdf_p: number;
  kdf_maxmem: number;
}

interface RecoveryRow {
  email: string | null;
  state: "disabled" | "pending" | "active";
  confirmation_digest: Buffer | null;
  confirmation_expires_at: string | null;
  smtp_health: "unknown" | "valid" | "invalid" | "unreachable";
  smtp_checked_at: string | null;
}

export class VaultRepository {
  public constructor(private readonly database: Database.Database) {}

  public isConfigured(): boolean {
    return this.database.prepare("SELECT 1 FROM vault_metadata WHERE id = 1").get() !== undefined;
  }

  public readMetadata(): VaultMetadata | null {
    const row = this.database.prepare(`SELECT format_version, salt, verifier_nonce, verifier_ciphertext, verifier_tag,
      scrypt_n, scrypt_r, scrypt_p, scrypt_maxmem FROM vault_metadata WHERE id = 1`).get() as MetadataRow | undefined;
    if (!row) return null;
    return {
      formatVersion: row.format_version === 2 ? 2 : 1,
      salt: row.salt,
      verifier: { nonce: row.verifier_nonce, ciphertext: row.verifier_ciphertext, authTag: row.verifier_tag },
      scrypt: { n: row.scrypt_n, r: row.scrypt_r, p: row.scrypt_p, maxmem: row.scrypt_maxmem }
    };
  }

  public initialize(metadata: VaultMetadata, secrets: ReadonlyMap<string, EncryptedValue>): void {
    this.database.transaction(() => {
      this.database.prepare(`INSERT INTO vault_metadata
        (id, format_version, salt, verifier_nonce, verifier_ciphertext, verifier_tag, scrypt_n, scrypt_r, scrypt_p, scrypt_maxmem)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        metadata.formatVersion,
        metadata.salt, metadata.verifier.nonce, metadata.verifier.ciphertext, metadata.verifier.authTag,
        metadata.scrypt.n, metadata.scrypt.r, metadata.scrypt.p, metadata.scrypt.maxmem
      );
      const insert = this.database.prepare(`INSERT INTO vault_secrets (name, nonce, ciphertext, auth_tag)
        VALUES (?, ?, ?, ?)`);
      for (const [name, value] of secrets) insert.run(name, value.nonce, value.ciphertext, value.authTag);
    })();
  }

  public initializeV2(metadata: VaultMetadata, passwordWrapper: DekWrapper, secrets: ReadonlyMap<string, EncryptedValue>): void {
    this.database.transaction(() => {
      this.initialize(metadata, secrets);
      this.replaceWrapper(passwordWrapper);
    })();
  }

  public readWrapper(kind: WrapperKind, activeOnly = true): DekWrapper | null {
    const row = this.database.prepare(`SELECT kind, generation, salt, kdf_n, kdf_r, kdf_p, kdf_maxmem,
      nonce, ciphertext, auth_tag FROM vault_key_wrappers WHERE kind = ?${activeOnly ? " AND active = 1" : ""}`).get(kind) as WrapperRow | undefined;
    return row ? {
      kind: row.kind,
      generation: row.generation,
      salt: row.salt,
      scrypt: { n: row.kdf_n, r: row.kdf_r, p: row.kdf_p, maxmem: row.kdf_maxmem },
      nonce: row.nonce,
      ciphertext: row.ciphertext,
      authTag: row.auth_tag
    } : null;
  }

  public readAllSecrets(): ReadonlyMap<string, EncryptedValue> {
    const rows = this.database.prepare("SELECT name, nonce, ciphertext, auth_tag FROM vault_secrets ORDER BY name").all() as Array<SecretRow & { name: string }>;
    return new Map(rows.map((row) => [row.name, { nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.auth_tag }]));
  }

  public migrateV1ToV2(metadata: VaultMetadata, passwordWrapper: DekWrapper, secrets: ReadonlyMap<string, EncryptedValue>): void {
    this.database.transaction(() => {
      this.database.prepare(`UPDATE vault_metadata SET format_version = 2, salt = ?, verifier_nonce = ?,
        verifier_ciphertext = ?, verifier_tag = ?, scrypt_n = ?, scrypt_r = ?, scrypt_p = ?, scrypt_maxmem = ?
        WHERE id = 1 AND format_version = 1`).run(
        metadata.salt, metadata.verifier.nonce, metadata.verifier.ciphertext, metadata.verifier.authTag,
        metadata.scrypt.n, metadata.scrypt.r, metadata.scrypt.p, metadata.scrypt.maxmem
      );
      this.database.prepare("DELETE FROM vault_secrets").run();
      const insert = this.database.prepare("INSERT INTO vault_secrets (name, nonce, ciphertext, auth_tag) VALUES (?, ?, ?, ?)");
      for (const [name, value] of secrets) insert.run(name, value.nonce, value.ciphertext, value.authTag);
      this.replaceWrapper(passwordWrapper);
    })();
  }

  public replaceWrapper(wrapper: DekWrapper): void {
    this.database.prepare(`INSERT INTO vault_key_wrappers
      (kind, generation, salt, kdf_n, kdf_r, kdf_p, kdf_maxmem, nonce, ciphertext, auth_tag, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(kind) DO UPDATE SET generation = excluded.generation, salt = excluded.salt,
        kdf_n = excluded.kdf_n, kdf_r = excluded.kdf_r, kdf_p = excluded.kdf_p,
        kdf_maxmem = excluded.kdf_maxmem, nonce = excluded.nonce, ciphertext = excluded.ciphertext,
        auth_tag = excluded.auth_tag, active = 1, created_at = CURRENT_TIMESTAMP`).run(
      wrapper.kind, wrapper.generation, wrapper.salt, wrapper.scrypt.n, wrapper.scrypt.r,
      wrapper.scrypt.p, wrapper.scrypt.maxmem, wrapper.nonce, wrapper.ciphertext, wrapper.authTag
    );
  }

  public enrollRecovery(email: string, recoveryWrapper: DekWrapper, smtpWrapper: DekWrapper, pending?: { digest: Buffer; expiresAt: string }): void {
    this.database.transaction(() => {
      this.replaceWrapper(recoveryWrapper);
      this.replaceWrapper(smtpWrapper);
      if (pending) this.database.prepare("UPDATE vault_key_wrappers SET active = 0 WHERE kind = 'recovery'").run();
      this.database.prepare(`UPDATE vault_recovery SET email = ?, state = ?, generation = ?,
        confirmation_digest = ?, confirmation_expires_at = ?, confirmation_attempts = 0 WHERE id = 1`)
        .run(email, pending ? "pending" : "active", recoveryWrapper.generation, pending?.digest ?? null, pending?.expiresAt ?? null);
    })();
  }

  public readRecovery(): RecoveryRow {
    return this.database.prepare(`SELECT email, state, confirmation_digest, confirmation_expires_at,
      smtp_health, smtp_checked_at FROM vault_recovery WHERE id = 1`).get() as RecoveryRow;
  }

  public activateRecovery(): void {
    this.database.transaction(() => {
      this.database.prepare("UPDATE vault_key_wrappers SET active = 1 WHERE kind = 'recovery'").run();
      this.database.prepare(`UPDATE vault_recovery SET state = 'active', confirmation_digest = NULL,
        confirmation_expires_at = NULL, confirmation_attempts = 0 WHERE id = 1`).run();
    })();
  }

  public recordSmtpHealth(health: "unknown" | "valid" | "invalid" | "unreachable", checkedAt: string): void {
    this.database.prepare("UPDATE vault_recovery SET smtp_health = ?, smtp_checked_at = ? WHERE id = 1").run(health, checkedAt);
  }

  public activateRotatedRecovery(wrapper: DekWrapper): void {
    this.database.transaction(() => {
      this.replaceWrapper(wrapper);
      this.database.prepare("UPDATE vault_recovery SET state = 'active', generation = ? WHERE id = 1").run(wrapper.generation);
    })();
  }

  public updateSmtpRecovery(wrapper: DekWrapper, secret: EncryptedValue, settings: Record<string, string>): void {
    this.database.transaction(() => {
      this.replaceWrapper(wrapper);
      this.upsertSecret("smtp-password", secret);
      const write = this.database.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`);
      for (const [key, value] of Object.entries(settings)) write.run(key, value);
      this.database.prepare("UPDATE vault_recovery SET smtp_health = 'unknown', smtp_checked_at = NULL WHERE id = 1").run();
    })();
  }

  public commitRecoveryReset(passwordWrapper: DekWrapper, usedKind: "recovery" | "smtp_recovery", smtpWrapper?: DekWrapper, smtpSecret?: EncryptedValue): void {
    this.database.transaction(() => {
      this.replaceWrapper(passwordWrapper);
      if (usedKind === "recovery") {
        this.database.prepare("UPDATE vault_key_wrappers SET active = 0 WHERE kind = 'recovery'").run();
        this.database.prepare("UPDATE vault_recovery SET state = 'disabled' WHERE id = 1").run();
      }
      if (smtpWrapper) this.replaceWrapper(smtpWrapper);
      if (smtpSecret) this.upsertSecret("smtp-password", smtpSecret);
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

  public deleteSecret(name: string): void {
    this.database.prepare("DELETE FROM vault_secrets WHERE name = ?").run(name);
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
