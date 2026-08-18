import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { AiPolishInput, AiPolishKind, AiPolishPrompt, AiPolishRecord, AiSystemPromptInput, AiSystemPromptResult } from "@workbench/contracts";
import { Icon } from "../../app/Icon";
import { api as defaultApi } from "../../lib/api";
import { AiPolishHistory } from "./AiPolishHistory";
import { polishPresets, presetFor } from "./polishPresets";

export interface AiPolishApi {
  generateAiPolish(input: AiPolishInput): Promise<AiPolishRecord>;
  generateAiSystemPrompt(input: AiSystemPromptInput): Promise<AiSystemPromptResult>;
  getAiPolishHistory(): Promise<AiPolishRecord[]>;
  getAiPolishPrompts(): Promise<AiPolishPrompt[]>;
  saveAiPolishPrompt(kind: AiPolishKind, systemPrompt: string): Promise<AiPolishPrompt>;
  updateAiPolish(id: number, content: string): Promise<AiPolishRecord>;
}

function isKind(value: string | null): value is AiPolishKind {
  return polishPresets.some((preset) => preset.kind === value);
}

export function AiPolishPage({ api: polishApi = defaultApi }: { api?: AiPolishApi }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedMode = searchParams.get("mode");
  const promptBuilderSelected = requestedMode === "prompt_builder";
  const selectedKind = isKind(requestedMode) ? requestedMode : "daily_report";
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
  const [promptGoal, setPromptGoal] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [promptGenerating, setPromptGenerating] = useState(false);
  const [promptFeedback, setPromptFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [savedPrompts, setSavedPrompts] = useState<Partial<Record<AiPolishKind, string>>>({});
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptSaveFeedback, setPromptSaveFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const refreshHistory = useCallback(async () => setRecords(await polishApi.getAiPolishHistory()), [polishApi]);

  useEffect(() => { void refreshHistory().catch(() => setError("历史记录加载失败，请稍后重试")); }, [refreshHistory]);
  useEffect(() => {
    void polishApi.getAiPolishPrompts().then((prompts) => {
      const loaded = Object.fromEntries(prompts.map((prompt) => [prompt.kind, prompt.systemPrompt])) as Partial<Record<AiPolishKind, string>>;
      setSavedPrompts(loaded);
      setSystemPrompt(loaded[selectedKind] ?? presetFor(selectedKind).systemPrompt);
    }).catch(() => setPromptSaveFeedback({ kind: "error", message: "已保存的提示词加载失败" }));
  }, [polishApi]);

  function selectKind(kind: AiPolishKind) {
    const next = presetFor(kind);
    setSearchParams({ mode: kind });
    setPrimaryText("");
    setSecondaryText(next.defaultSecondary);
    setSystemPrompt(savedPrompts[kind] ?? next.systemPrompt);
    setResult(null);
    setError(null);
    setCopyFeedback(null);
    setPromptGoal("");
    setGeneratedPrompt("");
    setPromptFeedback(null);
    setPromptSaveFeedback(null);
    setHistoryKind(kind);
  }

  async function saveSystemPrompt() {
    if (promptSaving || !systemPrompt.trim()) return;
    setPromptSaving(true);
    setPromptSaveFeedback(null);
    try {
      const saved = await polishApi.saveAiPolishPrompt(selectedKind, systemPrompt);
      setSavedPrompts((current) => ({ ...current, [saved.kind]: saved.systemPrompt }));
      setSystemPrompt(saved.systemPrompt);
      setPromptSaveFeedback({ kind: "success", message: "提示词已保存，重启应用后仍会保留" });
    } catch (reason) {
      setPromptSaveFeedback({ kind: "error", message: reason instanceof Error ? reason.message : "提示词保存失败，请稍后重试" });
    } finally {
      setPromptSaving(false);
    }
  }

  function selectPromptBuilder() {
    setSearchParams({ mode: "prompt_builder" });
    setPromptGoal("");
    setGeneratedPrompt("");
    setPromptFeedback(null);
    setError(null);
    setCopyFeedback(null);
  }

  async function generateSystemPrompt() {
    if (promptGenerating || promptGoal.trim().length < 5) return;
    setPromptGenerating(true);
    setPromptFeedback(null);
    try {
      const generated = await polishApi.generateAiSystemPrompt({ goal: promptGoal });
      setGeneratedPrompt(generated.prompt);
      setPromptFeedback({ kind: "success", message: `系统提示词已生成，可继续修改（${generated.model}）` });
    } catch (reason) {
      setPromptFeedback({ kind: "error", message: reason instanceof Error ? reason.message : "系统提示词生成失败，请稍后重试" });
    } finally {
      setPromptGenerating(false);
    }
  }

  async function copyGeneratedPrompt() {
    if (!generatedPrompt.trim()) return;
    try {
      await navigator.clipboard.writeText(generatedPrompt);
      setPromptFeedback({ kind: "success", message: "系统提示词已复制" });
    } catch {
      setPromptFeedback({ kind: "error", message: "复制失败，请手动选择提示词" });
    }
  }

  function applyPromptToCustom() {
    const custom = presetFor("custom");
    setSearchParams({ mode: "custom" });
    setPrimaryText("");
    setSecondaryText(custom.defaultSecondary);
    setSystemPrompt(generatedPrompt);
    setResult(null);
    setError(null);
    setCopyFeedback(null);
    setPromptFeedback(null);
    setHistoryKind("custom");
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
      {polishPresets.map((item) => <Link aria-current={!promptBuilderSelected && selectedKind === item.kind ? "page" : undefined} className={`polish-mode-card ${!promptBuilderSelected && selectedKind === item.kind ? "active" : ""}`} to={`?mode=${item.kind}`} key={item.kind} onClick={(event) => { event.preventDefault(); selectKind(item.kind); }}><span className="tool-icon"><Icon name={item.icon} /></span><span><strong>{item.title}</strong><small>{item.description}</small></span><Icon name="arrow" size={16} className="mode-arrow" /></Link>)}
      <Link aria-current={promptBuilderSelected ? "page" : undefined} className={`polish-mode-card ${promptBuilderSelected ? "active" : ""}`} to="?mode=prompt_builder" onClick={(event) => { event.preventDefault(); selectPromptBuilder(); }}><span className="tool-icon"><Icon name="sparkles" /></span><span><strong>提示词生成</strong><small>单独创建系统提示词</small></span><Icon name="arrow" size={16} className="mode-arrow" /></Link>
    </nav>

    {promptBuilderSelected ? <div className="prompt-builder-workspace">
      <section className="prompt-builder-card" aria-labelledby="prompt-builder-input-heading"><div className="card-heading"><div className="card-icon"><Icon name="sparkles" /></div><div><span className="step-label">描述任务</span><h3 id="prompt-builder-input-heading">提示词需求</h3></div></div><p>说明 AI 要完成的工作、输入内容、输出格式和必须遵守的限制。</p><label>你希望 AI 做什么<textarea aria-label="提示词生成需求" placeholder="例如：把会议记录整理成包含负责人和截止日期的行动项，不要补充原文没有的信息。" value={promptGoal} onChange={(event) => setPromptGoal(event.target.value)} rows={8} /></label><button className="button-primary" type="button" disabled={promptGenerating || promptGoal.trim().length < 5} onClick={() => void generateSystemPrompt()}>{promptGenerating ? <><span className="spinner" />生成提示词中…</> : <><Icon name="sparkles" size={17} />自动生成提示词</>}</button></section>
      <section className="prompt-builder-card" aria-labelledby="prompt-builder-result-heading"><div className="card-heading"><div className="card-icon accent"><Icon name="file" /></div><div><span className="step-label">生成结果</span><h3 id="prompt-builder-result-heading">系统提示词</h3></div></div><p>生成后可以继续修改、复制，或直接带到自定义工具中使用。</p><label>生成的系统提示词<textarea aria-label="生成的系统提示词" placeholder="生成的系统提示词会显示在这里…" value={generatedPrompt} onChange={(event) => setGeneratedPrompt(event.target.value)} rows={12} /></label><div className="prompt-builder-actions"><button className="button-secondary" type="button" disabled={!generatedPrompt.trim()} onClick={() => void copyGeneratedPrompt()}><Icon name="copy" size={17} />复制提示词</button><button className="button-primary" type="button" disabled={!generatedPrompt.trim()} onClick={applyPromptToCustom}><Icon name="arrow" size={17} />应用到自定义</button></div>{promptFeedback && <p className={`prompt-feedback ${promptFeedback.kind}`} role={promptFeedback.kind === "error" ? "alert" : "status"}>{promptFeedback.message}</p>}</section>
    </div> : <div className="ai-polish-workspace">
      <div className="daily-report-workspace">
        <form className="daily-report-input" onSubmit={generate}>
          <div className="card-heading"><div className="card-icon"><Icon name={preset.icon} /></div><div><span className="step-label">当前场景</span><h3>{preset.title}</h3></div></div>
          <label><span>{preset.primaryLabel}<small>{preset.primaryHint}</small></span><textarea aria-label={preset.primaryLabel} placeholder={preset.primaryPlaceholder} value={primaryText} onChange={(event) => setPrimaryText(event.target.value)} rows={4} /></label>
          {selectedKind === "translation" ? <fieldset className="translation-direction"><legend><span>{preset.secondaryLabel}</span><small>{preset.secondaryHint}</small></legend><div className="translation-direction-options">{["中文 → 英文", "英文 → 中文"].map((direction) => <label className="translation-direction-card" key={direction}><input type="radio" name="translation-direction" value={direction} checked={secondaryText === direction} onChange={(event) => setSecondaryText(event.target.value)} /><span>{direction}</span></label>)}</div></fieldset> : <label><span>{preset.secondaryLabel}<small>{preset.secondaryHint}</small></span><textarea aria-label={preset.secondaryLabel} placeholder={preset.secondaryPlaceholder} value={secondaryText} onChange={(event) => setSecondaryText(event.target.value)} rows={3} /></label>}
          <details className="prompt-editor" open><summary>查看和修改提示词</summary><label>系统提示词<textarea aria-label="系统提示词" value={systemPrompt} onChange={(event) => { setSystemPrompt(event.target.value); setPromptSaveFeedback(null); }} rows={4} /></label><div className="prompt-editor-actions"><button className="button-ghost compact" type="button" onClick={() => { setSystemPrompt(preset.systemPrompt); setPromptSaveFeedback(null); }}>恢复默认</button><button className="button-secondary compact" type="button" disabled={promptSaving || !systemPrompt.trim()} onClick={() => void saveSystemPrompt()}>{promptSaving ? <><span className="spinner" />保存中…</> : <><Icon name="check" size={16} />保存提示词</>}</button></div>{promptSaveFeedback && <p className={`prompt-feedback ${promptSaveFeedback.kind}`} role={promptSaveFeedback.kind === "error" ? "alert" : "status"}>{promptSaveFeedback.message}</p>}</details>
          <button className="button-primary generate-button" type="submit" disabled={submitting || !systemPrompt.trim() || (!primaryText.trim() && !secondaryText.trim())}>{submitting ? <><span className="spinner" />生成中…</> : <><Icon name="sparkles" size={18} />{preset.actionLabel}</>}</button>
          {error && <div role="alert">{error} {error.includes("配置") && <Link to="/settings">前往设置</Link>}</div>}
        </form>

        <section className="daily-report-result" aria-labelledby="ai-polish-result-heading"><div className="card-heading"><div className="card-icon accent"><Icon name="file" /></div><div><span className="step-label">生成结果</span><h3 id="ai-polish-result-heading">{preset.title}结果</h3></div></div>{result ? <><pre>{result.content}</pre><button className="button-secondary" type="button" onClick={() => void copyResult()}><Icon name="copy" size={17} />复制全文</button>{copyFeedback && <p role="status">{copyFeedback}</p>}</> : <div className="result-empty"><span><Icon name="sparkles" size={26} /></span><strong>等待生成</strong><p>填写左侧素材，AI 处理后的文案会显示在这里。</p></div>}</section>
      </div>

      <AiPolishHistory records={records} selectedKind={historyKind} onSelectKind={setHistoryKind} onReopen={setResult} onSave={saveHistory} />
    </div>}
  </section>;
}
