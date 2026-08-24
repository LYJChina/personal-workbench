import { z } from "zod";

export const PluginIdSchema = z
  .string()
  .regex(/^lyj\.(?:system|plugin)\.[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);

export const PluginPermissionSchema = z.enum([
  "storage:own",
  "profile:read",
  "profile:write",
  "reminders:read",
  "reminders:write",
  "ai:use",
  "mail:send"
]);

const ContributionIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const ContributionPathSchema = z.string().regex(/^\/[a-z0-9/-]*$/);
const ComponentTokenSchema = z.string().regex(/^system\.[a-z0-9.-]+$/);

export const PluginContributionSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("navigation"),
      id: ContributionIdSchema,
      label: z.string().trim().min(1).max(100),
      path: ContributionPathSchema,
      icon: z.string().regex(/^[a-z0-9-]+$/),
      position: z.number().int().min(0).max(10_000)
    })
    .strict(),
  z
    .object({
      type: z.literal("route"),
      id: ContributionIdSchema,
      path: ContributionPathSchema,
      component: ComponentTokenSchema
    })
    .strict(),
  z
    .object({
      type: z.literal("dashboard"),
      id: ContributionIdSchema,
      title: z.string().trim().min(1).max(100),
      component: ComponentTokenSchema,
      minW: z.number().int().min(1).max(16),
      minH: z.number().int().min(1).max(100)
    })
    .strict(),
  z
    .object({
      type: z.literal("ai-tool"),
      id: ContributionIdSchema,
      label: z.string().trim().min(1).max(100),
      description: z.string().trim().min(1).max(500),
      path: z.string().regex(/^\/ai-office\/[a-z0-9/-]+$/),
      icon: z.string().regex(/^[a-z0-9-]+$/),
      position: z.number().int().min(0).max(10_000)
    })
    .strict(),
  z
    .object({
      type: z.literal("settings"),
      id: ContributionIdSchema,
      title: z.string().trim().min(1).max(100),
      component: ComponentTokenSchema,
      position: z.number().int().min(0).max(10_000)
    })
    .strict()
]);

export const PluginRuntimeStatusSchema = z.enum(["stopped", "starting", "running", "failed", "safe-mode"]);

export const PluginErrorCodeSchema = z.literal("PLUGIN_START_FAILED").nullable();

const UniqueStringArraySchema = <T extends z.ZodTypeAny>(item: T) =>
  z.array(item).min(1).refine((items) => new Set(items).size === items.length, {
    message: "Values must be unique"
  });

export const PluginManifestSchema = z
  .object({
    manifestVersion: z.literal(1),
    id: PluginIdSchema,
    name: z.string().trim().min(1).max(100),
    version: z.string().regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/),
    author: z.string().trim().min(1).max(100),
    kind: z.enum(["system", "third-party"]),
    platforms: UniqueStringArraySchema(z.enum(["win32", "darwin"])),
    permissions: z.array(PluginPermissionSchema),
    contributions: z.array(PluginContributionSchema)
  })
  .strict()
  .superRefine((manifest, context) => {
    if (new Set(manifest.permissions).size !== manifest.permissions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["permissions"],
        message: "Permissions must be unique"
      });
    }

    const contributionKeys = new Set<string>();
    const routePaths = new Set<string>();
    const componentTokens = new Set<string>();

    manifest.contributions.forEach((contribution, index) => {
      const contributionKey = `${contribution.type}:${contribution.id}`;
      if (contributionKeys.has(contributionKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["contributions", index, "id"],
          message: "Contribution type and id must be unique"
        });
      }
      contributionKeys.add(contributionKey);

      if (contribution.type === "route") {
        if (routePaths.has(contribution.path)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contributions", index, "path"],
            message: "Route paths must be unique"
          });
        }
        routePaths.add(contribution.path);
      }

      if ("component" in contribution) {
        if (componentTokens.has(contribution.component)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["contributions", index, "component"],
            message: "Component tokens must be unique"
          });
        }
        componentTokens.add(contribution.component);
      }
    });
  });

export const PluginSummarySchema = z
  .object({
    manifest: PluginManifestSchema,
    enabled: z.boolean(),
    required: z.boolean(),
    runtimeStatus: PluginRuntimeStatusSchema,
    permissionsGranted: z.array(PluginPermissionSchema),
    errorCode: PluginErrorCodeSchema
  })
  .strict();

export type PluginId = z.infer<typeof PluginIdSchema>;
export type PluginPermission = z.infer<typeof PluginPermissionSchema>;
export type PluginContribution = z.infer<typeof PluginContributionSchema>;
export type PluginRuntimeStatus = z.infer<typeof PluginRuntimeStatusSchema>;
export type PluginErrorCode = z.infer<typeof PluginErrorCodeSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type PluginSummary = z.infer<typeof PluginSummarySchema>;
