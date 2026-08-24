import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync } from "node:fs";
import type { Stats } from "node:fs";
import { basename, isAbsolute, join, resolve, sep } from "node:path";
import Database from "better-sqlite3";
import type { AppPaths } from "../config/paths.js";
import { isUsablePhotoVersion } from "../modules/profile/photo-version.js";

interface TableColumn { name: string; }
interface TableDefinition { sql: string | null; }
interface LegacyProfilePhotoRow { photo_filename: string | null; photo_blob: Buffer | null; }

const maxPhotoBytes = 5 * 1024 * 1024;
const migrationLockBudgetMs = 5_000;
const busyRetrySignal = new Int32Array(new SharedArrayBuffer(4));
export const currentSchemaVersion = 4;
const futureSchemaError = "Database schema version is newer than supported";
const invalidRecoveryError = "Database migration recovery snapshot is invalid";

export interface LegacyPhotoFileSystem {
  lstat(path: string): Stats;
  realpath(path: string): string;
  open(path: string, flags: number): number;
  fstat(fd: number): Stats;
  readFile(fd: number): Buffer;
  close(fd: number): void;
}

const nativeLegacyPhotoFileSystem: LegacyPhotoFileSystem = {
  lstat: lstatSync, realpath: realpathSync, open: openSync, fstat: fstatSync, readFile: readFileSync, close: closeSync
};

export interface OpenDatabaseOptions {
  createDatabase?: (databasePath: string) => Database.Database;
  loadMigration?: (primaryUrl: URL, fallbackUrl: URL) => string;
  migrateHistory?: (database: Database.Database) => void;
  legacyPhotoFileSystem?: LegacyPhotoFileSystem;
  afterRecoverySnapshot?: () => void;
}

function loadMigration(primaryUrl: URL, fallbackUrl: URL): string {
  try {
    return readFileSync(primaryUrl, "utf8");
  } catch {
    return readFileSync(fallbackUrl, "utf8");
  }
}

function migrateAiPolishKinds(database: Database.Database): void {
  const definition = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_polish_records'").get() as TableDefinition | undefined;
  if (!definition?.sql?.includes("CHECK") || definition.sql.includes("'custom'")) return;

  database.transaction(() => {
    database.exec(`
      DROP INDEX IF EXISTS ai_polish_records_kind_created_idx;
      DROP INDEX IF EXISTS ai_polish_records_legacy_report_idx;
      ALTER TABLE ai_polish_records RENAME TO ai_polish_records_before_custom;
      CREATE TABLE ai_polish_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('daily_report', 'leadership', 'translation', 'general', 'custom')),
        primary_text TEXT NOT NULL,
        secondary_text TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        legacy_daily_report_id INTEGER
      );
      INSERT INTO ai_polish_records
        (id, kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at, legacy_daily_report_id)
        SELECT id, kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at, legacy_daily_report_id
        FROM ai_polish_records_before_custom;
      DROP TABLE ai_polish_records_before_custom;
      CREATE INDEX ai_polish_records_kind_created_idx ON ai_polish_records(kind, created_at DESC, id DESC);
    `);
  })();
}

function migrateAiPolishHistory(database: Database.Database): void {
  const columns = database.pragma("table_info(ai_polish_records)") as TableColumn[];
  if (!columns.some((column) => column.name === "legacy_daily_report_id")) {
    database.exec("ALTER TABLE ai_polish_records ADD COLUMN legacy_daily_report_id INTEGER");
  }
  migrateAiPolishKinds(database);
  database.transaction(() => {
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS ai_polish_records_legacy_report_idx ON ai_polish_records(legacy_daily_report_id)");
    database.exec(`INSERT OR IGNORE INTO ai_polish_records
      (legacy_daily_report_id, kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at)
      SELECT id, 'daily_report', completed, risks, '历史日报使用原日报提示词生成。', content, model, created_at, updated_at
      FROM daily_reports`);
  })();
}

