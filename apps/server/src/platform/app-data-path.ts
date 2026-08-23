import { posix, win32 } from "node:path";

export interface DataDirEnvironment {
  readonly LOCALAPPDATA?: string;
  readonly APPDATA?: string;
}

export interface DefaultDataDirInput {
  readonly platform: NodeJS.Platform;
  readonly environment: DataDirEnvironment;
  readonly homeDir: string;
}

function nonBlank(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

export function resolveDefaultDataDir(input: DefaultDataDirInput): string {
  if (input.platform === "win32") {
    const base = nonBlank(input.environment.LOCALAPPDATA)
      ? input.environment.LOCALAPPDATA
      : input.environment.APPDATA;
    if (!nonBlank(base)) {
      throw new Error("Windows application data directory is unavailable");
    }
    return win32.join(base, "LYJWorkBench");
  }

  if (input.platform === "darwin") {
    if (!nonBlank(input.homeDir)) {
      throw new Error("macOS home directory is unavailable");
    }
    return posix.join(input.homeDir, "Library", "Application Support", "LYJWorkBench");
  }

  throw new Error(`Unsupported platform: ${input.platform}`);
}
