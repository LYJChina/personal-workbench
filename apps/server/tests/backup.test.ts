import Database from "better-sqlite3";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { BackupService, type BackupExporter } from "../src/modules/backup/backup.service";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 };
const masterPassword = "correct horse battery staple";
const plaintextSecret = "backup-must-not-decrypt-this-provider-key";

function sqliteParser(response: NodeJS.ReadableStream, callback: (error: Error | null, body?: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", callback);
}

async function waitForEmpty(directory: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await readdir(directory)).length === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(await readdir(directory)).toEqual([]);
}

async function saveResponseDatabase(dataDir: string, body: Buffer, name = "assert-export.sqlite"): Promise<string> {
  const path = join(dataDir, name);
  await writeFile(path, body);
  return path;
}

describe("database backup export", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("initializes a fresh data directory through canonical migrations before exporting", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-backup-fresh-data-"));
    const backupTempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-fresh-output-"));
    temporaryDirectories.push(dataDir, backupTempRoot);

    const app = createApp({ dataDir, backupTempRoot });
    await request(app).put("/api/preferences/appearance").send({
      skin: "sage", density: "compact", radius: "subtle", glass: false
    }).expect(200);
    const response = await request(app)
      .post("/api/backup/export")
      .buffer(true)
      .parse(sqliteParser as never)
      .expect(200);

    const exportedPath = await saveResponseDatabase(dataDir, response.body as Buffer, "fresh-export.sqlite");
    const exported = new Database(exportedPath, { readonly: true, fileMustExist: true });
    try {
      expect(exported.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(exported.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile'").pluck().get()).toBe("profile");
      expect(exported.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('installed_plugins', 'plugin_audit_events', 'plugin_runtime_state') ORDER BY name").pluck().all())
        .toEqual(["installed_plugins", "plugin_audit_events", "plugin_runtime_state"]);
      expect(exported.pragma("table_info(profile)")).toEqual(expect.arrayContaining([expect.objectContaining({ name: "photo_blob" })]));
      expect(JSON.parse(String(exported.prepare("SELECT value FROM app_settings WHERE key = 'appearance'").pluck().get())))
        .toEqual({ skin: "sage", density: "compact", radius: "subtle", glass: false });
    } finally {
      exported.close();
    }
    await waitForEmpty(backupTempRoot);
  });

  it("runs the canonical legacy-photo migration before snapshotting an old database", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-backup-legacy-data-"));
    const backupTempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-legacy-output-"));
    temporaryDirectories.push(dataDir, backupTempRoot);
    const paths = resolveAppPaths({ dataDir });
    const legacyPhoto = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await mkdir(paths.uploadsDir, { recursive: true });
    await writeFile(join(paths.uploadsDir, "a0b1c2d3.png"), legacyPhoto);
    const legacy = new Database(paths.databasePath);
    legacy.exec(`
      CREATE TABLE profile (
        id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL DEFAULT '', birthday TEXT NOT NULL DEFAULT '',
        employee_number TEXT NOT NULL DEFAULT '', photo_filename TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE profile_custom_fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
        position INTEGER NOT NULL, label TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(profile_id, position)
      );
    `);
    legacy.prepare("INSERT INTO profile (id, name, photo_filename) VALUES (1, 'Legacy User', 'a0b1c2d3.png')").run();
    legacy.close();

    const response = await request(createApp({ dataDir, backupTempRoot }))
      .post("/api/backup/export")
      .buffer(true)
      .parse(sqliteParser as never)
      .expect(200);
    const exportedPath = await saveResponseDatabase(dataDir, response.body as Buffer, "legacy-export.sqlite");
    const exported = new Database(exportedPath, { readonly: true, fileMustExist: true });
    try {
      expect(exported.prepare("SELECT photo_blob, photo_mime, photo_version FROM profile WHERE id = 1").get()).toEqual({
        photo_blob: legacyPhoto,
        photo_mime: "image/png",
        photo_version: 1
      });
    } finally {
      exported.close();
    }
    await waitForEmpty(backupTempRoot);
  });

  it("downloads a dated, valid SQLite snapshot with committed WAL data while the vault is locked", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-backup-api-"));
    const backupTempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-output-"));
    temporaryDirectories.push(dataDir);
    temporaryDirectories.push(backupTempRoot);
    const app = createApp({
      dataDir,
      backupTempRoot,
      backupNow: () => new Date(2026, 7, 23, 12, 0, 0),
      vaultScrypt: testScrypt
    });

    await request(app).put("/api/profile").send({
      name: "李雨佳",
      birthday: "1995-06-18",
      employeeNumber: "LYJ-001",
      customFields: []
    }).expect(200);
    const photo = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await request(app).post("/api/profile/photo").attach("photo", photo, {
      filename: "portrait.png",
      contentType: "image/png"
    }).expect(200);
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    await request(app).put("/api/settings/deepseek").send({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: plaintextSecret
    }).expect(200);
    await request(app).put("/api/preferences/theme").send({ theme: "dark" }).expect(200, { theme: "dark" });
    await request(app).post("/api/vault/lock").expect(204);
    await request(app).get("/api/vault/status").expect(200, { configured: true, unlocked: false });

    const live = openDatabase(resolveAppPaths({ dataDir }));
    live.pragma("journal_mode = WAL");
    live.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("wal-marker", "committed-in-wal");
    live.prepare(`INSERT INTO generic_reminders
      (id, name, enabled, lifecycle, schedule_type, start_date, local_time, weekdays_json, month_day,
       total_occurrences, successful_occurrences, recipient, subject, body)
      VALUES ('backup-reminder', '备份提醒', 1, 'once', 'once', '2026-08-24', '09:30', '[]', NULL, 1, 0,
       'me@example.com', '提醒主题', '提醒正文')`).run();
    live.prepare(`INSERT INTO ai_chat_messages (role, content, model)
      VALUES ('user', '保留的历史消息', NULL)`).run();

    let response: request.Response;
    try {
      response = await request(app)
        .post("/api/backup/export")
        .buffer(true)
        .parse(sqliteParser as never)
        .expect(200);
      expect(live.prepare("SELECT value FROM app_settings WHERE key = 'wal-marker'").pluck().get()).toBe("committed-in-wal");
      live.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("after-backup", "source-usable");
    } finally {
      live.close();
    }

    expect(response.headers["content-type"]).toMatch(/^application\/vnd\.sqlite3/);
    expect(response.headers["content-disposition"]).toBe('attachment; filename="LYJWorkBench-backup-2026-08-23.sqlite"');
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toMatch(/no-store/);

    expect(Buffer.from(response.body as Buffer).includes(Buffer.from(plaintextSecret))).toBe(false);
    const exportedPath = await saveResponseDatabase(dataDir, response.body as Buffer);
    const exported = new Database(exportedPath, { readonly: true, fileMustExist: true });
    try {
      expect(exported.pragma("integrity_check", { simple: true })).toBe("ok");
      expect(exported.prepare("SELECT name, employee_number FROM profile WHERE id = 1").get()).toEqual({
        name: "李雨佳",
        employee_number: "LYJ-001"
      });
      expect(exported.prepare("SELECT photo_blob FROM profile WHERE id = 1").pluck().get()).toEqual(photo);
      expect(exported.prepare("SELECT value FROM app_settings WHERE key = 'wal-marker'").pluck().get()).toBe("committed-in-wal");
      expect(exported.prepare("SELECT value FROM app_settings WHERE key = 'theme'").pluck().get()).toBe("dark");
      expect(exported.prepare("SELECT value FROM app_settings WHERE key = 'deepseek.model'").pluck().get()).toBe("deepseek-chat");
      expect(exported.prepare("SELECT name FROM generic_reminders WHERE id = 'backup-reminder'").pluck().get()).toBe("备份提醒");
      expect(exported.prepare("SELECT content FROM ai_chat_messages ORDER BY id DESC LIMIT 1").pluck().get()).toBe("保留的历史消息");
      const metadata = exported.prepare("SELECT salt, verifier_ciphertext, scrypt_n FROM vault_metadata WHERE id = 1").get() as {
        salt: Buffer;
        verifier_ciphertext: Buffer;
        scrypt_n: number;
      };
      expect(Buffer.isBuffer(metadata.salt)).toBe(true);
      expect(Buffer.isBuffer(metadata.verifier_ciphertext)).toBe(true);
      expect(metadata.scrypt_n).toBe(testScrypt.n);
      const encrypted = exported.prepare("SELECT ciphertext FROM vault_secrets WHERE name = 'deepseek-api-key'").pluck().get() as Buffer;
      expect(Buffer.isBuffer(encrypted)).toBe(true);
      expect(encrypted.toString("utf8")).not.toContain(plaintextSecret);
    } finally {
      exported.close();
    }
    await waitForEmpty(backupTempRoot);
  });

  it("uses distinct snapshots for concurrent exports and cleans both exact temporary directories", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-backup-concurrent-data-"));
    const backupTempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-concurrent-output-"));
    temporaryDirectories.push(dataDir, backupTempRoot);
    const app = createApp({ dataDir, backupTempRoot });
    await request(app).get("/api/profile").expect(200);

    const [first, second] = await Promise.all([
      request(app).post("/api/backup/export").buffer(true).parse(sqliteParser as never).expect(200),
      request(app).post("/api/backup/export").buffer(true).parse(sqliteParser as never).expect(200)
    ]);

    expect((first.body as Buffer).length).toBeGreaterThan(0);
    expect((second.body as Buffer).length).toBeGreaterThan(0);
    await waitForEmpty(backupTempRoot);
  });

  it("returns distinct service paths and makes successful cleanup idempotent", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-backup-service-data-"));
    const tempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-service-output-"));
    temporaryDirectories.push(dataDir, tempRoot);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    database.close();
    const service = new BackupService(resolveAppPaths({ dataDir }), { tempRoot });

    const [first, second] = await Promise.all([service.createSnapshot(), service.createSnapshot()]);
    expect(first.filePath).not.toBe(second.filePath);
    expect(await readdir(tempRoot)).toHaveLength(2);

    await Promise.all([first.cleanup(), first.cleanup(), second.cleanup(), second.cleanup()]);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("closes database handles and removes its exact directory when integrity validation fails", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-invalid-"));
    temporaryDirectories.push(tempRoot);
    const sourceClose = vi.fn();
    const validationClose = vi.fn();
    const service = new BackupService(resolveAppPaths({ dataDir: tempRoot }), {
      tempRoot,
      openSource: () => ({
        backup: async (destination: string) => { await writeFile(destination, "invalid snapshot"); },
        close: sourceClose
      }) as unknown as Database.Database,
      openValidation: () => ({
        pragma: () => [{ integrity_check: "corrupt" }],
        close: validationClose
      }) as unknown as Database.Database
    });

    await expect(service.createSnapshot()).rejects.toThrow();
    expect(sourceClose).toHaveBeenCalledTimes(1);
    expect(validationClose).toHaveBeenCalledTimes(1);
    await waitForEmpty(tempRoot);
  });

  it("cancels online backup at its progress boundary when the request signal aborts", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-progress-abort-"));
    temporaryDirectories.push(tempRoot);
    const controller = new AbortController();
    const sourceClose = vi.fn();
    const openValidation = vi.fn();
    const service = new BackupService(resolveAppPaths({ dataDir: tempRoot }), {
      tempRoot,
      openSource: () => ({
        backup: async (_destination: string, options?: Database.BackupOptions) => {
          controller.abort();
          options?.progress({ totalPages: 100, remainingPages: 99 });
          throw new Error("backup continued after abort");
        },
        close: sourceClose
      }) as unknown as Database.Database,
      openValidation
    });

    await expect((service.createSnapshot as unknown as (signal: AbortSignal) => Promise<unknown>)(controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(sourceClose).toHaveBeenCalledTimes(1);
    expect(openValidation).not.toHaveBeenCalled();
    await waitForEmpty(tempRoot);
  });

  it("does not begin synchronous integrity validation after an abort at the backup boundary", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-validation-abort-"));
    temporaryDirectories.push(tempRoot);
    const controller = new AbortController();
    const sourceClose = vi.fn();
    const openValidation = vi.fn();
    const service = new BackupService(resolveAppPaths({ dataDir: tempRoot }), {
      tempRoot,
      openSource: () => ({
        backup: async (destination: string) => {
          await writeFile(destination, "completed snapshot");
          controller.abort();
        },
        close: sourceClose
      }) as unknown as Database.Database,
      openValidation
    });

    await expect((service.createSnapshot as unknown as (signal: AbortSignal) => Promise<unknown>)(controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(sourceClose).toHaveBeenCalledTimes(1);
    expect(openValidation).not.toHaveBeenCalled();
    await waitForEmpty(tempRoot);
  });

  it("closes the source and removes its exact directory when online backup fails", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-copy-failure-"));
    temporaryDirectories.push(tempRoot);
    const sourceClose = vi.fn();
    const service = new BackupService(resolveAppPaths({ dataDir: tempRoot }), {
      tempRoot,
      openSource: () => ({
        backup: async () => { throw new Error("private SQL dependency failure"); },
        close: sourceClose
      }) as unknown as Database.Database
    });

    await expect(service.createSnapshot()).rejects.toThrow();
    expect(sourceClose).toHaveBeenCalledTimes(1);
    await waitForEmpty(tempRoot);
  });

  it("cleans a failed online backup and returns one fixed response without dependency details", async () => {
    const sentinel = "C:\\private\\workbench.sqlite SQL secret master-password ciphertext";
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exporter: BackupExporter = { createSnapshot: vi.fn().mockRejectedValue(new Error(sentinel)) };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await request(createApp({ backupExporter: exporter }))
      .post("/api/backup/export")
      .expect(500);

    expect(response.body).toEqual({ error: { message: "导出失败，请稍后重试", code: "BACKUP_EXPORT_FAILED" } });
    expect(JSON.stringify(response.body)).not.toContain(sentinel);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sentinel);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("cleans exactly once when file stream creation or streaming fails", async () => {
    const createSnapshot = (cleanup: ReturnType<typeof vi.fn>): BackupExporter => ({
      createSnapshot: async () => ({
        filePath: "C:\\private\\unique\\workbench.sqlite",
        filename: "LYJWorkBench-backup-2026-08-23.sqlite",
        cleanup
      })
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const createCleanup = vi.fn().mockResolvedValue(undefined);
    await request(createApp({
      backupExporter: createSnapshot(createCleanup),
      backupCreateReadStream: (() => { throw new Error("secret stream creation failure"); }) as never
    })).post("/api/backup/export").expect(500, {
      error: { message: "导出失败，请稍后重试", code: "BACKUP_EXPORT_FAILED" }
    });
    expect(createCleanup).toHaveBeenCalledTimes(1);

    const streamCleanup = vi.fn().mockResolvedValue(undefined);
    const brokenStream = new PassThrough();
    const streamFailure = await request(createApp({
      backupExporter: createSnapshot(streamCleanup),
      backupCreateReadStream: (() => {
        queueMicrotask(() => brokenStream.destroy(new Error("secret stream failure")));
        return brokenStream;
      }) as never
    })).post("/api/backup/export").expect(500);
    expect(streamFailure.body).toEqual({
      error: { message: "导出失败，请稍后重试", code: "BACKUP_EXPORT_FAILED" }
    });
    expect(streamFailure.headers["content-disposition"]).toBeUndefined();
    await vi.waitFor(() => expect(streamCleanup).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/private|secret|workbench\.sqlite/i);

    const sendCleanup = vi.fn().mockResolvedValue(undefined);
    const unpipeableStream = new PassThrough();
    vi.spyOn(unpipeableStream, "pipe").mockImplementation(() => {
      throw new Error("secret synchronous send failure");
    });
    const sendFailure = await request(createApp({
      backupExporter: createSnapshot(sendCleanup),
      backupCreateReadStream: (() => unpipeableStream) as never
    })).post("/api/backup/export").expect(500);
    expect(sendFailure.body).toEqual({
      error: { message: "导出失败，请稍后重试", code: "BACKUP_EXPORT_FAILED" }
    });
    await vi.waitFor(() => expect(sendCleanup).toHaveBeenCalledTimes(1));
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/synchronous send failure/i);
  });

  it("streams rather than buffering a large snapshot and cleans after a client-aborted download", async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exporter: BackupExporter = {
      createSnapshot: async () => ({
        filePath: "virtual-large.sqlite",
        filename: "LYJWorkBench-backup-2026-08-23.sqlite",
        cleanup
      })
    };
    const stream = new PassThrough();
    const app = createApp({ backupExporter: exporter, backupCreateReadStream: (() => stream) as never });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");

    try {
      await new Promise<void>((resolve, reject) => {
        const outgoing = import("node:http").then(({ request: httpRequest }) => {
          const requestHandle = httpRequest({
            host: "127.0.0.1",
            port: address.port,
            path: "/api/backup/export",
            method: "POST",
            headers: { "X-LYJ-Workbench-Request": "local-browser-v1" }
          }, (response) => {
            response.once("data", () => {
              requestHandle.destroy();
              resolve();
            });
          });
          requestHandle.once("error", (error) => {
            if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
            else reject(error);
          });
          requestHandle.end();
          setImmediate(() => stream.write(Buffer.alloc(256 * 1024, 7)));
        });
        outgoing.catch(reject);
      });
      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
    } finally {
      stream.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("closes a real large-file stream before deleting its snapshot after client abort", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-backup-abort-data-"));
    const tempRoot = await mkdtemp(join(tmpdir(), "lyj-backup-abort-output-"));
    temporaryDirectories.push(dataDir, tempRoot);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    database.prepare("INSERT INTO app_settings (key, value) VALUES ('large-export', ?)").run("x".repeat(8 * 1024 * 1024));
    database.close();
    const server = createServer(createApp({ dataDir, backupTempRoot: tempRoot }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");

    try {
      await new Promise<void>((resolve, reject) => {
        const requestHandle = httpRequest({
          host: "127.0.0.1",
          port: address.port,
          path: "/api/backup/export",
          method: "POST",
          headers: { "X-LYJ-Workbench-Request": "local-browser-v1" }
        }, (response) => {
          response.once("data", () => {
            requestHandle.destroy();
            resolve();
          });
        });
        requestHandle.once("error", (error) => {
          if ((error as NodeJS.ErrnoException).code === "ECONNRESET") resolve();
          else reject(error);
        });
        requestHandle.end();
      });
      await waitForEmpty(tempRoot);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("signals the exporter and cleans without opening a stream when the client aborts during online backup", async () => {
    type Snapshot = Awaited<ReturnType<BackupExporter["createSnapshot"]>>;
    let resolveSnapshot!: (snapshot: Snapshot) => void;
    let exportSignal: AbortSignal | undefined;
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const exporter: BackupExporter = {
      createSnapshot: vi.fn((signal) => {
        exportSignal = signal;
        return new Promise<Snapshot>((resolve) => { resolveSnapshot = resolve; });
      })
    };
    const createFileStream = vi.fn(() => new PassThrough()) as never;
    const server = createServer(createApp({ backupExporter: exporter, backupCreateReadStream: createFileStream }));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP address");

    const requestHandle = httpRequest({
      host: "127.0.0.1",
      port: address.port,
      path: "/api/backup/export",
      method: "POST",
      headers: { "X-LYJ-Workbench-Request": "local-browser-v1" }
    });
    requestHandle.on("error", () => undefined);
    requestHandle.end();

    try {
      await vi.waitFor(() => expect(exporter.createSnapshot).toHaveBeenCalledTimes(1));
      requestHandle.destroy();
      await vi.waitFor(() => expect(exportSignal?.aborted).toBe(true));
      resolveSnapshot({
        filePath: "virtual-aborted-before-stream.sqlite",
        filename: "LYJWorkBench-backup-2026-08-23.sqlite",
        cleanup
      });

      await vi.waitFor(() => expect(cleanup).toHaveBeenCalledTimes(1));
      expect(createFileStream).not.toHaveBeenCalled();
    } finally {
      requestHandle.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
