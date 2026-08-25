import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { PluginManifest } from "@workbench/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import {
  PluginRepository,
  corruptStoredPluginManifestError,
  requiredPluginDisableError
} from "../src/modules/plugins/plugin.repository";

const systemManifestIds = [
  "lyj.system.ai-chat",
  "lyj.system.ai-polish",
  "lyj.system.daily-reports",
  "lyj.system.workday-calendar",
  "lyj.system.reminders"
] as const;

function systemManifests(): PluginManifest[] {
  return systemManifestIds.map((id, index) => ({
    manifestVersion: 1,
    id,
    name: `System plugin ${index + 1}`,
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32"],
    permissions: index === 0 ? ["ai:use"] : ["storage:own"],
    contributions: []
  }));
}

describe("plugin schema and repository", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function createRepository(): Promise<{ database: Database.Database; repository: PluginRepository }> {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-database-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    return { database, repository: new PluginRepository(database) };
  }

  it("upgrades a populated v3 database through current migrations without losing existing data", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-v3-"));
    temporaryDirectories.push(dataDir);
    const paths = resolveAppPaths({ dataDir });
    const v3 = new Database(paths.databasePath);
    v3.exec("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    v3.prepare("INSERT INTO app_settings (key, value) VALUES (?, ?)").run("preserve-me", "preserved-value");
    v3.pragma("user_version = 3");
    v3.close();

    const upgraded = openDatabase(paths);
    try {
      expect(upgraded.pragma("user_version", { simple: true })).toBe(7);
      expect(upgraded.prepare("SELECT value FROM app_settings WHERE key = ?").pluck().get("preserve-me")).toBe("preserved-value");
      expect(upgraded.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'installed_plugins'").pluck().get()).toBe("installed_plugins");
    } finally {
      upgraded.close();
    }
  });

  it("reconciles five system manifests idempotently without enabling an unknown plugin", async () => {
    const { database, repository } = await createRepository();
    try {
      const manifests = systemManifests();
      repository.reconcileSystemPlugins(manifests);
      repository.reconcileSystemPlugins(manifests);

      expect(repository.list()).toEqual(expect.arrayContaining(manifests.map((manifest) => expect.objectContaining({
        manifest,
        enabled: true,
        required: false,
        runtimeStatus: "stopped",
        permissionsGranted: manifest.permissions,
        errorCode: null
      }))));
      expect(() => repository.setEnabled("lyj.system.unknown", true)).toThrow("Plugin not found");
    } finally {
      database.close();
    }
  });

  it("preserves an existing disabled state while updating a system manifest", async () => {
    const { database, repository } = await createRepository();
    try {
      const [manifest] = systemManifests();
      repository.reconcileSystemPlugins([manifest]);
      repository.setEnabled(manifest.id, false);
      repository.reconcileSystemPlugins([{ ...manifest, version: "1.0.1" }]);

      expect(repository.list()).toEqual([expect.objectContaining({ manifest: expect.objectContaining({ version: "1.0.1" }), enabled: false })]);
    } finally {
      database.close();
    }
  });

  it("stops removed compiled plugins without deleting their rows or permissions", async () => {
    const { database, repository } = await createRepository();
    try {
      const [first, second] = systemManifests();
      repository.reconcileSystemPlugins([first, second]);
      repository.reconcileSystemPlugins([first]);

      expect(repository.list()).toEqual(expect.arrayContaining([
        expect.objectContaining({ manifest: first, runtimeStatus: "stopped" }),
        expect.objectContaining({ manifest: second, runtimeStatus: "stopped", permissionsGranted: second.permissions })
      ]));
      expect(database.prepare("SELECT plugin_id FROM plugin_permissions WHERE plugin_id = ?").pluck().get(second.id)).toBe(second.id);
    } finally {
      database.close();
    }
  });

  it("rejects duplicate IDs before mutating plugin state", async () => {
    const { database, repository } = await createRepository();
    try {
      const [manifest] = systemManifests();
      expect(() => repository.reconcileSystemPlugins([manifest, manifest])).toThrow("Duplicate system plugin ID");
      expect(repository.list()).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("fails with a fixed non-sensitive error when a stored manifest is corrupt", async () => {
    const { database, repository } = await createRepository();
    try {
      database.prepare(`INSERT INTO installed_plugins
        (plugin_id, manifest_json, version, kind, enabled, required, runtime_status)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run("lyj.system.reminders", '{"secret":"manifest-body"}', "1.0.0", "system", 1, 0, "stopped");

      expect(() => repository.list()).toThrow(corruptStoredPluginManifestError);
      expect(() => repository.list()).not.toThrow("manifest-body");
    } finally {
      database.close();
    }
  });

  it("does not disable a required plugin", async () => {
    const { database, repository } = await createRepository();
    try {
      const [manifest] = systemManifests();
      repository.reconcileSystemPlugins([manifest]);
      database.prepare("UPDATE installed_plugins SET required = 1 WHERE plugin_id = ?").run(manifest.id);

      expect(() => repository.setEnabled(manifest.id, false)).toThrow(requiredPluginDisableError);
      expect(repository.list()).toEqual([expect.objectContaining({ enabled: true, required: true })]);
    } finally {
      database.close();
    }
  });

  it("records only sanitized audit codes and deterministic startup state", async () => {
    const { database, repository } = await createRepository();
    try {
      repository.recordAudit({
        pluginId: "lyj.system.reminders",
        action: "PLUGIN_STARTUP_BEGAN",
        status: "failure",
        errorCode: "Error: stack trace with {\"manifest\":\"body\"}"
      } as never);
      repository.beginStartup();
      repository.completeStartup();

      expect(database.prepare("SELECT action, status, error_code FROM plugin_audit_events").get()).toEqual({
        action: "PLUGIN_AUDIT_EVENT_REJECTED", status: "failure", error_code: "PLUGIN_AUDIT_ERROR"
      });
      expect(database.prepare("SELECT value FROM plugin_runtime_state WHERE key = 'startup'").pluck().get()).toBe("complete");
      const storedAuditText = String(database.prepare("SELECT action || ' ' || COALESCE(error_code, '') FROM plugin_audit_events").pluck().get());
      expect(storedAuditText).not.toContain("stack trace");
      expect(storedAuditText).not.toContain("manifest");
    } finally {
      database.close();
    }
  });
});
