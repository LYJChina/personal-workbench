import { describe, expect, it } from "vitest";
import {
  AiConnectionCreateSchema,
  AiConnectionSchema,
  AiConnectionUpdateSchema
} from "./index";

const connection = {
  id: "legacy-deepseek",
  name: "DeepSeek",
  protocol: "openai",
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-chat",
  apiKeyConfigured: true,
  isDefault: true
} as const;

describe("AI connection contracts", () => {
  it.each(["openai", "anthropic"] as const)("accepts a strict %s connection", (protocol) => {
    expect(AiConnectionSchema.parse({ ...connection, protocol })).toEqual({ ...connection, protocol });
  });

  it("rejects secret material and internal secret names in responses", () => {
    expect(AiConnectionSchema.safeParse({ ...connection, apiKey: "secret" }).success).toBe(false);
    expect(AiConnectionSchema.safeParse({ ...connection, secretName: "deepseek-api-key" }).success).toBe(false);
  });

  it("accepts create and update inputs while rejecting unknown fields", () => {
    const input = {
      name: "Claude",
      protocol: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      model: "claude-model",
      apiKey: "sk-ant-test"
    };
    expect(AiConnectionCreateSchema.parse(input)).toEqual(input);
    expect(AiConnectionUpdateSchema.parse(input)).toEqual(input);
    expect(AiConnectionUpdateSchema.safeParse({ ...input, secretName: "hidden" }).success).toBe(false);
  });

  it("requires canonical lowercase connection IDs", () => {
    expect(AiConnectionSchema.safeParse({ ...connection, id: "provider-one" }).success).toBe(true);
    expect(AiConnectionSchema.safeParse({ ...connection, id: "Provider One" }).success).toBe(false);
    expect(AiConnectionSchema.safeParse({ ...connection, id: "provider_one" }).success).toBe(false);
  });
});
