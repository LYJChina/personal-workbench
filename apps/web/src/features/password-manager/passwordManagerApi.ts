import type { PasswordManagerEntryDetail, PasswordManagerEntryInput, PasswordManagerEntrySummary, PasswordManagerStatus } from "@workbench/contracts";
import type { SurfaceLayoutItem } from "@workbench/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/password-manager${path}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error("密码库请求失败，请稍后重试");
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export interface PasswordManagerFeatureApi {
  status(): Promise<PasswordManagerStatus>; setup(password: string): Promise<PasswordManagerStatus>; unlock(password: string): Promise<PasswordManagerStatus>; lock(): Promise<void>;
  listEntries(): Promise<PasswordManagerEntrySummary[]>; createEntry(input: PasswordManagerEntryInput): Promise<PasswordManagerEntrySummary>; updateEntry(id: string, input: PasswordManagerEntryInput): Promise<PasswordManagerEntrySummary>; deleteEntry(id: string): Promise<void>; revealEntry(id: string): Promise<PasswordManagerEntryDetail>;
  importEntries(items: PasswordManagerEntryInput[]): Promise<void>; updateLayout?(items: SurfaceLayoutItem[]): Promise<void>; requestRedactedAiHelp?(redactedText: string): Promise<unknown>;
}

export const passwordManagerApi: PasswordManagerFeatureApi = {
  status: () => request("/status"), setup: (password) => request("/setup", { method: "POST", body: JSON.stringify({ password }) }), unlock: (password) => request("/unlock", { method: "POST", body: JSON.stringify({ password }) }), lock: () => request("/lock", { method: "POST" }),
  listEntries: () => request("/entries"), createEntry: (input) => request("/entries", { method: "POST", body: JSON.stringify(input) }), updateEntry: (id, input) => request(`/entries/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }), deleteEntry: (id) => request(`/entries/${encodeURIComponent(id)}`, { method: "DELETE" }), revealEntry: (id) => request(`/entries/${encodeURIComponent(id)}/reveal`, { method: "POST" }), importEntries: (items) => request("/import", { method: "POST", body: JSON.stringify({ items }) }), updateLayout: (items) => request("/layout", { method: "PUT", body: JSON.stringify({ items }) }), requestRedactedAiHelp: (redactedText) => request("/import/assist", { method: "POST", body: JSON.stringify({ text: redactedText }) })
};
