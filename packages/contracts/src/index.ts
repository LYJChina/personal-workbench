import { z } from "zod";

export const ApiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.string().optional()
  })
});

export const HealthResponseSchema = z.object({
  status: z.literal("ok")
});

export const CustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.string().trim().max(1_000)
});

export const ProfileSchema = z.object({
  name: z.string(),
  birthday: z.string(),
  employeeNumber: z.string(),
  customFields: z.array(CustomFieldSchema),
  photoFilename: z.string().nullable()
});

export const ProfileUpdateSchema = ProfileSchema.pick({
  name: true,
  birthday: true,
  employeeNumber: true,
  customFields: true
}).extend({
  name: z.string().trim().min(1).max(100),
  birthday: z.union([z.literal(""), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  employeeNumber: z.string().trim().min(1).max(100)
});

export const ModuleIdSchema = z.enum(["profile", "workday-calendar", "upcoming-reminders", "ai-chat"]);

export const DashboardLayoutSchema = z.object({
  moduleId: ModuleIdSchema,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(16),
  h: z.number().int().min(1).max(100),
  enabled: z.boolean()
});

export const NavigationIdSchema = z.enum(["home", "ai-office", "reminders", "vault-coming-soon", "settings"]);

export const NavigationItemSchema = z.object({
  id: NavigationIdSchema,
  label: z.string().trim().min(1).max(100),
  path: z.string().startsWith("/").max(200),
  position: z.number().int().min(0),
  visible: z.boolean(),
  disabled: z.boolean()
});

export const ThemeSchema = z.enum(["light", "dark"]);
export const ThemePreferenceSchema = z.object({ theme: ThemeSchema });

export const DeepSeekSettingsSchema = z.object({
  baseUrl: z.string().trim().min(1).max(2_000),
  model: z.string().trim().min(1).max(200),
  apiKeyConfigured: z.boolean()
});

export const DeepSeekSettingsUpdateSchema = DeepSeekSettingsSchema.omit({ apiKeyConfigured: true }).extend({
  apiKey: z.string().max(10_000).optional()
});

export const MailTransportModeSchema = z.enum(["starttls", "tls"]);
export const MailSettingsSchema = z.object({
  smtpHost: z.string().trim().max(253),
  smtpPort: z.number().int().min(1).max(65_535),
  transportMode: MailTransportModeSchema,
  smtpUsername: z.string().trim().max(500),
  fromAddress: z.union([z.literal(""), z.string().trim().email().max(500)]),
  smtpPasswordConfigured: z.boolean()
});

export const MailSettingsUpdateSchema = MailSettingsSchema.omit({ smtpPasswordConfigured: true }).extend({
  smtpHost: z.string().trim().min(1).max(253),
  fromAddress: z.string().trim().email().max(500),
  smtpPassword: z.string().max(10_000).optional()
});

export const SettingsResponseSchema = z.object({
  deepseek: DeepSeekSettingsSchema,
  mail: MailSettingsSchema
});

export const ConnectionTestStatusSchema = z.enum(["success", "auth_failure", "timeout", "unreachable_host"]);
export const ConnectionTestResultSchema = z.object({
  status: ConnectionTestStatusSchema,
  message: z.string()
});

export const DailyReportInputSchema = z.object({
  completed: z.string().trim().max(20_000),
  risks: z.string().trim().max(20_000)
}).refine((input) => Boolean(input.completed || input.risks), {
  message: "At least one daily report section is required"
});

export const DailyReportSchema = z.object({
  id: z.number().int().positive(),
  completed: z.string(),
  risks: z.string(),
  content: z.string(),
  model: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const DailyReportUpdateSchema = z.object({
  content: z.string().trim().min(1).max(50_000)
});

export const AiPolishKindSchema = z.enum(["daily_report", "leadership", "translation", "general", "custom"]);
export const AiPolishInputSchema = z.object({
  kind: AiPolishKindSchema,
  primaryText: z.string().trim().max(20_000),
  secondaryText: z.string().trim().max(20_000),
  systemPrompt: z.string().trim().min(1).max(10_000)
}).refine((input) => Boolean(input.primaryText || input.secondaryText), {
  message: "At least one source field is required"
});

export const AiPolishRecordSchema = z.object({
  id: z.number().int().positive(),
  kind: AiPolishKindSchema,
  primaryText: z.string(),
  secondaryText: z.string(),
  systemPrompt: z.string(),
  content: z.string(),
  model: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const AiPolishUpdateSchema = z.object({
  content: z.string().trim().min(1).max(50_000)
});

export const AiPolishPromptSchema = z.object({
  kind: AiPolishKindSchema,
  systemPrompt: z.string().trim().min(1).max(10_000),
  updatedAt: z.string()
});

export const AiPolishPromptUpdateSchema = AiPolishPromptSchema.pick({ systemPrompt: true });

export const AiSystemPromptInputSchema = z.object({
  goal: z.string().trim().min(5).max(5_000)
});

export const AiSystemPromptResultSchema = z.object({
  prompt: z.string().trim().min(1).max(10_000),
  model: z.string().trim().min(1)
});

export const AiChatRoleSchema = z.enum(["user", "assistant"]);
export const AiChatInputSchema = z.object({
  content: z.string().trim().min(1).max(20_000)
});
export const AiChatMessageSchema = z.object({
  id: z.number().int().positive(),
  role: AiChatRoleSchema,
  content: z.string(),
  model: z.string().nullable(),
  createdAt: z.string()
});

export const ReminderIdSchema = z.literal("outbound-checkin");
export const ReminderUpdateSchema = z.object({
  enabled: z.boolean(),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  recipient: z.string().trim().email().max(500),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000)
});
export const ReminderFailureCategorySchema = z.enum([
  "not_configured",
  "auth_failure",
  "timeout",
  "unreachable_host",
  "unknown"
]);
export const ReminderAttemptSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attemptedAt: z.string(),
  category: ReminderFailureCategorySchema.optional()
});
export const ReminderSchema = ReminderUpdateSchema.omit({ recipient: true }).extend({
  recipient: z.union([z.literal(""), z.string().trim().email().max(500)]),
  id: ReminderIdSchema,
  weekday: z.literal(1),
  nextRun: z.string().nullable(),
  lastSuccess: ReminderAttemptSchema.nullable(),
  lastFailure: ReminderAttemptSchema.required({ category: true }).nullable()
});
export const ReminderTestResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("success"), message: z.string() }),
  z.object({ status: z.literal("failure"), category: ReminderFailureCategorySchema, message: z.string() })
]);

