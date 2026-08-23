import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { SecretStore } from "../src/platform/dpapi";

class EmptySecretStore implements SecretStore {
  public async protectSecret(): Promise<void> {}
  public async readSecret(): Promise<string | null> { return null; }
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

  it("returns and logs only a sanitized 500 when a dependency throws secret-bearing text", async () => {
    const sentinel = "Bearer deepseek-api-key=server-secret smtp-password=mail-secret";
    const secretStore: SecretStore = {
      protectSecret: async () => undefined,
      readSecret: async () => { throw new Error(sentinel); }
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const app = createApp({ dataDir: tempDir, secretStore });

    const response = await request(app)
      .post("/api/daily-reports/generate")
      .send({ completed: "完成安全检查", risks: "" });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { message: "Internal Server Error", code: "INTERNAL_ERROR" } });
    expect(JSON.stringify(response.body)).not.toMatch(/Bearer|api[_-]?key|smtp|server-secret|mail-secret/i);
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/Bearer|api[_-]?key|smtp|server-secret|mail-secret/i);
  });

});
