import { z } from "zod";

export const ModelDigestSourceIdSchema = z.enum(["huggingface", "openrouter"]);
export const ModelDigestSourceItemSchema = z.object({
  sourceId: ModelDigestSourceIdSchema,
  modelId: z.string().min(1).max(300),
  name: z.string().min(1).max(300),
  url: z.string().url().max(2_000),
  description: z.string().max(2_000).nullable(),
  category: z.string().max(120).nullable(),
  metrics: z.record(z.union([z.string().max(300), z.number().finite()])),
  updatedAt: z.string().datetime().nullable()
}).strict();

export const ModelDigestSourceSnapshotSchema = z.object({
  sourceId: ModelDigestSourceIdSchema,
  fetchedAt: z.string().datetime(),
  items: z.array(ModelDigestSourceItemSchema).max(100)
}).strict();

const ModelDigestSettingsBaseSchema = z.object({
  enabled: z.boolean(),
  recipientIds: z.array(z.string().uuid()).max(20),
  schedule: z.object({
    weekdays: z.array(z.number().int().min(1).max(5)).length(5),
    localTime: z.literal("09:00"),
    timeZone: z.literal("Asia/Shanghai")
  }).strict()
}).strict();

export const ModelDigestSettingsSchema = ModelDigestSettingsBaseSchema.refine((settings) => new Set(settings.recipientIds).size === settings.recipientIds.length, {
  message: "Recipient IDs must be unique"
});

export const ModelDigestSettingsUpdateSchema = z.object({
  enabled: z.boolean(),
  recipientIds: z.array(z.string().uuid()).max(20)
}).strict().refine((settings) => new Set(settings.recipientIds).size === settings.recipientIds.length, {
  message: "Recipient IDs must be unique"
});
export const ModelDigestRunTypeSchema = z.enum(["scheduled", "manual"]);
export const ModelDigestRunStatusSchema = z.enum(["queued", "fetching", "summarizing", "sending", "succeeded", "failed"]);
export const ModelDigestEmailStatusSchema = z.enum(["not_requested", "pending", "sent", "failed"]);
export const ModelDigestProgressStageSchema = z.enum([
  "queued", "fetching_huggingface", "fetching_openrouter", "searching_details",
  "generating_summary", "sending_email", "completed", "failed"
]);
export const ModelDigestProgressEventSchema = z.object({
  stage: ModelDigestProgressStageSchema,
  message: z.string().min(1).max(200),
  at: z.string().datetime()
}).strict();

export const ModelDigestRunSchema = z.object({
  id: z.string().uuid(),
  type: ModelDigestRunTypeSchema,
  status: ModelDigestRunStatusSchema,
  scheduledLocalDate: z.string().date().nullable(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
  sourceSnapshots: z.array(ModelDigestSourceSnapshotSchema),
  progressEvents: z.array(ModelDigestProgressEventSchema).max(100),
  summary: z.string().max(40_000).nullable(),
  deletedAt: z.string().datetime().nullable(),
  recipientIds: z.array(z.string().uuid()),
  emailStatus: ModelDigestEmailStatusSchema,
  errorCategory: z.string().max(60).nullable()
}).strict();

export const ModelDigestHistoryItemSchema = ModelDigestRunSchema.pick({
  id: true, type: true, status: true, createdAt: true, finishedAt: true,
  emailStatus: true, deletedAt: true
}).extend({ hasSummary: z.boolean() });
export const ModelDigestHistoryPageSchema = z.object({
  items: z.array(ModelDigestHistoryItemSchema),
  total: z.number().int().min(0),
  limit: z.number().int().min(1).max(100),
  offset: z.number().int().min(0)
}).strict();

export const StartModelDigestRunSchema = z.object({
  sendEmail: z.boolean().default(false),
  recipientIds: z.array(z.string().uuid()).max(20).default([])
}).strict().refine((run) => new Set(run.recipientIds).size === run.recipientIds.length, {
  message: "Recipient IDs must be unique"
});

export const ModelDigestOverviewSchema = z.object({
  settings: ModelDigestSettingsSchema,
  emails: z.array(z.object({ id: z.string().uuid(), label: z.string(), address: z.string().email() }).strict()),
  readiness: z.object({ aiConfigured: z.boolean(), smtpConfigured: z.boolean() }).strict(),
  latestRun: ModelDigestRunSchema.nullable(),
  lastRun: ModelDigestRunSchema.nullable(),
  activeRun: ModelDigestRunSchema.nullable(),
  nextRunAt: z.string().datetime().nullable()
}).strict();

export type ModelDigestSourceId = z.infer<typeof ModelDigestSourceIdSchema>;
export type ModelDigestSourceItem = z.infer<typeof ModelDigestSourceItemSchema>;
export type ModelDigestSourceSnapshot = z.infer<typeof ModelDigestSourceSnapshotSchema>;
export type ModelDigestSettings = z.infer<typeof ModelDigestSettingsSchema>;
export type ModelDigestSettingsUpdate = z.infer<typeof ModelDigestSettingsUpdateSchema>;
export type ModelDigestRun = z.infer<typeof ModelDigestRunSchema>;
export type ModelDigestProgressStage = z.infer<typeof ModelDigestProgressStageSchema>;
export type ModelDigestHistoryPage = z.infer<typeof ModelDigestHistoryPageSchema>;
export type StartModelDigestRun = z.infer<typeof StartModelDigestRunSchema>;
export type ModelDigestOverview = z.infer<typeof ModelDigestOverviewSchema>;