export const ReminderLifecycleSchema = z.enum(["once", "finite", "recurring"]);
export const ReminderScheduleTypeSchema = z.enum(["once", "daily", "workday", "weekly", "monthly"]);
const GenericReminderFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  enabled: z.boolean(),
  lifecycle: ReminderLifecycleSchema,
  scheduleType: ReminderScheduleTypeSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  monthDay: z.number().int().min(1).max(31).nullable(),
  totalOccurrences: z.number().int().min(1).max(10_000).nullable(),
  recipient: z.string().trim().email().max(500),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000)
});
export const GenericReminderInputSchema = GenericReminderFieldsSchema.superRefine((value, context) => {
  if (value.lifecycle === "once" && value.scheduleType !== "once") {
    context.addIssue({ code: "custom", path: ["scheduleType"], message: "一次性提醒必须使用指定日期" });
  }
  if (value.lifecycle === "finite" && value.totalOccurrences === null) {
    context.addIssue({ code: "custom", path: ["totalOccurrences"], message: "有限次数提醒需要总次数" });
  }
  if (value.lifecycle !== "finite" && value.totalOccurrences !== null) {
    context.addIssue({ code: "custom", path: ["totalOccurrences"], message: "仅有限次数提醒可设置总次数" });
  }
  if (value.scheduleType === "weekly" && value.weekdays.length === 0) {
    context.addIssue({ code: "custom", path: ["weekdays"], message: "每周提醒至少选择一天" });
  }
  if (value.scheduleType === "monthly" && value.monthDay === null) {
    context.addIssue({ code: "custom", path: ["monthDay"], message: "每月提醒需要日期" });
  }
});
export const GenericReminderSchema = GenericReminderFieldsSchema.extend({
  id: z.string().min(1),
  recipient: z.union([z.literal(""), z.string().trim().email().max(500)]),
  successfulOccurrences: z.number().int().nonnegative(),
  nextRun: z.string().nullable(),
  calendarBlocked: z.boolean()
});
export const GenericReminderAttemptSchema = z.object({
  id: z.number().int().positive(),
  reminderId: z.string().nullable(),
  reminderName: z.string(),
  scheduledFor: z.string(),
  attemptedAt: z.string(),
  status: z.enum(["success", "failure", "skipped"]),
  errorCategory: ReminderFailureCategorySchema.nullable(),
  recipient: z.string(),
  subject: z.string(),
  body: z.string()
});
export const HolidayDaySchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dayType: z.enum(["holiday", "makeup_workday"]),
  name: z.string().trim().min(1).max(100)
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type CustomField = z.infer<typeof CustomFieldSchema>;
export type ProfileResponse = z.infer<typeof ProfileSchema>;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
export type ModuleId = z.infer<typeof ModuleIdSchema>;
export type DashboardLayout = z.infer<typeof DashboardLayoutSchema>;
export type NavigationItem = z.infer<typeof NavigationItemSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;
export type DeepSeekSettings = z.infer<typeof DeepSeekSettingsSchema>;
export type DeepSeekSettingsUpdate = z.infer<typeof DeepSeekSettingsUpdateSchema>;
export type MailTransportMode = z.infer<typeof MailTransportModeSchema>;
export type MailSettings = z.infer<typeof MailSettingsSchema>;
export type MailSettingsUpdate = z.infer<typeof MailSettingsUpdateSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
export type ConnectionTestStatus = z.infer<typeof ConnectionTestStatusSchema>;
export type ConnectionTestResult = z.infer<typeof ConnectionTestResultSchema>;
export type DailyReportInput = z.infer<typeof DailyReportInputSchema>;
export type DailyReport = z.infer<typeof DailyReportSchema>;
export type DailyReportUpdate = z.infer<typeof DailyReportUpdateSchema>;
export type AiPolishKind = z.infer<typeof AiPolishKindSchema>;
export type AiPolishInput = z.infer<typeof AiPolishInputSchema>;
export type AiPolishRecord = z.infer<typeof AiPolishRecordSchema>;
export type AiPolishUpdate = z.infer<typeof AiPolishUpdateSchema>;
export type AiPolishPrompt = z.infer<typeof AiPolishPromptSchema>;
export type AiPolishPromptUpdate = z.infer<typeof AiPolishPromptUpdateSchema>;
export type AiSystemPromptInput = z.infer<typeof AiSystemPromptInputSchema>;
export type AiSystemPromptResult = z.infer<typeof AiSystemPromptResultSchema>;
export type AiChatRole = z.infer<typeof AiChatRoleSchema>;
export type AiChatInput = z.infer<typeof AiChatInputSchema>;
export type AiChatMessage = z.infer<typeof AiChatMessageSchema>;
export type ReminderId = z.infer<typeof ReminderIdSchema>;
export type ReminderUpdate = z.infer<typeof ReminderUpdateSchema>;
export type ReminderFailureCategory = z.infer<typeof ReminderFailureCategorySchema>;
export type ReminderAttempt = z.infer<typeof ReminderAttemptSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;
export type ReminderTestResult = z.infer<typeof ReminderTestResultSchema>;
export type ReminderLifecycle = z.infer<typeof ReminderLifecycleSchema>;
export type ReminderScheduleType = z.infer<typeof ReminderScheduleTypeSchema>;
export type GenericReminderInput = z.infer<typeof GenericReminderInputSchema>;
export type GenericReminder = z.infer<typeof GenericReminderSchema>;
export type GenericReminderAttempt = z.infer<typeof GenericReminderAttemptSchema>;
export type HolidayDay = z.infer<typeof HolidayDaySchema>;
