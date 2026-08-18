import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { resolveServerHost, resolveServerPort } from "./server-config.js";

const host = resolveServerHost(process.env.HOST);
const port = resolveServerPort(process.env.PORT);
const webDistDir = process.env.NODE_ENV === "production"
  ? fileURLToPath(new URL("../../web/dist/", import.meta.url))
  : undefined;

createApp({ webDistDir }).listen(port, host, () => {
  console.log(`LYJ Workbench server listening on http://${host}:${port}`);
});
