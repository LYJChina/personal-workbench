import { z } from "zod";

export const ProfileEmailSchema = z.object({
  id: z.string().uuid(),
  label: z.string().trim().min(1).max(80),
  address: z.string().trim().email().max(320)
}).strict();

export const ProfileEmailInputSchema = ProfileEmailSchema.extend({ id: z.string().uuid().optional() });

export const ProfileEmailsSchema = z.array(ProfileEmailSchema)
  .max(20)
  .refine((items) => new Set(items.map((item) => item.id)).size === items.length, {
    message: "Email IDs must be unique"
  })
  .refine((items) => new Set(items.map((item) => item.address.toLowerCase())).size === items.length, {
    message: "Email addresses must be unique"
  });

export const ProfileEmailInputsSchema = z.array(ProfileEmailInputSchema)
  .max(20)
  .refine((items) => new Set(items.flatMap((item) => item.id ? [item.id] : [])).size === items.filter((item) => item.id).length, {
    message: "Email IDs must be unique"
  })
  .refine((items) => new Set(items.map((item) => item.address.trim().toLowerCase())).size === items.length, {
    message: "Email addresses must be unique"
  });

export type ProfileEmail = z.infer<typeof ProfileEmailSchema>;
export type ProfileEmailInput = z.infer<typeof ProfileEmailInputSchema>;
