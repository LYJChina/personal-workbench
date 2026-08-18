import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import type { SecretStore } from "../src/platform/dpapi";

const execFileAsync = promisify(execFile);

async function waitForFile(path: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

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

  it("runs a controlled built fixture from resolved literal paths without browser or secret propagation", async () => {
    const projectRoot = join(tempDir, "controlled project");
    const serverEntry = join(projectRoot, "apps", "server", "dist", "index.js");
    const webIndex = join(projectRoot, "apps", "web", "dist", "index.html");
    const observation = join(projectRoot, "startup-observation.json");
    await mkdir(join(projectRoot, "apps", "server", "dist"), { recursive: true });
    await mkdir(join(projectRoot, "apps", "web", "dist"), { recursive: true });
    await writeFile(webIndex, "<!doctype html><title>controlled fixture</title>");
    await writeFile(serverEntry, `
      const fs = require("node:fs");
      const http = require("node:http");
      const path = require("node:path");
      fs.writeFileSync(path.join(process.cwd(), "startup-observation.json"), JSON.stringify({
        argv: process.argv.slice(2), cwd: process.cwd(), host: process.env.HOST,
        port: process.env.PORT, nodeEnv: process.env.NODE_ENV, environment: process.env
      }));
      const server = http.createServer((request, response) => {
        if (request.url === "/api/health") {
          const headers = { "Content-Type": "application/json" };
          if (process.env.LYJ_WORKBENCH_INSTANCE_TOKEN) {
            headers["X-LYJ-Workbench-Instance"] = process.env.LYJ_WORKBENCH_INSTANCE_TOKEN;
          }
          response.writeHead(200, headers);
          response.end(JSON.stringify({ status: "ok" }));
          setTimeout(() => server.close(() => process.exit(0)), 250);
          return;
        }
        response.writeHead(404); response.end();
      });
      server.listen(Number(process.env.PORT), process.env.HOST);
    `);
    const script = resolve(process.cwd(), "../../scripts/start-local.ps1");

    const result = await execFileAsync("powershell", [
      "-NoProfile", "-File", script, "-NoOpen", "-ProjectRoot", projectRoot,
      "-NodePath", process.execPath, "-ServerEntryPath", serverEntry, "-Port", "43127",
      "-HealthTimeoutSeconds", "10"
    ], {
      env: { ...process.env, LYJ_SECRET_SENTINEL: "must-not-reach-child" },
      timeout: 15_000
    });
    const recorded = JSON.parse(await readFile(observation, "utf8")) as {
      argv: string[]; cwd: string; host: string; port: string; nodeEnv: string; environment: Record<string, string>;
    };

    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("http://127.0.0.1:43127");
    expect(recorded).toMatchObject({ argv: [], cwd: projectRoot, host: "127.0.0.1", port: "43127", nodeEnv: "production" });
    expect(recorded.environment.LYJ_WORKBENCH_INSTANCE_TOKEN).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(recorded)).not.toContain("must-not-reach-child");
    expect(Object.keys(recorded.environment).map((key) => key.toLowerCase())).not.toEqual(expect.arrayContaining([
      "deepseek_api_key", "smtp_password", "lyj_secret_sentinel"
    ]));
  });

  it("returns failure and cleans up the exact child when health never succeeds", async () => {
    const projectRoot = join(tempDir, "unhealthy fixture");
    const serverEntry = join(projectRoot, "apps", "server", "dist", "index.js");
    const webIndex = join(projectRoot, "apps", "web", "dist", "index.html");
    const pidFile = join(projectRoot, "unhealthy.pid");
    await mkdir(join(projectRoot, "apps", "server", "dist"), { recursive: true });
    await mkdir(join(projectRoot, "apps", "web", "dist"), { recursive: true });
    await writeFile(webIndex, "<!doctype html><title>unhealthy fixture</title>");
    await writeFile(serverEntry, `
      require("node:fs").writeFileSync(require("node:path").join(process.cwd(), "unhealthy.pid"), String(process.pid));
      setInterval(() => undefined, 1_000);
    `);
    const script = resolve(process.cwd(), "../../scripts/start-local.ps1");

    await expect(execFileAsync("powershell", [
      "-NoProfile", "-File", script, "-NoOpen", "-ProjectRoot", projectRoot,
      "-NodePath", process.execPath, "-ServerEntryPath", serverEntry, "-Port", "43128",
      "-HealthTimeoutSeconds", "1"
    ], { timeout: 10_000 })).rejects.toMatchObject({ code: 1 });

    const childPid = Number(await readFile(pidFile, "utf8"));
    expect(Number.isInteger(childPid)).toBe(true);
    expect(() => process.kill(childPid, 0)).toThrow();
  });

  it("does not orphan the exact child when the PowerShell launcher is terminated", async () => {
    const projectRoot = join(tempDir, "terminated launcher fixture");
    const serverEntry = join(projectRoot, "apps", "server", "dist", "index.js");
    const webIndex = join(projectRoot, "apps", "web", "dist", "index.html");
    const pidFile = join(projectRoot, "server.pid");
    await mkdir(join(projectRoot, "apps", "server", "dist"), { recursive: true });
    await mkdir(join(projectRoot, "apps", "web", "dist"), { recursive: true });
    await writeFile(webIndex, "<!doctype html><title>terminated launcher fixture</title>");
    await writeFile(serverEntry, `
      const fs = require("node:fs");
      const http = require("node:http");
      const path = require("node:path");
      fs.writeFileSync(path.join(process.cwd(), "server.pid"), String(process.pid));
      http.createServer((request, response) => {
        if (request.url === "/api/health") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ status: "ok" }));
          return;
        }
        response.writeHead(404); response.end();
      }).listen(Number(process.env.PORT), process.env.HOST);
    `);
    const script = resolve(process.cwd(), "../../scripts/start-local.ps1");
    const launcher = spawn("powershell", [
      "-NoProfile", "-File", script, "-NoOpen", "-ProjectRoot", projectRoot,
      "-NodePath", process.execPath, "-ServerEntryPath", serverEntry, "-Port", "43129",
      "-HealthTimeoutSeconds", "10"
    ], { stdio: "ignore" });
    let childPid = 0;
    let orphaned = false;

    try {
      childPid = Number(await waitForFile(pidFile));
      expect(processExists(childPid)).toBe(true);
      launcher.kill();
      const deadline = Date.now() + 3_000;
      while (processExists(childPid) && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      orphaned = processExists(childPid);
      expect(orphaned).toBe(false);
    } finally {
      if (!launcher.killed) launcher.kill();
      if (childPid && processExists(childPid)) process.kill(childPid);
    }
  }, 10_000);

  it("rejects an incumbent healthy responder when the launched child loses the port collision", async () => {
    const incumbent = createServer((request, response) => {
      if (request.url === "/api/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      response.writeHead(404); response.end();
    });
    const port = await listen(incumbent);
    const projectRoot = join(tempDir, "port collision fixture");
    const serverEntry = join(projectRoot, "apps", "server", "dist", "index.js");
    const webIndex = join(projectRoot, "apps", "web", "dist", "index.html");
    const childPidFile = join(projectRoot, "collision-child.pid");
    const browserMarker = join(tempDir, "browser-opened.txt");
    const wrapper = join(tempDir, "collision-wrapper.ps1");
    await mkdir(join(projectRoot, "apps", "server", "dist"), { recursive: true });
    await mkdir(join(projectRoot, "apps", "web", "dist"), { recursive: true });
    await writeFile(webIndex, "<!doctype html><title>collision fixture</title>");
    await writeFile(serverEntry, `
      const fs = require("node:fs");
      const http = require("node:http");
      const path = require("node:path");
      fs.writeFileSync(path.join(process.cwd(), "collision-child.pid"), String(process.pid));
      const server = http.createServer((_request, response) => response.end());
      server.on("error", () => setTimeout(() => process.exit(7), 1_000));
      server.listen(Number(process.env.PORT), process.env.HOST);
    `);
    const launcher = resolve(process.cwd(), "../../scripts/start-local.ps1");
    await writeFile(wrapper, `
      param([string]$Launcher, [string]$ProjectRoot, [string]$NodePath, [string]$EntryPath, [string]$Port)
      function Start-Process { param($FilePath) Set-Content -LiteralPath $env:LYJ_BROWSER_MARKER -Value $FilePath }
      & $Launcher -ProjectRoot $ProjectRoot -NodePath $NodePath -ServerEntryPath $EntryPath -Port $Port -HealthTimeoutSeconds 5
    `);

    try {
      let failure: unknown;
      try {
        await execFileAsync("powershell", [
          "-NoProfile", "-File", wrapper, "-Launcher", launcher, "-ProjectRoot", projectRoot,
          "-NodePath", process.execPath, "-EntryPath", serverEntry, "-Port", String(port)
        ], { env: { ...process.env, LYJ_BROWSER_MARKER: browserMarker }, timeout: 10_000 });
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ code: expect.any(Number) });
      expect(String((failure as { stdout?: string }).stdout ?? "")).not.toContain("LYJ Workbench is ready");
      await expect(readFile(browserMarker, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
      const childPid = Number(await readFile(childPidFile, "utf8"));
      expect(processExists(childPid)).toBe(false);
    } finally {
      await close(incumbent);
    }
  }, 15_000);
});
