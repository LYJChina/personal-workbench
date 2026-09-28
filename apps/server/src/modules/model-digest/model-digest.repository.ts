import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  ModelDigestRunSchema,
  ModelDigestHistoryPageSchema,
  ModelDigestSettingsSchema,
  type ModelDigestHistoryPage,
  type ModelDigestProgressStage,
  type ModelDigestRun,
  type ModelDigestSettings,
  type ModelDigestSettingsUpdate,
  type ModelDigestSourceSnapshot
} from "@workbench/contracts";

interface RunRow {
  id: string;
  run_type: "scheduled" | "manual";
  status: ModelDigestRun["status"];
  scheduled_local_date: string | null;
  source_snapshots_json: string;
  progress_events_json: string;
  summary: string | null;
  deleted_at: string | null;
  recipient_ids_json: string;
  email_status: ModelDigestRun["emailStatus"];
  error_category: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

interface EmailRow { id: string; label: string; address: string; }

const schedule = { weekdays: [1, 2, 3, 4, 5], localTime: "09:00", timeZone: "Asia/Shanghai" } as const;

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function mapRun(row: RunRow): ModelDigestRun {
  return ModelDigestRunSchema.parse({
    id: row.id,
    type: row.run_type,
    status: row.status,
    scheduledLocalDate: row.scheduled_local_date,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    sourceSnapshots: parseJson<ModelDigestSourceSnapshot[]>(row.source_snapshots_json, []),
    progressEvents: parseJson<ModelDigestRun["progressEvents"]>(row.progress_events_json, []),
    summary: row.summary,
    deletedAt: row.deleted_at,
    recipientIds: parseJson<string[]>(row.recipient_ids_json, []),
    emailStatus: row.email_status,
    errorCategory: row.error_category
  });
}

export class ModelDigestRepository {
  public constructor(private readonly open: () => Database.Database) {}

  public getSettings(): ModelDigestSettings {
    const database = this.open();
    try {
      const row = database.prepare("SELECT enabled, recipient_ids_json FROM model_digest_settings WHERE id = 1").get() as { enabled: number; recipient_ids_json: string };
      return ModelDigestSettingsSchema.parse({ enabled: Boolean(row.enabled), recipientIds: parseJson<string[]>(row.recipient_ids_json, []), schedule });
    } finally { database.close(); }
  }

  public getEmails(): EmailRow[] {
    const database = this.open();
    try { return database.prepare("SELECT id, label, address FROM profile_emails WHERE profile_id = 1 ORDER BY position").all() as EmailRow[]; }
    finally { database.close(); }
  }

  public saveSettings(input: ModelDigestSettingsUpdate, now: Date): ModelDigestSettings {
    const database = this.open();
    try {
      const save = database.transaction(() => {
        const selected = input.recipientIds.length === 0 ? [] : database.prepare(
          `SELECT id FROM profile_emails WHERE profile_id = 1 AND id IN (${input.recipientIds.map(() => "?").join(",")})`
        ).all(...input.recipientIds) as Array<{ id: string }>;
        if (selected.length !== input.recipientIds.length) throw new Error("invalid_recipients");
        if (input.enabled && input.recipientIds.length === 0) throw new Error("recipients_required");
        database.prepare(`UPDATE model_digest_settings SET enabled = ?, recipient_ids_json = ?, updated_at = ? WHERE id = 1`)
          .run(Number(input.enabled), JSON.stringify(input.recipientIds), now.toISOString());
      });
      save();
      return this.getSettings();
    } finally { database.close(); }
  }

