import { useEffect, useState } from "react";
import type { ModelDigestHistoryPage, ModelDigestRun } from "@workbench/contracts";

export interface ModelDigestHistoryApi {
  listModelDigestRuns(limit?: number, offset?: number): Promise<ModelDigestHistoryPage>;
  listModelDigestTrash(limit?: number, offset?: number): Promise<ModelDigestHistoryPage>;
  getModelDigestRun(id: string): Promise<ModelDigestRun>;
  getDeletedModelDigestRun(id: string): Promise<ModelDigestRun>;
  deleteModelDigestRun(id: string): Promise<void>;
  restoreModelDigestRun(id: string): Promise<ModelDigestRun>;
}

const pageSize = 20;

export function ModelDigestHistoryPanel({ api, onSelect, onDelete, revision }: {
  api: ModelDigestHistoryApi;
  onSelect: (run: ModelDigestRun) => void;
  onDelete: (id: string) => void;
  revision: number;
}) {
  const [tab, setTab] = useState<"history" | "trash">("history");
  const [offset, setOffset] = useState(0);
  const [localRevision, setLocalRevision] = useState(0);
  const [page, setPage] = useState<ModelDigestHistoryPage | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const load = tab === "history" ? api.listModelDigestRuns(pageSize, offset) : api.listModelDigestTrash(pageSize, offset);
    load.then((result) => { if (live) {
      if (result.items.length === 0 && offset > 0) setOffset(Math.max(0, offset - pageSize));
      else setPage(result);
      setError("");
    } })
      .catch((reason: unknown) => { if (live) setError(reason instanceof Error ? reason.message : "历史记录加载失败"); });
    return () => { live = false; };
  }, [api, tab, offset, revision, localRevision]);

  function switchTab(next: "history" | "trash") { setTab(next); setOffset(0); setPage(null); }

  async function view(id: string) {
    setBusyId(id); setError("");
    try { onSelect(await (tab === "trash" ? api.getDeletedModelDigestRun(id) : api.getModelDigestRun(id))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "记录打开失败"); }
    finally { setBusyId(null); }
  }

  async function remove(id: string) {
    setBusyId(id); setError("");
    try { await api.deleteModelDigestRun(id); onDelete(id); setLocalRevision((value) => value + 1); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "移到回收站失败"); }
    finally { setBusyId(null); }
  }

  async function restore(id: string) {
    setBusyId(id); setError("");
    try {
      const run = await api.restoreModelDigestRun(id);
      onSelect(run);
      setLocalRevision((value) => value + 1);
      switchTab("history");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "恢复失败"); }
    finally { setBusyId(null); }
  }

  return <section className="model-digest-history">
    <div className="digest-history-header"><div><h3>查看历史记录</h3><p>每次查询和总结都会保存在本机数据库中。</p></div>
      <div className="digest-history-tabs" role="group" aria-label="记录分类">
        <button type="button" className={tab === "history" ? "active" : ""} onClick={() => switchTab("history")}>历史记录</button>
        <button type="button" className={tab === "trash" ? "active" : ""} onClick={() => switchTab("trash")}>回收站</button>
      </div>
    </div>
    {error && <p className="model-digest-message error" role="alert">{error}</p>}
    {!page ? <p className="digest-muted">正在加载记录…</p> : page.items.length === 0
      ? <p className="digest-history-empty">{tab === "trash" ? "回收站是空的。" : "还没有历史记录。"}</p>
      : <ul className="digest-history-list">{page.items.map((item) => <li key={item.id}>
        <div><strong>{new Date(item.createdAt).toLocaleString("zh-CN")}</strong><span>{item.type === "scheduled" ? "定时更新" : "手动查询"} · {item.status === "succeeded" ? "已完成" : item.status === "failed" ? "失败" : "进行中"}{item.hasSummary ? " · 有总结" : ""}</span></div>
        <div className="digest-history-actions"><button type="button" disabled={busyId === item.id} onClick={() => void view(item.id)}>查看记录</button>
          {tab === "trash" ? <button type="button" disabled={busyId === item.id} onClick={() => void restore(item.id)}>恢复</button>
            : <button type="button" disabled={busyId === item.id || !["succeeded", "failed"].includes(item.status)} onClick={() => void remove(item.id)}>移到回收站</button>}
        </div>
      </li>)}</ul>}
    {page && page.total > pageSize && <div className="digest-history-pagination">
      <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>上一页</button>
      <span>{Math.floor(offset / pageSize) + 1} / {Math.ceil(page.total / pageSize)}</span>
      <button type="button" disabled={offset + pageSize >= page.total} onClick={() => setOffset(offset + pageSize)}>下一页</button>
    </div>}
  </section>;
}
