import { describe, expect, it } from "vitest";
import {
  PasswordManagerEntryDetailSchema,
  PasswordManagerEntryInputSchema,
  PasswordManagerEntrySummarySchema,
  PasswordManagerImportPreviewSchema,
  PasswordManagerStatusSchema
} from "./password-manager";

const input = { name: "Example", website: "https://example.com", username: "alice", password: "secret" };
const summary = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  ...input,
  notes: "",
  customFields: [],
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z"
};

describe("password manager contracts", () => {
  it("accepts valid input, summary, detail, status, and import preview", () => {
    expect(PasswordManagerEntryInputSchema.parse(input)).toEqual(input);
    const { password: _password, ...summaryOnly } = summary;
    expect(PasswordManagerEntrySummarySchema.parse(summaryOnly)).toBeTruthy();
    expect(PasswordManagerEntryDetailSchema.parse(summary).password).toBe("secret");
    expect(PasswordManagerStatusSchema.parse({ configured: true, unlocked: false, idleTimeoutMinutes: 10 })).toBeTruthy();
    expect(PasswordManagerImportPreviewSchema.parse({ items: [input], duplicates: [], warnings: [], source: "local" })).toBeTruthy();
  });

  it("rejects unknown fields", () => {
    expect(PasswordManagerEntryInputSchema.safeParse({ ...input, extra: true }).success).toBe(false);
    expect(PasswordManagerEntrySummarySchema.safeParse({ ...summary, extra: true }).success).toBe(false);
    expect(PasswordManagerImportPreviewSchema.safeParse({ items: [], duplicates: [], warnings: [], source: "local", extra: true }).success).toBe(false);
  });

  it("enforces identifiers and field length limits", () => {
    expect(PasswordManagerEntrySummarySchema.safeParse({ ...summary, id: "not-an-id" }).success).toBe(false);
    expect(PasswordManagerEntryInputSchema.safeParse({ ...input, name: "n".repeat(101) }).success).toBe(false);
    expect(PasswordManagerEntryInputSchema.safeParse({ ...input, password: "p".repeat(1025) }).success).toBe(false);
    expect(PasswordManagerEntryInputSchema.safeParse({ ...input, customFields: [{ label: "", value: "x" }] }).success).toBe(false);
  });
});
