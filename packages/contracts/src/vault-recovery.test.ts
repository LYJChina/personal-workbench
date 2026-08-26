import { describe, expect, it } from "vitest";
import {
  VaultChangePasswordInputSchema,
  VaultConfirmRecoveryInputSchema,
  VaultRecoveryCodeResetInputSchema,
  VaultRecoveryStatusSchema,
  VaultSmtpResetInputSchema
} from "./index";

describe("vault recovery contracts", () => {
  it("accepts only the public recovery status fields", () => {
    const status = {
      state: "active",
      maskedEmail: "l***@example.com",
      smtpHealth: "valid",
      checkedAt: null
    } as const;
    expect(VaultRecoveryStatusSchema.parse(status)).toEqual(status);
    expect(VaultRecoveryStatusSchema.safeParse({ ...status, recoveryCode: "secret" }).success).toBe(false);
  });

  it("requires strong replacement passwords and non-empty recovery material", () => {
    expect(VaultChangePasswordInputSchema.safeParse({ currentPassword: "current-password", newPassword: "new-password-123" }).success).toBe(true);
    expect(VaultRecoveryCodeResetInputSchema.safeParse({ recoveryCode: "short", newPassword: "new-password-123" }).success).toBe(false);
    expect(VaultSmtpResetInputSchema.safeParse({ smtpEmail: "x@example.com", smtpPassword: "", newPassword: "new-password-123" }).success).toBe(false);
  });

  it("accepts only a six digit confirmation code", () => {
    expect(VaultConfirmRecoveryInputSchema.safeParse({ confirmationCode: "012345" }).success).toBe(true);
    expect(VaultConfirmRecoveryInputSchema.safeParse({ confirmationCode: "12345" }).success).toBe(false);
  });
});
