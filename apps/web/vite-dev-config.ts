const defaultApiPort = 3001;

export function resolveDevApiTarget(value: string | undefined): string {
  if (value === undefined) return `http://127.0.0.1:${defaultApiPort}`;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error("LYJ_WORKBENCH_API_PORT must be an integer from 1 through 65535");
  }
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("LYJ_WORKBENCH_API_PORT must be an integer from 1 through 65535");
  }
  return `http://127.0.0.1:${port}`;
}
