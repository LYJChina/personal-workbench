import { useEffect, useState } from "react";
import type {
  GenericReminder, GenericReminderAttempt, GenericReminderInput,
  ReminderLifecycle, ReminderTestResult
} from "@workbench/contracts";
import { api as sharedApi } from "../../lib/api";
import { ReminderEditor } from "./ReminderEditor";
import { ReminderList } from "./ReminderList";
import { ReminderHistory } from "./ReminderHistory";

export interface ReminderCenterApi {
  listReminders(): Promise<{ items: GenericReminder[] }>;
  createReminder(input: GenericReminderInput): Promise<GenericReminder>;
  updateReminder(id: string, input: GenericReminderInput): Promise<GenericReminder>;
  deleteReminder(id: string): Promise<void>;
  listAttempts(): Promise<{ items: GenericReminderAttempt[] }>;
  testReminder(id: string): Promise<ReminderTestResult>;
}

const defaultApi: ReminderCenterApi = {
  listReminders: sharedApi.listReminders,
  createReminder: sharedApi.createGenericReminder,
  updateReminder: sharedApi.updateGenericReminder,
  deleteReminder: sharedApi.deleteGenericReminder,
  listAttempts: sharedApi.listReminderAttempts,
  testReminder: sharedApi.testGenericReminder
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

export function ReminderPage({ api = defaultApi }: { api?: ReminderCenterApi }) {
  const [reminders, setReminders] = useState<GenericReminder[]>([]);
  const [attempts, setAttempts] = useState<GenericReminderAttempt[]>([]);
  const [filter, setFilter] = useState<"all" | ReminderLifecycle>("all");
  const [view, setView] = useState<"pending" | "history">("pending");
  const [editing, setEditing] = useState<GenericReminder | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function reload() {
    const [reminderResult, attemptResult] = await Promise.all([api.listReminders(), api.listAttempts()]);
    setReminders(reminderResult.items);
    setAttempts(attemptResult.items);
  }

  useEffect(() => {
    let active = true;
    Promise.all([api.listReminders(), api.listAttempts()])
      .then(([reminderResult, attemptResult]) => {
        if (!active) return;
        setReminders(reminderResult.items);
        setAttempts(attemptResult.items);
        const selectedId = new URLSearchParams(window.location.search).get("selected");
        const selected = reminderResult.items.find((item) => item.id === selectedId);
        if (selected) setEditing(selected);
      })
      .catch((error: unknown) => active && setFeedback({ kind: "error", text: message(error) }))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api]);

  async function save(input: GenericReminderInput) {
    if (editing) await api.updateReminder(editing.id, input);
    else await api.createReminder(input);
    await reload();
    setEditing(undefined);
    setFeedback({ kind: "success", text: "提醒已保存" });
  }

  async function remove(reminder: GenericReminder) {
    if (!window.confirm(`确定删除“${reminder.name}”吗？`)) return;
    try {
      await api.deleteReminder(reminder.id);
      await reload();
      setFeedback({ kind: "success", text: "提醒已删除" });
    } catch (error) {
      setFeedback({ kind: "error", text: message(error) });
    }
  }

  async function test(reminder: GenericReminder) {
    try {
      const result = await api.testReminder(reminder.id);
      setFeedback({ kind: result.status === "success" ? "success" : "error", text: result.status === "success" ? result.message : `${result.message}（${result.category}）` });
    } catch (error) {
      setFeedback({ kind: "error", text: message(error) });
    }
  }

  if (loading) return <section className="page-loading"><span className="spinner" />正在加载提醒事项…</section>;

  return <section className="reminder-page reminder-center-page">
    <header className="page-heading reminder-center-heading"><div><span className="eyebrow">REMINDERS</span><h2>提醒事项</h2><p>管理提醒计划；计划不会自动发送邮件，需要时请手动测试发送。</p></div><div className="heading-actions"><button type="button" className="button-primary" onClick={() => setEditing(null)}>新建提醒</button></div></header>
    {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} className={`feedback-banner ${feedback.kind}`}>{feedback.text}</p>}
    <div className="reminder-workspace">
      <div className="reminder-workspace-topbar">
        <div className="reminder-view-tabs" role="tablist" aria-label="提醒视图">
          <button type="button" role="tab" aria-selected={view === "pending"} className={view === "pending" ? "active" : ""} onClick={() => setView("pending")}>
            <span>提醒计划</span><strong>{reminders.length}</strong>
          </button>
          <button type="button" role="tab" aria-selected={view === "history"} className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
            <span>历史发送记录</span><strong>{attempts.length}</strong>
          </button>
        </div>
        <p>{view === "pending" ? "按计划时间查看和管理提醒元数据" : "查看每一次手动邮件发送结果"}</p>
      </div>
      {view === "pending"
        ? <ReminderList reminders={reminders} filter={filter} onFilter={setFilter} onEdit={setEditing} onDelete={(item) => void remove(item)} onTest={(item) => void test(item)} />
        : <ReminderHistory attempts={attempts} />}
    </div>
    {editing !== undefined && <ReminderEditor reminder={editing} onSave={save} onClose={() => setEditing(undefined)} />}
  </section>;
}
