import { z } from "zod";

export const SurfaceIdSchema = z.enum(["dashboard", "ai-office"]);
export const SurfaceItemIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);

export const SurfaceLayoutItemSchema = z.object({
  itemId: SurfaceItemIdSchema,
  surface: SurfaceIdSchema,
  x: z.number().int().min(0).max(16),
  y: z.number().int().min(0).max(10_000),
  w: z.number().int().min(1).max(16),
  h: z.number().int().min(1).max(100),
  enabled: z.boolean()
}).strict();

export type SurfaceId = z.infer<typeof SurfaceIdSchema>;
export type SurfaceLayoutItem = z.infer<typeof SurfaceLayoutItemSchema>;
