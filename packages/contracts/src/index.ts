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

export const ModuleIdSchema = z.enum(["profile"]);

export const DashboardLayoutSchema = z.object({
  moduleId: ModuleIdSchema,
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
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
