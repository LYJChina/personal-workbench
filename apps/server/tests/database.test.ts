import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";

describe("database initialization lifecycle", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("closes a created handle and preserves the original pragma error", async () => {
    const original = new Error("controlled pragma failure");
    const close = vi.fn();
    const fakeDatabase = { pragma: () => { throw original; }, close };
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-fake-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });

    expect(() => openDatabase(paths, { createDatabase: () => fakeDatabase as never })).toThrow(original);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes a real SQLite handle after a migration-load failure so the database can be removed", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-close-"));
    temporaryDirectories.push(dataDir);
    const original = new Error("controlled migration failure");
    const paths = resolveAppPaths({ dataDir });

    expect(() => openDatabase(paths, { loadMigration: () => { throw original; } })).toThrow(original);
    await rm(dataDir, { recursive: true, force: true });
    await expect(rm(dataDir, { recursive: true, force: true })).resolves.toBeUndefined();
  });

  it("closes a real SQLite handle after migration SQL execution fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-sql-close-"));
    temporaryDirectories.push(dataDir);
    const originalSql = "THIS IS NOT VALID SQLITE";

    expect(() => openDatabase(resolveAppPaths({ dataDir }), { loadMigration: () => originalSql })).toThrow();
    await rm(dataDir, { recursive: true, force: true });
    await expect(rm(dataDir, { recursive: true, force: true })).resolves.toBeUndefined();
  });

  it("closes a real SQLite handle and preserves a legacy-history migration failure", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-history-close-"));
    temporaryDirectories.push(dataDir);
    const original = new Error("controlled legacy history migration failure");

    expect(() => openDatabase(resolveAppPaths({ dataDir }), {
      migrateHistory: () => { throw original; }
    })).toThrow(original);
    await rm(dataDir, { recursive: true, force: true });
    await expect(rm(dataDir, { recursive: true, force: true })).resolves.toBeUndefined();
  });
});
