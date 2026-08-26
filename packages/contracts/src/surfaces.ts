import { z } from "zod";

export const SurfaceIdSchema = z.enum(["dashboard", "ai-office"]);
export const SurfaceItemIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
export const AiOfficeOrderItemSchema = z.object({
  itemId: z.string().min(1).max(100),
  position: z.number().int().nonnegative()
}).strict();
export const AiOfficeOrderSchema = AiOfficeOrderItemSchema.array().superRefine((items, context) => {
  const ids = new Set<string>();
  const positions = new Set<number>();
  for (const item of items) {
    if (ids.has(item.itemId)) {
      context.addIssue({ code: "custom", message: "Item IDs must be unique" });
    }
    ids.add(item.itemId);
    if (positions.has(item.position)) {
      context.addIssue({ code: "custom", message: "Positions must be unique" });
    }
    positions.add(item.position);
  }
  for (let index = 0; index < items.length; index += 1) {
    if (!positions.has(index)) {
      context.addIssue({ code: "custom", message: "Positions must be contiguous from zero" });
      break;
    }
  }
});

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
export type AiOfficeOrder = z.infer<typeof AiOfficeOrderSchema>;
export type SurfaceLayoutItem = z.infer<typeof SurfaceLayoutItemSchema>;
