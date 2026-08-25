import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  PasswordManagerRepository,
  PasswordManagerVersionConflictError
} from "../src/modules/password-manager/password-manager.repository";

const migration = readFileSync(new URL("../src/db/migrations/007_password_manager.sql", import.meta.url), "utf8");

function envelope(id: string, marker: number) {
  return {
    id,
    formatVersion: 1,
    nonce: Buffer.alloc(12, marker),
    ciphertext: Buffer.from([marker, marker + 1]),
    authTag: Buffer.alloc(16, marker + 2)
  };
}

describe("password-manager encrypted repository", () => {
  const databases: Database.Database[] = [];
  const temporaryDirectories: string[] = [];

  function createRepository() {
    const database = new Database(":memory:");
    databases.push(database);
    database.pragma("foreign_keys = ON");
    database.exec(migration);
    return { database, repository: new PasswordManagerRepository(database) };
  }

  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  it("installs idempotent metadata, encrypted-record, and layout tables without credential columns", () => {
    const { database } = createRepository();

    expect(() => database.exec(migration)).not.toThrow();
    const tables = database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'
      AND name LIKE 'password_manager_%' ORDER BY name`).pluck().all();
    expect(tables).toEqual([
      "password_manager_entries",
      "password_manager_layouts",
      "password_manager_metadata"
    ]);
    const columns = database.pragma("table_info(password_manager_entries)") as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      "id", "format_version", "nonce", "ciphertext", "auth_tag", "version", "created_at", "updated_at"
    ]);
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      "name", "website", "username", "password", "notes", "custom_fields"
    ]));
  });

  it("persists and reads only wrapped-key metadata", () => {
    const { repository } = createRepository();
    const wrapper = {
      formatVersion: 1 as const,
      salt: Buffer.alloc(16, 1),
      scrypt: { n: 16, r: 1, p: 1, maxmem: 16 * 1024 * 1024 },
      nonce: Buffer.alloc(12, 2),
      ciphertext: Buffer.alloc(32, 3),
      authTag: Buffer.alloc(16, 4)
    };

    repository.initialize(wrapper);

    expect(repository.isConfigured()).toBe(true);
    expect(repository.readWrapper()).toEqual(wrapper);
  });

  it("creates, lists, updates, lays out, and deletes encrypted rows", () => {
    const { repository } = createRepository();
    const id = "11111111-1111-4111-8111-111111111111";

    const created = repository.createEntry(envelope(id, 1), { x: 2, y: 3, w: 4, h: 5 });
    expect(created).toMatchObject({ id, version: 1, layout: { x: 2, y: 3, w: 4, h: 5 } });
    expect(repository.listEntries()).toEqual([created]);

    const updated = repository.updateEntry(id, envelope(id, 8), 1);
    expect(updated).toMatchObject({ id, version: 2, ciphertext: Buffer.from([8, 9]) });
    expect(() => repository.updateEntry(id, envelope(id, 9), 1))
      .toThrow(PasswordManagerVersionConflictError);

    repository.updateLayouts([{ id, x: 6, y: 7, w: 8, h: 9 }]);
    expect(repository.readEntry(id)?.layout).toEqual({ x: 6, y: 7, w: 8, h: 9 });

    repository.deleteEntry(id);
    expect(repository.listEntries()).toEqual([]);
  });

  it("rolls back the encrypted row if its layout write fails", () => {
    const { database, repository } = createRepository();
    const id = "11111111-1111-4111-8111-111111111111";
    database.exec(`CREATE TRIGGER reject_password_layout BEFORE INSERT ON password_manager_layouts
      BEGIN SELECT RAISE(ABORT, 'controlled layout failure'); END`);

    expect(() => repository.createEntry(envelope(id, 1), { x: 0, y: 0, w: 4, h: 4 })).toThrow();
    expect(database.prepare("SELECT COUNT(*) FROM password_manager_entries").pluck().get()).toBe(0);
  });

  it("rolls back every layout update when one item is invalid", () => {
    const { repository } = createRepository();
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    repository.createEntry(envelope(first, 1), { x: 0, y: 0, w: 4, h: 4 });
    repository.createEntry(envelope(second, 2), { x: 4, y: 0, w: 4, h: 4 });

    expect(() => repository.updateLayouts([
      { id: first, x: 9, y: 9, w: 4, h: 4 },
      { id: "33333333-3333-4333-8333-333333333333", x: 1, y: 1, w: 4, h: 4 }
    ])).toThrow();
    expect(repository.readEntry(first)?.layout).toEqual({ x: 0, y: 0, w: 4, h: 4 });
  });

  it("rejects non-UUID record identifiers at the repository boundary", () => {
    const { database, repository } = createRepository();
    const invalidId = "x".repeat(36);

    expect(() => repository.createEntry(envelope(invalidId, 1), { x: 0, y: 0, w: 4, h: 4 })).toThrow();
    expect(database.prepare("SELECT COUNT(*) FROM password_manager_entries").pluck().get()).toBe(0);
  });

  it("returns its own optimistic update from one transaction under a competing writer", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "lyj-password-manager-repository-"));
    temporaryDirectories.push(dataDir);
    const databasePath = join(dataDir, "repository.sqlite");
    const primary = new Database(databasePath);
    const competingDatabase = new Database(databasePath);
    databases.push(primary, competingDatabase);
    for (const database of [primary, competingDatabase]) {
      database.pragma("foreign_keys = ON");
      database.pragma("busy_timeout = 1");
    }
    primary.exec(migration);
    const competing = new PasswordManagerRepository(competingDatabase);
    let interleave = false;
    let competingWriteSucceeded = false;
    class InterleavingRepository extends PasswordManagerRepository {
      public override readEntry(id: string) {
        if (interleave) {
          interleave = false;
          try {
            competing.updateEntry(id, envelope(id, 9), 2);
            competingWriteSucceeded = true;
          } catch {
            // A correct transaction keeps the competing connection out until this update is read.
          }
        }
        return super.readEntry(id);
      }
    }
    const repository = new InterleavingRepository(primary);
    const id = "11111111-1111-4111-8111-111111111111";
    repository.createEntry(envelope(id, 1), { x: 0, y: 0, w: 4, h: 4 });

    interleave = true;
    const updated = repository.updateEntry(id, envelope(id, 8), 1);

    expect(competingWriteSucceeded).toBe(false);
    expect(updated).toMatchObject({ version: 2, ciphertext: Buffer.from([8, 9]) });
  });
});
