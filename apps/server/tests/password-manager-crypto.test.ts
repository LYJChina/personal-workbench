import { createDecipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveVaultKey } from "../src/modules/vault/vault.crypto";
import {
  PasswordManagerCrypto,
  PasswordManagerIntegrityError,
  PasswordManagerInvalidPasswordError
} from "../src/modules/password-manager/password-manager.crypto";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 16 * 1024 * 1024 };

describe("password-manager cryptography", () => {
  it("creates a dedicated random DEK wrapped by its own password KDF", async () => {
    const crypto = new PasswordManagerCrypto({ scrypt: testScrypt });

    const first = await crypto.createVault("independent-password");
    const second = await crypto.createVault("independent-password");
    const firstDek = await crypto.unlockVault("independent-password", first);
    const secondDek = await crypto.unlockVault("independent-password", second);

    expect(first.formatVersion).toBe(1);
    expect(first.salt).toHaveLength(16);
    expect(first.nonce).toHaveLength(12);
    expect(first.authTag).toHaveLength(16);
    expect(first.ciphertext).toHaveLength(32);
    expect(first.salt.equals(second.salt)).toBe(false);
    expect(firstDek.equals(secondDek)).toBe(false);
    firstDek.fill(0);
    secondDek.fill(0);
  });

  it("classifies a wrong password without exposing crypto details", async () => {
    const crypto = new PasswordManagerCrypto({ scrypt: testScrypt });
    const wrapper = await crypto.createVault("correct-password");

    await expect(crypto.unlockVault("wrong-password", wrapper))
      .rejects.toBeInstanceOf(PasswordManagerInvalidPasswordError);
  });

  it("domain-separates its password KDF from the main vault", async () => {
    const crypto = new PasswordManagerCrypto({ scrypt: testScrypt });
    const wrapper = await crypto.createVault("shared-looking-password");
    const mainVaultKey = await deriveVaultKey("shared-looking-password", {
      salt: wrapper.salt,
      ...wrapper.scrypt
    });

    expect(() => {
      const decipher = createDecipheriv("aes-256-gcm", mainVaultKey, wrapper.nonce, { authTagLength: 16 });
      decipher.setAAD(Buffer.from("LYJ_WORKBENCH_PASSWORD_MANAGER_DEK_WRAPPER_V1", "utf8"));
      decipher.setAuthTag(wrapper.authTag);
      Buffer.concat([decipher.update(wrapper.ciphertext), decipher.final()]);
    }).toThrow();
    mainVaultKey.fill(0);
  });

  it.each(["nonce", "ciphertext", "authTag"] as const)("rejects wrapped-DEK %s tampering", async (field) => {
    const crypto = new PasswordManagerCrypto({ scrypt: testScrypt });
    const wrapper = await crypto.createVault("correct-password");
    const tampered = { ...wrapper, [field]: Buffer.from(wrapper[field]) };
    tampered[field][0] ^= 1;

    await expect(crypto.unlockVault("correct-password", tampered))
      .rejects.toBeInstanceOf(PasswordManagerInvalidPasswordError);
  });

  it("binds record ciphertext to both record ID and format version", async () => {
    const crypto = new PasswordManagerCrypto({ scrypt: testScrypt });
    const wrapper = await crypto.createVault("correct-password");
    const dek = await crypto.unlockVault("correct-password", wrapper);
    const payload = Buffer.from(JSON.stringify({ name: "alpha", password: "secret-value" }));
    const encrypted = crypto.encryptRecord(dek, "11111111-1111-4111-8111-111111111111", 1, payload);

    expect(crypto.decryptRecord(dek, "11111111-1111-4111-8111-111111111111", 1, encrypted).toString("utf8"))
      .toBe(payload.toString("utf8"));
    expect(() => crypto.decryptRecord(dek, "22222222-2222-4222-8222-222222222222", 1, encrypted))
      .toThrow(PasswordManagerIntegrityError);
    expect(() => crypto.decryptRecord(dek, "11111111-1111-4111-8111-111111111111", 2, encrypted))
      .toThrow(PasswordManagerIntegrityError);
    dek.fill(0);
    payload.fill(0);
  });

  it.each(["nonce", "ciphertext", "authTag"] as const)("rejects record %s tampering", async (field) => {
    const crypto = new PasswordManagerCrypto({ scrypt: testScrypt });
    const wrapper = await crypto.createVault("correct-password");
    const dek = await crypto.unlockVault("correct-password", wrapper);
    const encrypted = crypto.encryptRecord(
      dek,
      "11111111-1111-4111-8111-111111111111",
      1,
      Buffer.from("credential")
    );
    const tampered = { ...encrypted, [field]: Buffer.from(encrypted[field]) };
    tampered[field][0] ^= 1;

    expect(() => crypto.decryptRecord(
      dek,
      "11111111-1111-4111-8111-111111111111",
      1,
      tampered
    )).toThrow(PasswordManagerIntegrityError);
    dek.fill(0);
  });
});
