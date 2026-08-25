import type { PasswordManagerEntryDetail, PasswordManagerEntryInput, PasswordManagerEntrySummary, PasswordManagerStatus } from "@workbench/contracts";
import type { SurfaceLayoutItem } from "@workbench/contracts";
import { WORKBENCH_MUTATION_HEADER_NAME, WORKBENCH_MUTATION_HEADER_VALUE } from "@workbench/contracts";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(init?.headers as Record<string, string> ?? {}) };
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) headers[WORKBENCH_MUTATION_HEADER_NAME] = WORKBENCH_MUTATION_HEADER_VALUE;
  const response = await fetch(`/api/password-manager${path}`, { ...init, headers });
  if (!response.ok) throw new Error("密码库请求失败，请稍后重试");
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export interface PasswordManagerFeatureApi {
  status(): Promise<PasswordManagerStatus>; setup(password: string): Promise<PasswordManagerStatus>; unlock(password: string): Promise<PasswordManagerStatus>; lock(): Promise<void>;
  listEntries(): Promise<PasswordManagerEntrySummary[]>; createEntry(input: PasswordManagerEntryInput): Promise<PasswordManagerEntrySummary>; updateEntry(id: string, input: PasswordManagerEntryInput, version?: number): Promise<PasswordManagerEntrySummary>; deleteEntry(id: string, version?: number): Promise<void>; revealEntry(id: string): Promise<PasswordManagerEntryDetail>;
  importEntries(items: PasswordManagerEntryInput[]): Promise<void>; updateLayout?(items: SurfaceLayoutItem[]): Promise<void>; requestRedactedAiHelp?(redactedText: string): Promise<unknown>;
}

export const passwordManagerApi: PasswordManagerFeatureApi = {
  status: () => request("/status"), setup: (password) => request("/setup", { method: "POST", body: JSON.stringify({ password }) }), unlock: (password) => request("/unlock", { method: "POST", body: JSON.stringify({ password }) }), lock: () => request("/lock", { method: "POST" }),
  listEntries: async () => (await request<{ items: PasswordManagerEntrySummary[] }>("/entries")).items,
  createEntry: (input) => request("/entries", { method: "POST", body: JSON.stringify(input) }),
  updateEntry: (id, input, version) => request(`/entries/${encodeURIComponent(id)}`, { method: "PUT", headers: version ? { "If-Match": `"${version}"` } : undefined, body: JSON.stringify(input) }),
  deleteEntry: (id, version) => request(`/entries/${encodeURIComponent(id)}`, { method: "DELETE", headers: version ? { "If-Match": `"${version}"` } : undefined }),
  revealEntry: (id) => request(`/entries/${encodeURIComponent(id)}/reveal`, { method: "POST" }), importEntries: async (items) => { for (const item of items) await request("/entries", { method: "POST", body: JSON.stringify(item) }); }, updateLayout: (items) => request("/layout", { method: "PUT", body: JSON.stringify({ items }) })
};
