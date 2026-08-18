export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 3001;

export function resolveServerHost(value: string | undefined): string {
  const host = value ?? DEFAULT_SERVER_HOST;
  if (host !== DEFAULT_SERVER_HOST) {
    throw new Error("HOST must be exactly 127.0.0.1");
  }
  return host;
}

export function resolveServerPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_SERVER_PORT;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("PORT must be an integer from 1 through 65535");
  }
  return port;
}
