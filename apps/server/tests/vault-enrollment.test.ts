import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { VaultEnrollmentService } from "../src/modules/vault/vault-enrollment.service";
import { InvalidRecoveryMaterialError } from "../src/modules/vault/vault.errors";
import { VaultService } from "../src/modules/vault/vault.service";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 };

describe("vault recovery enrollment", () => {
  const temporaryDirectories: string[] = [];
  afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  it("verifies SMTP, sends both codes, and activates long-code recovery only after confirmation", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-vault-enrollment-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const vault = new VaultService(database, { scrypt: testScrypt });
    const verify = vi.fn(async () => undefined);
    let sent: { recoveryCode: string } | undefined;
    const send = vi.fn(async (input: { recoveryCode: string }) => { sent = input; });
    const persistMail = vi.fn();
    const enrollment = new VaultEnrollmentService(vault, { verify, send }, { now: () => new Date("2026-08-25T12:00:00.000Z"), persistMail });
    const mail = { smtpHost: "smtp.example.com", smtpPort: 465, transportMode: "tls" as const, smtpUsername: "owner@example.com", fromAddress: "owner@example.com", smtpPassword: "smtp-code" };

    const confirmationCode = await enrollment.setup({ masterPassword: "current-master-password", recoveryEmail: "backup@example.com", mail });

    expect(verify).toHaveBeenCalledBefore(send);
    expect(persistMail).toHaveBeenCalledWith(mail);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "backup@example.com", confirmationCode, recoveryCode: expect.stringMatching(/^LYJ-/) }));
    expect(vault.recoveryStatus()).toEqual(expect.objectContaining({ state: "pending", maskedEmail: "b***@example.com" }));
    const recoveryCode = sent!.recoveryCode;
    vault.lock();
    await expect(vault.resetWithRecoveryCode(recoveryCode, "replacement-master-password")).rejects.toBeInstanceOf(InvalidRecoveryMaterialError);
    await enrollment.confirm(confirmationCode);
    await vault.resetWithRecoveryCode(recoveryCode, "replacement-master-password");
    database.close();
  });
});
