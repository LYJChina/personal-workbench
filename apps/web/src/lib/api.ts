import type {
  ConnectionTestResult,
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
  getReminder: () => requestJson<Reminder>("/reminders/outbound-checkin"),
  updateReminder: (input: ReminderUpdate) => requestJson<Reminder>("/reminders/outbound-checkin", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  }),
  testReminder: () => requestJson<ReminderTestResult>("/reminders/outbound-checkin/test", { method: "POST" })
};
