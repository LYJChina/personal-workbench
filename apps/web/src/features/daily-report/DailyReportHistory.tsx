import { useState } from "react";
import type { DailyReport } from "@workbench/contracts";

interface DailyReportHistoryProps {
  reports: DailyReport[];
  onReopen(report: DailyReport): void;
  onSave(id: number, content: string): Promise<DailyReport>;
}

function displayDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function preview(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 80)}…` : compact;
}

export function DailyReportHistory({ reports, onReopen, onSave }: DailyReportHistoryProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  function beginEdit(report: DailyReport) {
    setEditingId(report.id);
    setDraft(report.content);
    setFeedback(null);
  }

  async function save() {
    if (editingId === null || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await onSave(editingId, draft);
      setEditingId(null);
      setFeedback({ kind: "success", message: "修改已保存" });
    } catch (error) {
      setFeedback({ kind: "error", message: error instanceof Error ? error.message : "保存失败，请重试" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="daily-report-history" aria-labelledby="daily-report-history-heading">
      <h3 id="daily-report-history-heading">历史日报</h3>
      {feedback && <p role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
      {reports.length === 0 ? <p>暂无历史日报</p> : (
        <div className="daily-report-history-list">
          {reports.map((report) => (
            <article key={report.id}>
              <time dateTime={report.createdAt}>{displayDate(report.createdAt)}</time>
              <p>{preview(report.content)}</p>
              <div className="daily-report-actions">
                <button type="button" onClick={() => onReopen(report)}>重新打开</button>
                <button type="button" onClick={() => beginEdit(report)}>编辑</button>
              </div>
              {editingId === report.id && (
                <div className="daily-report-editor">
                  <label>编辑日报正文<textarea value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
                  <button type="button" disabled={saving || !draft.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存修改"}</button>
                  <button type="button" disabled={saving} onClick={() => setEditingId(null)}>取消</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
