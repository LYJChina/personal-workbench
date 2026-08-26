import type Database from "better-sqlite3";
import {
  AiConnectionIdSchema,
  AiConnectionSchema,
  type AiConnection,
  type AiConnectionCreate,
  type AiConnectionUpdate,
  type AiProviderProtocol
} from "@workbench/contracts";

interface AiConnectionRow {
  id: string;
  name: string;
  protocol: AiProviderProtocol;
  base_url: string;
  model: string;
  secret_name: string;
  is_default: number;
}

export interface AiConnectionRecord extends Omit<AiConnection, "apiKeyConfigured"> {
  secretName: string;
}

export const finalAiConnectionError = "At least one AI connection is required";
export const defaultAiConnectionError = "Switch the default AI connection before deleting it";
export const aiConnectionNotFoundError = "AI connection not found";

function recordFor(row: AiConnectionRow): AiConnectionRecord {
  return {
    id: AiConnectionIdSchema.parse(row.id),
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    model: row.model,
    secretName: row.secret_name,
    isDefault: Boolean(row.is_default)
  };
}

export class AiConnectionRepository {
  public constructor(private readonly database: Database.Database | (() => Database.Database)) {}

  public list(): AiConnectionRecord[] {
    return this.withDatabase((database) => (database.prepare(`
      SELECT id, name, protocol, base_url, model, secret_name, is_default
      FROM ai_connections
      ORDER BY is_default DESC, created_at, id
    `).all() as AiConnectionRow[]).map(recordFor));
  }

  public get(id: string): AiConnectionRecord | null {
    if (!AiConnectionIdSchema.safeParse(id).success) return null;
    return this.withDatabase((database) => {
      const row = database.prepare(`
        SELECT id, name, protocol, base_url, model, secret_name, is_default
        FROM ai_connections WHERE id = ?
      `).get(id) as AiConnectionRow | undefined;
      return row ? recordFor(row) : null;
    });
  }

  public getDefault(): AiConnectionRecord | null {
    return this.withDatabase((database) => {
      const row = database.prepare(`
        SELECT id, name, protocol, base_url, model, secret_name, is_default
        FROM ai_connections WHERE is_default = 1
      `).get() as AiConnectionRow | undefined;
      return row ? recordFor(row) : null;
    });
  }

  public create(id: string, input: AiConnectionCreate): AiConnectionRecord {
    const connectionId = AiConnectionIdSchema.parse(id);
    return this.withDatabase((database) => {
      const secretName = `ai-connection:${connectionId}:api-key`;
      database.prepare(`INSERT INTO ai_connections
        (id, name, protocol, base_url, model, secret_name, is_default)
        VALUES (?, ?, ?, ?, ?, ?, 0)`)
        .run(connectionId, input.name, input.protocol, input.baseUrl, input.model, secretName);
      return this.getFrom(database, connectionId);
    });
  }

  public update(id: string, input: AiConnectionUpdate): AiConnectionRecord {
    const connectionId = AiConnectionIdSchema.parse(id);
    return this.withDatabase((database) => {
      const result = database.prepare(`UPDATE ai_connections
        SET name = ?, protocol = ?, base_url = ?, model = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`)
        .run(input.name, input.protocol, input.baseUrl, input.model, connectionId);
      if (result.changes === 0) throw new Error(aiConnectionNotFoundError);
      return this.getFrom(database, connectionId);
    });
  }

  public setDefault(id: string): AiConnectionRecord {
    const connectionId = AiConnectionIdSchema.parse(id);
    return this.withDatabase((database) => database.transaction(() => {
      if (!database.prepare("SELECT 1 FROM ai_connections WHERE id = ?").get(connectionId)) {
        throw new Error(aiConnectionNotFoundError);
      }
      database.prepare("UPDATE ai_connections SET is_default = 0 WHERE is_default = 1").run();
      database.prepare("UPDATE ai_connections SET is_default = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(connectionId);
      return this.getFrom(database, connectionId);
    })());
  }

  public delete(id: string): { secretName: string } {
    const connectionId = AiConnectionIdSchema.parse(id);
    return this.withDatabase((database) => database.transaction(() => {
      const count = Number(database.prepare("SELECT COUNT(*) FROM ai_connections").pluck().get());
      if (count <= 1) throw new Error(finalAiConnectionError);
      const existing = this.getFrom(database, connectionId);
      if (existing.isDefault) throw new Error(defaultAiConnectionError);
      database.prepare("DELETE FROM ai_connections WHERE id = ?").run(connectionId);
      return { secretName: existing.secretName };
    })());
  }

  public assertDeletable(id: string): AiConnectionRecord {
    const connectionId = AiConnectionIdSchema.parse(id);
    return this.withDatabase((database) => {
      const existing = this.getFrom(database, connectionId);
      const count = Number(database.prepare("SELECT COUNT(*) FROM ai_connections").pluck().get());
      if (count <= 1) throw new Error(finalAiConnectionError);
      if (existing.isDefault) throw new Error(defaultAiConnectionError);
      return existing;
    });
  }

  private getFrom(database: Database.Database, id: string): AiConnectionRecord {
    const row = database.prepare(`
      SELECT id, name, protocol, base_url, model, secret_name, is_default
      FROM ai_connections WHERE id = ?
    `).get(id) as AiConnectionRow | undefined;
    if (!row) throw new Error(aiConnectionNotFoundError);
    return recordFor(row);
  }

  private withDatabase<T>(operation: (database: Database.Database) => T): T {
    if (typeof this.database !== "function") return operation(this.database);
    const database = this.database();
    try { return operation(database); }
    finally { database.close(); }
  }
}

export function publicAiConnection(record: AiConnectionRecord, apiKeyConfigured: boolean): AiConnection {
  const { secretName: _secretName, ...publicRecord } = record;
  return AiConnectionSchema.parse({ ...publicRecord, apiKeyConfigured });
}
