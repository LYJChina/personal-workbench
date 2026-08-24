import type { GenericReminderAttempt } from "@workbench/contracts";

export function ReminderHistory({ attempts }: { attempts: GenericReminderAttempt[] }) {
  return <section className="reminder-column" role="region" aria-label="历史发送记录">
    <header className="reminder-panel-heading"><div><h3>历史发送记录</h3><p>共保留 {attempts.length} 条手动邮件发送结果</p></div></header>
    <div className="reminder-scroll-list">{attempts.length === 0 ? <p className="empty-state compact">暂无手动发送记录</p> : attempts.map((attempt) => <article className="reminder-item history" key={attempt.id}>
      <div className="reminder-item-primary">
        <div className="reminder-item-heading"><div><h4>{attempt.reminderName}</h4><p>{attempt.subject}</p></div></div>
        <div className="reminder-schedule-summary"><span>手动发送时间</span><strong className="reminder-next">{new Date(attempt.attemptedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</strong></div>
        {attempt.errorCategory && <p className="error-copy">原因：{attempt.errorCategory}</p>}
      </div>
      <div className="reminder-item-controls"><span className={`status-chip ${attempt.status === "success" ? "" : "error"}`}>{attempt.status === "success" ? "发送成功" : attempt.status === "failure" ? "发送失败" : "已跳过"}</span></div>
    </article>)}</div>
  </section>;
}
