import type Database from "better-sqlite3";
import { AiPolishPromptSchema, AiPolishRecordSchema, type AiPolishInput, type AiPolishKind, type AiPolishPrompt, type AiPolishRecord } from "@workbench/contracts";

interface AiPolishRow {
  id: number;
  kind: string;
  primary_text: string;
  secondary_text: string;
  system_prompt: string;
  content: string;
  model: string;
  created_at: string;
  updated_at: string;
}

interface AiPolishPromptRow {
  kind: string;
  system_prompt: string;
  updated_at: string;
}

function mapRow(row: AiPolishRow): AiPolishRecord {
  return AiPolishRecordSchema.parse({
    id: row.id,
    kind: row.kind,
    primaryText: row.primary_text,
    secondaryText: row.secondary_text,
    systemPrompt: row.system_prompt,
    content: row.content,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

const selection = "id, kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at";

export class AiPolishRepository {
  public constructor(private readonly database: Database.Database) {}

  public create(input: AiPolishInput, result: { content: string; model: string }): AiPolishRecord {
    const timestamp = new Date().toISOString();
    const inserted = this.database.prepare(`INSERT INTO ai_polish_records
      (kind, primary_text, secondary_text, system_prompt, content, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(input.kind, input.primaryText, input.secondaryText, input.systemPrompt, result.content, result.model, timestamp, timestamp);
    return this.get(Number(inserted.lastInsertRowid)) as AiPolishRecord;
  }

  public list(): AiPolishRecord[] {
    return (this.database.prepare(`SELECT ${selection} FROM ai_polish_records ORDER BY created_at DESC, id DESC`).all() as AiPolishRow[]).map(mapRow);
  }

  public get(id: number): AiPolishRecord | null {
    const row = this.database.prepare(`SELECT ${selection} FROM ai_polish_records WHERE id = ?`).get(id) as AiPolishRow | undefined;
    return row ? mapRow(row) : null;
  }

  public updateContent(id: number, content: string): AiPolishRecord | null {
    const existing = this.get(id);
    if (!existing) return null;
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString();
    this.database.prepare("UPDATE ai_polish_records SET content = ?, updated_at = ? WHERE id = ?").run(content, updatedAt, id);
    return this.get(id);
  }

  public listPrompts(): AiPolishPrompt[] {
    const rows = this.database.prepare("SELECT kind, system_prompt, updated_at FROM ai_polish_prompts ORDER BY kind").all() as AiPolishPromptRow[];
    return rows.map((row) => AiPolishPromptSchema.parse({ kind: row.kind, systemPrompt: row.system_prompt, updatedAt: row.updated_at }));
  }

  public savePrompt(kind: AiPolishKind, systemPrompt: string): AiPolishPrompt {
    const updatedAt = new Date().toISOString();
    this.database.prepare(`INSERT INTO ai_polish_prompts (kind, system_prompt, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(kind) DO UPDATE SET system_prompt = excluded.system_prompt, updated_at = excluded.updated_at`
    ).run(kind, systemPrompt, updatedAt);
    const row = this.database.prepare("SELECT kind, system_prompt, updated_at FROM ai_polish_prompts WHERE kind = ?").get(kind) as AiPolishPromptRow;
    return AiPolishPromptSchema.parse({ kind: row.kind, systemPrompt: row.system_prompt, updatedAt: row.updated_at });
  }
}
