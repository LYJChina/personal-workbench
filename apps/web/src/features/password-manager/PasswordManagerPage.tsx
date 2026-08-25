import { useEffect, useMemo, useState } from "react";
import type { PasswordManagerEntryDetail, PasswordManagerEntryInput, PasswordManagerEntrySummary, PasswordManagerStatus } from "@workbench/contracts";
import type { SurfaceLayoutItem } from "@workbench/contracts";
import { EditableSurfaceGrid } from "../layout/EditableSurfaceGrid";
import { BulkImportDialog } from "./BulkImportDialog";
import { CredentialCard } from "./CredentialCard";
import { CredentialEditorDialog } from "./CredentialEditorDialog";
import { passwordManagerApi, type PasswordManagerFeatureApi } from "./passwordManagerApi";
import "./password-manager.css";

export type PasswordManagerApi = PasswordManagerFeatureApi;
const errorText = (error: unknown) => error instanceof Error ? error.message : "请求失败，请稍后重试";

function Gate({ status, api, onUnlocked }: { status: PasswordManagerStatus; api: PasswordManagerApi; onUnlocked(status: PasswordManagerStatus): void }) {
  const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null);
  const setup = !status.configured;
  async function submit(event: React.FormEvent) { event.preventDefault(); try { onUnlocked(setup ? await api.setup(password) : await api.unlock(password)); setPassword(""); } catch (reason) { setError(errorText(reason)); } }
  return <section className="password-gate"><h2>{setup ? "设置独立密码" : "解锁密码库"}</h2><p>此密码库与主保险箱独立，闲置后会自动锁定。</p><form onSubmit={(event) => void submit(event)}><label>{setup ? "设置密码" : "密码"}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label><button type="submit" disabled={!password}>{setup ? "创建密码库" : "解锁"}</button></form>{error && <p role="alert">{error}</p>}</section>;
}

export function PasswordManagerPage({ api = passwordManagerApi }: { api?: PasswordManagerApi }) {
  const [status, setStatus] = useState<PasswordManagerStatus | null>(null); const [entries, setEntries] = useState<PasswordManagerEntrySummary[]>([]); const [search, setSearch] = useState(""); const [revealed, setRevealed] = useState<Record<string, PasswordManagerEntryDetail>>({}); const [editor, setEditor] = useState<PasswordManagerEntrySummary | null | undefined>(); const [importing, setImporting] = useState(false); const [confirming, setConfirming] = useState<PasswordManagerEntrySummary | null>(null); const [feedback, setFeedback] = useState<string | null>(null); const [editingLayout, setEditingLayout] = useState(false);
  const reload = async () => setEntries(await api.listEntries());
  useEffect(() => { let active = true; void api.status().then(async (next) => { if (!active) return; setStatus(next); if (next.unlocked) setEntries(await api.listEntries()); }).catch((reason) => active && setFeedback(errorText(reason))); return () => { active = false; setRevealed({}); }; }, [api]);
  const visible = useMemo(() => entries.filter((entry) => `${entry.name} ${entry.website} ${entry.username}`.toLowerCase().includes(search.toLowerCase())), [entries, search]);
  async function unlock(next: PasswordManagerStatus) { setStatus(next); if (next.unlocked) await reload(); }
  async function lock() { try { await api.lock(); setRevealed({}); setEntries([]); setStatus((current) => current ? { ...current, unlocked: false } : current); } catch (reason) { setFeedback(errorText(reason)); } }
  async function reveal(entry: PasswordManagerEntrySummary) { try { const detail = await api.revealEntry(entry.id); setRevealed((current) => ({ ...current, [entry.id]: detail })); } catch (reason) { setFeedback(errorText(reason)); } }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setFeedback("已复制到剪贴板"); } catch { setFeedback("复制失败，请手动复制"); } }
  async function save(input: PasswordManagerEntryInput) { try { if (editor) await api.updateEntry(editor.id, input); else await api.createEntry(input); await reload(); setEditor(undefined); } catch (reason) { setFeedback(errorText(reason)); } }
  async function remove() { if (!confirming) return; try { await api.deleteEntry(confirming.id); setConfirming(null); await reload(); } catch (reason) { setFeedback(errorText(reason)); } }
  async function importItems(items: PasswordManagerEntryInput[]) { try { await api.importEntries(items); setImporting(false); await reload(); } catch (reason) { setFeedback(errorText(reason)); } }
  if (!status) return <section aria-label="加载密码库">正在加载密码库…</section>;
  if (!status.unlocked) return <Gate status={status} api={api} onUnlocked={(next) => void unlock(next)} />;
  const layoutItems: SurfaceLayoutItem[] = visible.map((entry, index) => ({ itemId: entry.id, surface: "dashboard", x: (index % 2) * 8, y: Math.floor(index / 2) * 3, w: 8, h: 3, enabled: true }));
  return <section className="password-manager-page"><header><div><h2>密码管理器</h2><p>凭据只在明确显示或复制时短暂留在内存中。</p></div><button type="button" onClick={() => void lock()}>锁定密码库</button></header>{feedback && <p role="status">{feedback}</p>}<div className="password-manager-toolbar"><label>搜索凭据<input aria-label="搜索凭据" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button type="button" onClick={() => setEditor(null)}>新建凭据</button><button type="button" onClick={() => setImporting(true)}>导入凭据</button><button type="button" onClick={() => setEditingLayout((current) => !current)}>{editingLayout ? "完成布局" : "编辑布局"}</button></div><EditableSurfaceGrid surface="dashboard" items={layoutItems} editing={editingLayout} onLayoutChange={(items) => void api.updateLayout?.(items).catch((reason) => setFeedback(errorText(reason)))} renderItem={(item) => { const entry = visible.find((candidate) => candidate.id === item.itemId); return entry ? <CredentialCard entry={entry} revealed={revealed[entry.id]} onReveal={() => void reveal(entry)} onCopy={(value) => void copy(value)} onEdit={() => setEditor(entry)} onDelete={() => setConfirming(entry)} /> : null; }} />{editor !== undefined && <CredentialEditorDialog entry={editor ?? undefined} onSave={(input) => void save(input)} onClose={() => setEditor(undefined)} />}{importing && <BulkImportDialog onImport={(items) => void importItems(items)} onClose={() => setImporting(false)} />}{confirming && <div role="dialog" aria-label="确认删除"><p>确定删除 {confirming.name} 吗？</p><button type="button" onClick={() => void remove()}>确认删除 {confirming.name}</button><button type="button" onClick={() => setConfirming(null)}>取消</button></div>}</section>;
}
