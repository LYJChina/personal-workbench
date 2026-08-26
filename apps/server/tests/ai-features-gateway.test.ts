import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { AiCompletionInput } from "../src/modules/ai-gateway/ai-gateway.types";
import type { SecretStore } from "../src/platform/secret-store";

const emptySecrets: SecretStore = {
  protectSecret: async () => undefined,
  readSecret: async () => null,
  deleteSecret: async () => undefined
};

describe("system AI features use the kernel gateway", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("routes chat, polish, and daily-report prompts through one provider-neutral boundary", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-ai-feature-gateway-"));
    temporaryDirectories.push(dataDir);
    const inputs: AiCompletionInput[] = [];
    const gateway = {
      complete: vi.fn(async (input: AiCompletionInput) => {
        inputs.push(input);
        return { content: `gateway-result-${inputs.length}`, model: "gateway-model" };
      })
    };
    const app = createApp({ dataDir, secretStore: emptySecrets, aiGateway: gateway } as never);

    await request(app).post("/api/ai-chat/messages").send({ content: "对话问题" }).expect(201);
    await request(app).post("/api/ai-polish/generate").send({
      kind: "general", primaryText: "需要润色", secondaryText: "", systemPrompt: "简洁"
    }).expect(201);
    await request(app).post("/api/daily-reports/generate").send({ completed: "完成网关", risks: "" }).expect(201);

    expect(inputs).toHaveLength(3);
    expect(inputs[0].messages.at(-1)).toEqual({ role: "user", content: "对话问题" });
    expect(inputs[1].messages.map((message) => message.role)).toEqual(["system", "system", "user"]);
    expect(inputs[2].messages.map((message) => message.role)).toEqual(["system", "user"]);
  });
});
