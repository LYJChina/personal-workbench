import { z } from "zod";

const PasswordManagerCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.string().max(1_000)
}).strict();

export const PasswordManagerEntryIdSchema = z.string().uuid();

const EntryInputFieldsSchema = z.object({
  name: z.string().trim().min(1).max(100),
  website: z.string().trim().max(2_000).optional(),
  username: z.string().max(320),
  password: z.string().min(1).max(1_024),
  notes: z.string().max(20_000).optional(),
  customFields: z.array(PasswordManagerCustomFieldSchema).max(100).optional()
}).strict();

export const PasswordManagerStatusSchema = z.object({
  configured: z.boolean(),
  unlocked: z.boolean(),
  idleTimeoutMinutes: z.number().int().min(1).max(1_440)
}).strict();

export const PasswordManagerEntryInputSchema = EntryInputFieldsSchema;

export const PasswordManagerEntrySummarySchema = z.object({
  id: PasswordManagerEntryIdSchema,
  name: z.string().trim().min(1).max(100),
  website: z.string().trim().max(2_000),
  username: z.string().max(320),
  notes: z.string().max(20_000),
  customFields: z.array(PasswordManagerCustomFieldSchema).max(100),
  createdAt: z.string().min(1).max(100),
  updatedAt: z.string().min(1).max(100)
}).strict();

export const PasswordManagerEntryDetailSchema = PasswordManagerEntrySummarySchema.extend({
  password: z.string().min(1).max(1_024)
}).strict();

export const PasswordManagerImportPreviewSchema = z.object({
  items: z.array(PasswordManagerEntryInputSchema).max(10_000),
  duplicates: z.array(z.string().trim().min(1).max(100)).max(10_000),
  warnings: z.array(z.string().trim().min(1).max(1_000)).max(10_000),
  source: z.enum(["local", "redacted-ai"])
}).strict();

export type PasswordManagerStatus = z.infer<typeof PasswordManagerStatusSchema>;
export type PasswordManagerEntryInput = z.infer<typeof PasswordManagerEntryInputSchema>;
export type PasswordManagerEntrySummary = z.infer<typeof PasswordManagerEntrySummarySchema>;
export type PasswordManagerEntryDetail = z.infer<typeof PasswordManagerEntryDetailSchema>;
export type PasswordManagerImportPreview = z.infer<typeof PasswordManagerImportPreviewSchema>;
