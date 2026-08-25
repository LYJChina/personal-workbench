import type Database from "better-sqlite3";
import { PasswordManagerEntryIdSchema } from "@workbench/contracts";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import type { PasswordManagerEncryptedValue, WrappedCredentialDek } from "./password-manager.crypto.js";

export interface PasswordManagerEntryLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PasswordManagerLayoutUpdate extends PasswordManagerEntryLayout {
  id: string;
}

export interface EncryptedPasswordManagerEntry extends PasswordManagerEncryptedValue {
  id: string;
  formatVersion: number;
}

export interface PasswordManagerEntryRow extends EncryptedPasswordManagerEntry {
  version: number;
  createdAt: string;
  updatedAt: string;
  layout: PasswordManagerEntryLayout;
}

interface MetadataRow {
  format_version: number;
  salt: Buffer;
  kdf_n: number;
  kdf_r: number;
  kdf_p: number;
  kdf_maxmem: number;
  wrapper_nonce: Buffer;
  wrapped_dek: Buffer;
  wrapper_tag: Buffer;
}

interface EntryDatabaseRow {
  id: string;
  format_version: number;
  nonce: Buffer;
  ciphertext: Buffer;
  auth_tag: Buffer;
  version: number;
  created_at: string;
  updated_at: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class PasswordManagerVersionConflictError extends Error {
  public constructor() {
    super("Password-manager entry version conflict");
    this.name = "PasswordManagerVersionConflictError";
  }
}

export class PasswordManagerEntryNotFoundError extends Error {
  public constructor() {
    super("Password-manager entry not found");
    this.name = "PasswordManagerEntryNotFoundError";
  }
}

function mapEntry(row: EntryDatabaseRow): PasswordManagerEntryRow {
  return {
    id: row.id,
    formatVersion: row.format_version,
    nonce: row.nonce,
    ciphertext: row.ciphertext,
    authTag: row.auth_tag,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    layout: { x: row.x, y: row.y, w: row.w, h: row.h }
  };
}

function requireEntryId(id: string): void {
  if (!PasswordManagerEntryIdSchema.safeParse(id).success) throw new PasswordManagerEntryNotFoundError();
}

const selectEntries = `SELECT entries.id, entries.format_version, entries.nonce, entries.ciphertext,
  entries.auth_tag, entries.version, entries.created_at, entries.updated_at,
  layouts.x, layouts.y, layouts.w, layouts.h
  FROM password_manager_entries AS entries
  JOIN password_manager_layouts AS layouts ON layouts.entry_id = entries.id`;

export class PasswordManagerRepository {
  public constructor(private readonly database: Database.Database) {}

  public isConfigured(): boolean {
    return this.database.prepare("SELECT 1 FROM password_manager_metadata WHERE id = 1").get() !== undefined;
  }

