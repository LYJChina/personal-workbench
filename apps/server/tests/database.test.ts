import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
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

  it("versions a new database without a recovery artifact or scheduler-only tables", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-versioned-new-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });

    const database = openDatabase(paths);
    expect(database.pragma("user_version", { simple: true })).toBe(7);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('vault_key_wrappers', 'vault_recovery') ORDER BY name").pluck().all()).toEqual([
      "vault_key_wrappers",
      "vault_recovery"
    ]);
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('reminder_delivery_claims', 'reminder_scheduler_state', 'generic_reminder_claims')").pluck().all()).toEqual([]);
    database.close();

    expect((await readdir(dataDir)).filter((name) => name.includes("migration-recovery"))).toEqual([]);
  });

  it("upgrades a populated version-zero database in place and preserves its data", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-versioned-legacy-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const legacy = new Database(paths.databasePath);
    legacy.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    legacy.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("legacy-key", "legacy-value");
    legacy.close();

    const upgraded = openDatabase(paths);
    expect(upgraded.pragma("user_version", { simple: true })).toBe(7);
    expect(upgraded.prepare("SELECT value FROM app_settings WHERE key = ?").pluck().get("legacy-key")).toBe("legacy-value");
    upgraded.close();
  });

  it("fails closed with a fixed error for a database newer than supported", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-versioned-future-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const future = new Database(paths.databasePath);
    future.pragma("user_version = 99");
    future.close();

    expect(() => openDatabase(paths)).toThrow("Database schema version is newer than supported");
  });

  it("rolls back every pending version without replacing data committed after the recovery snapshot", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-recovery-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const legacy = new Database(paths.databasePath);
    legacy.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    legacy.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("preserve-me", "exact-value");
    legacy.close();

    expect(() => openDatabase(paths, {
      afterRecoverySnapshot: () => {
        const concurrentWriter = new Database(paths.databasePath);
        concurrentWriter.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("concurrent-key", "committed-after-snapshot");
        concurrentWriter.close();
      },
      migrateHistory: () => { throw new Error("injected version-three failure"); }
    }))
      .toThrow("injected version-three failure");
    const restored = new Database(paths.databasePath);
    expect(restored.pragma("user_version", { simple: true })).toBe(0);
    expect(restored.prepare("SELECT value FROM app_settings WHERE key = ?").pluck().get("preserve-me")).toBe("exact-value");
    expect(restored.prepare("SELECT value FROM app_settings WHERE key = ?").pluck().get("concurrent-key")).toBe("committed-after-snapshot");
    expect(restored.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'generic_reminders'").get()).toBeUndefined();
    restored.close();
    expect((await readdir(dataDir)).some((name) => name.includes("migration-recovery"))).toBe(true);

    const retried = openDatabase(paths);
    expect(retried.pragma("user_version", { simple: true })).toBe(7);
    expect(retried.prepare("SELECT value FROM app_settings WHERE key = ?").pluck().get("preserve-me")).toBe("exact-value");
    retried.close();
  });

  it("rejects a corrupt retained recovery artifact before applying migrations", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-corrupt-recovery-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const legacy = new Database(paths.databasePath);
    legacy.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    legacy.close();
    await writeFile(`${paths.databasePath}.migration-recovery-${process.pid}.sqlite`, "not sqlite");

    expect(() => openDatabase(paths)).toThrow("Database migration recovery snapshot is invalid");
  });

  it("lets a second process fail atomically after snapshot while the first opener retries the migration", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-second-opener-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const legacy = new Database(paths.databasePath);
    legacy.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    legacy.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("race-key", "preserved");
    legacy.close();
    let childResult: ReturnType<typeof spawnSync> | undefined;

    const database = openDatabase(paths, {
      afterRecoverySnapshot: () => {
        const script = `
          import { resolveAppPaths } from './src/config/paths.ts';
          import { openDatabase } from './src/db/database.ts';
          try {
            openDatabase(resolveAppPaths({ dataDir: ${JSON.stringify(dataDir)} }), { migrateHistory: () => { throw new Error('forced second-opener failure'); } });
            process.exit(2);
          } catch (error) {
            process.exit(error instanceof Error && error.message === 'forced second-opener failure' ? 0 : 3);
          }
        `;
        childResult = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { cwd: process.cwd(), stdio: "pipe" });
      }
    });
    expect({ status: childResult?.status, stderr: childResult?.stderr?.toString() }).toEqual({ status: 0, stderr: "" });
    expect(database.pragma("user_version", { simple: true })).toBe(7);
    expect(database.prepare("SELECT value FROM app_settings WHERE key = ?").pluck().get("race-key")).toBe("preserved");
    database.close();
  });

  it("includes committed WAL-backed legacy data in the version-zero upgrade", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-wal-legacy-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const legacy = new Database(paths.databasePath);
    legacy.pragma("journal_mode = WAL");
    legacy.pragma("wal_autocheckpoint = 0");
    legacy.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    legacy.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("wal-key", "committed-in-wal");

    const upgraded = openDatabase(paths);
    expect(upgraded.pragma("user_version", { simple: true })).toBe(7);
    expect(upgraded.prepare("SELECT value FROM app_settings WHERE key = ?").pluck().get("wal-key")).toBe("committed-in-wal");
    upgraded.close();
    legacy.close();
  });

  it("reopens a current database without creating a migration recovery artifact", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-database-noop-reopen-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    openDatabase(paths).close();

    openDatabase(paths).close();

    expect((await readdir(dataDir)).filter((name) => name.includes("migration-recovery"))).toEqual([]);
  });
});

