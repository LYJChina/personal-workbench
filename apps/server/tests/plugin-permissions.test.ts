import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginManifest } from "@workbench/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { ContributionRegistry } from "../src/kernel/contribution-registry";
import { PermissionGate, pluginPermissionDeniedCode } from "../src/kernel/permissions";
import { PluginLifecycle, type SystemPluginDefinition } from "../src/kernel/plugin-lifecycle";
import { PluginRepository } from "../src/modules/plugins/plugin.repository";

const manifest: PluginManifest = {
  manifestVersion: 1,
  id: "lyj.system.permissions",
  name: "Permissions",
  version: "1.0.0",
  author: "LYJ Workbench",
  kind: "system",
  platforms: ["win32"],
  permissions: ["profile:read"],
  contributions: []
};

describe("PermissionGate", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it("re-reads the persisted grant on every capability assertion", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-permissions-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      const repository = new PluginRepository(database);
      repository.reconcileSystemPlugins([manifest]);
      const gate = new PermissionGate(repository);

      expect(Object.keys(gate)).toEqual([]);
      expect((gate as unknown as Record<string, unknown>).repository).toBeUndefined();

      expect(() => gate.assert(manifest.id, "profile:read")).not.toThrow();
      database.prepare("UPDATE plugin_permissions SET granted = 0 WHERE plugin_id = ? AND permission = ?")
        .run(manifest.id, "profile:read");

      let denial: unknown;
      try {
        gate.assert(manifest.id, "profile:read");
      } catch (error) {
        denial = error;
      }
      expect(denial).toMatchObject({ message: pluginPermissionDeniedCode, code: pluginPermissionDeniedCode });
      expect(String(denial)).not.toContain(manifest.id);

      database.prepare("UPDATE plugin_permissions SET granted = 1 WHERE plugin_id = ? AND permission = ?")
        .run(manifest.id, "profile:read");
      expect(() => gate.assert(manifest.id, "profile:read")).not.toThrow();
      expect(() => gate.assert(manifest.id, "mail:send")).toThrow(pluginPermissionDeniedCode);
    } finally {
      database.close();
    }
  });

  it("does not restore a revoked grant when a newly constructed lifecycle starts plugins", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-permissions-start-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      const repository = new PluginRepository(database);
      repository.reconcileSystemPlugins([manifest]);
      database.prepare("UPDATE plugin_permissions SET granted = 0 WHERE plugin_id = ? AND permission = ?")
        .run(manifest.id, "profile:read");
      const gate = new PermissionGate(repository);
      const definition: SystemPluginDefinition = { manifest, start: () => undefined };
      const lifecycle = new PluginLifecycle({
        definitions: [definition],
        repository,
        registry: new ContributionRegistry(),
        permissions: gate
      });

      await lifecycle.startAll();

      expect(() => gate.assert(manifest.id, "profile:read")).toThrow(pluginPermissionDeniedCode);
    } finally {
      database.close();
    }
  });

  it("does not restore a revoked grant when a newly constructed lifecycle enables a plugin", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-permissions-enable-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    try {
      const repository = new PluginRepository(database);
      repository.reconcileSystemPlugins([manifest]);
      repository.setEnabled(manifest.id, false);
      database.prepare("UPDATE plugin_permissions SET granted = 0 WHERE plugin_id = ? AND permission = ?")
        .run(manifest.id, "profile:read");
      const gate = new PermissionGate(repository);
      const definition: SystemPluginDefinition = { manifest, start: () => undefined };
      const lifecycle = new PluginLifecycle({
        definitions: [definition],
        repository,
        registry: new ContributionRegistry(),
        permissions: gate
      });

      await lifecycle.enable(manifest.id);

      expect(() => gate.assert(manifest.id, "profile:read")).toThrow(pluginPermissionDeniedCode);
    } finally {
      database.close();
    }
  });
});
