import { execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The launcher is intentionally a plain Node ESM entry point.
import * as launcher from "../../../scripts/start-local.mjs";

const {
  browserCommand,
  buildChildEnvironment,
  parseStartArguments,
  runLocalLauncher,
  waitForOwnedHealth
} = launcher;

const execFileAsync = promisify(execFile);

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP address");
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

function operationalTestEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  const allowed = new Set([
    "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR",
    "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "LANG", "LC_ALL", "TZ"
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allowed.has(key.toUpperCase())) result[key] = value;
  }
  return Object.assign(result, overrides);
}

async function waitForFile(path: string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  throw new Error("Fixture process did not start");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

class MockChild extends EventEmitter {
  public exitCode: number | null = null;
  public signalCode: NodeJS.Signals | null = null;
  public kill = vi.fn(() => {
    queueMicrotask(() => {
      this.signalCode = "SIGTERM";
      this.emit("exit", null, "SIGTERM");
    });
    return true;
  });
}

function launcherOptions(overrides: Record<string, unknown> = {}) {
  return {
    port: 43_123,
    openBrowser: true,
    projectRoot: "C:/fixture/workbench",
    serverEntry: "C:/fixture/workbench/apps/server/dist/index.js",
    webIndex: "C:/fixture/workbench/apps/web/dist/index.html",
    healthTimeoutMs: 100,
    healthIntervalMs: 1,
    env: {},
    platform: "win32",
    instanceToken: "owned-token",
    ...overrides
  };
}

function launcherDependencies(child: MockChild, overrides: Record<string, unknown> = {}) {
  return {
    spawnServer: vi.fn(() => child),
    waitForOwnedHealth: vi.fn(async () => undefined),
    openBrowser: vi.fn(async () => undefined),
    subscribeSignal: vi.fn(() => () => undefined),
    waitForChildExit: vi.fn(async () => {
      child.exitCode = 0;
      return { code: 0, signal: null };
    }),
    logReady: vi.fn(),
    ...overrides
  };
}

describe("cross-platform local launcher", () => {
  it("parses a validated port and --no-open", () => {
    expect(parseStartArguments(["--port", "43123", "--no-open"])).toEqual({
      port: 43_123,
      openBrowser: false
    });
    expect(parseStartArguments([])).toEqual({ port: 3_001, openBrowser: true });
  });

  it.each(["", "0", "65536", "3001.5", "not-a-port", " 3001", "3001 "])(
    "rejects invalid port %j",
    (port) => {
      expect(() => parseStartArguments(["--port", port])).toThrow(
        "PORT must be an integer from 1 through 65535"
      );
    }
  );

  it("rejects unknown or incomplete arguments", () => {
    expect(() => parseStartArguments(["--port"])).toThrow("PORT must be an integer");
    expect(() => parseStartArguments(["--mystery"])).toThrow("Unknown launcher argument");
  });

  it("uses direct hidden browser commands without a shell", () => {
    const url = "http://127.0.0.1:43123";
    expect(browserCommand("win32", url)).toEqual({
      command: "explorer.exe",
      args: [url],
      options: { stdio: "ignore", windowsHide: true, shell: false }
    });
    expect(browserCommand("darwin", url)).toEqual({
      command: "open",
      args: [url],
      options: { stdio: "ignore", windowsHide: true, shell: false }
    });
  });

  it("builds a case-insensitive operational allowlist and strips secrets", () => {
    const parentEnv = {
      Path: "C:/bin",
      HOME: "/Users/lyj",
      SystemRoot: "C:/Windows",
      LOCALAPPDATA: "C:/Users/lyj/AppData/Local",
      APPDATA: "C:/Users/lyj/AppData/Roaming",
      lang: "zh_CN.UTF-8",
      LYJ_SECRET_SENTINEL: "must-not-reach-child",
      deepseek_api_key: "provider-secret",
      SMTP_PASSWORD: "mail-secret",
      LYJ_WORKBENCH_PARENT_IPC: "forged-parent-value",
      WORKBENCH_ARBITRARY_SETTING: "must-not-reach-child"
    };

    const childEnv = buildChildEnvironment(parentEnv, {
      port: 43_123,
      instanceToken: "owned-token"
    });

    expect(childEnv.LOCALAPPDATA).toBe(parentEnv.LOCALAPPDATA);
    expect(childEnv.APPDATA).toBe(parentEnv.APPDATA);
    expect(childEnv).toMatchObject({
      Path: "C:/bin",
      HOME: "/Users/lyj",
      SystemRoot: "C:/Windows",
      lang: "zh_CN.UTF-8",
      NODE_ENV: "production",
      HOST: "127.0.0.1",
      PORT: "43123",
      LYJ_WORKBENCH_INSTANCE_TOKEN: "owned-token",
      LYJ_WORKBENCH_PARENT_IPC: "1"
    });
    expect(JSON.stringify(childEnv)).not.toMatch(
      /LYJ_SECRET_SENTINEL|DEEPSEEK_API_KEY|SMTP_PASSWORD|must-not-reach-child|provider-secret|mail-secret|forged-parent-value/i
    );
  });

  it("accepts health only when the launched instance token matches", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      headers: { get: (name: string) => name.toLowerCase() === "x-lyj-workbench-instance" ? "owned-token" : null },
      json: async () => ({ status: "ok" })
    }));

    await expect(waitForOwnedHealth({
      url: "http://127.0.0.1:43123/api/health",
      instanceToken: "owned-token",
      child: new MockChild(),
      timeoutMs: 20,
      intervalMs: 1,
      fetchImpl,
      sleep: async () => undefined
    })).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("times out when health is unavailable", async () => {
    let now = 0;
    await expect(waitForOwnedHealth({
      url: "http://127.0.0.1:43123/api/health",
      instanceToken: "owned-token",
      child: new MockChild(),
      timeoutMs: 2,
      intervalMs: 1,
      fetchImpl: vi.fn(async () => { throw new Error("connection refused secret"); }),
      sleep: async () => { now += 1; },
      now: () => now
    })).rejects.toThrow("Local server did not become healthy");
  });

  it("limits each health request to the remaining overall timeout budget", async () => {
    const startedAt = Date.now();
    await expect(waitForOwnedHealth({
      url: "http://127.0.0.1:43123/api/health",
      instanceToken: "owned-token",
      child: new MockChild(),
      timeoutMs: 25,
      intervalMs: 1,
      fetchImpl: vi.fn((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }))
    })).rejects.toThrow("Local server did not become healthy");
    expect(Date.now() - startedAt).toBeLessThan(300);
  });

  it("rejects foreign health when the launched child exits", async () => {
    const child = new MockChild();
    await expect(waitForOwnedHealth({
      url: "http://127.0.0.1:43123/api/health",
      instanceToken: "owned-token",
      child,
      timeoutMs: 20,
      intervalMs: 1,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        headers: { get: () => "incumbent-token" },
        json: async () => ({ status: "ok" })
      })),
      sleep: async () => {
        child.exitCode = 7;
      }
    })).rejects.toThrow("Local server exited before it became healthy");
  });

  it("kills and awaits the exact child after health failure without opening a browser", async () => {
    const child = new MockChild();
    const openBrowser = vi.fn();
    const dependencies = launcherDependencies(child, {
      waitForOwnedHealth: vi.fn(async () => { throw new Error("health failure secret"); }),
      openBrowser,
      waitForChildExit: vi.fn(() => new Promise((resolveExit) => child.once("exit", resolveExit)))
    });

    await expect(runLocalLauncher(launcherOptions(), dependencies)).rejects.toThrow("health failure secret");
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("cleans up a child that loses a collision to foreign health", async () => {
    const child = new MockChild();
    const openBrowser = vi.fn();
    const dependencies = launcherDependencies(child, {
      waitForOwnedHealth: vi.fn(async () => { throw new Error("foreign instance"); }),
      openBrowser,
      waitForChildExit: vi.fn(() => new Promise((resolveExit) => child.once("exit", resolveExit)))
    });

    await expect(runLocalLauncher(launcherOptions(), dependencies)).rejects.toThrow("foreign instance");
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it.each(["SIGINT", "SIGTERM"] as const)("terminates and awaits the exact child on %s", async (signal) => {
    const child = new MockChild();
    const handlers = new Map<string, () => void>();
    const waitForChildExit = vi.fn(() => new Promise((resolveExit) => child.once("exit", resolveExit)));
    const dependencies = launcherDependencies(child, {
      subscribeSignal: vi.fn((name: string, handler: () => void) => {
        handlers.set(name, handler);
        return () => handlers.delete(name);
      }),
      waitForChildExit
    });

    const running = runLocalLauncher(launcherOptions(), dependencies);
    await vi.waitFor(() => expect(handlers.has(signal)).toBe(true));
    handlers.get(signal)?.();
    await running;

    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(waitForChildExit).toHaveBeenCalledWith(child);
  });

  it("opens a browser once only after owned health succeeds", async () => {
    const child = new MockChild();
    const dependencies = launcherDependencies(child);

    await runLocalLauncher(launcherOptions(), dependencies);

    expect(dependencies.waitForOwnedHealth).toHaveBeenCalledTimes(1);
    expect(dependencies.openBrowser).toHaveBeenCalledTimes(1);
    expect(dependencies.openBrowser).toHaveBeenCalledWith("win32", "http://127.0.0.1:43123");
  });

  it("never opens a browser with --no-open", async () => {
    const child = new MockChild();
    const dependencies = launcherDependencies(child);

    await runLocalLauncher(launcherOptions({ openBrowser: false }), dependencies);

    expect(dependencies.openBrowser).not.toHaveBeenCalled();
  });

  it("treats an unexpected child signal after health as launcher failure", async () => {
    const child = new MockChild();
    const dependencies = launcherDependencies(child, {
      waitForChildExit: vi.fn(async () => {
        child.signalCode = "SIGTERM";
        return { code: null, signal: "SIGTERM" };
      })
    });

    await expect(runLocalLauncher(launcherOptions(), dependencies)).rejects.toThrow(
      "Local server exited unexpectedly"
    );
  });

  it("passes only the allowlisted child environment to the server spawn", async () => {
    const child = new MockChild();
    const dependencies = launcherDependencies(child);
    const env = { PATH: "C:/bin", SMTP_PASSWORD: "mail-secret", ARBITRARY: "must-not-reach-child" };

    await runLocalLauncher(launcherOptions({ env }), dependencies);

    expect(dependencies.spawnServer).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ PATH: "C:/bin", HOST: "127.0.0.1", PORT: "43123" })
    }));
    expect(JSON.stringify(dependencies.spawnServer.mock.calls)).not.toMatch(/mail-secret|must-not-reach-child/);
  });

  it("is safe to import without starting a server", async () => {
    const moduleUrl = pathToFileURL(resolve(process.cwd(), "../../scripts/start-local.mjs")).href;
    const result = await execFileAsync(process.execPath, ["--input-type=module", "--eval", `import(${JSON.stringify(moduleUrl)})`], {
      timeout: 5_000
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("does not orphan the real server child when the launcher is hard-terminated", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "lyj-node-launcher-"));
    const serverEntry = join(fixtureRoot, "server.mjs");
    const webIndex = join(fixtureRoot, "web", "index.html");
    const pidFile = join(fixtureRoot, "server.pid");
    const ipcFile = join(fixtureRoot, "server-ipc.txt");
    const port = await reservePort();
    await mkdir(join(fixtureRoot, "web"), { recursive: true });
    await writeFile(webIndex, "<!doctype html><title>launcher fixture</title>");
    await writeFile(serverEntry, `
      import { writeFileSync } from "node:fs";
      import { createServer } from "node:http";
      writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      writeFileSync(${JSON.stringify(ipcFile)}, String(process.connected));
      const server = createServer((request, response) => {
        if (request.url === "/api/health") {
          response.writeHead(200, {
            "Content-Type": "application/json",
            "X-LYJ-Workbench-Instance": process.env.LYJ_WORKBENCH_INSTANCE_TOKEN
          });
          response.end(JSON.stringify({ status: "ok" }));
          return;
        }
        response.writeHead(404); response.end();
      }).listen(Number(process.env.PORT), process.env.HOST);
      if (process.connected) {
        process.once("disconnect", () => server.close(() => process.exit(0)));
      }
    `);
    const moduleUrl = pathToFileURL(resolve(process.cwd(), "../../scripts/start-local.mjs")).href;
    const options = {
      port,
      openBrowser: false,
      projectRoot: fixtureRoot,
      serverEntry,
      webIndex,
      healthTimeoutMs: 5_000,
      healthIntervalMs: 20,
      env: process.env,
      platform: process.platform,
      instanceToken: "integration-owned-token"
    };
    const harness = spawn(process.execPath, [
      "--input-type=module",
      "--eval",
      `const { runLocalLauncher } = await import(${JSON.stringify(moduleUrl)}); await runLocalLauncher(${JSON.stringify(options)});`
    ], { stdio: "ignore", windowsHide: true });
    let serverPid = 0;

    try {
      serverPid = Number(await waitForFile(pidFile));
      expect(processExists(serverPid)).toBe(true);
      expect(await waitForFile(ipcFile)).toBe("true");
      harness.kill("SIGKILL");
      await new Promise((resolveExit) => harness.once("exit", resolveExit));

      const deadline = Date.now() + 3_000;
      while (processExists(serverPid) && Date.now() < deadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      expect(processExists(serverPid)).toBe(false);
      await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    } finally {
      if (processExists(harness.pid!)) harness.kill("SIGKILL");
      if (serverPid && processExists(serverPid)) process.kill(serverPid, "SIGKILL");
      const cleanupDeadline = Date.now() + 2_000;
      while (serverPid && processExists(serverPid) && Date.now() < cleanupDeadline) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 25));
      }
      await rm(fixtureRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, 10_000);

  it("shuts down the production server entry when its IPC parent disconnects", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "lyj-index-ipc-"));
    const port = await reservePort();
    const child = spawn(process.execPath, [
      "--import",
      "tsx/esm",
      resolve(process.cwd(), "src/index.ts")
    ], {
      cwd: process.cwd(),
      env: operationalTestEnvironment({
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(port),
        LOCALAPPDATA: fixtureRoot,
        HOME: fixtureRoot,
        LYJ_WORKBENCH_INSTANCE_TOKEN: "production-index-token",
        LYJ_WORKBENCH_PARENT_IPC: "1"
      }),
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      windowsHide: true
    });

    try {
      const deadline = Date.now() + 5_000;
      let ownedHealth = false;
      while (!ownedHealth && Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`);
          ownedHealth = response.headers.get("X-LYJ-Workbench-Instance") === "production-index-token";
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, 25));
        }
      }
      expect(ownedHealth).toBe(true);

      child.disconnect();
      const exit = await Promise.race([
        new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveExit) => {
          child.once("exit", (code, signal) => resolveExit({ code, signal }));
        }),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("production index did not exit")), 3_000))
      ]);
      expect(exit).toEqual({ code: 0, signal: null });
      await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
    } finally {
      if (processExists(child.pid!)) child.kill("SIGKILL");
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 10_000);

  it("rejects a real foreign health responder after the spawned child loses the port collision", async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), "lyj-node-collision-"));
    const pidFile = join(fixtureRoot, "collision.pid");
    const serverEntry = join(fixtureRoot, "collision.mjs");
    const port = await reservePort();
    const incumbent = createHttpServer((request, response) => {
      if (request.url === "/api/health") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "ok" }));
        return;
      }
      response.writeHead(404); response.end();
    });
    await new Promise<void>((resolveListen) => incumbent.listen(port, "127.0.0.1", resolveListen));
    await writeFile(serverEntry, `
      import { writeFileSync } from "node:fs";
      import { createServer } from "node:http";
      writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      const server = createServer((_request, response) => response.end());
      server.once("error", () => process.exit(7));
      server.listen(Number(process.env.PORT), process.env.HOST);
      if (process.connected) process.once("disconnect", () => process.exit(0));
    `);
    const options = {
      port,
      openBrowser: false,
      projectRoot: fixtureRoot,
      serverEntry,
      webIndex: join(fixtureRoot, "index.html"),
      healthTimeoutMs: 3_000,
      healthIntervalMs: 20,
      env: process.env,
      platform: process.platform,
      instanceToken: "collision-owned-token"
    };
    const launchResult = runLocalLauncher(options).then(
      (value: unknown) => ({ value, error: null }),
      (error: unknown) => ({ value: null, error })
    );
    let collisionPid = 0;

    try {
      collisionPid = Number(await waitForFile(pidFile));
      const outcome = await launchResult;
      expect(outcome.value).toBeNull();
      expect(outcome.error).toBeInstanceOf(Error);
      expect(processExists(collisionPid)).toBe(false);
    } finally {
      if (collisionPid && processExists(collisionPid)) process.kill(collisionPid, "SIGKILL");
      await new Promise<void>((resolveClose) => incumbent.close(() => resolveClose()));
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 10_000);

  it("prints only the fixed top-level error for invalid CLI input", async () => {
    const script = resolve(process.cwd(), "../../scripts/start-local.mjs");
    await expect(execFileAsync(process.execPath, [script, "--port", "smtp-password=mail-secret"], {
      timeout: 5_000
    })).rejects.toMatchObject({
      code: 1,
      stdout: "",
      stderr: "Local launcher failed\n"
    });
  });
});
