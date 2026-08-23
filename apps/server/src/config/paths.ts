import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDefaultDataDir } from "../platform/app-data-path.js";

export interface AppPaths {
  dataDir: string;
  databasePath: string;
  uploadsDir: string;
  secretsDir: string;
}

export function resolveAppPaths(options: { dataDir?: string } = {}): AppPaths {
  const dataDir = options.dataDir ?? resolveDefaultDataDir({
    platform: process.platform,
    environment: process.env,
    homeDir: homedir()
  });
  const uploadsDir = join(dataDir, "uploads");

  return {
    dataDir,
    databasePath: join(dataDir, "workbench.sqlite"),
    uploadsDir,
    secretsDir: join(dataDir, "secrets")
  };
}
