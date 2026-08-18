import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AiPolishInput, AiPolishKind, AiPolishRecord } from "@workbench/contracts";
import { Icon } from "../../app/Icon";
import { api as defaultApi } from "../../lib/api";
import { AiPolishHistory } from "./AiPolishHistory";
import { polishPresets, presetFor } from "./polishPresets";

export interface AiPolishApi {
  generateAiPolish(input: AiPolishInput): Promise<AiPolishRecord>;
  getAiPolishHistory(): Promise<AiPolishRecord[]>;
  updateAiPolish(id: number, content: string): Promise<AiPolishRecord>;
}

function isKind(value: string | null): value is AiPolishKind {
  return polishPresets.some((preset) => preset.kind === value);
}

export function AiPolishPage({ api: polishApi = defaultApi }: { api?: AiPolishApi }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedKind = isKind(searchParams.get("mode")) ? searchParams.get("mode") as AiPolishKind : "daily_report";
  const preset = presetFor(selectedKind);
  const [primaryText, setPrimaryText] = useState("");
  const [secondaryText, setSecondaryText] = useState(preset.defaultSecondary);
  const [systemPrompt, setSystemPrompt] = useState(preset.systemPrompt);
  const [result, setResult] = useState<AiPolishRecord | null>(null);
  const [records, setRecords] = useState<AiPolishRecord[]>([]);
  const [historyKind, setHistoryKind] = useState<AiPolishKind>(selectedKind);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const refreshHistory = useCallback(async () => setRecords(await polishApi.getAiPolishHistory()), [polishApi]);

  useEffect(() => { void refreshHistory().catch(() => setError("历史记录加载失败，请稍后重试")); }, [refreshHistory]);

  function selectKind(kind: AiPolishKind) {
    const next = presetFor(kind);
    setSearchParams({ mode: kind });
    setPrimaryText("");
    setSecondaryText(next.defaultSecondary);
    setSystemPrompt(next.systemPrompt);
    setResult(null);
    setError(null);
    setCopyFeedback(null);
    setHistoryKind(kind);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setCopyFeedback(null);
    try {
      const generated = await polishApi.generateAiPolish({ kind: selectedKind, primaryText, secondaryText, systemPrompt });
      setResult(generated);
      setRecords((current) => [generated, ...current.filter((record) => record.id !== generated.id)]);
      setHistoryKind(selectedKind);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.content);
      setCopyFeedback("已复制全文");
    } catch {
      setError("复制失败，请手动选择正文");
    }
  }

  async function saveHistory(id: number, content: string) {
    const saved = await polishApi.updateAiPolish(id, content);
    setRecords((current) => current.map((record) => record.id === saved.id ? saved : record));
    setResult((current) => current?.id === saved.id ? saved : current);
    return saved;
  }

  return <section className="daily-report-page ai-polish-page">
    <h2 className="sr-only">AI 润色</h2>

    <nav className="polish-mode-grid" aria-label="润色场景">
      {polishPresets.map((item) => <Link aria-current={selectedKind === item.kind ? "page" : undefined} className={`polish-mode-card ${selectedKind === item.kind ? "active" : ""}`} to={`?mode=${item.kind}`} key={item.kind} onClick={(event) => { event.preventDefault(); selectKind(item.kind); }}><span className="tool-icon"><Icon name={item.icon} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span><Icon name="arrow" size={16} className="mode-arrow" /></Link>)}
    </nav>

    <div className="ai-polish-workspace">
      <div className="daily-report-workspace">
        <form className="daily-report-input" onSubmit={generate}>
          <div className="card-heading"><div className="card-icon"><Icon name={preset.icon} /></div><div><span className="step-label">当前场景</span><h3>{preset.title}</h3></div></div>
          <label><span>{preset.primaryLabel}<small>{preset.primaryHint}</small></span><textarea aria-label={preset.primaryLabel} placeholder={preset.primaryPlaceholder} value={primaryText} onChange={(event) => setPrimaryText(event.target.value)} rows={4} /></label>
          <label><span>{preset.secondaryLabel}<small>{preset.secondaryHint}</small></span><textarea aria-label={preset.secondaryLabel} placeholder={preset.secondaryPlaceholder} value={secondaryText} onChange={(event) => setSecondaryText(event.target.value)} rows={3} /></label>
          <details className="prompt-editor" open><summary>查看和修改提示词</summary><label>系统提示词<textarea aria-label="系统提示词" value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={4} /></label><button className="button-ghost compact" type="button" onClick={() => setSystemPrompt(preset.systemPrompt)}>恢复此场景默认提示词</button></details>
          <button className="button-primary generate-button" type="submit" disabled={submitting || !systemPrompt.trim() || (!primaryText.trim() && !secondaryText.trim())}>{submitting ? <><span className="spinner" />生成中…</> : <><Icon name="sparkles" size={18} />{preset.actionLabel}</>}</button>
          {error && <div role="alert">{error} {error.includes("配置") && <Link to="/settings">前往设置</Link>}</div>}
        </form>

        <section className="daily-report-result" aria-labelledby="ai-polish-result-heading"><div className="card-heading"><div className="card-icon accent"><Icon name="file" /></div><div><span className="step-label">生成结果</span><h3 id="ai-polish-result-heading">{preset.title}结果</h3></div></div>{result ? <><pre>{result.content}</pre><button className="button-secondary" type="button" onClick={() => void copyResult()}><Icon name="copy" size={17} />复制全文</button>{copyFeedback && <p role="status">{copyFeedback}</p>}</> : <div className="result-empty"><span><Icon name="sparkles" size={26} /></span><strong>等待生成</strong><p>填写左侧素材，AI 处理后的文案会显示在这里。</p></div>}</section>
      </div>

      <AiPolishHistory records={records} selectedKind={historyKind} onSelectKind={setHistoryKind} onReopen={setResult} onSave={saveHistory} />
    </div>
  </section>;
}
