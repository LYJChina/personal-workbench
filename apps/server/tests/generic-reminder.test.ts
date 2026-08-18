import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";

describe("generic reminder migration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lyj-generic-reminder-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates generic reminder and holiday tables", () => {
    const database = openDatabase(resolveAppPaths({ dataDir: tempDir }));
    try {
      const tables = database.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'generic_reminders', 'generic_reminder_attempts',
          'generic_reminder_claims', 'holiday_calendar_days', 'holiday_calendar_syncs'
        ) ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(tables.map(({ name }) => name)).toEqual([
        "generic_reminder_attempts",
        "generic_reminder_claims",
        "generic_reminders",
        "holiday_calendar_days",
        "holiday_calendar_syncs"
      ]);
    } finally {
      database.close();
    }
  });
});