  public initialize(wrapper: WrappedCredentialDek): void {
    this.database.prepare(`INSERT INTO password_manager_metadata
      (id, format_version, salt, kdf_n, kdf_r, kdf_p, kdf_maxmem, wrapper_nonce, wrapped_dek, wrapper_tag)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      wrapper.formatVersion,
      wrapper.salt,
      wrapper.scrypt.n,
      wrapper.scrypt.r,
      wrapper.scrypt.p,
      wrapper.scrypt.maxmem,
      wrapper.nonce,
      wrapper.ciphertext,
      wrapper.authTag
    );
  }

  public readWrapper(): WrappedCredentialDek | null {
    const row = this.database.prepare(`SELECT format_version, salt, kdf_n, kdf_r, kdf_p,
      kdf_maxmem, wrapper_nonce, wrapped_dek, wrapper_tag
      FROM password_manager_metadata WHERE id = 1`).get() as MetadataRow | undefined;
    if (!row) return null;
    return {
      formatVersion: row.format_version as 1,
      salt: row.salt,
      scrypt: { n: row.kdf_n, r: row.kdf_r, p: row.kdf_p, maxmem: row.kdf_maxmem },
      nonce: row.wrapper_nonce,
      ciphertext: row.wrapped_dek,
      authTag: row.wrapper_tag
    };
  }

  public createEntry(encryptedPayload: EncryptedPasswordManagerEntry, layout: PasswordManagerEntryLayout): PasswordManagerEntryRow {
    requireEntryId(encryptedPayload.id);
    return this.database.transaction(() => {
      this.database.prepare(`INSERT INTO password_manager_entries
        (id, format_version, nonce, ciphertext, auth_tag) VALUES (?, ?, ?, ?, ?)`).run(
        encryptedPayload.id,
        encryptedPayload.formatVersion,
        encryptedPayload.nonce,
        encryptedPayload.ciphertext,
        encryptedPayload.authTag
      );
      this.database.prepare(`INSERT INTO password_manager_layouts (entry_id, x, y, w, h)
        VALUES (?, ?, ?, ?, ?)`).run(encryptedPayload.id, layout.x, layout.y, layout.w, layout.h);
      return this.requireEntry(encryptedPayload.id);
    })();
  }

  public listEntries(): PasswordManagerEntryRow[] {
    return (this.database.prepare(`${selectEntries} ORDER BY entries.created_at, entries.id`).all() as EntryDatabaseRow[])
      .map(mapEntry);
  }

  public readEntry(id: string): PasswordManagerEntryRow | null {
    requireEntryId(id);
    const row = this.database.prepare(`${selectEntries} WHERE entries.id = ?`).get(id) as EntryDatabaseRow | undefined;
    return row ? mapEntry(row) : null;
  }

  public updateEntry(id: string, encryptedPayload: EncryptedPasswordManagerEntry, version: number): PasswordManagerEntryRow {
    requireEntryId(id);
    if (encryptedPayload.id !== id) throw new PasswordManagerEntryNotFoundError();
    return this.database.transaction(() => {
      const result = this.database.prepare(`UPDATE password_manager_entries
        SET format_version = ?, nonce = ?, ciphertext = ?, auth_tag = ?, version = version + 1,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND version = ?`).run(
        encryptedPayload.formatVersion,
        encryptedPayload.nonce,
        encryptedPayload.ciphertext,
        encryptedPayload.authTag,
        id,
        version
      );
      if (result.changes === 0) {
        if (this.database.prepare("SELECT 1 FROM password_manager_entries WHERE id = ?").get(id)) {
          throw new PasswordManagerVersionConflictError();
        }
        throw new PasswordManagerEntryNotFoundError();
      }
      return this.requireEntry(id);
    })();
  }

  public deleteEntry(id: string): void {
    requireEntryId(id);
    const result = this.database.prepare("DELETE FROM password_manager_entries WHERE id = ?").run(id);
    if (result.changes === 0) throw new PasswordManagerEntryNotFoundError();
  }

  public updateLayouts(layouts: readonly PasswordManagerLayoutUpdate[]): void {
    this.database.transaction(() => {
      const update = this.database.prepare(`UPDATE password_manager_layouts
        SET x = ?, y = ?, w = ?, h = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE entry_id = ?`);
      for (const layout of layouts) {
        requireEntryId(layout.id);
        const result = update.run(layout.x, layout.y, layout.w, layout.h, layout.id);
        if (result.changes === 0) throw new PasswordManagerEntryNotFoundError();
      }
    })();
  }

  private requireEntry(id: string): PasswordManagerEntryRow {
    const entry = this.readEntry(id);
    if (!entry) throw new PasswordManagerEntryNotFoundError();
    return entry;
  }
}

export type PasswordManagerRepositoryProvider = <T>(operation: (repository: PasswordManagerRepository) => T) => T;

export function createPasswordManagerRepositoryProvider(paths: AppPaths): PasswordManagerRepositoryProvider {
  return <T>(operation: (repository: PasswordManagerRepository) => T): T => {
    const database = openDatabase(paths);
    try {
      return operation(new PasswordManagerRepository(database));
    } finally {
      database.close();
    }
  };
}
