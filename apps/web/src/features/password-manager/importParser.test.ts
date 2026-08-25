import { describe, expect, it, vi } from "vitest";
import { parseLocalImport, redactImportForAi, restoreRedactedAiResult } from "./importParser";
import { passwordManagerApi } from "./passwordManagerApi";

describe("local credential import parser", () => {
  it("parses CSV, TSV, JSON, and tagged credentials without saving them", () => {
    expect(parseLocalImport("name,website,username,password\nGitHub,https://github.com,ada,secret").items).toEqual([
      expect.objectContaining({ name: "GitHub", website: "https://github.com", username: "ada", password: "secret" })
    ]);
    expect(parseLocalImport("name\tusername\tpassword\nEmail\tada@example.com\tpw").items[0]).toMatchObject({ name: "Email", username: "ada@example.com", password: "pw" });
    expect(parseLocalImport(JSON.stringify([{ name: "Bank", username: "ada", password: "code", notes: "local" }])).items[0]).toMatchObject({ name: "Bank", notes: "local" });
    expect(parseLocalImport("name: Forum\nusername: ada\npassword: token\nwebsite: https://forum.test").items[0]).toMatchObject({ name: "Forum", username: "ada", password: "token" });
  });

  it("reports missing fields, malformed input, duplicates and file limits", () => {
    expect(parseLocalImport("name,username,password\nOnly Name,,").warnings.join(" ")).toMatch(/缺少/);
    expect(parseLocalImport("{broken").warnings.join(" ")).toMatch(/格式/);
    expect(parseLocalImport("name,username,password\nSame,a,one\nSame,a,two").duplicates).toEqual(["Same"]);
    expect(parseLocalImport("x".repeat(1_000_001)).warnings.join(" ")).toMatch(/过大/);
  });

  it("redacts every credential value before optional AI help and restores placeholders only locally", () => {
    const preview = parseLocalImport("name,website,username,password\nGitHub,https://github.com,ada,top-secret");
    const { redactedText, placeholders } = redactImportForAi(preview);
    expect(redactedText).toContain("[CREDENTIAL_1]");
    expect(redactedText).not.toContain("top-secret");
    expect(redactedText).not.toContain("ada");
    expect(restoreRedactedAiResult({ ...preview, items: [{ ...preview.items[0], username: "[CREDENTIAL_1]", password: "[CREDENTIAL_2]" }], source: "redacted-ai" }, placeholders).items[0]).toMatchObject({ username: "ada", password: "top-secret" });
  });

  it("sends only redacted placeholders to optional AI help", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { redactedText } = redactImportForAi(parseLocalImport("name,username,password\nGitHub,ada,top-secret"));
    await passwordManagerApi.requestRedactedAiHelp?.(redactedText);
    const body = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).toContain("[CREDENTIAL_1]");
    expect(body).not.toContain("ada");
    expect(body).not.toContain("top-secret");
  });
});