  public createRun(input: {
    type: ModelDigestRun["type"];
    recipientIds: string[];
    sendEmail: boolean;
    scheduledLocalDate: string | null;
    now: Date;
  }): ModelDigestRun | null {
    const database = this.open();
    try {
      const active = database.prepare("SELECT id FROM model_digest_runs WHERE status IN ('queued', 'fetching', 'summarizing', 'sending') LIMIT 1").get();
      if (active) return null;
      const id = randomUUID();
      try {
        database.prepare(`INSERT INTO model_digest_runs
          (id, run_type, status, scheduled_local_date, recipient_ids_json, send_email, email_status, created_at, progress_events_json)
          VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?)`)
          .run(id, input.type, input.scheduledLocalDate, JSON.stringify(input.recipientIds), Number(input.sendEmail),
            input.sendEmail ? "pending" : "not_requested", input.now.toISOString(),
            JSON.stringify([{ stage: "queued", message: "任务已创建，等待开始", at: input.now.toISOString() }]));
      } catch (error) {
        if ((error as { code?: string }).code?.includes("CONSTRAINT")) return null;
        throw error;
      }
      return this.getRun(id);
    } finally { database.close(); }
  }

  public hasScheduledRun(localDate: string): boolean {
    const database = this.open();
    try {
      return Boolean(database.prepare("SELECT 1 FROM model_digest_runs WHERE run_type = 'scheduled' AND scheduled_local_date = ? LIMIT 1").get(localDate));
    } finally { database.close(); }
  }

  public getRun(id: string): ModelDigestRun | null {
    const database = this.open();
    try {
      const row = database.prepare("SELECT * FROM model_digest_runs WHERE id = ? AND deleted_at IS NULL").get(id) as RunRow | undefined;
      return row ? mapRun(row) : null;
    } finally { database.close(); }
  }

  public getDeletedRun(id: string): ModelDigestRun | null {
    const database = this.open();
    try {
      const row = database.prepare("SELECT * FROM model_digest_runs WHERE id = ? AND deleted_at IS NOT NULL").get(id) as RunRow | undefined;
      return row ? mapRun(row) : null;
    } finally { database.close(); }
  }

