import { useState } from "react";
import type { AiPolishKind, AiPolishRecord } from "@workbench/contracts";
import { Icon } from "../../app/Icon";
import { polishPresets, presetFor } from "./polishPresets";

const historyLabels: Record<AiPolishKind, string> = {
  daily_report: "历史日报",
  leadership: "历史给领导的话",
  translation: "历史翻译",
  general: "历史普通润色"
};

export function AiPolishHistory({ records, selectedKind, onSelectKind, onReopen, onSave }: {
  records: AiPolishRecord[];
  selectedKind: AiPolishKind;
  onSelectKind(kind: AiPolishKind): void;
  onReopen(record: AiPolishRecord): void;
  onSave(id: number, content: string): Promise<AiPolishRecord>;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const visibleRecords = records.filter((record) => record.kind === selectedKind);
  const selectedPreset = presetFor(selectedKind);

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

  return <section className="daily-report-history" aria-labelledby="ai-polish-history-heading">
    <div className="section-heading"><div><h3 id="ai-polish-history-heading">历史记录</h3><p>选择场景查看对应内容，记录仅保存在本机。</p></div><span className="count-badge">{visibleRecords.length} 条</span></div>
    <div className="history-kind-tabs" role="tablist" aria-label="历史记录类型">
      {polishPresets.map((preset) => <button className={selectedKind === preset.kind ? "active" : ""} role="tab" aria-selected={selectedKind === preset.kind} type="button" key={preset.kind} onClick={() => onSelectKind(preset.kind)}>{historyLabels[preset.kind]}</button>)}
    </div>
    {feedback && <p role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
    {visibleRecords.length === 0 ? <div className="empty-state compact"><Icon name="clock" size={24} /><strong>暂无{historyLabels[selectedPreset.kind]}</strong><span>第一次生成后，记录会出现在这里。</span></div> : <div className="daily-report-history-list">
      {visibleRecords.map((record) => <article key={record.id}>
        <time dateTime={record.createdAt}><Icon name="clock" size={15} />{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(record.createdAt))}</time>
        <p>{record.content.replace(/\s+/g, " ").slice(0, 100)}{record.content.length > 100 ? "…" : ""}</p>
        <div className="daily-report-actions"><button className="button-ghost" type="button" onClick={() => onReopen(record)}>重新打开</button><button className="button-ghost" type="button" onClick={() => { setEditingId(record.id); setDraft(record.content); setFeedback(null); }}><Icon name="edit" size={15} />编辑</button></div>
        {editingId === record.id && <div className="daily-report-editor"><label>编辑{selectedPreset.title}正文<textarea value={draft} onChange={(event) => setDraft(event.target.value)} /></label><button type="button" disabled={saving || !draft.trim()} onClick={() => void save()}>{saving ? "保存中…" : "保存修改"}</button><button type="button" disabled={saving} onClick={() => setEditingId(null)}>取消</button></div>}
      </article>)}
    </div>}
  </section>;
}
