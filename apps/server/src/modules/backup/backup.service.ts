import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";

export interface BackupSnapshot {
  filePath: string;
  filename: string;
  cleanup(): Promise<void>;
}

export interface BackupExporter {
  createSnapshot(signal?: AbortSignal): Promise<BackupSnapshot>;
}

export interface BackupServiceDependencies {
  now?: () => Date;
  tempRoot?: string;
  openSource?: (paths: AppPaths) => Database.Database;
  openValidation?: (databasePath: string) => Database.Database;
}

function localDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isValidSnapshot(database: Database.Database, signal?: AbortSignal): boolean {
  signal?.throwIfAborted();
  const rows = database.pragma("integrity_check") as Array<Record<string, unknown>>;
  return rows.length === 1
    && Object.keys(rows[0] ?? {}).length === 1
    && Object.values(rows[0] ?? {})[0] === "ok";
}

export class BackupService implements BackupExporter {
  private readonly now: () => Date;
  private readonly tempRoot: string;
  private readonly openSource: (paths: AppPaths) => Database.Database;
  private readonly openValidation: (databasePath: string) => Database.Database;

  public constructor(private readonly paths: AppPaths, dependencies: BackupServiceDependencies = {}) {
    this.now = dependencies.now ?? (() => new Date());
    this.tempRoot = dependencies.tempRoot ?? tmpdir();
    this.openSource = dependencies.openSource ?? openDatabase;
    this.openValidation = dependencies.openValidation ?? ((path) => new Database(path, { readonly: true, fileMustExist: true }));
  }

  public async createSnapshot(signal?: AbortSignal): Promise<BackupSnapshot> {
    signal?.throwIfAborted();
    await mkdir(this.tempRoot, { recursive: true });
    signal?.throwIfAborted();
    const temporaryDirectory = await mkdtemp(join(this.tempRoot, "lyj-workbench-backup-"));
    const filePath = join(temporaryDirectory, "workbench.sqlite");
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = (): Promise<void> => cleanupPromise ??= rm(temporaryDirectory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 25
    });

    try {
      const source = this.openSource(this.paths);
      try {
        signal?.throwIfAborted();
        await source.backup(filePath, {
          progress: () => {
            signal?.throwIfAborted();
            return 32;
          }
        });
      } finally {
        source.close();
      }

      signal?.throwIfAborted();
      const validation = this.openValidation(filePath);
      try {
        if (!isValidSnapshot(validation, signal)) throw new Error("Snapshot integrity validation failed");
      } finally {
        validation.close();
      }

      return {
        filePath,
        filename: `LYJWorkBench-backup-${localDate(this.now())}.sqlite`,
        cleanup
      };
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
}
