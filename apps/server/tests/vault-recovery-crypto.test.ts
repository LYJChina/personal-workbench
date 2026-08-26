import { describe, expect, it } from "vitest";
import { InvalidRecoveryMaterialError } from "../src/modules/vault/vault.errors";
import {
  generateDek,
  generateRecoveryCode,
  normalizeRecoveryCode,
  normalizeSmtpIdentity,
  unwrapDek,
  wrapDek
} from "../src/modules/vault/vault-recovery.crypto";

const testScrypt = { n: 16, r: 1, p: 1, maxmem: 128 * 1024 * 1024 };

describe("vault recovery cryptography", () => {
  it("generates a grouped recovery code with at least 160 bits of entropy", () => {
    const generated = generateRecoveryCode();
    expect(generated.display).toMatch(/^LYJ(?:-[A-Z2-9]{4}){8}$/);
    expect(generated.entropy).toHaveLength(20);
    expect(normalizeRecoveryCode(generated.display.toLowerCase())).toBe(generated.display);
    generated.entropy.fill(0);
  });

  it("wraps and unwraps a DEK only with matching material and purpose", async () => {
    const dek = generateDek();
    const wrapped = await wrapDek(dek, "recovery material", testScrypt, "recovery", 1);
    const recovered = await unwrapDek(wrapped, "recovery material", "recovery");
    expect(recovered).toEqual(dek);
    recovered.fill(0);
    await expect(unwrapDek(wrapped, "wrong material", "recovery")).rejects.toBeInstanceOf(InvalidRecoveryMaterialError);
    await expect(unwrapDek(wrapped, "recovery material", "password")).rejects.toBeInstanceOf(InvalidRecoveryMaterialError);
    dek.fill(0);
  });

  it("normalizes SMTP identity without changing authorization-code case", () => {
    expect(normalizeSmtpIdentity(" User@Example.COM ", " Code-X ")).toBe("user@example.com\0Code-X");
  });
});
