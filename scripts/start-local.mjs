import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const INSTANCE_HEADER = "X-LYJ-Workbench-Instance";
const CHILD_ENV_ALLOWLIST = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
  "LANG", "LC_ALL", "TZ", "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR"
]);

function parsePort(value) {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  return port;
}

export function parseStartArguments(argv) {
  let port = 3_001;
  let openBrowser = true;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--no-open") {
      openBrowser = false;
      continue;
    }
    if (argument === "--port") {
      port = parsePort(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error("Unknown launcher argument");
  }
  return { port, openBrowser };
}

export function browserCommand(platform, url) {
  const options = { stdio: "ignore", windowsHide: true, shell: false };
  if (platform === "win32") {
    return { command: "explorer.exe", args: [url], options };
  }
  if (platform === "darwin") {
    return { command: "open", args: [url], options };
  }
  throw new Error("Browser opening is unsupported on this platform");
}

function buildOperationalEnvironment(env) {
  const operationalEnv = {};
  const inheritedNames = new Set();
  for (const [key, value] of Object.entries(env)) {
    const normalizedKey = key.toUpperCase();
    if (
      value !== undefined &&
      CHILD_ENV_ALLOWLIST.has(normalizedKey) &&
      !inheritedNames.has(normalizedKey)
    ) {
      operationalEnv[key] = value;
      inheritedNames.add(normalizedKey);
    }
  }
  return operationalEnv;
}

export function buildChildEnvironment(env, { port, instanceToken }) {
  return {
    ...buildOperationalEnvironment(env),
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    LYJ_WORKBENCH_INSTANCE_TOKEN: instanceToken,
    LYJ_WORKBENCH_PARENT_IPC: "1"
  };
}

function childHasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

export async function waitForOwnedHealth(input) {
  const {
    url,
    instanceToken,
    child,
    timeoutMs,
    intervalMs = 200,
    fetchImpl = globalThis.fetch,
    sleep = (milliseconds) => new Promise((resolveWait) => setTimeout(resolveWait, milliseconds)),
    now = Date.now
  } = input;
  const deadline = now() + timeoutMs;
  let startupError = false;
  const onError = () => { startupError = true; };
  child.once?.("error", onError);

  try {
    while (now() < deadline) {
      if (startupError) throw new Error("Local server failed to start");
      if (childHasExited(child)) throw new Error("Local server exited before it became healthy");
      try {
        const requestTimeoutMs = Math.max(1, Math.min(2_000, deadline - now()));
        const response = await fetchImpl(url, {
          method: "GET",
          signal: AbortSignal.timeout(requestTimeoutMs)
        });
        const body = response.ok ? await response.json() : null;
        if (
          body?.status === "ok" &&
          response.headers.get(INSTANCE_HEADER) === instanceToken
        ) {
          return;
        }
      } catch {
        // A connection failure is expected while the owned server starts.
      }
      await sleep(intervalMs);
    }
    if (startupError) throw new Error("Local server failed to start");
    if (childHasExited(child)) throw new Error("Local server exited before it became healthy");
    throw new Error("Local server did not become healthy before the timeout");
  } finally {
    child.off?.("error", onError);
  }
}

function defaultSpawnServer({ projectRoot, serverEntry, env }) {
  return spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    env,
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: true,
    shell: false
  });
}

function defaultWaitForChildExit(child) {
  if (childHasExited(child)) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolveExit, rejectExit) => {
    const onError = () => {
      removeListeners();
      rejectExit(new Error("Local server process failed"));
    };
    const onExit = (code, signal) => {
      removeListeners();
      resolveExit({ code, signal });
    };
    const removeListeners = () => {
      child.off("error", onError);
      child.off("exit", onExit);
    };
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function defaultOpenBrowser(platform, url) {
  const { command, args, options } = browserCommand(platform, url);
  return new Promise((resolveOpen, rejectOpen) => {
    const opener = spawn(command, args, {
      ...options,
      env: buildOperationalEnvironment(process.env)
    });
    const onSpawn = () => {
      opener.off("error", onError);
      opener.unref();
      resolveOpen();
    };
    const onError = () => {
      opener.off("spawn", onSpawn);
      rejectOpen(new Error("Browser could not be opened"));
    };
    opener.once("spawn", onSpawn);
    opener.once("error", onError);
  });
}

function defaultSubscribeSignal(signal, handler) {
  process.on(signal, handler);
  return () => process.off(signal, handler);
}

export async function runLocalLauncher(options, dependencies = {}) {
  const spawnServer = dependencies.spawnServer ?? defaultSpawnServer;
  const checkOwnedHealth = dependencies.waitForOwnedHealth ?? waitForOwnedHealth;
  const openBrowser = dependencies.openBrowser ?? defaultOpenBrowser;
  const subscribeSignal = dependencies.subscribeSignal ?? defaultSubscribeSignal;
  const waitForChildExit = dependencies.waitForChildExit ?? defaultWaitForChildExit;
  const logReady = dependencies.logReady ?? console.log;
  const url = `http://127.0.0.1:${options.port}`;
  const env = buildChildEnvironment(options.env ?? {}, {
    port: options.port,
    instanceToken: options.instanceToken
  });
  const child = spawnServer({
    projectRoot: options.projectRoot,
    serverEntry: options.serverEntry,
    env
  });
  let cleanupPromise = null;
  let signalRequested = false;

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      if (!childHasExited(child)) child.kill();
      if (!childHasExited(child)) await waitForChildExit(child);
    })();
    return cleanupPromise;
  };
  const onSignal = () => {
    signalRequested = true;
    void cleanup();
  };
  const unsubscribeInt = subscribeSignal("SIGINT", onSignal);
  const unsubscribeTerm = subscribeSignal("SIGTERM", onSignal);

  try {
    await checkOwnedHealth({
      url: `${url}/api/health`,
      instanceToken: options.instanceToken,
      child,
      timeoutMs: options.healthTimeoutMs,
      intervalMs: options.healthIntervalMs
    });
    logReady(`LYJ Workbench is ready at ${url}`);
    if (options.openBrowser === true) {
      await openBrowser(options.platform, url);
    }
    const outcome = await waitForChildExit(child);
    if (!signalRequested && (outcome?.signal != null || outcome?.code !== 0)) {
      throw new Error("Local server exited unexpectedly");
    }
    return outcome;
  } finally {
    unsubscribeInt();
    unsubscribeTerm();
    await cleanup();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const parsed = parseStartArguments(argv);
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(scriptDir, "..");
  const serverEntry = resolve(projectRoot, "apps/server/dist/index.js");
  const webIndex = resolve(projectRoot, "apps/web/dist/index.html");
  await Promise.all([access(serverEntry), access(webIndex)]);
  return runLocalLauncher({
    ...parsed,
    projectRoot,
    serverEntry,
    webIndex,
    healthTimeoutMs: 30_000,
    healthIntervalMs: 200,
    env: process.env,
    platform: process.platform,
    instanceToken: randomBytes(16).toString("hex")
  });
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch(() => {
    console.error("Local launcher failed");
    process.exitCode = 1;
  });
}
