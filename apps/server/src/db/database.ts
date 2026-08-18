import { mkdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import type { AppPaths } from "../config/paths.js";

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
  return database;
}
