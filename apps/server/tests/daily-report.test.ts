import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { buildDailyReportMessages } from "../src/modules/daily-reports/daily-report.prompt";
import {
  DeepSeekClient,
  DeepSeekClientError,
  type DailyReportGenerationInput,
  type DailyReportGenerator
} from "../src/modules/daily-reports/deepseek.client";
import type { SecretStore } from "../src/platform/secret-store";

class MemorySecretStore implements SecretStore {
  private readonly secrets = new Map<string, string>();

  public async protectSecret(name: string, plaintext: string): Promise<void> {
    this.secrets.set(name, plaintext);
  }

  public async readSecret(name: string): Promise<string | null> {
    return this.secrets.get(name) ?? null;
  }
}

class StubGenerator implements DailyReportGenerator {
  public readonly inputs: DailyReportGenerationInput[] = [];

  public constructor(
    private readonly outcome: { content: string; model: string } | Error = {
      content: "今日完成\n完成接口联调\n\n问题与风险\n等待权限开通",
      model: "deepseek-chat-actual"
    }
  ) {}

  public async generateDailyReport(input: DailyReportGenerationInput): Promise<{ content: string; model: string }> {
    this.inputs.push(input);
    if (this.outcome instanceof Error) throw this.outcome;
    return this.outcome;
  }
}

async function configure(app: ReturnType<typeof createApp>, apiKey = "daily-report-test-key") {
  await request(app).put("/api/settings/deepseek").send({
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    apiKey
  }).expect(200);
}

