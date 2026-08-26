import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { SecretStore } from "../src/platform/secret-store";

const mutationHeaderName = "X-LYJ-Workbench-Request";
const mutationHeaderValue = "local-browser-v1";

class EmptySecretStore implements SecretStore {
  public async protectSecret(): Promise<void> {}
  public async readSecret(): Promise<string | null> { return null; }
  public async deleteSecret(): Promise<void> {}
}

describe("production-local security boundaries", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-workbench-security-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("defaults to the exact IPv4 loopback address and accepts only valid TCP ports", async () => {
    const { resolveServerHost, resolveServerPort } = await import("../src/server-config");

    expect(resolveServerHost(undefined)).toBe("127.0.0.1");
    expect(resolveServerHost("127.0.0.1")).toBe("127.0.0.1");
    expect(resolveServerPort(undefined)).toBe(3001);
    expect(resolveServerPort("43123")).toBe(43123);
  });

  it.each(["0.0.0.0", "::", "::1", "localhost", "192.168.1.20", "workbench.local", "127.0.0.1 "])(
    "rejects the non-canonical production host %s",
    async (host) => {
      const { resolveServerHost } = await import("../src/server-config");
      expect(() => resolveServerHost(host)).toThrow("HOST must be exactly 127.0.0.1");
    }
  );

  it.each(["", "0", "65536", "3001.5", "not-a-port", " 3001", "3001 "])(
    "rejects the malformed production port %j",
    async (port) => {
      const { resolveServerPort } = await import("../src/server-config");
      expect(() => resolveServerPort(port)).toThrow("PORT must be an integer from 1 through 65535");
    }
  );

  it("serves the built UI for client routes while preserving JSON API 404 responses", async () => {
    const webDistDir = join(tempDir, ".worktrees", "feature", "apps", "web", "dist");
    await mkdir(join(webDistDir, "assets"), { recursive: true });
    await writeFile(join(webDistDir, "index.html"), "<!doctype html><title>LYJ fixture</title><div id=\"root\"></div>");
    await writeFile(join(webDistDir, "assets", "fixture.js"), "globalThis.fixtureLoaded = true;");
    const app = createApp({ dataDir: join(tempDir, "data"), secretStore: new EmptySecretStore(), webDistDir });

    const asset = await request(app).get("/assets/fixture.js");
    const clientRoute = await request(app).get("/ai-office/daily-report");
    const apiRoute = await request(app).get("/api/does-not-exist");

    expect(asset.status).toBe(200);
    expect(asset.text).toContain("fixtureLoaded");
    expect(clientRoute.status).toBe(200);
    expect(clientRoute.text).toContain("LYJ fixture");
    expect(apiRoute.status).toBe(404);
    expect(apiRoute.type).toMatch(/json/);
    expect(apiRoute.body).toEqual({ error: { message: "Not Found", code: "NOT_FOUND" } });
  });

  it("returns only a sanitized provider error when the AI secret store throws secret-bearing text", async () => {
    const sentinel = "Bearer deepseek-api-key=server-secret smtp-password=mail-secret";
    const secretStore: SecretStore = {
      protectSecret: async () => undefined,
      readSecret: async () => { throw new Error(sentinel); },
      deleteSecret: async () => undefined
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({ dataDir: tempDir, secretStore });

    const response = await request(app)
      .post("/api/daily-reports/generate")
      .set(mutationHeaderName, mutationHeaderValue)
      .send({ completed: "完成安全检查", risks: "" });

    expect(response.status).toBe(502);
    expect(response.body).toEqual({ error: { message: "模型服务暂时不可用，请稍后重试", code: "AI_UPSTREAM_ERROR" } });
    expect(JSON.stringify(response.body)).not.toMatch(/Bearer|api[_-]?key|smtp|server-secret|mail-secret/i);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/Bearer|api[_-]?key|smtp|server-secret|mail-secret/i);
  });

  it.each([
    "attacker.example:3001",
    "localhost:3001",
    "127.0.0.1.evil:3001",
    "127%2e0%2e0%2e1:3001",
    "[::1]:3001",
    "user@127.0.0.1:3001",
    "127.0.0.1:0",
    "127.0.0.1:65536",
    "127.0.0.1:3001,attacker.example"
  ])("rejects untrusted Host %s before exposing API data", async (host) => {
    const app = createApp({ dataDir: tempDir, secretStore: new EmptySecretStore() });

    const response = await request(app).get("/api/profile").set("Host", host);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { message: "Forbidden", code: "FORBIDDEN" } });
  });

  it("rejects forwarded-host overrides even when Host is valid", async () => {
    const app = createApp({ dataDir: tempDir, secretStore: new EmptySecretStore() });
    const response = await request(app)
      .get("/api/profile")
      .set("Host", "127.0.0.1:3001")
      .set("X-Forwarded-Host", "attacker.example");
    expect(response.status).toBe(403);
  });

  it("rejects hostile Origin and missing mutation provenance without invoking SMTP", async () => {
    const send = vi.fn().mockResolvedValue({ status: "success" as const });
    const app = createApp({
      dataDir: tempDir,
      secretStore: new EmptySecretStore(),
      reminderChannel: { send }
    });

    const hostileOrigin = await request(app)
      .post("/api/reminders/outbound-checkin/test")
      .set("Host", "127.0.0.1:3001")
      .set("Origin", "http://attacker.example")
      .set(mutationHeaderName, mutationHeaderValue)
      .set("Content-Type", "text/plain")
      .send("hostile");
    const missingHeader = await request(app)
      .post("/api/reminders/outbound-checkin/test")
      .set("Host", "127.0.0.1:3001")
      .set("Origin", "http://127.0.0.1:5173")
      .set(mutationHeaderName, "missing");

    expect(hostileOrigin.status).toBe(403);
    expect(missingHeader.status).toBe(403);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["/API/reminders/outbound-checkin/test", "/Api/reminders/outbound-checkin/test"])(
    "rejects mixed-case API mutation %s without provenance before invoking SMTP",
    async (path) => {
      const send = vi.fn().mockResolvedValue({ status: "success" as const });
      const app = createApp({
        dataDir: tempDir,
        secretStore: new EmptySecretStore(),
        reminderChannel: { send }
      });

      const response = await request(app)
        .post(path)
        .set("Host", "127.0.0.1:3001")
        .set("Origin", "http://127.0.0.1:5173")
        .set(mutationHeaderName, "missing");

      expect(response.status).toBe(403);
      expect(send).not.toHaveBeenCalled();
    }
  );

  it("rejects an unprovenanced backup export without invoking the exporter", async () => {
    const createSnapshot = vi.fn();
    const app = createApp({
      dataDir: tempDir,
      secretStore: new EmptySecretStore(),
      backupExporter: { createSnapshot }
    });

    const response = await request(app)
      .post("/api/backup/export")
      .set("Host", "127.0.0.1:3001")
      .set(mutationHeaderName, "missing");

    expect(response.status).toBe(403);
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it.each([
    ["PUT", "/api/plugins/lyj.system.ai-chat/enabled", { enabled: false }],
    ["POST", "/api/plugins/safe-mode/reset", undefined]
  ])("requires mutation provenance for plugin management %s %s", async (method, path, body) => {
    const app = createApp({ dataDir: tempDir, secretStore: new EmptySecretStore() });
    const pending = method === "PUT" ? request(app).put(path) : request(app).post(path);
    pending.set("Host", "127.0.0.1:3001").set(mutationHeaderName, "missing");
    if (body !== undefined) pending.send(body);

    const response = await pending;

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: { message: "Forbidden", code: "FORBIDDEN" } });
  });

  it("accepts a valid Vite origin and mutation provenance", async () => {
    const send = vi.fn().mockResolvedValue({ status: "success" as const });
    const app = createApp({
      dataDir: tempDir,
      secretStore: new EmptySecretStore(),
      reminderChannel: { send }
    });

    const response = await request(app)
      .post("/api/reminders/outbound-checkin/test")
      .set("Host", "127.0.0.1:3001")
      .set("Origin", "http://127.0.0.1:5173")
      .set(mutationHeaderName, mutationHeaderValue);

    expect(response.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

});
