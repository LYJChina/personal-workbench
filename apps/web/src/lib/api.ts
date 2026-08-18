import type {
  ConnectionTestResult,
  AiPolishInput,
  AiPolishKind,
  AiPolishPrompt,
  AiPolishRecord,
  AiSystemPromptInput,
  AiSystemPromptResult,
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
  SchedulerStatus,
  HolidayDay,
  SettingsResponse,
  Theme
} from "@workbench/contracts";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "请求失败，请稍后重试");
  }
  return response.json() as Promise<T>;
}

async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? "请求失败，请稍后重试");
  }
}

export const api = {
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
  getReminderSchedulerStatus: () => requestJson<SchedulerStatus>("/reminder-scheduler/status"),
  syncReminderScheduler: () => requestJson<SchedulerStatus>("/reminder-scheduler/sync", { method: "POST" }),
  getCalendar: (from: string, to: string) => requestJson<{ days: HolidayDay[]; coverage: Array<{ year: number; synchronizedAt: string }> }>(
    `/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
  ),
  syncCalendar: (years: number[]) => requestJson<{ updatedYears: number[]; unavailableYears: number[] }>("/calendar/sync", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ years })
  }),
  getUpcomingReminders: () => requestJson<{ items: GenericReminder[] }>("/dashboard/upcoming-reminders")
};
