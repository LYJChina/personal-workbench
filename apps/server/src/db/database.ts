import { mkdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import type { AppPaths } from "../config/paths.js";

interface TableColumn { name: string; }
interface TableDefinition { sql: string | null; }

function migrateAiPolishKinds(database: Database.Database): void {
  const definition = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ai_polish_records'").get() as TableDefinition | undefined;
  if (!definition?.sql?.includes("CHECK") || definition.sql.includes("'custom'")) return;

  database.transaction(() => {
    database.exec(`
      DROP INDEX IF EXISTS ai_polish_records_kind_created_idx;
      DROP INDEX IF EXISTS ai_polish_records_legacy_report_idx;
      ALTER TABLE ai_polish_records RENAME TO ai_polish_records_before_custom;
      CREATE TABLE ai_polish_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('daily_report', 'leadership', 'translation', 'general', 'custom')),
        primary_text TEXT NOT NULL,
        secondary_text TEXT NOT NULL,
        system_prompt TEXT NOT NULL,
        content TEXT NOT NULL,
        model TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        legacy_daily_report_id INTEGER
      );
      INSERT INTO ai_polish_records
        (id, kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at, legacy_daily_report_id)
        SELECT id, kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at, legacy_daily_report_id
        FROM ai_polish_records_before_custom;
      DROP TABLE ai_polish_records_before_custom;
      CREATE INDEX ai_polish_records_kind_created_idx ON ai_polish_records(kind, created_at DESC, id DESC);
    `);
  })();
}

function migrateAiPolishHistory(database: Database.Database): void {
  const columns = database.pragma("table_info(ai_polish_records)") as TableColumn[];
  if (!columns.some((column) => column.name === "legacy_daily_report_id")) {
    database.exec("ALTER TABLE ai_polish_records ADD COLUMN legacy_daily_report_id INTEGER");
  }
  migrateAiPolishKinds(database);
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