function identifyImageMime(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function isSafeLegacyPhotoFilename(filename: string): boolean {
  return /^[a-f0-9-]+\.(?:jpg|png|webp)$/.test(filename)
    && !filename.includes("\0")
    && !isAbsolute(filename)
    && !/[\\/:]/.test(filename)
    && basename(filename) === filename;
}

function sameFileIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function readSafeLegacyPhoto(paths: AppPaths, filename: string, filesystem: LegacyPhotoFileSystem): { bytes: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp" } | null {
  if (!isSafeLegacyPhotoFilename(filename)) return null;

  try {
    const uploadsRoot = resolve(paths.uploadsDir);
    const rootEntry = filesystem.lstat(uploadsRoot);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) return null;
    const canonicalRoot = filesystem.realpath(uploadsRoot);
    const candidate = resolve(join(uploadsRoot, filename));
    if (candidate !== join(uploadsRoot, filename) || !candidate.startsWith(`${uploadsRoot}${sep}`)) return null;

    const before = filesystem.lstat(candidate);
    if (!before.isFile() || before.isSymbolicLink() || before.size > maxPhotoBytes) return null;
    const canonicalCandidate = filesystem.realpath(candidate);
    if (!canonicalCandidate.startsWith(`${canonicalRoot}${sep}`)) return null;

    const fd = filesystem.open(candidate, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = filesystem.fstat(fd);
      const after = filesystem.lstat(candidate);
      if (!opened.isFile() || opened.size > maxPhotoBytes || after.isSymbolicLink()
        || !sameFileIdentity(before, opened) || !sameFileIdentity(after, opened)) return null;

      const bytes = filesystem.readFile(fd);
      const finalState = filesystem.fstat(fd);
      if (bytes.length > maxPhotoBytes || finalState.size > maxPhotoBytes || !sameFileIdentity(opened, finalState)) return null;
      const rootAfter = filesystem.lstat(uploadsRoot);
      if (!rootAfter.isDirectory() || rootAfter.isSymbolicLink() || !sameFileIdentity(rootEntry, rootAfter) || filesystem.realpath(uploadsRoot) !== canonicalRoot) return null;
      const mimeType = identifyImageMime(bytes);
      return mimeType ? { bytes, mimeType } : null;
    } finally {
      filesystem.close(fd);
    }
  } catch {
    return null;
  }
}

function migrateProfilePhotos(database: Database.Database, paths: AppPaths, filesystem: LegacyPhotoFileSystem): void {
  const columns = database.pragma("table_info(profile)") as TableColumn[];
  const existingColumns = new Set(columns.map((column) => column.name));
  if (!existingColumns.has("photo_blob")) database.exec("ALTER TABLE profile ADD COLUMN photo_blob BLOB");
  if (!existingColumns.has("photo_mime")) database.exec("ALTER TABLE profile ADD COLUMN photo_mime TEXT");
  if (!existingColumns.has("photo_version")) database.exec("ALTER TABLE profile ADD COLUMN photo_version INTEGER NOT NULL DEFAULT 0");

  const profile = database.prepare("SELECT photo_filename, photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get() as (LegacyProfilePhotoRow & { photo_mime: string | null; photo_version: unknown }) | undefined;
  if (!profile) return;
  const storedMime = Buffer.isBuffer(profile.photo_blob) ? identifyImageMime(profile.photo_blob) : null;
  if (profile.photo_blob !== null && !storedMime) {
    database.prepare("UPDATE profile SET photo_blob = NULL, photo_mime = NULL, photo_version = 0 WHERE id = 1").run();
  } else if (storedMime) {
    const needsMimeRepair = profile.photo_mime !== storedMime;
    const needsVersionRepair = !isUsablePhotoVersion(profile.photo_version);
    if (needsMimeRepair || needsVersionRepair) database.prepare("UPDATE profile SET photo_mime = ?, photo_version = ? WHERE id = 1").run(storedMime, needsVersionRepair ? 1 : profile.photo_version);
    return;
  }
  const recoverable = database.prepare("SELECT photo_filename, photo_blob FROM profile WHERE id = 1").get() as LegacyProfilePhotoRow | undefined;
  if (!recoverable || recoverable.photo_blob !== null || recoverable.photo_filename === null) return;
  const legacyPhoto = readSafeLegacyPhoto(paths, recoverable.photo_filename, filesystem);
  if (!legacyPhoto) return;

  database.prepare(`
      UPDATE profile
      SET photo_blob = ?, photo_mime = ?, photo_version = 1
      WHERE id = 1 AND photo_blob IS NULL
    `).run(legacyPhoto.bytes, legacyPhoto.mimeType);
}

function migrateProfilePhotosAtomically(database: Database.Database, paths: AppPaths, filesystem: LegacyPhotoFileSystem): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    migrateProfilePhotos(database, paths, filesystem);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* preserve migration error */ }
    throw error;
  }
}

function retryBusyMigration(database: Database.Database, operation: () => void, deadline = performance.now() + migrationLockBudgetMs): void {
  let lastBusyError: unknown;
  while (true) {
    const remainingBeforeAttempt = deadline - performance.now();
    if (remainingBeforeAttempt <= 0) throw lastBusyError;
    database.pragma(`busy_timeout = ${Math.max(1, Math.min(250, Math.ceil(remainingBeforeAttempt)))}`);
    try {
      operation();
      return;
    } catch (error: unknown) {
      if (!(error instanceof Error) || !/SQLITE_BUSY|database is locked/i.test(error.message)) throw error;
      lastBusyError = error;
      try { database.exec("ROLLBACK"); } catch { /* no active transaction to reset */ }
      const remainingAfterAttempt = deadline - performance.now();
      if (remainingAfterAttempt <= 0) throw error;
      Atomics.wait(busyRetrySignal, 0, 0, Math.min(25, Math.ceil(remainingAfterAttempt)));
    }
  }
}

