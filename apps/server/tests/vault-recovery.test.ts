import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { InvalidMasterPasswordError, VaultService } from "../src/modules/vault/vault.service";
import { InvalidRecoveryMaterialError } from "../src/modules/vault/vault.errors";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 };

describe("vault password and recovery transactions", () => {
  const temporaryDirectories: string[] = [];
  afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  async function createVault() {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-vault-recovery-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const vault = new VaultService(database, { scrypt: testScrypt });
    await vault.setup("current-master-password", { protected: "unchanged-value" });
    return { database, vault };
  }

  it("changes only the password wrapper and keeps the current session unlocked", async () => {
    const { database, vault } = await createVault();
    await vault.changePassword("current-master-password", "replacement-master-password");
    expect(await vault.readSecret("protected")).toBe("unchanged-value");
    vault.lock();
    await expect(vault.unlock("current-master-password")).rejects.toBeInstanceOf(InvalidMasterPasswordError);
    await vault.unlock("replacement-master-password");
    expect(await vault.readSecret("protected")).toBe("unchanged-value");
    database.close();
  });

  it("refuses a password change when the current password is wrong", async () => {
    const { database, vault } = await createVault();
    await expect(vault.changePassword("wrong-master-password", "replacement-master-password")).rejects.toBeInstanceOf(InvalidMasterPasswordError);
    vault.lock();
    await vault.unlock("current-master-password");
    database.close();
  });

  it("uses an enrolled recovery code once and installs a new master password", async () => {
    const { database, vault } = await createVault();
    await vault.enrollRecovery({ recoveryEmail: "owner@example.com", recoveryCode: "LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", smtpEmail: "owner@example.com", smtpPassword: "smtp-code" });
    vault.lock();

    await vault.resetWithRecoveryCode("LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", "replacement-master-password");
    expect(await vault.readSecret("protected")).toBe("unchanged-value");
    vault.lock();
    await expect(vault.resetWithRecoveryCode("LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", "another-master-password")).rejects.toBeInstanceOf(InvalidRecoveryMaterialError);
    await vault.unlock("replacement-master-password");
    await vault.rotateRecoveryCode("LYJ-JJJJ-KKKK-MMMM-NNNN-PPPP-QQQQ-RRRR-SSSS");
    vault.lock();
    await vault.resetWithRecoveryCode("LYJ-JJJJ-KKKK-MMMM-NNNN-PPPP-QQQQ-RRRR-SSSS", "third-master-password");
    database.close();
  });

  it("recovers with the unchanged SMTP identity and rotates the SMTP wrapper", async () => {
    const { database, vault } = await createVault();
    await vault.enrollRecovery({ recoveryEmail: "owner@example.com", recoveryCode: "LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", smtpEmail: "Owner@Example.com", smtpPassword: "smtp-code" });
    vault.lock();

    await vault.resetWithSmtp("owner@example.com", "smtp-code", "replacement-master-password");
    expect(await vault.readSecret("protected")).toBe("unchanged-value");
    vault.lock();
    await expect(vault.resetWithSmtp("owner@example.com", "changed-code", "another-master-password")).rejects.toBeInstanceOf(InvalidRecoveryMaterialError);
    database.close();
  });

  it("records SMTP health independently from vault unlock state", async () => {
    const { database, vault } = await createVault();
    vault.recordSmtpHealth("invalid", new Date("2026-08-25T12:00:00.000Z"));
    expect(vault.recoveryStatus()).toEqual(expect.objectContaining({ smtpHealth: "invalid", checkedAt: "2026-08-25T12:00:00.000Z" }));
    expect(vault.status().unlocked).toBe(true);
    database.close();
  });

  it("rotates encrypted SMTP credentials and its recovery wrapper together", async () => {
    const { database, vault } = await createVault();
    await vault.enrollRecovery({ recoveryEmail: "owner@example.com", recoveryCode: "LYJ-AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH", smtpEmail: "old@example.com", smtpPassword: "old-code" });
    await vault.updateSmtpCredentials("current-master-password", "new@example.com", "new-code", {
      smtpHost: "smtp.example.com", smtpPort: 465, transportMode: "tls", fromAddress: "new@example.com"
    });
    vault.lock();
    await expect(vault.resetWithSmtp("old@example.com", "old-code", "replacement-master-password")).rejects.toBeInstanceOf(InvalidRecoveryMaterialError);
    await vault.resetWithSmtp("new@example.com", "new-code", "replacement-master-password");
    expect(await vault.readSecret("smtp-password")).toBe("new-code");
    database.close();
  });
});
