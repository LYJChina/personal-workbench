import { useEffect, useState } from "react";
import type {
  GenericReminder, GenericReminderAttempt, GenericReminderInput,
  ReminderLifecycle, ReminderTestResult, SchedulerStatus
} from "@workbench/contracts";
import { api as sharedApi } from "../../lib/api";
import { Icon } from "../../app/Icon";
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
  getSchedulerStatus(): Promise<SchedulerStatus>;
  syncScheduler(): Promise<SchedulerStatus>;
}

const defaultApi: ReminderCenterApi = {
  listReminders: sharedApi.listReminders,
  createReminder: sharedApi.createGenericReminder,
  updateReminder: sharedApi.updateGenericReminder,
  deleteReminder: sharedApi.deleteGenericReminder,
  listAttempts: sharedApi.listReminderAttempts,
  testReminder: sharedApi.testGenericReminder,
  getSchedulerStatus: sharedApi.getReminderSchedulerStatus,
  syncScheduler: sharedApi.syncReminderScheduler
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

function schedulerTime(value: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}年${Number(parts.month)}月${Number(parts.day)}日 ${parts.hour}:${parts.minute}`;
}

export function ReminderPage({ api = defaultApi }: { api?: ReminderCenterApi }) {
  const [reminders, setReminders] = useState<GenericReminder[]>([]);
  const [attempts, setAttempts] = useState<GenericReminderAttempt[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerStatus | null>(null);
  const [filter, setFilter] = useState<"all" | ReminderLifecycle>("all");
  const [editing, setEditing] = useState<GenericReminder | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function reload() {
    const [reminderResult, attemptResult] = await Promise.all([api.listReminders(), api.listAttempts()]);
    setReminders(reminderResult.items);
    setAttempts(attemptResult.items);
  }

  useEffect(() => {
    let active = true;
    Promise.all([api.listReminders(), api.listAttempts(), api.getSchedulerStatus()])
      .then(([reminderResult, attemptResult, status]) => {
        if (!active) return;
        setReminders(reminderResult.items);
        setAttempts(attemptResult.items);
        setScheduler(status);
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

  async function synchronize() {
    setSyncing(true);
    setFeedback(null);
    try {
      const status = await api.syncScheduler();
      setScheduler(status);
      setFeedback({ kind: status.synchronized ? "success" : "error", text: status.message });
    } catch (error) {
      setFeedback({ kind: "error", text: message(error) });
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <section className="page-loading"><span className="spinner" />正在加载提醒事项…</section>;

  return <section className="reminder-page reminder-center-page">
    <header className="page-heading reminder-center-heading"><div><span className="eyebrow">AUTOMATION</span><h2>提醒事项</h2><p>管理一次性、有限次数和常驻邮件提醒。</p></div><div className="heading-actions"><button type="button" className="button-secondary" disabled={syncing} onClick={() => void synchronize()}><Icon name="clock" size={17} />{syncing ? "同步中…" : "同步系统计划"}</button><button type="button" className="button-primary" onClick={() => setEditing(null)}>新建提醒</button></div></header>
    <div className={`scheduler-banner ${scheduler?.synchronized ? "success" : "warning"}`}><div><strong>{scheduler?.synchronized ? "系统计划已同步" : "系统计划尚未同步"}</strong><p>{scheduler?.message ?? "无法读取系统计划状态"}</p>{scheduler?.nextRun && <p>下次执行：{schedulerTime(scheduler.nextRun)}</p>}</div><span className="status-chip neutral">{scheduler?.taskName ?? "LYJWorkBench-ReminderRunner"}</span></div>
    {feedback && <p role={feedback.kind === "error" ? "alert" : "status"} className={`feedback-banner ${feedback.kind}`}>{feedback.text}</p>}
    <div className="reminder-center-grid">
      <ReminderList reminders={reminders} filter={filter} onFilter={setFilter} onEdit={setEditing} onDelete={(item) => void remove(item)} onTest={(item) => void test(item)} />
      <ReminderHistory attempts={attempts} />
    </div>
    {editing !== undefined && <ReminderEditor reminder={editing} onSave={save} onClose={() => setEditing(undefined)} />}
  </section>;
}
