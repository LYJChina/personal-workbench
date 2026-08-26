import type Database from "better-sqlite3";
import type { AiPersonaSettings, AiPersonaSettingsUpdate } from "@workbench/contracts";

const key = "ai-persona-settings";
const defaults: AiPersonaSettingsUpdate = { assistantName: "AI", personalityPrompt: "你是一名稳妥、清晰、简洁的个人办公助手。", profilePortrait: "", systemPrompt: "" };
export class AiPersonaRepository {
  public constructor(private readonly database: Database.Database) {}
  public get(): AiPersonaSettings {
    const row = this.database.prepare("SELECT value, updated_at FROM app_settings WHERE key = ?").get(key) as { value: string; updated_at: string } | undefined;
    if (!row) return { ...defaults, updatedAt: new Date(0).toISOString() };
    try { return { ...defaults, ...JSON.parse(row.value), updatedAt: row.updated_at }; } catch { return { ...defaults, updatedAt: row.updated_at }; }
  }
  public update(input: AiPersonaSettingsUpdate): AiPersonaSettings {
    this.database.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").run(key, JSON.stringify(input));
    return this.get();
  }
}
