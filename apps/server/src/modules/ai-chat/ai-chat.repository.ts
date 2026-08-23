import type Database from "better-sqlite3";
import type { AiChatMessage, AiChatRole } from "@workbench/contracts";

interface AiChatMessageRow {
  id: number;
  role: AiChatRole;
  content: string;
  model: string | null;
  created_at: string;
}

function mapRow(row: AiChatMessageRow): AiChatMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    model: row.model,
    createdAt: row.created_at
  };
}

const selection = "id, role, content, model, created_at";

export class AiChatRepository {
  public constructor(private readonly database: Database.Database) {}

  public list(): AiChatMessage[] {
    return (this.database.prepare(`SELECT ${selection} FROM ai_chat_messages ORDER BY id`).all() as AiChatMessageRow[]).map(mapRow);
  }

  public create(role: AiChatRole, content: string, model: string | null): AiChatMessage {
    const inserted = this.database.prepare("INSERT INTO ai_chat_messages (role, content, model) VALUES (?, ?, ?)").run(role, content, model);
    const row = this.database.prepare(`SELECT ${selection} FROM ai_chat_messages WHERE id = ?`).get(inserted.lastInsertRowid) as AiChatMessageRow;
    return mapRow(row);
  }

  public clear(): void {
    this.database.prepare("DELETE FROM ai_chat_messages").run();
  }
}
