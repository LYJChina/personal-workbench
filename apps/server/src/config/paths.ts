import { join } from "node:path";

export interface AppPaths {
  dataDir: string;
  databasePath: string;
  uploadsDir: string;
  secretsDir: string;
}

export function resolveAppPaths(options: { dataDir?: string } = {}): AppPaths {
  const dataDir = options.dataDir ?? join(process.env.LOCALAPPDATA ?? process.env.APPDATA ?? ".", "LYJWorkBench");
  const uploadsDir = join(dataDir, "uploads");

  return {
    dataDir,
    databasePath: join(dataDir, "workbench.sqlite"),
    uploadsDir,
    secretsDir: join(dataDir, "secrets")
  };
}