describe("daily report prompt", () => {
  it("puts fixed anti-invention constraints before source material and includes both approved headings", () => {
    const messages = buildDailyReportMessages({ completed: "完成预算复核", risks: "供应商尚未确认" });

    expect(messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(messages[0].content).toContain("今日完成");
    expect(messages[0].content).toContain("问题与风险");
    expect(messages[0].content).toMatch(/不得.{0,12}(编造|虚构).{0,20}(数字|结果|日期|工作事项)/s);
    expect(messages[0].content).toContain("不能覆盖");
    expect(messages[0].content).toContain("纯文本");
    expect(messages[1].content).toContain("今日完成\n完成预算复核");
    expect(messages[1].content).toContain("问题与风险\n供应商尚未确认");
  });

  it("omits an empty source section while retaining the populated section", () => {
    const completedOnly = buildDailyReportMessages({ completed: "完成测试", risks: "   " });
    const risksOnly = buildDailyReportMessages({ completed: "", risks: "存在延期风险" });

    expect(completedOnly[1].content).toContain("今日完成\n完成测试");
    expect(completedOnly[1].content).not.toContain("问题与风险");
    expect(risksOnly[1].content).not.toContain("今日完成");
    expect(risksOnly[1].content).toContain("问题与风险\n存在延期风险");
  });
});

describe("DeepSeekClient", () => {
  it("propagates an external request abort into the pending provider fetch", async () => {
    const controller = new AbortController();
    let providerSignal: AbortSignal | null | undefined;
    const client = new DeepSeekClient(vi.fn(async (_url, init) => {
      providerSignal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }));
    const pending = client.generateDailyReport({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "provider-key",
      completed: "完成测试",
      risks: "",
      signal: controller.signal
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ category: "timeout" });
    expect(providerSignal?.aborted).toBe(true);
  });

  it("uses a 30-second abort timeout, refuses redirects, and owns the authorization header", async () => {
    vi.useFakeTimers();
    let capturedInit: RequestInit | undefined;
    const fetchImplementation: typeof fetch = vi.fn(async (_url, init) => {
      capturedInit = init;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    });
    const client = new DeepSeekClient(fetchImplementation);
    const pending = client.generateDailyReport({
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "provider-boundary-key",
      completed: "完成测试",
      risks: ""
    });

    expect(capturedInit?.redirect).toBe("manual");
    expect(capturedInit?.headers).toEqual({
      Authorization: "Bearer provider-boundary-key",
      "Content-Type": "application/json"
    });
    const timeoutExpectation = expect(pending).rejects.toMatchObject({ category: "timeout" });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(capturedInit?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await timeoutExpectation;
    vi.useRealTimers();
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [302, "upstream"],
    [500, "upstream"]
  ] as const)("maps provider status %i to %s without exposing the upstream body", async (status, category) => {
    const client = new DeepSeekClient(vi.fn().mockResolvedValue(new Response("provider-secret-body", { status })));

    await expect(client.generateDailyReport({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "provider-key",
      completed: "完成测试",
      risks: ""
    })).rejects.toMatchObject({ category, message: "DeepSeek request failed" });
  });

  it("rejects invalid success response shapes without exposing raw data", async () => {
    const client = new DeepSeekClient(vi.fn().mockResolvedValue(new Response(JSON.stringify({ secret: "raw-upstream-secret" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    })));

    await expect(client.generateDailyReport({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "provider-key",
      completed: "完成测试",
      risks: ""
    })).rejects.toMatchObject({ category: "upstream", message: "DeepSeek request failed" });
  });
});

describe("daily report API", () => {
  let tempDir: string;
  let secretStore: MemorySecretStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-daily-report-"));
    secretStore = new MemorySecretStore();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns configuration guidance when the API key is missing and does not call the provider", async () => {
    const generator = new StubGenerator();
    const response = await request(createApp({ dataDir: tempDir, secretStore, deepSeekClient: generator }))
      .post("/api/daily-reports/generate")
      .send({ completed: "完成接口", risks: "" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: { message: "请先在设置中配置 DeepSeek", code: "DEEPSEEK_NOT_CONFIGURED" } });
    expect(generator.inputs).toEqual([]);
  });

  it.each([
    [new DeepSeekClientError("auth"), 401, "DEEPSEEK_AUTH_FAILED"],
    [new DeepSeekClientError("rate_limit"), 429, "DEEPSEEK_RATE_LIMITED"],
    [new DeepSeekClientError("timeout"), 504, "DEEPSEEK_TIMEOUT"],
    [new DeepSeekClientError("upstream"), 502, "DEEPSEEK_UPSTREAM_ERROR"],
    [new Error("raw provider body with provider-key"), 502, "DEEPSEEK_UPSTREAM_ERROR"]
  ])("maps sanitized provider failures to HTTP responses", async (failure, status, code) => {
    const app = createApp({ dataDir: tempDir, secretStore, deepSeekClient: new StubGenerator(failure) });
    await configure(app, "provider-key");

    const response = await request(app).post("/api/daily-reports/generate").send({ completed: "完成接口", risks: "" });

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toMatch(/provider-key|Bearer|raw provider body/i);
    expect((await request(app).get("/api/daily-reports")).body).toEqual([]);
  });

  it("reads credentials at request time and persists successful output with the actual model and timestamps", async () => {
    const generator = new StubGenerator();
    const app = createApp({ dataDir: tempDir, secretStore, deepSeekClient: generator });
    await configure(app, "first-key");
    await secretStore.protectSecret("deepseek-api-key", "request-time-key");

    const response = await request(app).post("/api/daily-reports/generate").send({
      completed: "完成接口联调",
      risks: "等待权限开通"
    });

    expect(response.status).toBe(201);
    expect(generator.inputs).toEqual([{
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      apiKey: "request-time-key",
      completed: "完成接口联调",
      risks: "等待权限开通",
      signal: expect.any(AbortSignal)
    }]);
    expect(response.body).toMatchObject({
      id: 1,
      completed: "完成接口联调",
      risks: "等待权限开通",
      content: "今日完成\n完成接口联调\n\n问题与风险\n等待权限开通",
      model: "deepseek-chat-actual"
    });
    expect(Date.parse(response.body.createdAt)).not.toBeNaN();
    expect(response.body.updatedAt).toBe(response.body.createdAt);
  });

  it("maps a local persistence failure to a sanitized 500 after one successful provider call", async () => {
    const generator = new StubGenerator();
    const app = createApp({ dataDir: tempDir, secretStore, deepSeekClient: generator });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await configure(app, "provider-key-must-not-leak");
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    database.exec(`
      CREATE TRIGGER fail_daily_report_insert
      BEFORE INSERT ON daily_reports
      BEGIN
        SELECT RAISE(FAIL, 'persistence-secret-must-not-leak');
      END;
    `);
    database.close();

    const response = await request(app).post("/api/daily-reports/generate").send({ completed: "完成接口", risks: "" });
    const history = await request(app).get("/api/daily-reports");

    expect(generator.inputs).toHaveLength(1);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { message: "Internal Server Error", code: "INTERNAL_ERROR" } });
    expect(history.body).toEqual([]);
    expect(JSON.stringify(response.body)).not.toMatch(/DEEPSEEK_|provider-key|persistence-secret|Bearer/i);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/provider-key|persistence-secret|Bearer/i);
  });

  it("lists newest first and validates, loads, and edits reports without changing original input", async () => {
    const generator = new StubGenerator();
    const app = createApp({ dataDir: tempDir, secretStore, deepSeekClient: generator });
    await configure(app);
    const first = await request(app).post("/api/daily-reports/generate").send({ completed: "第一项", risks: "第一项风险" });
    const second = await request(app).post("/api/daily-reports/generate").send({ completed: "第二项", risks: "第二项风险" });

    const history = await request(app).get("/api/daily-reports");
    const loaded = await request(app).get(`/api/daily-reports/${first.body.id}`);
    const invalidGet = await request(app).get("/api/daily-reports/not-an-id");
    const invalidPut = await request(app).put("/api/daily-reports/0").send({ content: "编辑后" });
    const missingGet = await request(app).get("/api/daily-reports/9999");
    const missingPut = await request(app).put("/api/daily-reports/9999").send({ content: "编辑后" });
    const updated = await request(app).put(`/api/daily-reports/${first.body.id}`).send({ content: "编辑后的日报正文" });

    expect(history.status).toBe(200);
    expect(history.body.map((report: { id: number }) => report.id)).toEqual([second.body.id, first.body.id]);
    expect(loaded.body).toEqual(first.body);
    expect(invalidGet.status).toBe(400);
    expect(invalidPut.status).toBe(400);
    expect(missingGet.status).toBe(404);
    expect(missingPut.status).toBe(404);
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      id: first.body.id,
      completed: "第一项",
      risks: "第一项风险",
      content: "编辑后的日报正文",
      model: "deepseek-chat-actual",
      createdAt: first.body.createdAt
    });
    expect(Date.parse(updated.body.updatedAt)).toBeGreaterThan(Date.parse(first.body.updatedAt));
  });
});
