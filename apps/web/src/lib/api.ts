import type {
  AiConnection,
  AiConnectionCreate,
  AiConnectionUpdate,
  AiOfficeOrder,
  ConnectionTestResult,
  AiPolishInput,
  AiPolishKind,
  AiPolishPrompt,
  AiPolishRecord,
  AiSystemPromptInput,
  AiSystemPromptResult,
  AiChatMessage,
  AiPersonaSettings,
  AiPersonaSettingsUpdate,
  DashboardLayout,
  DailyReport,
  DailyReportInput,
  DeepSeekSettings,
  DeepSeekSettingsUpdate,
  MailSettings,
  MailSettingsUpdate,
  NavigationItem,
  ProfileResponse,
  ProfileUpdate,
  Reminder,
  ReminderTestResult,
  ReminderUpdate,
  GenericReminder,
  GenericReminderInput,
  GenericReminderAttempt,
  HolidayDay,
  PluginSummary,
  SettingsResponse,
  Theme,
  VaultStatus
  ,AppearancePreference
  ,AppearanceSettings
} from "@workbench/contracts";
import {
  WORKBENCH_MUTATION_HEADER_NAME,
  WORKBENCH_MUTATION_HEADER_VALUE
} from "@workbench/contracts";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function withMutationProvenance(init?: RequestInit): RequestInit | undefined {
  if (!init?.method || !mutationMethods.has(init.method.toUpperCase())) return init;
  return {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      [WORKBENCH_MUTATION_HEADER_NAME]: WORKBENCH_MUTATION_HEADER_VALUE
    }
  };
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, withMutationProvenance(init));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "请求失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`/api${path}`, withMutationProvenance(init));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "请求失败，请稍后重试");
  }
}

const fallbackBackupFilename = "LYJWorkBench-backup.sqlite";

function backupFilename(contentDisposition: string | null): string {
  const candidate = contentDisposition?.match(/filename="([^"]+)"/i)?.[1];
  if (!candidate || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.sqlite$/.test(candidate) || candidate.includes("..")) {
    return fallbackBackupFilename;
  }
  return candidate;
}

