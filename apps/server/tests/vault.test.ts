import { access, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import {
  InvalidMasterPasswordError,
  VaultIntegrityError,
  VaultLockedError,
  VaultMetadataIntegrityError,
  VaultService
} from "../src/modules/vault/vault.service";
import { decryptVaultValue, encryptVaultValue } from "../src/modules/vault/vault.crypto";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 };

describe("portable encrypted vault", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function createVault() {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-vault-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const database = openDatabase(paths);
    return { database, paths, vault: new VaultService(database, { scrypt: testScrypt }) };
  }

  it("sets up metadata and initial secrets atomically", async () => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", {
      "deepseek-api-key": "sk-initial-plaintext",
      "smtp-password": "smtp-initial-plaintext"
    });

    expect(vault.status()).toEqual({ configured: true, unlocked: true });
    expect(await vault.readSecret("deepseek-api-key")).toBe("sk-initial-plaintext");
    expect(database.prepare("SELECT COUNT(*) AS count FROM vault_metadata").get()).toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM vault_secrets").get()).toEqual({ count: 2 });
    const metadata = database.prepare("SELECT salt, verifier_nonce, verifier_tag FROM vault_metadata WHERE id = 1").get() as Record<string, Buffer>;
    expect(metadata.salt).toHaveLength(16);
    expect(metadata.verifier_nonce).toHaveLength(12);
    expect(metadata.verifier_tag).toHaveLength(16);
    database.close();
  });

  it("rolls back all setup writes when an initial secret is invalid", async () => {
    const { database, vault } = await createVault();
    await expect(vault.setup("portable-master-password", { valid: "value", invalid: "" })).rejects.toThrow(/empty/i);
    expect(database.prepare("SELECT COUNT(*) AS count FROM vault_metadata").get()).toEqual({ count: 0 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM vault_secrets").get()).toEqual({ count: 0 });
    database.close();
  });

  it("rolls back metadata when an initial secret insert fails", async () => {
    const { database, vault } = await createVault();
    database.prepare(`INSERT INTO vault_secrets (name, nonce, ciphertext, auth_tag)
      VALUES ('conflict', zeroblob(12), zeroblob(1), zeroblob(16))`).run();
    await expect(vault.setup("portable-master-password", { conflict: "value" })).rejects.toThrow();
    expect(database.prepare("SELECT COUNT(*) AS count FROM vault_metadata").get()).toEqual({ count: 0 });
    database.close();
  });

  it("rejects empty master passwords, names, and plaintext", async () => {
    const { database, vault } = await createVault();
    await expect(vault.setup("", {})).rejects.toThrow(/master password/i);
    await vault.setup("portable-master-password", {});
    await expect(vault.protectSecret("", "value")).rejects.toThrow(/name/i);
    await expect(vault.protectSecret("name", "")).rejects.toThrow(/empty/i);
    database.close();
  });

  it.each([
    ["non-integer N", { n: 16.5 }],
    ["non-power-of-two N", { n: 12 }],
    ["oversized N", { n: 262_144 }],
    ["negative r", { r: -1 }],
    ["oversized p", { p: 5 }],
    ["undersized maxmem", { maxmem: 1024 }],
    ["insufficient maxmem", { n: 65_536, r: 8, maxmem: 64 * 1024 * 1024 }]
  ])("rejects unsafe injected scrypt options: %s", async (_label, override) => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-vault-invalid-options-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    expect(() => new VaultService(database, { scrypt: { ...testScrypt, ...override } })).toThrow(VaultMetadataIntegrityError);
    database.close();
  });

  it("requires unlock before protecting or reading secrets", async () => {
    const { database, vault } = await createVault();
    await expect(vault.protectSecret("name", "value")).rejects.toBeInstanceOf(VaultLockedError);
    await expect(vault.readSecret("name")).rejects.toBeInstanceOf(VaultLockedError);
    database.close();
  });

  it("zeroes the derived key when locking", async () => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", {});
    const key = (vault as unknown as { key: Buffer }).key;
    expect(key.some((byte) => byte !== 0)).toBe(true);
    vault.lock();
    expect(key.every((byte) => byte === 0)).toBe(true);
    database.close();
  });

  it("rejects a wrong password with a classified error", async () => {
    const { database, vault } = await createVault();
    await vault.setup("correct-master-password", {});
    vault.lock();
    await expect(vault.unlock("wrong-master-password")).rejects.toBeInstanceOf(InvalidMasterPasswordError);
    expect(vault.status()).toEqual({ configured: true, unlocked: false });
    database.close();
  });

  it.each([
    ["negative N", "scrypt_n", -1],
    ["non-power-of-two N", "scrypt_n", 12],
    ["oversized N", "scrypt_n", 262_144],
    ["oversized r", "scrypt_r", 17],
    ["oversized p", "scrypt_p", 5],
    ["insufficient maxmem", "scrypt_n = 65536, scrypt_r = 8, scrypt_maxmem", 64 * 1024 * 1024]
  ])("rejects tampered metadata parameters before derivation: %s", async (_label, column, value) => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", {});
    vault.lock();
    database.pragma("ignore_check_constraints = ON");
    database.prepare(`UPDATE vault_metadata SET ${column} = ? WHERE id = 1`).run(value);
    await expect(vault.unlock("portable-master-password")).rejects.toBeInstanceOf(VaultMetadataIntegrityError);
    database.close();
  });

  it.each([
    ["salt", "salt", Buffer.alloc(15)],
    ["verifier nonce", "verifier_nonce", Buffer.alloc(11)],
    ["verifier tag", "verifier_tag", Buffer.alloc(15)],
    ["verifier ciphertext", "verifier_ciphertext", Buffer.alloc(1)]
  ])("rejects malformed %s with a metadata integrity error", async (_label, column, value) => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", {});
    vault.lock();
    database.pragma("ignore_check_constraints = ON");
    database.prepare(`UPDATE vault_metadata SET ${column} = ? WHERE id = 1`).run(value);
    await expect(vault.unlock("portable-master-password")).rejects.toBeInstanceOf(VaultMetadataIntegrityError);
    database.close();
  });

  it("unlocks secrets after recreating the service", async () => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", { token: "portable-secret" });
    vault.lock();
    const recreated = new VaultService(database, { scrypt: testScrypt });
    await recreated.unlock("portable-master-password");
    expect(await recreated.readSecret("token")).toBe("portable-secret");
    database.close();
  });

  it("replaces a secret and uses a unique nonce every time", async () => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", {});
    await vault.protectSecret("token", "same-value");
    const first = database.prepare("SELECT nonce FROM vault_secrets WHERE name = ?").get("token") as { nonce: Buffer };
    await vault.protectSecret("token", "same-value");
    const second = database.prepare("SELECT nonce FROM vault_secrets WHERE name = ?").get("token") as { nonce: Buffer };
    expect(second.nonce.equals(first.nonce)).toBe(false);
    expect(await vault.readSecret("token")).toBe("same-value");
    database.close();
  });

  it("classifies ciphertext tampering as an integrity failure", async () => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", { token: "secret" });
    const row = database.prepare("SELECT ciphertext FROM vault_secrets WHERE name = ?").get("token") as { ciphertext: Buffer };
    row.ciphertext[0] ^= 1;
    database.prepare("UPDATE vault_secrets SET ciphertext = ? WHERE name = ?").run(row.ciphertext, "token");
    await expect(vault.readSecret("token")).rejects.toBeInstanceOf(VaultIntegrityError);
    database.close();
  });

  it.each([
    ["nonce", "nonce", Buffer.alloc(11)],
    ["authentication tag", "auth_tag", Buffer.alloc(15)],
    ["empty ciphertext", "ciphertext", Buffer.alloc(0)]
  ])("classifies malformed secret %s as an integrity failure", async (_label, column, value) => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", { token: "secret" });
    database.pragma("ignore_check_constraints = ON");
    database.prepare(`UPDATE vault_secrets SET ${column} = ? WHERE name = 'token'`).run(value);
    await expect(vault.readSecret("token")).rejects.toBeInstanceOf(VaultIntegrityError);
    database.close();
  });

  it("validates raw AES-GCM key and envelope lengths", () => {
    const key = Buffer.alloc(32);
    expect(() => encryptVaultValue(Buffer.alloc(31), Buffer.from("secret"))).toThrow(VaultIntegrityError);
    expect(() => decryptVaultValue(key, { nonce: Buffer.alloc(11), ciphertext: Buffer.from("x"), authTag: Buffer.alloc(16) })).toThrow(VaultIntegrityError);
    expect(() => decryptVaultValue(key, { nonce: Buffer.alloc(12), ciphertext: Buffer.from("x"), authTag: Buffer.alloc(15) })).toThrow(VaultIntegrityError);
  });

  it("binds ciphertext to its name so rows cannot be swapped", async () => {
    const { database, vault } = await createVault();
    await vault.setup("portable-master-password", { alpha: "first-secret", beta: "second-secret" });
    const alpha = database.prepare("SELECT nonce, ciphertext, auth_tag FROM vault_secrets WHERE name = 'alpha'").get() as Record<string, Buffer>;
    const beta = database.prepare("SELECT nonce, ciphertext, auth_tag FROM vault_secrets WHERE name = 'beta'").get() as Record<string, Buffer>;
    database.prepare("UPDATE vault_secrets SET nonce = ?, ciphertext = ?, auth_tag = ? WHERE name = 'alpha'").run(beta.nonce, beta.ciphertext, beta.auth_tag);
    database.prepare("UPDATE vault_secrets SET nonce = ?, ciphertext = ?, auth_tag = ? WHERE name = 'beta'").run(alpha.nonce, alpha.ciphertext, alpha.auth_tag);
    await expect(vault.readSecret("alpha")).rejects.toBeInstanceOf(VaultIntegrityError);
    database.close();
  });

  it("stores neither the master password nor secret plaintext in SQLite WAL files", async () => {
    const { database, paths, vault } = await createVault();
    database.pragma("journal_mode = WAL");
    await vault.setup("raw-database-master", { token: "raw-database-secret" });
    const sensitiveValues = [Buffer.from("raw-database-master"), Buffer.from("raw-database-secret")];
    for (const path of [paths.databasePath, `${paths.databasePath}-wal`, `${paths.databasePath}-shm`]) {
      try {
        await access(path);
        const raw = await readFile(path);
        for (const sensitive of sensitiveValues) expect(raw.includes(sensitive)).toBe(false);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    database.pragma("wal_checkpoint(TRUNCATE)");
    database.close();
    const raw = await readFile(paths.databasePath);
    for (const sensitive of sensitiveValues) expect(raw.includes(sensitive)).toBe(false);
  });

  it("persists the production KDF parameters by default", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-vault-defaults-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const vault = new VaultService(database);
    await vault.setup("production-parameters-master", {});
    expect(database.prepare(`SELECT scrypt_n AS n, scrypt_r AS r, scrypt_p AS p,
      scrypt_maxmem AS maxmem FROM vault_metadata WHERE id = 1`).get()).toEqual({
      n: 65_536,
      r: 8,
      p: 1,
      maxmem: 128 * 1024 * 1024
    });
    database.close();
  });
});