  private listByDeletedState(limit: number, offset: number, deleted: boolean): ModelDigestHistoryPage {
    const database = this.open();
    try {
      const condition = deleted ? "deleted_at IS NOT NULL" : "deleted_at IS NULL";
      const rows = database.prepare(`SELECT id, run_type, status, created_at, finished_at, email_status, deleted_at,
        summary IS NOT NULL AS has_summary FROM model_digest_runs WHERE ${condition}
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(limit, offset) as Array<{
          id: string; run_type: ModelDigestRun["type"]; status: ModelDigestRun["status"];
          created_at: string; finished_at: string | null; email_status: ModelDigestRun["emailStatus"];
          deleted_at: string | null; has_summary: number;
        }>;
      const total = (database.prepare(`SELECT COUNT(*) AS count FROM model_digest_runs WHERE ${condition}`).get() as { count: number }).count;
      return ModelDigestHistoryPageSchema.parse({ items: rows.map((row) => ({
        id: row.id, type: row.run_type, status: row.status, createdAt: row.created_at,
        finishedAt: row.finished_at, emailStatus: row.email_status, deletedAt: row.deleted_at,
        hasSummary: Boolean(row.has_summary)
      })), total, limit, offset });
    } finally { database.close(); }
  }

  public listRuns(limit: number, offset: number): ModelDigestHistoryPage { return this.listByDeletedState(limit, offset, false); }
  public listDeletedRuns(limit: number, offset: number): ModelDigestHistoryPage { return this.listByDeletedState(limit, offset, true); }

  public addProgressEvent(id: string, stage: ModelDigestProgressStage, message: string, now: Date): void {
    const database = this.open();
    try {
      database.transaction(() => {
        const row = database.prepare("SELECT progress_events_json FROM model_digest_runs WHERE id = ? AND deleted_at IS NULL")
          .get(id) as { progress_events_json: string } | undefined;
        if (!row) throw new Error("run_not_found");
        const events = parseJson<ModelDigestRun["progressEvents"]>(row.progress_events_json, []);
        events.push({ stage, message, at: now.toISOString() });
        database.prepare("UPDATE model_digest_runs SET progress_events_json = ? WHERE id = ?").run(JSON.stringify(events), id);
      })();
    } finally { database.close(); }
  }

  public deleteRun(id: string, now: Date): boolean {
    const database = this.open();
    try {
      const row = database.prepare("SELECT status FROM model_digest_runs WHERE id = ? AND deleted_at IS NULL")
        .get(id) as { status: ModelDigestRun["status"] } | undefined;
      if (!row) return false;
      if (!["succeeded", "failed"].includes(row.status)) throw new Error("run_active");
      return database.prepare("UPDATE model_digest_runs SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
        .run(now.toISOString(), id).changes === 1;
    } finally { database.close(); }
  }

  public restoreRun(id: string): boolean {
    const database = this.open();
    try {
      return database.prepare("UPDATE model_digest_runs SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL")
        .run(id).changes === 1;
    } finally { database.close(); }
  }

  public getActiveRun(): ModelDigestRun | null {
    const database = this.open();
    try {
      const row = database.prepare("SELECT * FROM model_digest_runs WHERE deleted_at IS NULL AND status IN ('queued', 'fetching', 'summarizing', 'sending') ORDER BY created_at, id LIMIT 1").get() as RunRow | undefined;
      return row ? mapRun(row) : null;
    } finally { database.close(); }
  }

  public latestRun(): ModelDigestRun | null {
    const database = this.open();
    try {
      const row = database.prepare("SELECT * FROM model_digest_runs WHERE deleted_at IS NULL ORDER BY created_at DESC, id DESC LIMIT 1").get() as RunRow | undefined;
      return row ? mapRun(row) : null;
    } finally { database.close(); }
  }

  public latestSuccessfulRun(): ModelDigestRun | null {
    const database = this.open();
    try {
      const row = database.prepare("SELECT * FROM model_digest_runs WHERE deleted_at IS NULL AND summary IS NOT NULL AND status IN ('succeeded', 'failed') ORDER BY created_at DESC, id DESC LIMIT 1").get() as RunRow | undefined;
      return row ? mapRun(row) : null;
    } finally { database.close(); }
  }

  public updateRun(id: string, patch: Partial<Pick<ModelDigestRun, "status" | "sourceSnapshots" | "summary" | "emailStatus" | "errorCategory" | "startedAt" | "finishedAt">>): ModelDigestRun {
    const current = this.getRun(id);
    if (!current) throw new Error("run_not_found");
    const next = ModelDigestRunSchema.parse({ ...current, ...patch });
    const database = this.open();
    try {
      database.prepare(`UPDATE model_digest_runs SET status = ?, source_snapshots_json = ?, summary = ?,
        email_status = ?, error_category = ?, started_at = ?, finished_at = ? WHERE id = ?`)
        .run(next.status, JSON.stringify(next.sourceSnapshots), next.summary, next.emailStatus,
          next.errorCategory, next.startedAt, next.finishedAt, id);
      return next;
    } finally { database.close(); }
  }

  public markInterruptedRuns(now: Date): void {
    const database = this.open();
    try {
      database.transaction(() => {
        const rows = database.prepare(`SELECT id, progress_events_json FROM model_digest_runs
          WHERE status IN ('queued', 'fetching', 'summarizing', 'sending')`).all() as Array<{ id: string; progress_events_json: string }>;
        const update = database.prepare(`UPDATE model_digest_runs SET status = 'failed', error_category = 'interrupted',
          email_status = CASE WHEN email_status = 'pending' THEN 'failed' ELSE email_status END,
          finished_at = ?, progress_events_json = ? WHERE id = ?`);
        for (const row of rows) {
          const events = parseJson<ModelDigestRun["progressEvents"]>(row.progress_events_json, []);
          events.push({ stage: "failed", message: "服务重启，本次任务已中断", at: now.toISOString() });
          update.run(now.toISOString(), JSON.stringify(events), row.id);
        }
      })();
    } finally { database.close(); }
  }
}
