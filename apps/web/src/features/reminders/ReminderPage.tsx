import { useEffect, useState, type FormEvent } from "react";
import type { Reminder, ReminderTestResult, ReminderUpdate } from "@workbench/contracts";
import { api as defaultApi } from "../../lib/api";
import { Icon } from "../../app/Icon";

export interface ReminderApi {
  getReminder(): Promise<Reminder>;
  updateReminder(input: ReminderUpdate): Promise<Reminder>;
  testReminder(): Promise<ReminderTestResult>;
}

interface ReminderPageProps {
  api?: ReminderApi;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

function formatDateTime(value: string | null): string {
  if (!value) return "暂无";
  return new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export function ReminderPage({ api: reminderApi = defaultApi }: ReminderPageProps) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [form, setForm] = useState<ReminderUpdate | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    reminderApi.getReminder()
      .then((loaded) => {
        if (!active) return;
        setReminder(loaded);
        setForm({
          enabled: loaded.enabled,
          localTime: loaded.localTime,
          recipient: loaded.recipient,
          subject: loaded.subject,
          body: loaded.body
        });
      })
      .catch((error: unknown) => {
        if (active) setFeedback({ kind: "error", message: errorMessage(error) });
      });
    return () => { active = false; };
  }, [reminderApi]);

  function update<K extends keyof ReminderUpdate>(key: K, value: ReminderUpdate[K]) {
    setForm((current) => current ? { ...current, [key]: value } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      const saved = await reminderApi.updateReminder(form);
      setReminder(saved);
      setFeedback({ kind: "success", message: "提醒设置已保存" });
    } catch (error) {
      setFeedback({ kind: "error", message: errorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    if (testing) return;
    setTesting(true);
    setFeedback(null);
    try {
      const result = await reminderApi.testReminder();
      setFeedback(result.status === "success"
        ? { kind: "success", message: result.message }
        : { kind: "error", message: `${result.message}（${result.category}）` });
    } catch (error) {
      setFeedback({ kind: "error", message: errorMessage(error) });
    } finally {
      setTesting(false);
    }
  }

  if (!form || !reminder) return <section className="page-loading">{feedback && <p role="alert">{feedback.message}</p>}<span className="spinner" />正在加载提醒设置…</section>;

  return (
    <section className="reminder-page">
      <header>
        <div className="page-heading"><div><span className="eyebrow">AUTOMATION</span><h2>外勤打卡邮件提醒</h2><p>每周一由本机任务计划程序发送，网页关闭时也能准时运行。</p></div><span className={`status-chip ${form.enabled ? "" : "neutral"}`}>{form.enabled ? "运行中" : "未启用"}</span></div>
      </header>
      <div className="reminder-layout"><form className="reminder-form" onSubmit={save}>
        <div className="toggle-row"><div><strong>启用每周一提醒</strong><span>系统会在设定时间发送邮件</span></div><label className="switch"><input aria-label="启用每周一提醒" type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span /></label></div>
        <label>收件邮箱<input type="email" required value={form.recipient} onChange={(event) => update("recipient", event.target.value)} /></label>
        <label>提醒时间<input type="time" required value={form.localTime} onChange={(event) => update("localTime", event.target.value)} /></label>
        <label>邮件主题<input required value={form.subject} onChange={(event) => update("subject", event.target.value)} /></label>
        <label>邮件正文<textarea required rows={6} value={form.body} onChange={(event) => update("body", event.target.value)} /></label>
        <div className="form-actions">
          <button className="button-primary" type="submit" disabled={saving}>{saving ? "保存中…" : "保存提醒"}</button>
          <button className="button-secondary" type="button" disabled={testing} onClick={() => void sendTest()}><Icon name="mail" size={17} />{testing ? "发送中…" : "发送测试邮件"}</button>
        </div>
      </form>
      <aside className="schedule-card"><span className="card-icon warm"><Icon name="clock" /></span><span className="eyebrow">NEXT RUN</span><strong>{formatDateTime(reminder.nextRun)}</strong><p>时间以北京时间（Asia/Shanghai）计算</p></aside></div>
      {feedback && <p className={`feedback-banner ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.message}</p>}
      {reminder.schedulerReinstallRequired && (
        <aside aria-label="任务计划同步警告">
          <p>任务计划时间尚未同步。请在 PowerShell 中运行：</p>
          <code>{reminder.schedulerReinstallInstruction}</code>
        </aside>
      )}
      <dl className="reminder-stats">
        <div><dt>下次运行</dt><dd>{formatDateTime(reminder.nextRun)}</dd></div>
        <div><dt>上次成功</dt><dd>{reminder.lastSuccess ? `${reminder.lastSuccess.localDate} ${formatDateTime(reminder.lastSuccess.attemptedAt)}` : "暂无记录"}</dd></div>
        <div><dt>上次失败</dt><dd>{reminder.lastFailure ? `${reminder.lastFailure.localDate} ${reminder.lastFailure.category}` : "暂无记录"}</dd></div>
      </dl>
    </section>
  );
}
