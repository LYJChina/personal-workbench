import type Database from "better-sqlite3";
import {
  PluginIdSchema,
  PluginManifestSchema,
  PluginSummarySchema,
  type PluginId,
  type PluginManifest,
  type PluginPermission,
  type PluginSummary
} from "@workbench/contracts";

export const corruptStoredPluginManifestError = "Stored plugin manifest is invalid";
export const requiredPluginDisableError = "Required plugin cannot be disabled";

const auditActions = [
  "PLUGIN_RECONCILED",
  "PLUGIN_ENABLEMENT_CHANGED",
  "PLUGIN_STARTUP_BEGAN",
  "PLUGIN_STARTUP_COMPLETED"
] as const;
const auditStatuses = ["success", "denied", "failure"] as const;
const auditErrorCodes = ["PLUGIN_START_FAILED"] as const;

type PluginAuditAction = (typeof auditActions)[number];
type PluginAuditStatus = (typeof auditStatuses)[number];
type PluginAuditErrorCode = (typeof auditErrorCodes)[number];

export interface PluginAuditEvent {
  pluginId?: PluginId;
  action: PluginAuditAction;
  status: PluginAuditStatus;
  errorCode?: PluginAuditErrorCode | null;
}

interface PluginRow {
  plugin_id: string;
  manifest_json: string;
  enabled: number;
  required: number;
  runtime_status: string;
  last_error_code: string | null;
}

interface PermissionRow {
  permission: string;
}

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export class PluginRepository {
  public constructor(private readonly database: Database.Database) {}

  public reconcileSystemPlugins(manifests: unknown[]): void {
    const parsed = manifests.map((manifest) => PluginManifestSchema.parse(manifest));
    const pluginIds = new Set<string>();
    for (const manifest of parsed) {
      if (manifest.kind !== "system") throw new Error("System plugin manifest required");
      if (pluginIds.has(manifest.id)) throw new Error("Duplicate system plugin ID");
      pluginIds.add(manifest.id);
    }

    this.database.transaction((systemManifests: PluginManifest[]) => {
      const upsertPlugin = this.database.prepare(`
        INSERT INTO installed_plugins
          (plugin_id, manifest_json, version, kind, enabled, required, runtime_status, last_error_code)
        VALUES (?, ?, ?, 'system', 1, 0, 'stopped', NULL)
        ON CONFLICT(plugin_id) DO UPDATE SET
          manifest_json = excluded.manifest_json,
          version = excluded.version,
          kind = excluded.kind,
          updated_at = CURRENT_TIMESTAMP
      `);
      const upsertPermission = this.database.prepare(`
        INSERT INTO plugin_permissions (plugin_id, permission, granted)
        VALUES (?, ?, 1)
        ON CONFLICT(plugin_id, permission) DO UPDATE SET granted = 1, updated_at = CURRENT_TIMESTAMP
      `);

      for (const manifest of systemManifests) {
        upsertPlugin.run(manifest.id, JSON.stringify(manifest), manifest.version);
        if (manifest.permissions.length === 0) {
          this.database.prepare("DELETE FROM plugin_permissions WHERE plugin_id = ?").run(manifest.id);
        } else {
          const placeholders = manifest.permissions.map(() => "?").join(", ");
          this.database.prepare(`DELETE FROM plugin_permissions WHERE plugin_id = ? AND permission NOT IN (${placeholders})`)
            .run(manifest.id, ...manifest.permissions);
          for (const permission of manifest.permissions) upsertPermission.run(manifest.id, permission);
        }
      }

      if (systemManifests.length === 0) {
        this.database.prepare("UPDATE installed_plugins SET runtime_status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE kind = 'system'").run();
      } else {
        const placeholders = systemManifests.map(() => "?").join(", ");
        this.database.prepare(`UPDATE installed_plugins SET runtime_status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE kind = 'system' AND plugin_id NOT IN (${placeholders})`)
          .run(...systemManifests.map((manifest) => manifest.id));
      }
    })(parsed);
  }

  public list(): PluginSummary[] {
    const rows = this.database.prepare(`
      SELECT plugin_id, manifest_json, enabled, required, runtime_status, last_error_code
      FROM installed_plugins
      ORDER BY plugin_id
    `).all() as PluginRow[];

    try {
      const permissionsForPlugin = this.database.prepare("SELECT permission FROM plugin_permissions WHERE plugin_id = ? AND granted = 1 ORDER BY permission");
      return rows.map((row) => {
        const manifest = PluginManifestSchema.parse(JSON.parse(row.manifest_json));
        const permissionsGranted = (permissionsForPlugin.all(row.plugin_id) as PermissionRow[]).map((permission) => permission.permission as PluginPermission);
        return PluginSummarySchema.parse({
          manifest,
          enabled: Boolean(row.enabled),
          required: Boolean(row.required),
          runtimeStatus: row.runtime_status,
          permissionsGranted,
          errorCode: row.last_error_code
        });
      });
    } catch {
      throw new Error(corruptStoredPluginManifestError);
    }
  }

  public setEnabled(id: string, enabled: boolean): void {
    const row = this.database.prepare("SELECT required FROM installed_plugins WHERE plugin_id = ?").get(id) as { required: number } | undefined;
    if (!row) throw new Error("Plugin not found");
    if (row.required && !enabled) throw new Error(requiredPluginDisableError);
    this.database.prepare("UPDATE installed_plugins SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE plugin_id = ?").run(Number(enabled), id);
  }

  public recordAudit(event: PluginAuditEvent): void {
    const trustedPluginId = PluginIdSchema.safeParse(event.pluginId).success ? event.pluginId ?? null : null;
    const accepted = includes(auditActions, event.action)
      && includes(auditStatuses, event.status)
      && (event.errorCode === undefined || event.errorCode === null || includes(auditErrorCodes, event.errorCode));
    const action = accepted ? event.action : "PLUGIN_AUDIT_EVENT_REJECTED";
    const status = includes(auditStatuses, event.status) ? event.status : "denied";
    const errorCode = accepted ? event.errorCode ?? null : "PLUGIN_AUDIT_ERROR";
    this.database.prepare("INSERT INTO plugin_audit_events (plugin_id, action, status, error_code) VALUES (?, ?, ?, ?)")
      .run(trustedPluginId, action, status, errorCode);
  }

  public beginStartup(): void {
    this.setStartupState("starting");
  }

  public completeStartup(): void {
    this.setStartupState("complete");
  }

  private setStartupState(value: "starting" | "complete"): void {
    this.database.prepare(`
      INSERT INTO plugin_runtime_state (key, value) VALUES ('startup', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(value);
  }
}
