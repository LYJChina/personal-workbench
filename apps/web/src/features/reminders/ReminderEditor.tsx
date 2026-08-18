import { useState, type FormEvent } from "react";
import type { GenericReminder, GenericReminderInput } from "@workbench/contracts";

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

const emptyInput: GenericReminderInput = {
  name: "", enabled: true, lifecycle: "once", scheduleType: "once", startDate: today(),
  localTime: "09:00", weekdays: [1], monthDay: null, totalOccurrences: null,
  recipient: "", subject: "", body: ""
};

export function ReminderEditor({ reminder, onSave, onClose }: {
  reminder: GenericReminder | null;
  onSave(input: GenericReminderInput): Promise<void>;
  onClose(): void;
}) {
  const [form, setForm] = useState<GenericReminderInput>(reminder ? {
    name: reminder.name, enabled: reminder.enabled, lifecycle: reminder.lifecycle,
    scheduleType: reminder.scheduleType, startDate: reminder.startDate, localTime: reminder.localTime,
    weekdays: reminder.weekdays, monthDay: reminder.monthDay, totalOccurrences: reminder.totalOccurrences,
    recipient: reminder.recipient, subject: reminder.subject, body: reminder.body
  } : emptyInput);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = <K extends keyof GenericReminderInput>(key: K, value: GenericReminderInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const normalized: GenericReminderInput = {
        ...form,
        scheduleType: form.lifecycle === "once" ? "once" : form.scheduleType,
        totalOccurrences: form.lifecycle === "finite" ? form.totalOccurrences ?? 1 : null,
        monthDay: form.scheduleType === "monthly" ? form.monthDay ?? 1 : null,
        weekdays: form.scheduleType === "weekly" ? form.weekdays : []
      };
      await onSave(normalized);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "提醒保存失败");
    } finally {
      setSaving(false);
    }
  }

  return <div className="reminder-dialog-backdrop"><section className="reminder-dialog" role="dialog" aria-modal="true" aria-labelledby="reminder-editor-title">
    <header><div><span className="eyebrow">EMAIL REMINDER</span><h3 id="reminder-editor-title">{reminder ? "编辑提醒" : "新建提醒"}</h3></div><button type="button" className="button-ghost" onClick={onClose}>关闭</button></header>
    <form onSubmit={(event) => void submit(event)}>
      <label>提醒名称<input required value={form.name} onChange={(event) => update("name", event.target.value)} /></label>
      <label>收件邮箱<input type="email" required value={form.recipient} onChange={(event) => update("recipient", event.target.value)} /></label>
      <div className="form-row">
        <label>提醒类型<select value={form.lifecycle} onChange={(event) => update("lifecycle", event.target.value as GenericReminderInput["lifecycle"])}><option value="once">一次性</option><option value="finite">有限次数</option><option value="recurring">常驻</option></select></label>
        {form.lifecycle !== "once" && <label>重复规则<select value={form.scheduleType === "once" ? "daily" : form.scheduleType} onChange={(event) => update("scheduleType", event.target.value as GenericReminderInput["scheduleType"])}><option value="daily">每天</option><option value="workday">法定工作日</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label>}
      </div>
      <div className="form-row"><label>开始日期<input type="date" required value={form.startDate} onChange={(event) => update("startDate", event.target.value)} /></label><label>提醒时间<input type="time" required value={form.localTime} onChange={(event) => update("localTime", event.target.value)} /></label></div>
      {form.lifecycle === "finite" && <label>执行次数<input type="number" min="1" max="10000" required value={form.totalOccurrences ?? 1} onChange={(event) => update("totalOccurrences", Number(event.target.value))} /></label>}
      {form.lifecycle !== "once" && form.scheduleType === "weekly" && <fieldset><legend>每周星期</legend><div className="weekday-picker">{["日","一","二","三","四","五","六"].map((label, day) => <label key={day}><input type="checkbox" checked={form.weekdays.includes(day)} onChange={(event) => update("weekdays", event.target.checked ? [...form.weekdays, day].sort() : form.weekdays.filter((item) => item !== day))} />周{label}</label>)}</div></fieldset>}
      {form.lifecycle !== "once" && form.scheduleType === "monthly" && <label>每月日期<input type="number" min="1" max="31" value={form.monthDay ?? 1} onChange={(event) => update("monthDay", Number(event.target.value))} /></label>}
      <label>邮件主题<input required value={form.subject} onChange={(event) => update("subject", event.target.value)} /></label>
      <label>邮件正文<textarea required rows={5} value={form.body} onChange={(event) => update("body", event.target.value)} /></label>
      <label className="inline-check"><input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} />创建后立即启用</label>
      {error && <p role="alert" className="feedback-banner error">{error}</p>}
      <div className="form-actions"><button type="button" className="button-secondary" onClick={onClose}>取消</button><button type="submit" className="button-primary" disabled={saving}>{saving ? "保存中…" : "保存提醒"}</button></div>
    </form>
  </section></div>;
}
