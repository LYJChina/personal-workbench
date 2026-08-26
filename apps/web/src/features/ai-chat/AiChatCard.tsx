import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AiChatMessage } from "@workbench/contracts";
import type { AiPersonaSettings } from "@workbench/contracts";
import { api as sharedApi } from "../../lib/api";
import { Icon } from "../../app/Icon";

export interface AiChatCardApi {
  listMessages(): Promise<AiChatMessage[]>;
  sendMessage(content: string): Promise<AiChatMessage>;
  clearMessages(): Promise<void>;
}

const defaultApi: AiChatCardApi = {
  listMessages: sharedApi.getAiChatMessages,
  sendMessage: sharedApi.sendAiChatMessage,
  clearMessages: sharedApi.clearAiChatMessages
};

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : "模型暂时无法响应，请稍后再试";
}

export function AiChatCard({ api = defaultApi }: { api?: AiChatCardApi }) {
  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persona, setPersona] = useState<AiPersonaSettings | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api.listMessages()
      .then((items) => active && setMessages(items))
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [api]);
  useEffect(() => { void sharedApi.getAiPersona?.().then(setPersona).catch(() => undefined); }, []);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages, sending]);

  async function send() {
    const content = draft.trim();
    if (!content || loading || sending) return;
    const optimistic: AiChatMessage = {
      id: -Date.now(), role: "user", content, model: null, createdAt: new Date().toISOString()
    };
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setError(null);
    setSending(true);
    try {
      const assistant = await api.sendMessage(content);
      setMessages((current) => [...current, assistant]);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  }

  async function clearConversation() {
    if (messages.length > 0 && !window.confirm("确定清空当前对话吗？")) return;
    setError(null);
    try {
      await api.clearMessages();
      setMessages([]);
      setDraft("");
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  const assistantName = persona?.assistantName || "AI";
  return <section className="dashboard-card ai-chat-card" aria-label="大模型对话">
    <header>
      <div className="ai-chat-title"><span className="card-icon violet"><Icon name="sparkles" size={18} /></span><div><h3>问问 {assistantName}</h3><small>使用你在设置中配置的模型</small></div></div>
      <button className="button-ghost compact" type="button" disabled={loading || sending} onClick={() => void clearConversation()}>新对话</button>
    </header>
    <div className="ai-chat-log" role="log" aria-label="大模型对话记录" aria-live="polite" ref={logRef}>
      {loading
        ? <div className="ai-chat-empty"><span className="spinner" />正在读取本地对话…</div>
        : messages.length === 0
          ? <div className="ai-chat-empty"><Icon name="sparkles" size={22} /><strong>随时问我一个问题</strong><span>例如：帮我整理今天的工作重点</span></div>
          : messages.map((message) => <article className={`ai-chat-message ${message.role}`} key={message.id}><span>{message.role === "user" ? "我" : assistantName}</span><p>{message.content}</p></article>)}
      {sending && <div className="ai-chat-thinking"><span className="spinner" />正在思考…</div>}
    </div>
    {error && <p className="ai-chat-error" role="alert">{error}</p>}
    <form className="ai-chat-composer" onSubmit={submit}>
      <textarea aria-label="输入问题" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={handleKeyDown} placeholder={loading ? "正在读取本地对话…" : "输入问题，Enter 发送…"} rows={2} disabled={loading || sending} />
      <button className="button-primary compact" type="submit" disabled={loading || sending || !draft.trim()}>发送</button>
    </form>
  </section>;
}
