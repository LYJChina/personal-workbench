import { Router } from "express";
import type { AppPaths } from "../../config/paths.js";
import { openDatabase } from "../../db/database.js";
import { bindRequestLifecycle, requestCanContinue } from "../../http/request-lifecycle.js";
import { GithubHolidayClient, type HolidayYearLoader } from "./holiday.client.js";
import { HolidayRepository } from "./holiday.repository.js";

function isDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function parseYears(value: unknown): number[] | null {
  if (!value || typeof value !== "object") return null;
  const years = (value as { years?: unknown }).years;
  if (!Array.isArray(years) || years.length < 1 || years.length > 2
      || years.some((year) => !Number.isInteger(year) || year < 2000 || year > 2200)) return null;
  return years as number[];
}

export function createHolidayRouter(paths: AppPaths, options: {
  loader?: HolidayYearLoader;
  now?: () => Date;
} = {}): Router {
  const router = Router();
  const now = options.now ?? (() => new Date());
  const loader = options.loader ?? ((year: number, signal?: AbortSignal) => new GithubHolidayClient().fetchYear(year, signal));

  router.get("/calendar", (request, response) => {
    const from = request.query.from;
    const to = request.query.to;
    if (!isDate(from) || !isDate(to) || from > to) {
      response.status(400).json({ error: { message: "Invalid calendar range", code: "VALIDATION_ERROR" } });
      return;
    }
    const database = openDatabase(paths);
    try {
      const repository = new HolidayRepository(database);
      response.json({ days: repository.list(from, to), coverage: repository.coverage() });
    } finally {
      database.close();
    }
  });

  router.post("/calendar/sync", async (request, response, next) => {
    const years = parseYears(request.body);
    if (!years) {
      response.status(400).json({ error: { message: "Invalid holiday years", code: "VALIDATION_ERROR" } });
      return;
    }
    let database: ReturnType<typeof openDatabase> | undefined;
    const signal = bindRequestLifecycle(request, response, () => database?.close());
    try {
      const updatedYears: number[] = [];
      const unavailableYears: number[] = [];
      const loaded: Array<{ year: number; days: Awaited<ReturnType<HolidayYearLoader>> }> = [];
      for (const year of years) {
        const days = await loader(year, signal);
        if (!requestCanContinue(request, response, signal)) return;
        loaded.push({ year, days });
      }
      if (!requestCanContinue(request, response, signal)) return;
      database = openDatabase(paths);
      const repository = new HolidayRepository(database);
      for (const { year, days } of loaded) {
        if (!requestCanContinue(request, response, signal)) return;
        if (!days) unavailableYears.push(year);
        else {
          repository.replaceYear(year, days, "bastengao/chinese-holidays-data", now());
          updatedYears.push(year);
        }
      }
      if (!requestCanContinue(request, response, signal)) return;
      response.json({ updatedYears, unavailableYears });
    } catch (error) {
      if (requestCanContinue(request, response, signal)) next(error);
    }
  });

  return router;
}
