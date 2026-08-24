import {
  WORKBENCH_MUTATION_HEADER_NAME,
  WORKBENCH_MUTATION_HEADER_VALUE
} from "@workbench/contracts";
import type { NextFunction, Request, Response } from "express";

const stateChangingMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const forbiddenProxyHeaders = ["forwarded", "x-forwarded-host", "x-forwarded-server", "x-original-host"];
const forbiddenResponse = { error: { message: "Forbidden", code: "FORBIDDEN" } } as const;

function isValidPort(port: string): boolean {
  if (!/^[0-9]+$/.test(port)) return false;
  const numeric = Number(port);
  return numeric >= 1 && numeric <= 65_535;
}

function validHost(request: Request): boolean {
  const hostHeaders = request.rawHeaders.filter((_, index) => index % 2 === 0)
    .filter((name) => name.toLowerCase() === "host");
  if (hostHeaders.length !== 1) return false;
  const host = request.headers.host;
  if (typeof host !== "string") return false;
  const match = /^127\.0\.0\.1(?::([0-9]+))?$/.exec(host);
  return Boolean(match && (!match[1] || isValidPort(match[1])));
}

function validOrigin(origin: string): boolean {
  if (!/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(origin)) return false;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "http:"
      && parsed.hostname === "127.0.0.1"
      && isValidPort(parsed.port)
      && parsed.username === ""
      && parsed.password === ""
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === "";
  } catch {
    return false;
  }
}

export function enforceLocalRequestBoundary(request: Request, response: Response, next: NextFunction): void {
  const proxyOverride = forbiddenProxyHeaders.some((name) => request.headers[name] !== undefined);
  const origin = request.headers.origin;
  const invalidOrigin = origin !== undefined && (typeof origin !== "string" || !validOrigin(origin));
  const invalidMutation = /^\/api(?:\/|$)/i.test(request.path)
    && stateChangingMethods.has(request.method)
    && request.get(WORKBENCH_MUTATION_HEADER_NAME) !== WORKBENCH_MUTATION_HEADER_VALUE;

  if (!validHost(request) || proxyOverride || invalidOrigin || invalidMutation) {
    response.status(403).json(forbiddenResponse);
    return;
  }
  next();
}
