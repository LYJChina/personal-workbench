import type { GenericReminderAttempt } from "@workbench/contracts";

export function ReminderHistory({ attempts }: { attempts: GenericReminderAttempt[] }) {
  return <section className="reminder-column" role="region" aria-label="已执行">
    <header><div><span className="eyebrow">HISTORY</span><h3>已执行</h3></div><span className="status-chip neutral">{attempts.length} 条</span></header>
    <div className="reminder-scroll-list">{attempts.length === 0 ? <p className="empty-state">暂无执行记录</p> : attempts.map((attempt) => <article className="reminder-item history" key={attempt.id}>
      <div className="reminder-item-heading"><div><h4>{attempt.reminderName}</h4><p>{new Date(attempt.attemptedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</p></div><span className={`status-chip ${attempt.status === "success" ? "" : "error"}`}>{attempt.status === "success" ? "发送成功" : attempt.status === "failure" ? "发送失败" : "已跳过"}</span></div>
      <p>{attempt.subject}</p>{attempt.errorCategory && <p className="error-copy">原因：{attempt.errorCategory}</p>}
    </article>)}</div>
  </section>;
}
