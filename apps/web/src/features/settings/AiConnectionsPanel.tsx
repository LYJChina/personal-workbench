import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  AiConnection,
  AiConnectionCreate,
  AiConnectionUpdate,
  AiProviderProtocol,
  ConnectionTestResult
} from "@workbench/contracts";
import { Icon } from "../../app/Icon";

export interface AiConnectionsApi {
  getAiConnections(signal?: AbortSignal): Promise<AiConnection[]>;
  createAiConnection(input: AiConnectionCreate, signal?: AbortSignal): Promise<AiConnection>;
  updateAiConnection(id: string, input: AiConnectionUpdate, signal?: AbortSignal): Promise<AiConnection>;
  setDefaultAiConnection(id: string, signal?: AbortSignal): Promise<AiConnection>;
  testAiConnection(id: string, signal?: AbortSignal): Promise<ConnectionTestResult>;
  deleteAiConnection(id: string, signal?: AbortSignal): Promise<void>;
}

interface AiConnectionsPanelProps {
  api: AiConnectionsApi;
}

interface EditorState {
  id: string | null;
  name: string;
  protocol: AiProviderProtocol;
  baseUrl: string;
  model: string;
  apiKey: string;
}

const emptyEditor: EditorState = {
  id: null,
  name: "",
  protocol: "openai",
  baseUrl: "",
  model: "",
  apiKey: ""
};

const loadFailure = "模型服务暂时无法读取，请稍后重试。";
const actionFailure = "操作失败，请稍后重试。";

function protocolLabel(protocol: AiProviderProtocol): string {
  return protocol === "anthropic" ? "Anthropic 原生" : "OpenAI 兼容";
}

