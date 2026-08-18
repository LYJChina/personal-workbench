import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { HealthResponseSchema } from "@workbench/contracts";
import { resolveAppPaths } from "./config/paths.js";
import { createProfileRouter, isPhotoUploadLimitError } from "./modules/profile/profile.routes.js";
import { createPreferencesRouter } from "./modules/preferences/preferences.routes.js";

export interface CreateAppOptions {
  dataDir?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const paths = resolveAppPaths(options);

  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json(HealthResponseSchema.parse({ status: "ok" }));
  });

  app.use("/api", createProfileRouter(paths));
  app.use("/api", createPreferencesRouter(paths));

  app.use((_request, response) => {
    response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (isPhotoUploadLimitError(error)) {
      response.status(413).json({ error: { message: "Profile photo must be 5 MB or smaller", code: "PAYLOAD_TOO_LARGE" } });
      return;
    }
    console.error(error instanceof Error ? error.message : "Unhandled server error");
    response.status(500).json({ error: { message: "Internal Server Error", code: "INTERNAL_ERROR" } });
  });

  return app;
}
