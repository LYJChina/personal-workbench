import { useEffect, useState } from "react";
import type { ModelDigestRun } from "@workbench/contracts";

const activeStatuses = new Set<ModelDigestRun["status"]>(["queued", "fetching", "summarizing", "sending"]);

export function ModelDigestProgress({ run }: { run: ModelDigestRun | null }) {
  const [now, setNow] = useState(Date.now());
  const running = Boolean(run && activeStatuses.has(run.status));

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  if (!run) return null;
  const events = run.progressEvents;
  const elapsed = Math.max(0, Math.floor(((running ? now : Date.parse(run.finishedAt ?? run.createdAt)) - Date.parse(run.startedAt ?? run.createdAt)) / 1_000));
  return <div className="digest-progress" aria-live="polite">
    <div className="digest-progress-heading"><h4>获取过程</h4><span>用时 {Math.floor(elapsed / 60)} 分 {elapsed % 60} 秒</span></div>
    {events.length ? <ol>{events.map((event, index) => <li key={`${event.stage}-${index}`} className={running && index === events.length - 1 ? "current" : ""}>
      <span className="digest-progress-dot" aria-hidden="true" />
      <div><strong>{event.message}</strong><small>{new Date(event.at).toLocaleTimeString("zh-CN", { hour12: false })}</small></div>
    </li>)}</ol> : <p className="digest-muted">这条旧记录没有保存过程明细。</p>}
  </div>;
}
