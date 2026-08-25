import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";

describe("AI connection database migration", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("migrates legacy DeepSeek settings into the default OpenAI-compatible connection", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-ai-connection-v4-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const legacy = openDatabase(paths);
    try {
      legacy.exec("DROP TABLE ai_connections");
      legacy.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?), (?, ?)")
        .run("deepseek.base_url", "https://private.example/v1", "deepseek.model", "legacy-model");
      legacy.pragma("user_version = 4");
    } finally {
      legacy.close();
    }

    const upgraded = openDatabase(paths);
    try {
      expect(upgraded.pragma("user_version", { simple: true })).toBe(7);
      expect(upgraded.prepare(`SELECT id, name, protocol, base_url, model, secret_name, is_default
        FROM ai_connections`).get()).toEqual({
        id: "legacy-deepseek",
        name: "DeepSeek",
        protocol: "openai",
        base_url: "https://private.example/v1",
        model: "legacy-model",
        secret_name: "deepseek-api-key",
        is_default: 1
      });
    } finally {
      upgraded.close();
    }
  });
});