export function AiConnectionsPanel({ api }: AiConnectionsPanelProps) {
  const [connections, setConnections] = useState<AiConnection[] | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "status" | "alert"; message: string } | null>(null);
  const activeController = useRef<AbortController | null>(null);

  async function load(signal: AbortSignal) {
    const loaded = await api.getAiConnections(signal);
    if (!signal.aborted) setConnections(loaded);
  }

  useEffect(() => {
    const controller = new AbortController();
    activeController.current = controller;
    setConnections(null);
    setFeedback(null);
    void load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setFeedback({ kind: "alert", message: loadFailure });
    });
    return () => activeController.current?.abort();
  }, [api]);

  function beginEdit(connection: AiConnection) {
    setFeedback(null);
    setEditor({
      id: connection.id,
      name: connection.name,
      protocol: connection.protocol,
      baseUrl: connection.baseUrl,
      model: connection.model,
      apiKey: ""
    });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy) return;
    const controller = new AbortController();
    activeController.current = controller;
    setBusy("save");
    setFeedback(null);
    const replacement = editor.apiKey.trim();
    const input = {
      name: editor.name.trim(),
      protocol: editor.protocol,
      baseUrl: editor.baseUrl.trim(),
      model: editor.model.trim(),
      ...(replacement ? { apiKey: replacement } : {})
    };
    try {
      if (editor.id) await api.updateAiConnection(editor.id, input, controller.signal);
      else await api.createAiConnection(input, controller.signal);
      await load(controller.signal);
      if (!controller.signal.aborted) {
        setEditor(null);
        setFeedback({ kind: "status", message: "模型服务已保存" });
      }
    } catch {
      if (!controller.signal.aborted) setFeedback({ kind: "alert", message: actionFailure });
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  async function runAction(id: string, action: "default" | "test" | "delete") {
    if (busy) return;
    const controller = new AbortController();
    activeController.current = controller;
    setBusy(`${action}:${id}`);
    setFeedback(null);
    try {
      if (action === "default") {
        await api.setDefaultAiConnection(id, controller.signal);
        await load(controller.signal);
        if (!controller.signal.aborted) setFeedback({ kind: "status", message: "默认模型服务已更新" });
      } else if (action === "delete") {
        await api.deleteAiConnection(id, controller.signal);
        await load(controller.signal);
        if (!controller.signal.aborted) setFeedback({ kind: "status", message: "模型服务已删除" });
      } else {
        const result = await api.testAiConnection(id, controller.signal);
        if (!controller.signal.aborted) setFeedback({ kind: result.status === "success" ? "status" : "alert", message: result.message });
      }
    } catch {
      if (!controller.signal.aborted) setFeedback({ kind: "alert", message: actionFailure });
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  return (
    <section className="ai-connections-panel" aria-labelledby="ai-connections-heading">
      <div className="settings-section-heading">
        <div className="card-icon"><Icon name="sparkles" /></div>
        <div><h3 id="ai-connections-heading">模型服务</h3><p>统一供 AI 对话、润色和日报使用，支持 OpenAI 兼容与 Anthropic 原生协议</p></div>
        <button className="button-primary" type="button" onClick={() => { setFeedback(null); setEditor(emptyEditor); }}>添加模型服务</button>
      </div>

      {connections === null && !feedback ? <p className="muted-text">正在读取模型服务…</p> : null}
      {connections ? (
        <div className="ai-connection-list">
          {connections.map((connection) => (
            <article className="ai-connection-card" key={connection.id}>
              <div className="ai-connection-summary">
                <div>
                  <div className="ai-connection-title"><h4>{connection.name}</h4>{connection.isDefault ? <span className="status-chip">默认服务</span> : null}</div>
                  <p>{protocolLabel(connection.protocol)} · {connection.model}</p>
                  <small>{connection.baseUrl}</small>
                </div>
                <span className={`status-chip ${connection.apiKeyConfigured ? "" : "neutral"}`}>{connection.apiKeyConfigured ? "API Key 已配置" : "API Key 未配置"}</span>
              </div>
              <div className="form-actions">
                <button className="button-secondary" type="button" aria-label={`编辑 ${connection.name}`} onClick={() => beginEdit(connection)}>编辑</button>
                <button className="button-secondary" type="button" aria-label={`测试 ${connection.name}`} disabled={Boolean(busy)} onClick={() => void runAction(connection.id, "test")}>{busy === `test:${connection.id}` ? "测试中…" : "测试连接"}</button>
                {!connection.isDefault ? <button className="button-secondary" type="button" aria-label={`将 ${connection.name} 设为默认`} disabled={Boolean(busy)} onClick={() => void runAction(connection.id, "default")}>设为默认</button> : null}
                <button className="button-ghost danger" type="button" aria-label={`删除 ${connection.name}`} disabled={Boolean(busy) || connection.isDefault || connections.length === 1} onClick={() => void runAction(connection.id, "delete")}>删除</button>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {editor ? (
        <form className="ai-connection-editor" onSubmit={save}>
          <h4>{editor.id ? "编辑模型服务" : "添加模型服务"}</h4>
          <div className="form-grid">
            <label>服务名称<input required maxLength={100} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
            <label>协议<select value={editor.protocol} onChange={(event) => setEditor({ ...editor, protocol: event.target.value as AiProviderProtocol })}><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic 原生</option></select></label>
            <label>API 地址<input type="url" required value={editor.baseUrl} onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })} placeholder={editor.protocol === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"} /></label>
            <label>模型名称<input required maxLength={200} value={editor.model} onChange={(event) => setEditor({ ...editor, model: event.target.value })} /></label>
          </div>
          <label>API Key<input aria-label="API Key" type="password" autoComplete="new-password" value={editor.apiKey} onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })} placeholder={editor.id ? "留空则保持不变" : "请输入服务密钥"} /><small>只会写入本地加密保险库，保存后不再回显。</small></label>
          <div className="form-actions"><button className="button-primary" type="submit" disabled={Boolean(busy)}>{busy === "save" ? "正在保存…" : "保存模型服务"}</button><button className="button-secondary" type="button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>取消</button></div>
        </form>
      ) : null}

      {feedback ? <p role={feedback.kind}>{feedback.message}</p> : null}
    </section>
  );
}
