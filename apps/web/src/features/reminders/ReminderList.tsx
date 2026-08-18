import type { GenericReminder, ReminderLifecycle } from "@workbench/contracts";

const lifecycleLabel: Record<ReminderLifecycle, string> = { once: "一次性", finite: "有限次数", recurring: "常驻" };
const scheduleLabel = { once: "指定日期", daily: "每天", workday: "法定工作日", weekly: "每周", monthly: "每月" } as const;

function format(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "暂无下次执行";
}

export function ReminderList({ reminders, filter, onFilter, onEdit, onDelete, onTest }: {
  reminders: GenericReminder[];
  filter: "all" | ReminderLifecycle;
  onFilter(value: "all" | ReminderLifecycle): void;
  onEdit(reminder: GenericReminder): void;
  onDelete(reminder: GenericReminder): void;
  onTest(reminder: GenericReminder): void;
}) {
  const visible = filter === "all" ? reminders : reminders.filter((item) => item.lifecycle === filter);
  return <section className="reminder-column" role="region" aria-label="等待执行">
    <header className="reminder-panel-heading"><div><h3>待执行提醒</h3><p>筛选后共 {visible.length} 项</p></div></header>
    <div className="reminder-filters" aria-label="提醒类型筛选">{([['all','全部'],['recurring','常驻'],['once','一次性'],['finite','有限次数']] as const).map(([value,label]) => <button key={value} type="button" className={filter === value ? "active" : ""} onClick={() => onFilter(value)}>{label}</button>)}</div>
    <div className="reminder-scroll-list">{visible.length === 0 ? <p className="empty-state compact">暂无等待执行的提醒</p> : visible.map((item) => <article className="reminder-item" key={item.id}>
      <div className="reminder-item-primary">
        <div className="reminder-item-heading"><div><h4>{item.name}</h4><p>{item.subject}</p></div></div>
        <div className="reminder-schedule-summary"><span>下次执行</span><strong className="reminder-next">{item.calendarBlocked ? "等待更新节假日日历" : format(item.nextRun)}</strong></div>
        <div className="reminder-meta"><span>{lifecycleLabel[item.lifecycle]}</span><span>{scheduleLabel[item.scheduleType]}</span>{item.totalOccurrences !== null && <span>剩余 {Math.max(0, item.totalOccurrences - item.successfulOccurrences)} 次</span>}</div>
      </div>
      <div className="reminder-item-controls">
        <span className={`status-chip ${item.enabled ? "" : "neutral"}`}>{item.enabled ? "启用" : "停用"}</span>
        <div className="reminder-card-actions"><button type="button" onClick={() => onEdit(item)}>编辑</button><button type="button" onClick={() => onTest(item)}>测试邮件</button><button type="button" className="danger-link" onClick={() => onDelete(item)}>删除</button></div>
      </div>
    </article>)}</div>
  </section>;
}
