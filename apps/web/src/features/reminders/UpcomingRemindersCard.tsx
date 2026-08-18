import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { GenericReminder } from "@workbench/contracts";
import { api as sharedApi } from "../../lib/api";

export function UpcomingRemindersCard({ api = sharedApi }: {
  api?: { getUpcomingReminders(): Promise<{ items: GenericReminder[] }> };
}) {
  const navigate = useNavigate();
  const [items, setItems] = useState<GenericReminder[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.getUpcomingReminders().then((result) => setItems(result.items.slice().sort((a, b) => (a.nextRun ?? "").localeCompare(b.nextRun ?? ""))))
      .catch(() => setError("近期提醒加载失败"));
  }, [api]);
  return <section className="dashboard-card upcoming-reminders-card" role="region" aria-label="近期提醒">
    <header><div><span className="eyebrow">UPCOMING</span><h3>近期提醒</h3></div><button type="button" className="button-ghost" onClick={() => navigate("/reminders")}>管理</button></header>
    {error && <p role="alert">{error}</p>}
    <div className="upcoming-scroll">{items.length === 0 ? <p className="empty-state">暂无等待执行的提醒</p> : items.map((item) => <button type="button" key={item.id} onClick={() => navigate(`/reminders?selected=${encodeURIComponent(item.id)}`)}><span><strong>{item.name}</strong><small>{item.scheduleType === "workday" ? "法定工作日" : item.scheduleType === "daily" ? "每天" : item.scheduleType === "weekly" ? "每周" : item.scheduleType === "monthly" ? "每月" : "一次性"}</small></span><time>{item.nextRun ? new Date(item.nextRun).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) : "待计算"}</time></button>)}</div>
  </section>;
}