async function exportDatabase(): Promise<string> {
  const response = await fetch("/api/backup/export", withMutationProvenance({ method: "POST" }));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "导出失败，请稍后重试");
  }

  const blob = await response.blob();
  const filename = backupFilename(response.headers.get("Content-Disposition"));
  let objectUrl: string | undefined;
  let anchor: HTMLAnchorElement | undefined;
  try {
    objectUrl = URL.createObjectURL(blob);
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    return filename;
  } finally {
    anchor?.remove();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export const api = {
  exportDatabase,
  getPlugins: (signal?: AbortSignal) => requestJson<PluginSummary[]>(
    "/plugins",
    signal ? { signal } : undefined
  ),
  setPluginEnabled: (id: string, enabled: boolean, signal?: AbortSignal) => requestJson<PluginSummary>(
    `/plugins/${encodeURIComponent(id)}/enabled`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
      ...(signal ? { signal } : {})
    }
  ),
  resetPluginSafeMode: (signal?: AbortSignal) => requestJson<PluginSummary[]>(
    "/plugins/safe-mode/reset",
    { method: "POST", ...(signal ? { signal } : {}) }
  ),
  getPluginContributions: (signal?: AbortSignal) => requestJson<unknown>(
    "/plugins/contributions",
    signal ? { signal } : undefined
  ),
  getVaultStatus: () => requestJson<VaultStatus>("/vault/status"),
  getLegacyImportStatus: () => requestJson<{ detected: boolean }>("/vault/legacy-import-status"),
  setupVault: (masterPassword: string) => requestJson<VaultStatus>("/vault/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword })
  }),
  enrollVault: (input: import("@workbench/contracts").VaultEnrollmentInput) => requestJson<import("@workbench/contracts").VaultRecoveryStatus>("/vault/enroll", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  }),
  unlockVault: (masterPassword: string) => requestVoid("/vault/unlock", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterPassword })
  }),
  lockVault: () => requestVoid("/vault/lock", { method: "POST" }),
  getVaultRecoveryStatus: () => requestJson<import("@workbench/contracts").VaultRecoveryStatus>("/vault/recovery/status"),
  changeVaultPassword: (currentPassword: string, newPassword: string) => requestVoid("/vault/password", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword })
  }),
  resetVaultWithRecoveryCode: (recoveryCode: string, newPassword: string) => requestVoid("/vault/recovery/code-reset", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recoveryCode, newPassword })
  }),
  resetVaultWithSmtp: (smtpEmail: string, smtpPassword: string, newPassword: string) => requestVoid("/vault/recovery/smtp-reset", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ smtpEmail, smtpPassword, newPassword })
  }),
  confirmVaultRecovery: (confirmationCode: string) => requestVoid("/vault/recovery/confirm", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationCode })
  }),
  getProfile: () => requestJson<ProfileResponse>("/profile"),
  updateProfile: (profile: ProfileUpdate) => requestJson<ProfileResponse>("/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile)
  }),
  uploadProfilePhoto: async (photo: File) => {
    const form = new FormData();
    form.append("photo", photo);
    return requestJson<ProfileResponse>("/profile/photo", { method: "POST", body: form });
  },
  getLayout: () => requestJson<DashboardLayout[]>("/preferences/layout"),
  updateLayout: (layout: DashboardLayout[]) => requestJson<DashboardLayout[]>("/preferences/layout", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(layout)
  }),
  getNavigation: () => requestJson<NavigationItem[]>("/preferences/navigation"),
  updateNavigation: (navigation: NavigationItem[]) => requestJson<NavigationItem[]>("/preferences/navigation", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(navigation)
  }),
  getTheme: () => requestJson<{ theme: Theme }>("/preferences/theme"),
  updateTheme: (theme: Theme) => requestJson<{ theme: Theme }>("/preferences/theme", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme })
  }),
  getSettings: () => requestJson<SettingsResponse>("/settings"),
  getAiConnections: (signal?: AbortSignal) => requestJson<AiConnection[]>(
    "/settings/ai-connections",
    signal ? { signal } : undefined
  ),
  createAiConnection: (connection: AiConnectionCreate, signal?: AbortSignal) => requestJson<AiConnection>(
    "/settings/ai-connections",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connection),
      ...(signal ? { signal } : {})
    }
  ),
  updateAiConnection: (id: string, connection: AiConnectionUpdate, signal?: AbortSignal) => requestJson<AiConnection>(
    `/settings/ai-connections/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(connection),
      ...(signal ? { signal } : {})
    }
  ),
  setDefaultAiConnection: (id: string, signal?: AbortSignal) => requestJson<AiConnection>(
    `/settings/ai-connections/${encodeURIComponent(id)}/default`,
    { method: "PUT", ...(signal ? { signal } : {}) }
  ),
  testAiConnection: (id: string, signal?: AbortSignal) => requestJson<ConnectionTestResult>(
    `/settings/ai-connections/${encodeURIComponent(id)}/test`,
    { method: "POST", ...(signal ? { signal } : {}) }
  ),
  deleteAiConnection: (id: string, signal?: AbortSignal) => requestVoid(
    `/settings/ai-connections/${encodeURIComponent(id)}`,
    { method: "DELETE", ...(signal ? { signal } : {}) }
  ),
  updateDeepSeekSettings: (settings: DeepSeekSettingsUpdate) => requestJson<DeepSeekSettings>("/settings/deepseek", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  }),
  updateMailSettings: (settings: MailSettingsUpdate) => requestJson<MailSettings>("/settings/mail", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  }),
  testDeepSeekConnection: () => requestJson<ConnectionTestResult>("/settings/deepseek/test", { method: "POST" }),
  testMailConnection: () => requestJson<ConnectionTestResult>("/settings/mail/test", { method: "POST" }),
  generateDailyReport: (input: DailyReportInput) => requestJson<DailyReport>("/daily-reports/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }),
  getDailyReports: () => requestJson<DailyReport[]>("/daily-reports"),
  getDailyReport: (id: number) => requestJson<DailyReport>(`/daily-reports/${id}`),
  updateDailyReport: (id: number, content: string) => requestJson<DailyReport>(`/daily-reports/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  }),
  generateAiPolish: (input: AiPolishInput) => requestJson<AiPolishRecord>("/ai-polish/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }),
  generateAiSystemPrompt: (input: AiSystemPromptInput) => requestJson<AiSystemPromptResult>("/ai-polish/system-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }),
  getAiPolishHistory: () => requestJson<AiPolishRecord[]>("/ai-polish"),
  getAiChatMessages: () => requestJson<AiChatMessage[]>("/ai-chat/messages"),
  sendAiChatMessage: (content: string) => requestJson<AiChatMessage>("/ai-chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  }),
  getAiPersona: () => requestJson<AiPersonaSettings>("/ai-chat/persona"),
  updateAiPersona: (settings: AiPersonaSettingsUpdate) => requestJson<AiPersonaSettings>("/ai-chat/persona", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings)
  }),
  generateAiPersona: () => requestJson<AiPersonaSettings>("/ai-chat/persona/generate", { method: "POST" }),
  getAppearance: () => requestJson<AppearancePreference>("/preferences/appearance"),
  updateAppearance: (appearance: AppearanceSettings) => requestJson<AppearanceSettings>("/preferences/appearance", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(appearance)
  }),
  getAiOfficeOrder: () => requestJson<AiOfficeOrder>("/preferences/ai-office-order"),
  updateAiOfficeOrder: (order: AiOfficeOrder) => requestJson<AiOfficeOrder>("/preferences/ai-office-order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(order)
  }),
  clearAiChatMessages: () => requestVoid("/ai-chat/messages", { method: "DELETE" }),
  getAiPolishPrompts: () => requestJson<AiPolishPrompt[]>("/ai-polish/prompts"),
  saveAiPolishPrompt: (kind: AiPolishKind, systemPrompt: string) => requestJson<AiPolishPrompt>(`/ai-polish/prompts/${kind}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ systemPrompt })
  }),
  updateAiPolish: (id: number, content: string) => requestJson<AiPolishRecord>(`/ai-polish/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  }),
  getReminder: () => requestJson<Reminder>("/reminders/outbound-checkin"),
  updateReminder: (input: ReminderUpdate) => requestJson<Reminder>("/reminders/outbound-checkin", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }),
  testReminder: () => requestJson<ReminderTestResult>("/reminders/outbound-checkin/test", { method: "POST" }),
  listReminders: () => requestJson<{ items: GenericReminder[] }>("/reminders"),
  createGenericReminder: (input: GenericReminderInput) => requestJson<GenericReminder>("/reminders", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  }),
  updateGenericReminder: (id: string, input: GenericReminderInput) => requestJson<GenericReminder>(`/reminders/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  }),
  deleteGenericReminder: (id: string) => requestVoid(`/reminders/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listReminderAttempts: () => requestJson<{ items: GenericReminderAttempt[] }>("/reminder-attempts"),
  testGenericReminder: (id: string) => requestJson<ReminderTestResult>(`/reminders/${encodeURIComponent(id)}/test`, { method: "POST" }),
  getCalendar: (from: string, to: string) => requestJson<{ days: HolidayDay[]; coverage: Array<{ year: number; synchronizedAt: string }> }>(
    `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  ),
  syncCalendar: (years: number[]) => requestJson<{ updatedYears: number[]; unavailableYears: number[] }>("/calendar/sync", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ years })
  }),
  getUpcomingReminders: () => requestJson<{ items: GenericReminder[] }>("/dashboard/upcoming-reminders")
};