describe("profile photo SQLite migration", () => {
  const temporaryDirectories: string[] = [];
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function createLegacyDatabase(photoFilename: string | null): Promise<ReturnType<typeof resolveAppPaths>> {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-profile-photo-migration-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const legacy = new Database(paths.databasePath);
    legacy.exec(`
      CREATE TABLE profile (
        id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL DEFAULT '', birthday TEXT NOT NULL DEFAULT '',
        employee_number TEXT NOT NULL DEFAULT '', photo_filename TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE profile_custom_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, label TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(profile_id, position)
      );
    `);
    legacy.prepare("INSERT INTO profile (id, name, birthday, employee_number, photo_filename) VALUES (1, ?, ?, ?, ?)")
      .run("李雨佳", "1995-06-18", "LYJ-001", photoFilename);
    legacy.prepare("INSERT INTO profile_custom_fields (profile_id, position, label, value) VALUES (1, 0, ?, ?)")
      .run("部门", "运营部");
    legacy.close();
    return paths;
  }

  it("adds profile photo columns to an existing database, imports a valid legacy image once, and preserves profile data", async () => {
    const paths = await createLegacyDatabase("a0b1c2d3.png");
    await mkdir(paths.uploadsDir, { recursive: true });
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), pngSignature);

    const first = openDatabase(paths);
    try {
      const imported = first.prepare("SELECT name, birthday, employee_number, photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get() as {
        name: string; birthday: string; employee_number: string; photo_blob: Buffer; photo_mime: string; photo_version: number;
      };
      expect(imported).toMatchObject({ name: "李雨佳", birthday: "1995-06-18", employee_number: "LYJ-001", photo_mime: "image/png", photo_version: 1 });
      expect(imported.photo_blob).toEqual(pngSignature);
      expect(first.prepare("SELECT label, value FROM profile_custom_fields").all()).toEqual([{ label: "部门", value: "运营部" }]);
    } finally {
      first.close();
    }

    const changedLegacyBytes = Buffer.concat([pngSignature, Buffer.from([0x01])]);
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), changedLegacyBytes);
    const second = openDatabase(paths);
    try {
      const retained = second.prepare("SELECT photo_blob, photo_version FROM profile WHERE id = 1").get() as { photo_blob: Buffer; photo_version: number };
      expect(retained.photo_blob).toEqual(pngSignature);
      expect(retained.photo_version).toBe(1);
    } finally {
      second.close();
    }
  });

  it("retries a missing legacy image on a later open", async () => {
    const paths = await createLegacyDatabase("a0b1c2d3.png");
    await mkdir(paths.uploadsDir, { recursive: true });
    const first = openDatabase(paths);
    first.close();
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), pngSignature);
    const retried = openDatabase(paths);
    try {
      expect(retried.prepare("SELECT photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_mime: "image/png", photo_version: 1 });
    } finally { retried.close(); }
  });

  it("leaves legacy image import retryable without blocking database opening for unsafe or invalid legacy files", async () => {
    const cases = [
      { filename: "../outside.png", bytes: null },
      { filename: "missing.png", bytes: null },
      { filename: "safe.png:alternate", bytes: pngSignature },
      { filename: "large.png", bytes: Buffer.concat([pngSignature, Buffer.alloc(5 * 1024 * 1024 - pngSignature.length + 1)]) },
      { filename: "invalid.png", bytes: Buffer.from("not an image") }
    ];

    for (const legacyPhoto of cases) {
      const paths = await createLegacyDatabase(legacyPhoto.filename);
      await mkdir(paths.uploadsDir, { recursive: true });
      if (legacyPhoto.bytes) await writeFile(join(paths.uploadsDir, legacyPhoto.filename.replace("../", "")), legacyPhoto.bytes);
      const database = openDatabase(paths);
      try {
        const row = database.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get() as {
          photo_blob: Buffer | null; photo_mime: string | null; photo_version: number;
        };
        expect(row).toEqual({ photo_blob: null, photo_mime: null, photo_version: 0 });
      } finally {
        database.close();
      }
    }
  });

  it("repairs partial photo state using blob signatures and clears invalid blobs before legacy recovery", async () => {
    const paths = await createLegacyDatabase("a0b1c2d3.png");
    const legacy = new Database(paths.databasePath);
    legacy.exec("ALTER TABLE profile ADD COLUMN photo_blob BLOB; ALTER TABLE profile ADD COLUMN photo_mime TEXT");
    legacy.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ? WHERE id = 1").run(pngSignature, "bad/type");
    legacy.close();
    let database = openDatabase(paths);
    try {
      expect(database.prepare("SELECT photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_mime: "image/png", photo_version: 1 });
    } finally { database.close(); }

    const corrupt = new Database(paths.databasePath);
    corrupt.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ?, photo_version = ? WHERE id = 1").run(Buffer.from("invalid"), "image/png", 9);
    corrupt.close();
    await mkdir(paths.uploadsDir, { recursive: true });
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), pngSignature);
    database = openDatabase(paths);
    try {
      expect(database.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_blob: pngSignature, photo_mime: "image/png", photo_version: 1 });
    } finally { database.close(); }
  });

  it("rejects a legacy symlink even when its target contains a valid image", async (context) => {
    const paths = await createLegacyDatabase("linked.png");
    const outside = join(paths.dataDir, "outside.png");
    await mkdir(paths.uploadsDir, { recursive: true });
    await writeFile(outside, pngSignature);
    try {
      await symlink(outside, join(paths.uploadsDir, "linked.png"));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return context.skip();
      throw error;
    }

    const database = openDatabase(paths);
    try {
      const row = database.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get();
      expect(row).toEqual({ photo_blob: null, photo_mime: null, photo_version: 0 });
    } finally {
      database.close();
    }
  });

  it.runIf(process.platform === "win32")("rejects an uploads root implemented as a Windows junction", async () => {
    const paths = await createLegacyDatabase("a0b1c2d3.png");
    const outside = join(paths.dataDir, "outside-uploads");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "a0b1c2d3.png"), pngSignature);
    await symlink(outside, paths.uploadsDir, "junction");
    const database = openDatabase(paths);
    try {
      expect(database.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_blob: null, photo_mime: null, photo_version: 0 });
    } finally { database.close(); }
  });

  it("serializes eight independent processes opening the same legacy photo database", async () => {
    const paths = await createLegacyDatabase("a0b1c2d3.png");
    await mkdir(paths.uploadsDir, { recursive: true });
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), pngSignature);
    const root = process.cwd().replace(/\\/g, "/");
    const script = `import { resolveAppPaths } from ${JSON.stringify(`file:///${root}/src/config/paths.ts`)}; import { openDatabase } from ${JSON.stringify(`file:///${root}/src/db/database.ts`)}; const db = openDatabase(resolveAppPaths({ dataDir: ${JSON.stringify(paths.dataDir)} })); db.close();`;
    const run = () => new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "-e", script], { cwd: process.cwd(), shell: false, stdio: ["ignore", "pipe", "pipe"] });
      let output = "";
      child.stdout.on("data", (chunk) => { output += String(chunk); });
      child.stderr.on("data", (chunk) => { output += String(chunk); });
      const timeout = setTimeout(() => { child.kill(); reject(new Error("child timed out")); }, 15_000);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => { clearTimeout(timeout); resolve({ code, output }); });
    });
    const results = await Promise.all(Array.from({ length: 8 }, run));
    expect(results).toEqual(Array.from({ length: 8 }, () => expect.objectContaining({ code: 0 })));
    expect(results.map((result) => result.output).join("\n")).not.toMatch(/SQLITE_BUSY|duplicate column/i);
    const database = openDatabase(paths);
    try {
      expect((database.pragma("table_info(profile)") as Array<{ name: string }>).map((column) => column.name)).toEqual(expect.arrayContaining(["photo_blob", "photo_mime", "photo_version"]));
      expect(database.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_blob: pngSignature, photo_mime: "image/png", photo_version: 1 });
    } finally { database.close(); }
  }, 25_000);

  it("does not rewrite a fully normalized stored photo during a later open", async () => {
    const paths = await createLegacyDatabase("a0b1c2d3.png");
    await mkdir(paths.uploadsDir, { recursive: true });
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), pngSignature);
    const first = openDatabase(paths);
    first.prepare("UPDATE profile SET updated_at = ? WHERE id = 1").run("2000-01-01 00:00:00");
    const before = first.prepare("SELECT * FROM profile WHERE id = 1").get();
    first.close();
    const second = openDatabase(paths);
    try {
      expect(second.prepare("SELECT * FROM profile WHERE id = 1").get()).toEqual(before);
    } finally { second.close(); }
  });

  it.each(["0", "bad", 1.5, -1, 9_007_199_254_740_991, 9_007_199_254_740_992, null])("persists malformed photo version %p as one", async (version) => {
    const paths = await createLegacyDatabase(null);
    const database = new Database(paths.databasePath);
    database.exec("ALTER TABLE profile ADD COLUMN photo_blob BLOB; ALTER TABLE profile ADD COLUMN photo_mime TEXT; ALTER TABLE profile ADD COLUMN photo_version");
    database.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ?, photo_version = ? WHERE id = 1").run(pngSignature, "image/png", version);
    database.close();
    const normalized = openDatabase(paths);
    try {
      expect(normalized.prepare("SELECT photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_mime: "image/png", photo_version: 1 });
    } finally { normalized.close(); }
  });

  it("keeps an already usable maximum photo version unchanged during open", async () => {
    const paths = await createLegacyDatabase(null);
    const raw = new Database(paths.databasePath);
    raw.exec("ALTER TABLE profile ADD COLUMN photo_blob BLOB; ALTER TABLE profile ADD COLUMN photo_mime TEXT; ALTER TABLE profile ADD COLUMN photo_version");
    raw.prepare("UPDATE profile SET photo_blob = ?, photo_mime = ?, photo_version = ? WHERE id = 1").run(pngSignature, "image/png", Number.MAX_SAFE_INTEGER - 1);
    raw.close();
    const database = openDatabase(paths);
    try {
      expect(database.prepare("SELECT photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_version: Number.MAX_SAFE_INTEGER - 1 });
    } finally { database.close(); }
  });

  it("rejects legacy bytes when the uploads root changes identity after the candidate is read", async () => {
    const paths = await createLegacyDatabase("a0b1c2d3.png");
    await mkdir(paths.uploadsDir, { recursive: true });
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), pngSignature);
    let read = false;
    const filesystem = {
      lstat: (path: string) => {
        const stat = lstatSync(path);
        if (!read || path !== paths.uploadsDir) return stat;
        const changed = Object.create(stat) as typeof stat;
        Object.defineProperty(changed, "dev", { value: stat.dev + 1 });
        return changed;
      },
      realpath: (path: string) => read && path === paths.uploadsDir ? `${realpathSync(path)}-swapped` : realpathSync(path),
      open: openSync,
      fstat: fstatSync,
      readFile: (fd: number) => { const bytes = readFileSync(fd); read = true; return bytes; },
      close: closeSync
    };
    const database = openDatabase(paths, { legacyPhotoFileSystem: filesystem });
    try {
      expect(read).toBe(true);
      expect(database.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({ photo_blob: null, photo_mime: null, photo_version: 0 });
    } finally { database.close(); }
  });

  it("fails within the total migration-lock budget when another process holds EXCLUSIVE beyond it", async () => {
    const paths = await createLegacyDatabase(null);
    const script = `import Database from 'better-sqlite3'; const db = new Database(${JSON.stringify(paths.databasePath)}); db.exec('BEGIN EXCLUSIVE'); process.stdout.write('locked\\n'); setTimeout(() => { db.exec('COMMIT'); db.close(); }, 6500);`;
    const holder = spawn(process.execPath, ["--import", "tsx", "-e", script], { cwd: process.cwd(), shell: false, stdio: ["ignore", "pipe", "pipe"] });
    await new Promise<void>((resolve, reject) => {
      holder.stdout.once("data", () => resolve());
      holder.once("error", reject);
      holder.once("exit", (code) => reject(new Error(`lock holder exited early: ${code}`)));
    });
    const started = performance.now();
    let failure: unknown;
    try {
      openDatabase(paths);
    } catch (error) {
      failure = error;
    }
    const elapsed = performance.now() - started;
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toMatch(/SQLITE_BUSY|database is locked/i);
    expect(elapsed).toBeLessThan(5_750);
    await new Promise<void>((resolve, reject) => { holder.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`lock holder exited: ${code}`))); });
    await expect(rm(paths.dataDir, { recursive: true, force: true })).resolves.toBeUndefined();
  }, 15_000);
});
