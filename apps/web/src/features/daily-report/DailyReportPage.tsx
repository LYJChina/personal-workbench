import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { DailyReport, DailyReportInput } from "@workbench/contracts";
import { api as defaultApi } from "../../lib/api";
import { DailyReportHistory } from "./DailyReportHistory";

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
        <Link to="/ai-office">返回 AI 办公</Link>
        <h2>日报填写</h2>
        <p>输入事实材料，由本地服务调用 DeepSeek 生成专业、简洁的中文日报。</p>
      </header>

      <div className="daily-report-workspace">
        <form className="daily-report-input" onSubmit={generate}>
          <h3>日报材料</h3>
          <label>今日完成<textarea value={completed} onChange={(event) => setCompleted(event.target.value)} rows={8} /></label>
          <label>问题与风险<textarea value={risks} onChange={(event) => setRisks(event.target.value)} rows={8} /></label>
          <button type="submit" disabled={submitting || (!completed.trim() && !risks.trim())}>{submitting ? "生成中…" : "生成日报"}</button>
          {error && <div role="alert"><span>{error}</span>{configurationError && <> <Link to="/settings">前往设置</Link></>}</div>}
        </form>

        <section className="daily-report-result" aria-labelledby="daily-report-result-heading">
          <h3 id="daily-report-result-heading">生成结果</h3>
          {result ? (
            <>
              <pre>{result.content}</pre>
              <button type="button" onClick={() => void copyResult()}>复制全文</button>
              {copyFeedback && <p role={copyFeedback.kind === "error" ? "alert" : "status"}>{copyFeedback.message}</p>}
            </>
          ) : <p>生成后的日报将在这里显示。</p>}
        </section>
      </div>

      {historyWarning && <p role="status" className="daily-report-history-warning">{historyWarning}</p>}
      <DailyReportHistory reports={reports} onReopen={setResult} onSave={saveHistory} />
    </section>
  );
}
