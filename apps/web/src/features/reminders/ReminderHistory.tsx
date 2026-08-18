import type { GenericReminderAttempt } from "@workbench/contracts";

export function ReminderHistory({ attempts }: { attempts: GenericReminderAttempt[] }) {
  return <section className="reminder-column" role="region" aria-label="已执行">
    <header className="reminder-panel-heading"><div><h3>执行记录</h3><p>共保留 {attempts.length} 条邮件执行结果</p></div></header>
    <div className="reminder-scroll-list">{attempts.length === 0 ? <p className="empty-state compact">暂无执行记录</p> : attempts.map((attempt) => <article className="reminder-item history" key={attempt.id}>
      <div className="reminder-item-primary">
        <div className="reminder-item-heading"><div><h4>{attempt.reminderName}</h4><p>{attempt.subject}</p></div></div>
        <div className="reminder-schedule-summary"><span>执行时间</span><strong className="reminder-next">{new Date(attempt.attemptedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</strong></div>
        {attempt.errorCategory && <p className="error-copy">原因：{attempt.errorCategory}</p>}
      </div>
      <div className="reminder-item-controls"><span className={`status-chip ${attempt.status === "success" ? "" : "error"}`}>{attempt.status === "success" ? "发送成功" : attempt.status === "failure" ? "发送失败" : "已跳过"}</span></div>
    </article>)}</div>
  </section>;
}
