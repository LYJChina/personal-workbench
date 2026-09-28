import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(import.meta.resolve("tsx/cli"));
const child = spawn(process.execPath, [cli, "watch", "src/index.ts"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  stdio: "inherit",
  windowsHide: true
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
