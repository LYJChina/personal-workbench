// @vitest-environment node

import { createServer as createHttpServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer as createViteServer, type ViteDevServer } from "vite";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return (server.address() as AddressInfo).port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
}

describe("loopback development proxy", () => {
  let apiServer: Server | undefined;
  let viteServer: ViteDevServer | undefined;
  const originalApiPort = process.env.LYJ_WORKBENCH_API_PORT;

  afterEach(async () => {
    if (viteServer) await viteServer.close();
    if (apiServer) await close(apiServer);
    viteServer = undefined;
    apiServer = undefined;
    if (originalApiPort === undefined) delete process.env.LYJ_WORKBENCH_API_PORT;
    else process.env.LYJ_WORKBENCH_API_PORT = originalApiPort;
  });

  it("defaults and overrides only the port of the exact loopback API target", async () => {
    const { resolveDevApiTarget } = await import("../vite-dev-config");

    expect(resolveDevApiTarget(undefined)).toBe("http://127.0.0.1:3001");
    expect(resolveDevApiTarget("43123")).toBe("http://127.0.0.1:43123");
  });

  it.each(["", "0", "65536", "3001.5", "localhost:3001", "http://192.168.1.20:3001", " 3001", "3001 "])(
    "rejects the malformed or non-port development override %j",
    async (value) => {
      const { resolveDevApiTarget } = await import("../vite-dev-config");
      expect(() => resolveDevApiTarget(value)).toThrow("LYJ_WORKBENCH_API_PORT must be an integer from 1 through 65535");
    }
  );

  it("forwards a real Vite-origin health request to the controlled loopback API", async () => {
    const observedPaths: string[] = [];
    apiServer = createHttpServer((request, response) => {
      observedPaths.push(request.url ?? "");
      response.writeHead(200, { "Content-Type": "application/json", "X-Controlled-Api": "reached" });
      response.end(JSON.stringify({ status: "ok", source: "controlled-api" }));
    });
    const apiPort = await listen(apiServer);
    process.env.LYJ_WORKBENCH_API_PORT = String(apiPort);

    viteServer = await createViteServer({
      root: resolve(process.cwd()),
      configFile: resolve(process.cwd(), "vite.config.ts"),
      configLoader: "runner",
      logLevel: "silent",
      server: { host: "127.0.0.1", port: 0, strictPort: true }
    });
    await viteServer.listen();
    const vitePort = (viteServer.httpServer!.address() as AddressInfo).port;

    const response = await fetch(`http://127.0.0.1:${vitePort}/api/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-controlled-api")).toBe("reached");
    expect(await response.json()).toEqual({ status: "ok", source: "controlled-api" });
    expect(observedPaths).toEqual(["/api/health"]);
  });
});
