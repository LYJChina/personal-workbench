import { afterEach, describe, expect, it, vi } from "vitest";
import { AnthropicAdapter } from "../src/modules/ai-gateway/anthropic.adapter";
import { AiGateway } from "../src/modules/ai-gateway/ai-gateway";
import { AiGatewayError } from "../src/modules/ai-gateway/ai-gateway.types";
import { OpenAiAdapter } from "../src/modules/ai-gateway/openai.adapter";
import type { AiConnectionRecord } from "../src/modules/ai-gateway/ai-connection.repository";

const openAiConnection: AiConnectionRecord = {
  id: "openai-one",
  name: "OpenAI",
  protocol: "openai",
  baseUrl: "https://api.openai.example/v1",
  model: "gpt-model",
  secretName: "ai-connection:openai-one:api-key",
  isDefault: true
};

const anthropicConnection: AiConnectionRecord = {
  ...openAiConnection,
  id: "anthropic-one",
  name: "Anthropic",
  protocol: "anthropic",
  baseUrl: "https://api.anthropic.example/v1",
  model: "claude-model",
  secretName: "ai-connection:anthropic-one:api-key"
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("provider-neutral AI gateway", () => {
  it("sends and parses an OpenAI-compatible chat completion", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: "gpt-response-model",
      choices: [{ message: { content: " OpenAI response " } }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new OpenAiAdapter(fetchMock as typeof fetch);

    await expect(adapter.complete(openAiConnection, "openai-secret", {
      messages: [{ role: "system", content: "Be concise" }, { role: "user", content: "Hello" }],
      temperature: 0.2,
      maxTokens: 321
    })).resolves.toEqual({ content: "OpenAI response", model: "gpt-response-model" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.example/v1/chat/completions", expect.objectContaining({
      method: "POST",
      redirect: "manual",
      headers: { Authorization: "Bearer openai-secret", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-model",
        messages: [{ role: "system", content: "Be concise" }, { role: "user", content: "Hello" }],
        temperature: 0.2,
        max_tokens: 321
      })
    }));
  });

  it("converts unified messages to an Anthropic message request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      model: "claude-response-model",
      content: [{ type: "text", text: " Claude response " }]
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const adapter = new AnthropicAdapter(fetchMock as typeof fetch);

    await expect(adapter.complete(anthropicConnection, "anthropic-secret", {
      messages: [
        { role: "system", content: "First rule" },
        { role: "system", content: "Second rule" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" }
      ],
      temperature: 0.3,
      maxTokens: 456
    })).resolves.toEqual({ content: "Claude response", model: "claude-response-model" });

    expect(fetchMock).toHaveBeenCalledWith("https://api.anthropic.example/v1/messages", expect.objectContaining({
      method: "POST",
      redirect: "manual",
      headers: {
        "x-api-key": "anthropic-secret",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-model",
        system: "First rule\n\nSecond rule",
        messages: [{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi" }],
        temperature: 0.3,
        max_tokens: 456
      })
    }));
  });

  it.each([
    [400, "invalid_request"],
    [401, "auth"],
    [402, "billing"],
    [429, "rate_limit"],
    [302, "upstream"],
    [500, "upstream"]
  ] as const)("normalizes provider HTTP %s as %s", async (status, category) => {
    const adapter = new OpenAiAdapter(vi.fn(async () => new Response("sensitive upstream body", { status })) as typeof fetch);
    const promise = adapter.complete(openAiConnection, "secret-not-in-error", {
      messages: [{ role: "user", content: "Hello" }]
    });
    await expect(promise).rejects.toMatchObject({ category });
    await expect(promise).rejects.not.toThrow(/sensitive upstream body|secret-not-in-error/);
  });

  it("uses a practical output budget for a connection probe", async () => {
    const openai = { complete: vi.fn(async () => ({ content: "OK", model: "gpt-model" })) };
    const gateway = new AiGateway({
      repository: { get: () => openAiConnection } as never,
      secretStore: { readSecret: async () => "provider-key" } as never,
      openai,
      anthropic: { complete: vi.fn() }
    });

    await gateway.testConnection(openAiConnection.id);

    expect(openai.complete).toHaveBeenCalledWith(openAiConnection, "provider-key", expect.objectContaining({
      maxTokens: 32
    }));
  });

  it("distinguishes a network failure from an upstream HTTP failure", async () => {
    const adapter = new OpenAiAdapter(vi.fn(async () => { throw new TypeError("fetch failed"); }) as typeof fetch);

    await expect(adapter.complete(openAiConnection, "network-key", {
      messages: [{ role: "user", content: "Hello" }]
    })).rejects.toMatchObject({ category: "network" });
  });

  it.each([
    ["OpenAI", openAiConnection, (fetchImplementation: typeof fetch) => new OpenAiAdapter(fetchImplementation)],
    ["Anthropic", anthropicConnection, (fetchImplementation: typeof fetch) => new AnthropicAdapter(fetchImplementation)]
  ] as const)("aborts the %s adapter after 30 seconds", async (_name, connection, createAdapter) => {
    vi.useFakeTimers();
    let providerSignal: AbortSignal | null | undefined;
    const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      providerSignal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }) as typeof fetch;
    const pending = createAdapter(fetchImplementation).complete(connection, "timeout-secret", {
      messages: [{ role: "user", content: "Hello" }]
    });
    const rejection = expect(pending).rejects.toMatchObject({ category: "timeout" });

    await vi.advanceTimersByTimeAsync(29_999);
    expect(providerSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(providerSignal?.aborted).toBe(true);
  });

  it.each([
    ["OpenAI", openAiConnection, (fetchImplementation: typeof fetch) => new OpenAiAdapter(fetchImplementation)],
    ["Anthropic", anthropicConnection, (fetchImplementation: typeof fetch) => new AnthropicAdapter(fetchImplementation)]
  ] as const)("normalizes malformed and network-failed %s responses without leaking data", async (_name, connection, createAdapter) => {
    const malformed = createAdapter(vi.fn(async () => new Response(JSON.stringify({ secret: "raw-provider-body" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })) as typeof fetch);
    const malformedRequest = malformed.complete(connection, "malformed-secret", {
      messages: [{ role: "user", content: "Hello" }]
    });
    await expect(malformedRequest).rejects.toMatchObject({ category: "upstream" });
    await expect(malformedRequest).rejects.not.toThrow(/raw-provider-body|malformed-secret/);

    const network = createAdapter(vi.fn(async () => { throw new Error("network secret body"); }) as typeof fetch);
    const networkRequest = network.complete(connection, "network-key", {
      messages: [{ role: "user", content: "Hello" }]
    });
    await expect(networkRequest).rejects.toMatchObject({ category: "network" });
    await expect(networkRequest).rejects.not.toThrow(/network secret body|network-key/);
  });

  it("selects an adapter from the current default connection on every request", async () => {
    let current: AiConnectionRecord | null = openAiConnection;
    const repository = { getDefault: () => current };
    const secretStore = { readSecret: vi.fn(async (name: string) => `${name}-value`) };
    const openai = { complete: vi.fn(async () => ({ content: "openai", model: "gpt" })) };
    const anthropic = { complete: vi.fn(async () => ({ content: "anthropic", model: "claude" })) };
    const gateway = new AiGateway({ repository: repository as never, secretStore: secretStore as never, openai, anthropic });

    await expect(gateway.complete({ messages: [{ role: "user", content: "one" }] })).resolves.toEqual({ content: "openai", model: "gpt" });
    current = anthropicConnection;
    await expect(gateway.complete({ messages: [{ role: "user", content: "two" }] })).resolves.toEqual({ content: "anthropic", model: "claude" });
    expect(openai.complete).toHaveBeenCalledOnce();
    expect(anthropic.complete).toHaveBeenCalledOnce();
    expect(secretStore.readSecret).toHaveBeenNthCalledWith(1, openAiConnection.secretName);
    expect(secretStore.readSecret).toHaveBeenNthCalledWith(2, anthropicConnection.secretName);
  });

  it.each([
    [null, "unused"],
    [openAiConnection, null]
  ])("reports not_configured without calling a provider when connection/key is missing", async (connection, secret) => {
    const gateway = new AiGateway({
      repository: { getDefault: () => connection } as never,
      secretStore: { readSecret: async () => secret } as never,
      openai: { complete: vi.fn() },
      anthropic: { complete: vi.fn() }
    });
    const promise = gateway.complete({ messages: [{ role: "user", content: "Hello" }] });
    await expect(promise).rejects.toBeInstanceOf(AiGatewayError);
    await expect(promise).rejects.toMatchObject({ category: "not_configured" });
  });
});
