import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ModelDigestOverview, ModelDigestRun } from "@workbench/contracts";
import { api as defaultApi } from "../../lib/api";
import { Icon } from "../../app/Icon";
import { ModelDigestHistoryPanel, type ModelDigestHistoryApi } from "./ModelDigestHistoryPanel";
import { ModelDigestProgress } from "./ModelDigestProgress";
import "./model-digest.css";

interface ModelDigestApi extends ModelDigestHistoryApi {
  getModelDigest(): Promise<ModelDigestOverview>;
  updateModelDigestSettings(input: { enabled: boolean; recipientIds: string[] }): Promise<ModelDigestOverview["settings"]>;
  startModelDigestRun(input: { sendEmail: boolean; recipientIds: string[] }): Promise<{ runId: string }>;
  getModelDigestRun(id: string): Promise<ModelDigestRun>;
}

export function ModelDigestPage({ api = defaultApi }: { api?: ModelDigestApi }) {
  const [overview, setOverview] = useState<ModelDigestOverview | null>(null);
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleRecipients, setScheduleRecipients] = useState<string[]>([]);
  const [mailNow, setMailNow] = useState(false);
  const [manualRecipients, setManualRecipients] = useState<string[]>([]);
  const [activeRun, setActiveRun] = useState<ModelDigestRun | null>(null);
  const [selectedRun, setSelectedRun] = useState<ModelDigestRun | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    api.getModelDigest().then((data) => {
      if (!live) return;
      setOverview(data);
      setScheduleEnabled(data.settings.enabled);
      setScheduleRecipients(data.settings.recipientIds);
      if (data.activeRun) setActiveRun(data.activeRun);
      else if (data.lastRun?.status === "failed") setActiveRun(data.lastRun);
    }).catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : "模型总结加载失败"); });
    return () => { live = false; };
  }, [api]);

  useEffect(() => {
    if (!activeRun || ["succeeded", "failed"].includes(activeRun.status)) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api.getModelDigestRun(activeRun.id).then((run) => { if (live) setActiveRun(run); })
        .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : "进度刷新失败"); });
    }, 1800);
    return () => { live = false; window.clearTimeout(timer); };
  }, [activeRun, api]);

  useEffect(() => {
    if (!activeRun || !["succeeded", "failed"].includes(activeRun.status)) return;
    let live = true;
    api.getModelDigest().then((data) => { if (live) { setOverview(data); setHistoryRevision((value) => value + 1); } })
      .catch(() => undefined);
    return () => { live = false; };
  }, [activeRun?.id, activeRun?.status, api]);

  function toggle(setter: (value: string[]) => void, values: string[], id: string) {
    setter(values.includes(id) ? values.filter((item) => item !== id) : [...values, id]);
  }

  async function saveSchedule() {
    setBusy(true); setError(""); setNotice("");
    try {
      await api.updateModelDigestSettings({ enabled: scheduleEnabled, recipientIds: scheduleRecipients });
      const data = await api.getModelDigest(); setOverview(data); setNotice("工作日定时设置已保存");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "设置保存失败"); }
    finally { setBusy(false); }
  }

  async function runNow() {
    setBusy(true); setError(""); setNotice("");
    try {
      const { runId } = await api.startModelDigestRun({ sendEmail: mailNow, recipientIds: mailNow ? manualRecipients : [] });
      setSelectedRun(null);
      setActiveRun(await api.getModelDigestRun(runId));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "无法开始模型总结"); }
    finally { setBusy(false); }
  }

  const emails = overview?.emails ?? [];
  const summaryRun = selectedRun ?? (activeRun?.summary ? activeRun : overview?.latestRun);
  const progressRun = selectedRun ?? activeRun ?? overview?.lastRun ?? null;
  const isRunning = Boolean(activeRun && ["queued", "fetching", "summarizing", "sending"].includes(activeRun.status));

  return <section className="model-digest-page">
    <header>
      <Link className="back-link" to="/ai-office"><Icon name="arrow" size={17} />返回 AI 办公</Link>
      <div className="page-heading"><div><span className="eyebrow">MODEL DIGEST</span><h2>模型总结</h2><p>汇总 Hugging Face 社区趋势与 OpenRouter 近一周 token 使用榜，并由默认 AI 模型整理。</p></div><span className="privacy-badge"><Icon name="clock" size={14} />工作日 09:00</span></div>
    </header>

    {error && <p className="model-digest-message error" role="alert">{error}</p>}
    {notice && <p className="model-digest-message" role="status">{notice}</p>}

    <div className="model-digest-grid">
      <section className="model-digest-card">
        <div className="model-digest-card-heading"><span className="model-digest-icon"><Icon name="clock" /></span><div><h3>工作日自动更新</h3><p>每天北京时间 09:00 获取并总结，完成后发送到所选邮箱。</p></div></div>
        <label className="digest-switch"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} />启用自动更新</label>
        <fieldset disabled={!scheduleEnabled || busy} className="digest-recipient-list">
          <legend>定时邮件收件人</legend>
          {emails.length ? emails.map((email) => <label key={email.id}><input type="checkbox" checked={scheduleRecipients.includes(email.id)} onChange={() => toggle(setScheduleRecipients, scheduleRecipients, email.id)} /><span><strong>{email.label}</strong><small>{email.address}</small></span></label>) : <p>请先在个人信息中添加邮箱。</p>}
        </fieldset>
        <button className="button-primary" type="button" disabled={busy || (scheduleEnabled && (scheduleRecipients.length === 0 || !overview?.readiness.aiConfigured || !overview?.readiness.smtpConfigured))} onClick={() => void saveSchedule()}>{busy ? "处理中…" : "保存定时设置"}</button>
        {overview?.nextRunAt && scheduleEnabled && <p className="digest-muted">下次运行：{new Date(overview.nextRunAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>}
        {(!overview?.readiness.aiConfigured || !overview?.readiness.smtpConfigured) && <p className="digest-muted">启用定时邮件前，请配置默认 AI 模型和 SMTP 发件箱。<Link to="/settings">前往设置</Link></p>}
      </section>

      <section className="model-digest-card">
        <div className="model-digest-card-heading"><span className="model-digest-icon accent"><Icon name="sparkles" /></span><div><h3>立即获取并总结</h3><p>实时抓取两个来源，结果会显示在下方。</p></div></div>
        <label className="digest-switch"><input type="checkbox" checked={mailNow} onChange={(event) => setMailNow(event.target.checked)} />本次同时发送邮件</label>
        {mailNow && <fieldset className="digest-recipient-list" disabled={busy}><legend>选择本次收件人（可多选）</legend>{emails.length ? emails.map((email) => <label key={email.id}><input type="checkbox" checked={manualRecipients.includes(email.id)} onChange={() => toggle(setManualRecipients, manualRecipients, email.id)} /><span><strong>{email.label}</strong><small>{email.address}</small></span></label>) : <p>请先在个人信息中添加邮箱。</p>}</fieldset>}
        <button className="button-primary" type="button" disabled={busy || isRunning || !overview?.readiness.aiConfigured || (mailNow && (!manualRecipients.length || !overview?.readiness.smtpConfigured))} onClick={() => void runNow()}>{isRunning ? "正在获取并总结…" : "立即获取并总结"}</button>
        {activeRun && <p className={`digest-run-status ${activeRun.status === "failed" ? "failed" : ""}`} role={activeRun.status === "failed" ? "alert" : "status"}>本次进度：{statusLabel(activeRun.status)}{activeRun.emailStatus === "sent" ? " · 邮件已发送" : activeRun.emailStatus === "failed" ? " · 邮件发送失败" : ""}{activeRun.errorCategory ? ` · ${failureMessage(activeRun.errorCategory)}` : ""}</p>}
        <ModelDigestProgress run={progressRun} />
      </section>
    </div>

    <section className="model-digest-result">
      <div className="model-digest-card-heading"><span className="model-digest-icon accent"><Icon name="file" /></span><div><h3>{selectedRun ? selectedRun.deletedAt ? "回收站记录" : "历史模型总结" : "最新模型总结"}</h3><p>{summaryRun ? `更新于 ${new Date(summaryRun.finishedAt ?? summaryRun.createdAt).toLocaleString("zh-CN")}` : "完成一次总结后，结果会显示在这里。"}</p></div>{selectedRun && <button className="digest-back-latest" type="button" onClick={() => setSelectedRun(null)}>返回最新</button>}</div>
      {summaryRun?.summary ? <>
        <div className="model-digest-summary">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            skipHtml
            components={{
              a: ({ href, children }) => allowedSourceLink(href)
                ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                : <span>{children}</span>,
              img: () => null
            }}
          >{summaryRun.summary}</ReactMarkdown>
        </div>
        <details className="digest-source-details"><summary>查看来源数据</summary><div className="digest-sources">{summaryRun.sourceSnapshots.map((snapshot) => <section key={snapshot.sourceId}><h4>{snapshot.sourceId === "huggingface" ? "Hugging Face Trending" : "OpenRouter Top Weekly"}</h4><p>{snapshot.sourceId === "huggingface" ? "Hub 社区趋势榜" : "OpenRouter 平台近一周 token 使用排序"} · 抓取于 {new Date(snapshot.fetchedAt).toLocaleString("zh-CN")}</p><ul>{snapshot.items.map((item) => <li key={`${item.sourceId}:${item.modelId}`}><a href={item.url} target="_blank" rel="noreferrer">{item.name}</a>{item.metrics.trendingScore !== undefined && <span>趋势分 {item.metrics.trendingScore}</span>}{item.metrics.likes !== undefined && <span>{item.metrics.likes} likes</span>}{item.metrics.weeklyRank !== undefined && <span>周榜第 {item.metrics.weeklyRank} 名</span>}</li>)}</ul></section>)}</div></details>
      </> : <div className="result-empty"><span><Icon name={progressRun?.status === "failed" ? "file" : "sparkles"} size={26} /></span><strong>{progressRun?.status === "failed" ? "本次总结未完成" : "等待生成"}</strong><p>{progressRun?.errorCategory ? failureMessage(progressRun.errorCategory) : "点击“立即获取并总结”开始一次更新。"}</p></div>}
    </section>
    <ModelDigestHistoryPanel api={api} revision={historyRevision} onSelect={setSelectedRun} onDelete={(id) => {
      if (selectedRun?.id === id) setSelectedRun(null);
      if (activeRun?.id === id) setActiveRun(null);
      void api.getModelDigest().then(setOverview).catch(() => undefined);
    }} />
  </section>;
}

function allowedSourceLink(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const url = new URL(href);
    return url.protocol === "https:" && url.port === "" && url.username === "" && url.password === ""
      && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch { return false; }
}

function statusLabel(status: ModelDigestRun["status"]): string {
  return ({ queued: "排队中", fetching: "获取榜单", summarizing: "AI 总结中", sending: "发送邮件", succeeded: "已完成", failed: "失败" })[status];
}

function failureMessage(category: string): string {
  if (category.startsWith("huggingface_")) return "连接 Hugging Face 失败，请检查网络或代理设置后重试。";
  if (category.startsWith("openrouter_")) return "连接 OpenRouter 失败，请检查网络或代理设置后重试。";
  if (category === "not_configured") return "默认 AI 模型未配置或密钥不可用，请检查设置。";
  if (category === "auth") return "AI 模型服务的密钥无效，请检查默认模型设置。";
  if (category === "billing") return "AI 模型服务的额度或账单异常，请检查服务商账户。";
  if (category === "invalid_request") return "AI 模型服务拒绝了总结请求，请检查默认模型设置。";
  if (category === "rate_limit") return "AI 模型服务请求过于频繁，请稍后重试。";
  if (category === "upstream") return "AI 模型服务返回异常，请稍后重试；若持续出现，请检查默认模型设置。";
  if (category === "email_delivery_failed") return "摘要已生成，但邮件未能成功发送。";
  if (category === "interrupted") return "服务重启时任务被中断，请重新运行。";
  if (category === "timeout") return "AI 模型响应超时，请稍后重试。";
  if (category === "network") return "连接 AI 模型服务失败，请检查网络或代理设置后重试。";
  return "本次任务失败，请检查配置后重试。";
}
