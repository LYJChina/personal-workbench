import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { DailyReport, DailyReportInput } from "@workbench/contracts";
import { api as defaultApi } from "../../lib/api";
import { DailyReportHistory } from "./DailyReportHistory";
import { Icon } from "../../app/Icon";

export interface DailyReportApi {
  generateDailyReport(input: DailyReportInput): Promise<DailyReport>;
  getDailyReports(): Promise<DailyReport[]>;
  getDailyReport(id: number): Promise<DailyReport>;
  updateDailyReport(id: number, content: string): Promise<DailyReport>;
}

interface DailyReportPageProps {
  api?: DailyReportApi;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

function newestFirst(reports: DailyReport[]): DailyReport[] {
  return [...reports].sort((left, right) => {
    const byCreatedAt = Date.parse(right.createdAt) - Date.parse(left.createdAt);
    return byCreatedAt || right.id - left.id;
  });
}

export function DailyReportPage({ api: reportApi = defaultApi }: DailyReportPageProps) {
  const [completed, setCompleted] = useState("");
  const [risks, setRisks] = useState("");
  const [result, setResult] = useState<DailyReport | null>(null);
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const refreshHistory = useCallback(async () => {
    setReports(newestFirst(await reportApi.getDailyReports()));
  }, [reportApi]);

  useEffect(() => {
    let active = true;
    reportApi.getDailyReports()
      .then((loaded) => { if (active) setReports(newestFirst(loaded)); })
      .catch(() => { if (active) setHistoryWarning("历史记录加载失败，请稍后重试"); });
    return () => { active = false; };
  }, [reportApi]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setCopyFeedback(null);
    let generated: DailyReport;
    try {
      generated = await reportApi.generateDailyReport({ completed, risks });
    } catch (reason) {
      setError(messageFor(reason));
      setSubmitting(false);
      return;
    }

    setResult(generated);
    setSubmitting(false);
    try {
      await refreshHistory();
      setHistoryWarning(null);
    } catch {
      setHistoryWarning("日报已生成并保存，但历史记录刷新失败，请勿重复生成");
    }
  }

  async function copyResult() {
    if (!result) return;
    setCopyFeedback(null);
    try {
      await navigator.clipboard.writeText(result.content);
      setCopyFeedback({ kind: "success", message: "已复制全文" });
    } catch {
      setCopyFeedback({ kind: "error", message: "复制失败，请手动选择正文" });
    }
  }

  async function saveHistory(id: number, content: string): Promise<DailyReport> {
    const saved = await reportApi.updateDailyReport(id, content);
    setReports((current) => newestFirst(current.map((report) => report.id === saved.id ? saved : report)));
    setResult((current) => current?.id === saved.id ? saved : current);
    return saved;
  }

  const configurationError = Boolean(error?.includes("配置") && error.includes("DeepSeek"));

  return (
    <section className="daily-report-page">
      <header>
        <Link className="back-link" to="/ai-office"><Icon name="arrow" size={17} />返回 AI 办公</Link>
        <div className="page-heading"><div><span className="eyebrow">DAILY REPORT</span><h2>日报填写</h2><p>写下关键词和事实，AI 会帮你整理成专业、简洁的中文日报。</p></div><span className="privacy-badge"><Icon name="lock" size={14} /> 本地保存</span></div>
      </header>

      <div className="daily-report-workspace">
        <form className="daily-report-input" onSubmit={generate}>
          <div className="card-heading"><div className="card-icon"><Icon name="edit" /></div><div><span className="step-label">01</span><h3>填写日报素材</h3></div></div>
          <label><span>今日完成 <small>写下已完成的事项或关键词</small></span><textarea aria-label="今日完成" placeholder="例如：完成项目周报页面；修复登录超时问题；与客户确认需求…" value={completed} onChange={(event) => setCompleted(event.target.value)} rows={7} /></label>
          <label><span>问题与风险 <small>没有可留空</small></span><textarea aria-label="问题与风险" placeholder="例如：接口文档仍待确认，可能影响联调进度…" value={risks} onChange={(event) => setRisks(event.target.value)} rows={6} /></label>
          <button className="button-primary generate-button" type="submit" disabled={submitting || (!completed.trim() && !risks.trim())}>{submitting ? <><span className="spinner" />生成中…</> : <><Icon name="sparkles" size={18} />生成日报</>}</button>
          {error && <div role="alert"><span>{error}</span>{configurationError && <> <Link to="/settings">前往设置</Link></>}</div>}
        </form>

        <section className="daily-report-result" aria-labelledby="daily-report-result-heading">
          <div className="card-heading"><div className="card-icon accent"><Icon name="file" /></div><div><span className="step-label">02</span><h3 id="daily-report-result-heading">生成结果</h3></div></div>
          {result ? (
            <>
              <pre>{result.content}</pre>
              <button className="button-secondary" type="button" onClick={() => void copyResult()}><Icon name="copy" size={17} />复制全文</button>
              {copyFeedback && <p role={copyFeedback.kind === "error" ? "alert" : "status"}>{copyFeedback.message}</p>}
            </>
          ) : <div className="result-empty"><span><Icon name="sparkles" size={26} /></span><strong>等待生成</strong><p>填写左侧素材并点击“生成日报”，润色结果会显示在这里。</p></div>}
        </section>
      </div>

      {historyWarning && <p role="status" className="daily-report-history-warning">{historyWarning}</p>}
      <DailyReportHistory reports={reports} onReopen={setResult} onSave={saveHistory} />
    </section>
  );
}
