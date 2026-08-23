import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const SERVER_DIST_DIRECTORY = join(projectRoot, "apps", "server", "dist");

export async function cleanServerDist({ remove = rm } = {}) {
  await remove(SERVER_DIST_DIRECTORY, { recursive: true, force: true });
}

const entryUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryUrl === import.meta.url) {
  const arguments_ = process.argv.slice(2);
  const operation = arguments_.length === 0
    ? cleanServerDist()
    : Promise.reject(new Error("Server build cleanup accepts no arguments"));
  operation.catch(() => {
    console.error("Server build cleanup failed");
    process.exitCode = 1;
  });
}
