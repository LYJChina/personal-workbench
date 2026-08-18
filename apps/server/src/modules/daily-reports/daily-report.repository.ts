import type Database from "better-sqlite3";
import { DailyReportSchema, type DailyReport, type DailyReportInput } from "@workbench/contracts";

interface DailyReportRow {
  id: number;
  completed: string;
  risks: string;
  content: string;
  model: string;
  created_at: string;
  updated_at: string;
}

function mapRow(row: DailyReportRow): DailyReport {
  return DailyReportSchema.parse({
    id: row.id,
    completed: row.completed,
    risks: row.risks,
    content: row.content,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

export class DailyReportRepository {
  public constructor(private readonly database: Database.Database) {}

  public create(input: DailyReportInput, result: { content: string; model: string }): DailyReport {
    const timestamp = new Date().toISOString();
    const inserted = this.database.prepare(
      "INSERT INTO daily_reports (completed, risks, content, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(input.completed, input.risks, result.content, result.model, timestamp, timestamp);
    return this.get(Number(inserted.lastInsertRowid)) as DailyReport;
  }

  public list(): DailyReport[] {
    const rows = this.database.prepare(
      "SELECT id, completed, risks, content, model, created_at, updated_at FROM daily_reports ORDER BY created_at DESC, id DESC"
    ).all() as DailyReportRow[];
    return rows.map(mapRow);
  }

  public get(id: number): DailyReport | null {
    const row = this.database.prepare(
      "SELECT id, completed, risks, content, model, created_at, updated_at FROM daily_reports WHERE id = ?"
    ).get(id) as DailyReportRow | undefined;
    return row ? mapRow(row) : null;
  }

  public updateContent(id: number, content: string): DailyReport | null {
    const existing = this.get(id);
    if (!existing) return null;
    const now = Date.now();
    const prior = Date.parse(existing.updatedAt);
    const updatedAt = new Date(Number.isFinite(prior) && now <= prior ? prior + 1 : now).toISOString();
    this.database.prepare("UPDATE daily_reports SET content = ?, updated_at = ? WHERE id = ?").run(content, updatedAt, id);
    return this.get(id);
  }
}
