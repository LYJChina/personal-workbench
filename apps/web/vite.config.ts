import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolveDevApiTarget } from "./vite-dev-config";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: resolveDevApiTarget(loadEnv(mode, ".", "LYJ_").LYJ_WORKBENCH_API_PORT),
        changeOrigin: false
      }
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts"
  }
}));
