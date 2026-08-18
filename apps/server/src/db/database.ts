import { mkdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import type { AppPaths } from "../config/paths.js";

interface TableColumn { name: string; }

function migrateAiPolishHistory(database: Database.Database): void {
  const columns = database.pragma("table_info(ai_polish_records)") as TableColumn[];
  if (!columns.some((column) => column.name === "legacy_daily_report_id")) {
    database.exec("ALTER TABLE ai_polish_records ADD COLUMN legacy_daily_report_id INTEGER");
  }
  database.transaction(() => {
    database.exec("CREATE UNIQUE INDEX IF NOT EXISTS ai_polish_records_legacy_report_idx ON ai_polish_records(legacy_daily_report_id)");
    database.exec(`INSERT OR IGNORE INTO ai_polish_records
      (legacy_daily_report_id, kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at)
      SELECT id, 'daily_report', completed, risks, '历史日报使用原日报提示词生成。', content, model, created_at, updated_at
      FROM daily_reports`);
  })();
}

export function openDatabase(paths: AppPaths): Database.Database {
  mkdirSync(paths.uploadsDir, { recursive: true });
  const database = new Database(paths.databasePath);
  database.pragma("foreign_keys = ON");
  let migrationUrl = new URL("./migrations/001_init.sql", import.meta.url);
  try {
    readFileSync(migrationUrl);
  } catch {
    migrationUrl = new URL("../../src/db/migrations/001_init.sql", import.meta.url);
  }
  database.exec(readFileSync(migrationUrl, "utf8"));
  migrateAiPolishHistory(database);
  return database;
}
