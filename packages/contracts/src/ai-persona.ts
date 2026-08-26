import { z } from "zod";

export const AiPersonaSettingsSchema = z.object({
  assistantName: z.string().trim().min(1).max(80),
  personalityPrompt: z.string().max(10_000),
  profilePortrait: z.string().max(10_000),
  systemPrompt: z.string().max(20_000),
  updatedAt: z.string()
});
export const AiPersonaSettingsUpdateSchema = AiPersonaSettingsSchema.omit({ updatedAt: true });
export type AiPersonaSettings = z.infer<typeof AiPersonaSettingsSchema>;
export type AiPersonaSettingsUpdate = z.infer<typeof AiPersonaSettingsUpdateSchema>;
