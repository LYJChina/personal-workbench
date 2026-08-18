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

export type ApiError = z.infer<typeof ApiErrorSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type CustomField = z.infer<typeof CustomFieldSchema>;
export type ProfileResponse = z.infer<typeof ProfileSchema>;
export type ProfileUpdate = z.infer<typeof ProfileUpdateSchema>;
