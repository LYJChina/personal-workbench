import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { createVaultRepositoryProvider } from "../src/modules/vault/vault.repository";
import { VaultService } from "../src/modules/vault/vault.service";
import {
  createLegacyWindowsSecretImporter,
  detectLegacyWindowsSecrets,
  type LegacySecretImporter
} from "../src/modules/vault/legacy-secret-import";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 };
const masterPassword = "correct horse battery staple";

describe("one-time legacy Windows secret import", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function createDataDir(): Promise<string> {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-legacy-import-"));
    temporaryDirectories.push(dataDir);
    return dataDir;
  }

  async function createKnownBlob(dataDir: string, name = "deepseek-api-key"): Promise<void> {
    const secretsDir = join(dataDir, "secrets");
    await mkdir(secretsDir, { recursive: true });
    await writeFile(join(secretsDir, `${name}.bin`), "legacy blob");
  }

  function importer(values: Record<string, string>, failure?: Error): LegacySecretImporter {
    return {
      readAvailableSecrets: async () => {
        if (failure) throw failure;
        return values;
      }
    };
  }

  it.each([
    ["no known blobs", []],
    ["one known blob", ["deepseek-api-key.bin"]],
    ["both known blobs while ignoring unknown blobs", ["deepseek-api-key.bin", "smtp-password.bin", "unknown.bin"]]
  ])("detects %s using filesystem-only Windows checks", async (_label, files) => {
    const dataDir = await createDataDir();
    const secretsDir = join(dataDir, "secrets");
    await mkdir(secretsDir);
    await Promise.all(files.map((file) => writeFile(join(secretsDir, file), "legacy blob")));

    expect(detectLegacyWindowsSecrets(secretsDir, "win32")).toBe(files.some((file) =>
      file === "deepseek-api-key.bin" || file === "smtp-password.bin"
    ));
  });

  it("does not probe or import on non-Windows platforms", async () => {
    const dataDir = await createDataDir();
    const readAvailableSecrets = vi.fn(async () => ({ "deepseek-api-key": "must-not-read" }));
    const app = createApp({
      dataDir,
      platform: "darwin",
      legacySecretImporter: { readAvailableSecrets },
      vaultScrypt: testScrypt
    });

    await request(app).get("/api/vault/legacy-import-status").expect(200, { detected: false });
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    expect(readAvailableSecrets).not.toHaveBeenCalled();
  });

  it("discloses detection without weakening vault status or exposing legacy details", async () => {
    const dataDir = await createDataDir();
    await createKnownBlob(dataDir);
    const app = createApp({
      dataDir,
      platform: "win32",
      legacySecretImporter: importer({ "deepseek-api-key": "legacy-api-value" }),
      vaultScrypt: testScrypt
    });

    await request(app).get("/api/vault/status").expect(200, { configured: false, unlocked: false });
    const disclosure = await request(app).get("/api/vault/legacy-import-status").expect(200, { detected: true });
    expect(JSON.stringify(disclosure.body)).not.toMatch(/deepseek|smtp|path|secret|value/i);
  });

  it("rechecks a previous negative detection during setup and imports a blob that appears later", async () => {
    const dataDir = await createDataDir();
    const secretsDir = join(dataDir, "secrets");
    await mkdir(secretsDir);
    const readAvailableSecrets = vi.fn(async () => ({ "deepseek-api-key": "appeared-after-disclosure" }));
    const app = createApp({
      dataDir,
      platform: "win32",
      legacySecretImporter: { readAvailableSecrets },
      vaultScrypt: testScrypt
    });

    await request(app).get("/api/vault/legacy-import-status").expect(200, { detected: false });
    await writeFile(join(secretsDir, "deepseek-api-key.bin"), "new legacy blob");
    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    expect(readAvailableSecrets).toHaveBeenCalledTimes(1);

    const vault = new VaultService(createVaultRepositoryProvider(resolveAppPaths({ dataDir })), { scrypt: testScrypt });
    await vault.unlock(masterPassword);
    await expect(vault.readSecret("deepseek-api-key")).resolves.toBe("appeared-after-disclosure");
    vault.lock();
  });

  it("imports both known values in the one setup transaction and survives recreation", async () => {
    const dataDir = await createDataDir();
    await createKnownBlob(dataDir);
    const app = createApp({
      dataDir,
      platform: "win32",
      legacySecretImporter: importer({
        "deepseek-api-key": "legacy-api-value",
        "smtp-password": "legacy-mail-value",
        "dpapi-test-secret": "not-for-production",
        unknown: "not-for-production"
      }),
      vaultScrypt: testScrypt
    });

    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201, { configured: true, unlocked: true });
    await request(app).post("/api/vault/lock").expect(204);
    const recreated = createApp({ dataDir, platform: "darwin", vaultScrypt: testScrypt });
    await request(recreated).post("/api/vault/unlock").send({ masterPassword }).expect(204);
    const portableVault = new VaultService(createVaultRepositoryProvider(resolveAppPaths({ dataDir })), { scrypt: testScrypt });
    await portableVault.unlock(masterPassword);
    await expect(portableVault.readSecret("deepseek-api-key")).resolves.toBe("legacy-api-value");
    await expect(portableVault.readSecret("smtp-password")).resolves.toBe("legacy-mail-value");
    portableVault.lock();

    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      expect(database.prepare("SELECT name FROM vault_secrets ORDER BY name").all()).toEqual([
        { name: "deepseek-api-key" },
        { name: "smtp-password" }
      ]);
    } finally {
      database.close();
    }
  });

  it("fails setup atomically and sanitizes a legacy read failure", async () => {
    const dataDir = await createDataDir();
    await createKnownBlob(dataDir);
    const sensitiveFailure = new Error("powershell.exe failed to decrypt C:\\secret-path\\smtp-password.bin: legacy-mail-value");
    const app = createApp({
      dataDir,
      platform: "win32",
      legacySecretImporter: importer({}, sensitiveFailure),
      vaultScrypt: testScrypt
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await request(app).post("/api/vault/setup").send({ masterPassword }).expect(500);
    expect(response.body).toEqual({ error: { message: "旧版密钥迁移失败", code: "LEGACY_SECRET_IMPORT_FAILED" } });
    expect(`${JSON.stringify(response.body)} ${consoleError.mock.calls.flat().join(" ")}`).not.toMatch(
      /powershell|secret-path|smtp-password|legacy-mail-value|ciphertext/i
    );
    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM vault_metadata").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM vault_secrets").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }
  });

  it("keeps setup atomic when the second legacy value fails and permits a clean retry", async () => {
    const dataDir = await createDataDir();
    const sensitiveFailure = new Error("powershell.exe C:\\private\\smtp-password.bin second-value");
    let attempts = 0;
    const readSecret = vi.fn(async (name: string) => {
      if (name === "deepseek-api-key") return "first-value";
      attempts += 1;
      if (attempts === 1) throw sensitiveFailure;
      return "second-value";
    });
    const secretsDir = join(dataDir, "secrets");
    await mkdir(secretsDir);
    await writeFile(join(secretsDir, "deepseek-api-key.bin"), "first blob");
    await writeFile(join(secretsDir, "smtp-password.bin"), "second blob");
    const app = createApp({
      dataDir,
      platform: "win32",
      legacySecretImporter: createLegacyWindowsSecretImporter(secretsDir, { readSecret }),
      vaultScrypt: testScrypt
    });

    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(500, {
      error: { message: "旧版密钥迁移失败", code: "LEGACY_SECRET_IMPORT_FAILED" }
    });
    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      expect(database.prepare("SELECT COUNT(*) AS count FROM vault_metadata").get()).toEqual({ count: 0 });
      expect(database.prepare("SELECT COUNT(*) AS count FROM vault_secrets").get()).toEqual({ count: 0 });
    } finally {
      database.close();
    }

    await request(app).post("/api/vault/setup").send({ masterPassword }).expect(201);
    expect(readSecret).toHaveBeenNthCalledWith(1, "deepseek-api-key");
    expect(readSecret).toHaveBeenNthCalledWith(2, "smtp-password");
    expect(readSecret).toHaveBeenNthCalledWith(3, "deepseek-api-key");
    expect(readSecret).toHaveBeenNthCalledWith(4, "smtp-password");
  });

  it("does not probe or import legacy material after vault configuration", async () => {
    const dataDir = await createDataDir();
    const first = createApp({ dataDir, platform: "darwin", vaultScrypt: testScrypt });
    await request(first).post("/api/vault/setup").send({ masterPassword }).expect(201);
    const readAvailableSecrets = vi.fn(async () => ({ "deepseek-api-key": "must-not-read" }));
    const recreated = createApp({
      dataDir,
      platform: "win32",
      legacySecretImporter: { readAvailableSecrets },
      vaultScrypt: testScrypt
    });

    await request(recreated).get("/api/vault/legacy-import-status").expect(200, { detected: false });
    await request(recreated).post("/api/vault/unlock").send({ masterPassword }).expect(204);
    expect(readAvailableSecrets).not.toHaveBeenCalled();
  });
});