function integrityIsOk(path: string): boolean {
  let validation: Database.Database | undefined;
  try {
    validation = new Database(path, { readonly: true, fileMustExist: true });
    return validation.pragma("integrity_check", { simple: true }) === "ok";
  } catch {
    return false;
  } finally {
    validation?.close();
  }
}

function removeIfPresent(path: string): void {
  try { unlinkSync(path); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

interface Migration {
  version: number;
  run(database: Database.Database, readMigration: (primaryUrl: URL, fallbackUrl: URL) => string, paths: AppPaths, options: OpenDatabaseOptions): void;
}

const migrations: Migration[] = [
  {
    version: 1,
    run: (database, readMigration) => database.exec(readMigration(
      new URL("./migrations/001_init.sql", import.meta.url),
      new URL("../../src/db/migrations/001_init.sql", import.meta.url)
    ))
  },
  {
    version: 2,
    run: (database, readMigration) => database.exec(readMigration(
      new URL("./migrations/002_generic_reminders.sql", import.meta.url),
      new URL("../../src/db/migrations/002_generic_reminders.sql", import.meta.url)
    ))
  },
  {
    version: 3,
    run: (database, _readMigration, paths, options) => {
      (options.migrateHistory ?? migrateAiPolishHistory)(database);
      migrateProfilePhotos(database, paths, options.legacyPhotoFileSystem ?? nativeLegacyPhotoFileSystem);
    }
  },
  {
    version: 4,
    run: (database, readMigration) => database.exec(readMigration(
      new URL("./migrations/004_plugin_kernel.sql", import.meta.url),
      new URL("../../src/db/migrations/004_plugin_kernel.sql", import.meta.url)
    ))
  }
];

export function openDatabase(paths: AppPaths, options: OpenDatabaseOptions = {}): Database.Database {
  mkdirSync(paths.uploadsDir, { recursive: true });
  const existingDatabase = existsSync(paths.databasePath);
  const database = (options.createDatabase ?? ((databasePath) => new Database(databasePath)))(paths.databasePath);
  let recoveryPath: string | undefined;
  try {
    database.pragma("foreign_keys = ON");
    const deadline = performance.now() + migrationLockBudgetMs;
    let installedVersion = 0;
    retryBusyMigration(database, () => {
      installedVersion = Number(database.pragma("user_version", { simple: true }));
    }, deadline);
    if (installedVersion > currentSchemaVersion) throw new Error(futureSchemaError);
    if (installedVersion === currentSchemaVersion) {
      retryBusyMigration(database, () => migrateProfilePhotosAtomically(
        database, paths, options.legacyPhotoFileSystem ?? nativeLegacyPhotoFileSystem
      ), deadline);
      return database;
    }
    const readMigration = options.loadMigration ?? loadMigration;
    if (existingDatabase) {
      recoveryPath = `${paths.databasePath}.migration-recovery-${process.pid}.sqlite`;
      if (!existsSync(recoveryPath)) {
        retryBusyMigration(database, () => {
          database.exec(`VACUUM INTO '${recoveryPath!.replaceAll("'", "''")}'`);
        }, deadline);
      }
      if (!integrityIsOk(recoveryPath)) throw new Error(invalidRecoveryError);
      options.afterRecoverySnapshot?.();
    }
    retryBusyMigration(database, () => {
      database.exec("BEGIN IMMEDIATE");
      try {
        let version = Number(database.pragma("user_version", { simple: true }));
        if (version > currentSchemaVersion) throw new Error(futureSchemaError);
        for (const migration of migrations) {
          if (migration.version <= version) continue;
          const savepoint = `migration_v${migration.version}`;
          database.exec(`SAVEPOINT ${savepoint}`);
          try {
            migration.run(database, readMigration, paths, options);
            database.pragma(`user_version = ${migration.version}`);
            database.exec(`RELEASE ${savepoint}`);
            version = migration.version;
          } catch (error) {
            database.exec(`ROLLBACK TO ${savepoint}`);
            database.exec(`RELEASE ${savepoint}`);
            throw error;
          }
        }
        database.exec("COMMIT");
      } catch (error) {
        try { database.exec("ROLLBACK"); } catch { /* preserve migration failure */ }
        throw error;
      }
    }, deadline);
    if (recoveryPath) removeIfPresent(recoveryPath);
    return database;
  } catch (error) {
    try {
      database.close();
    } catch {
      // Preserve the initialization failure; callers need the root cause.
    }
    throw error;
  }
}
