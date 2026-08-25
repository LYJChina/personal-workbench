import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginContribution, PluginManifest } from "@workbench/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { resolveAppPaths } from "../src/config/paths";
import { openDatabase } from "../src/db/database";
import { ContributionRegistry } from "../src/kernel/contribution-registry";
import { PermissionGate } from "../src/kernel/permissions";
import { PluginLifecycle, type SystemPluginDefinition } from "../src/kernel/plugin-lifecycle";
import { PluginRepository } from "../src/modules/plugins/plugin.repository";

function manifest(id: string, contributions: PluginContribution[] = []): PluginManifest {
  return {
    manifestVersion: 1,
    id: `lyj.system.${id}`,
    name: id,
    version: "1.0.0",
    author: "LYJ Workbench",
    kind: "system",
    platforms: ["win32"],
    permissions: ["storage:own"],
    contributions
  };
}

function navigation(id: string): PluginContribution {
  return { type: "navigation", id, label: id, path: `/${id}`, icon: "circle", position: 1 };
}

describe("PluginLifecycle", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function harness(definitions: SystemPluginDefinition[]) {
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-lifecycle-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const repository = new PluginRepository(database);
    repository.reconcileSystemPlugins(definitions.map((definition) => definition.manifest));
    const registry = new ContributionRegistry();
    const permissions = new PermissionGate(repository);
    const lifecycle = new PluginLifecycle({ definitions, repository, registry, permissions });
    return { database, repository, registry, permissions, lifecycle };
  }

  it("starts in stable plugin-ID order and isolates a failed plugin from later plugins", async () => {
    const events: string[] = [];
    const definitions: SystemPluginDefinition[] = [
      { manifest: manifest("zeta", [navigation("zeta")]), start: () => { events.push("zeta"); } },
      { manifest: manifest("alpha", [navigation("alpha")]), start: () => { events.push("alpha"); } },
      {
        manifest: manifest("broken", [navigation("broken")]),
        start: ({ registry }) => {
          registry.register("lyj.system.broken", [navigation("runtime-broken")]);
          events.push("broken");
          throw new Error("secret startup stack");
        }
      }
    ];
    const { database, repository, registry, lifecycle } = await harness(definitions);
    try {
      await lifecycle.startAll();

      expect(events).toEqual(["alpha", "broken", "zeta"]);
      expect(registry.list().map((entry) => entry.pluginId)).toEqual([
        "lyj.system.alpha",
        "lyj.system.zeta"
      ]);
      expect(repository.list()).toEqual(expect.arrayContaining([
        expect.objectContaining({ manifest: expect.objectContaining({ id: "lyj.system.broken" }), runtimeStatus: "failed", errorCode: "PLUGIN_START_FAILED" }),
        expect.objectContaining({ manifest: expect.objectContaining({ id: "lyj.system.zeta" }), runtimeStatus: "running", errorCode: null })
      ]));
      expect(JSON.stringify(lifecycle.status())).not.toContain("secret startup stack");
    } finally {
      database.close();
    }
  });

  it("rolls back a registration collision without calling start or disturbing earlier contributions", async () => {
    let conflictingStartCalls = 0;
    const definitions: SystemPluginDefinition[] = [
      { manifest: manifest("alpha", [navigation("shared")]), start: () => undefined },
      { manifest: manifest("beta", [navigation("temporary"), navigation("shared")]), start: () => { conflictingStartCalls += 1; } },
      { manifest: manifest("gamma", [navigation("gamma")]), start: () => undefined }
    ];
    const { database, registry, lifecycle } = await harness(definitions);
    try {
      await lifecycle.startAll();

      expect(conflictingStartCalls).toBe(0);
      expect(registry.list("navigation").map((entry) => entry.contribution.id)).toEqual(["shared", "gamma"]);
      expect(lifecycle.status()).toEqual(expect.arrayContaining([
        expect.objectContaining({ manifest: expect.objectContaining({ id: "lyj.system.beta" }), runtimeStatus: "failed", errorCode: "PLUGIN_START_FAILED" })
      ]));
    } finally {
      database.close();
    }
  });

  it("does not expose core registry internals through the plugin start context", async () => {
    let exposedKeys: string[] = [];
    let exposedTarget: unknown;
    const definition: SystemPluginDefinition = {
      manifest: manifest("encapsulated"),
      start: ({ registry }) => {
        exposedKeys = Object.keys(registry);
        exposedTarget = (registry as unknown as Record<string, unknown>).target;
      }
    };
    const { database, lifecycle } = await harness([definition]);
    try {
      await lifecycle.startAll();
      expect(exposedKeys).toEqual([]);
      expect(exposedTarget).toBeUndefined();
    } finally {
      database.close();
    }
  });

  it("disables idempotently in cleanup, revocation, persistence order", async () => {
    const events: string[] = [];
    class TrackingRegistry extends ContributionRegistry {
      public override register(pluginId: string, contributions: PluginContribution[]): () => void {
        const revoke = super.register(pluginId, contributions);
        const contributionIds = contributions.map((contribution) => contribution.id).join(",");
        return () => {
          events.push(`revoke:${contributionIds}`);
          revoke();
        };
      }
    }

    const definition: SystemPluginDefinition = {
      manifest: manifest("ordered", [navigation("ordered")]),
      start: ({ registry }) => {
        registry.register("lyj.system.ordered", [navigation("dynamic-first")]);
        registry.register("lyj.system.ordered", [navigation("dynamic-second")]);
        return () => {
          expect(registry.list("navigation")).toHaveLength(3);
          events.push("cleanup");
        };
      }
    };
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-disable-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const repository = new PluginRepository(database);
    repository.reconcileSystemPlugins([definition.manifest]);
    const originalSetEnabled = repository.setEnabled.bind(repository);
    repository.setEnabled = (id, enabled) => {
      if (!enabled) events.push("persist");
      originalSetEnabled(id, enabled);
    };
    const registry = new TrackingRegistry();
    const lifecycle = new PluginLifecycle({
      definitions: [definition],
      repository,
      registry,
      permissions: new PermissionGate(repository)
    });
    try {
      await lifecycle.startAll();
      events.length = 0;
      await lifecycle.disable(definition.manifest.id);
      await lifecycle.disable(definition.manifest.id);

      expect(events).toEqual([
        "cleanup",
        "revoke:dynamic-second",
        "revoke:dynamic-first",
        "revoke:ordered",
        "persist"
      ]);
      expect(registry.list()).toEqual([]);
      expect(lifecycle.status()).toEqual([
        expect.objectContaining({ enabled: false, runtimeStatus: "stopped", errorCode: null })
      ]);
    } finally {
      database.close();
    }
  });

  it("continues reverse revocation and persists disabled state when one revoker throws", async () => {
    const events: string[] = [];
    class ThrowingRegistry extends ContributionRegistry {
      public override register(pluginId: string, contributions: PluginContribution[]): () => void {
        const revoke = super.register(pluginId, contributions);
        const contributionIds = contributions.map((contribution) => contribution.id).join(",");
        return () => {
          events.push(`revoke:${contributionIds}`);
          if (contributionIds === "dynamic-second") throw new Error("revoker failed");
          revoke();
        };
      }
    }

    const definition: SystemPluginDefinition = {
      manifest: manifest("revoker-failure", [navigation("manifest")]),
      start: ({ registry }) => {
        registry.register("lyj.system.revoker-failure", [navigation("dynamic-first")]);
        registry.register("lyj.system.revoker-failure", [navigation("dynamic-second")]);
        return () => { events.push("cleanup"); };
      }
    };
    const dataDir = await mkdtemp(join(tmpdir(), "lyj-plugin-revoker-failure-"));
    temporaryDirectories.push(dataDir);
    const database = openDatabase(resolveAppPaths({ dataDir }));
    const repository = new PluginRepository(database);
    repository.reconcileSystemPlugins([definition.manifest]);
    const registry = new ThrowingRegistry();
    const lifecycle = new PluginLifecycle({
      definitions: [definition],
      repository,
      registry,
      permissions: new PermissionGate(repository)
    });
    try {
      await lifecycle.startAll();
      events.length = 0;

      await lifecycle.disable(definition.manifest.id);

      expect(events).toEqual([
        "cleanup",
        "revoke:dynamic-second",
        "revoke:dynamic-first",
        "revoke:manifest"
      ]);
      expect(registry.list("navigation")).toEqual([
        expect.objectContaining({ contribution: expect.objectContaining({ id: "dynamic-second" }) })
      ]);
      expect(lifecycle.status()).toEqual([
        expect.objectContaining({ enabled: false, runtimeStatus: "stopped", errorCode: null })
      ]);
    } finally {
      database.close();
    }
  });

  it("persists disable and enable state through fresh repository and lifecycle instances", async () => {
    let starts = 0;
    const definition: SystemPluginDefinition = {
      manifest: manifest("persistent", [navigation("persistent")]),
      start: () => { starts += 1; }
    };
    const { database, repository, lifecycle } = await harness([definition]);
    try {
      await lifecycle.startAll();
      await lifecycle.disable(definition.manifest.id);

      const freshRepository = new PluginRepository(database);
      const freshLifecycle = new PluginLifecycle({
        definitions: [definition],
        repository: freshRepository,
        registry: new ContributionRegistry(),
        permissions: new PermissionGate(freshRepository)
      });
      expect(freshLifecycle.isEnabled(definition.manifest.id)).toBe(false);

      await freshLifecycle.enable(definition.manifest.id);
      expect(starts).toBe(2);
      expect(new PluginRepository(database).list()).toEqual([
        expect.objectContaining({ enabled: true, runtimeStatus: "running", errorCode: null })
      ]);
    } finally {
      database.close();
    }
  });

  it("persists safe mode after three detected interruptions and starts only required plugins", async () => {
    const events: string[] = [];
    const optional: SystemPluginDefinition = { manifest: manifest("optional", [navigation("optional")]), start: () => { events.push("optional"); } };
    const required: SystemPluginDefinition = { manifest: manifest("required", [navigation("required")]), start: () => { events.push("required"); } };
    const { database, repository } = await harness([optional, required]);
    try {
      repository.reconcileSystemPlugins([optional.manifest, required.manifest]);
      database.prepare("UPDATE installed_plugins SET required = 1 WHERE plugin_id = ?").run(required.manifest.id);

      repository.beginStartup();
      new PluginRepository(database).beginStartup();
      new PluginRepository(database).beginStartup();
      const entered = new PluginRepository(database).beginStartup();
      expect(entered).toMatchObject({ consecutiveFailedStartups: 3, safeMode: true, incomplete: true });

      const freshRepository = new PluginRepository(database);
      const registry = new ContributionRegistry();
      const lifecycle = new PluginLifecycle({
        definitions: [optional, required],
        repository: freshRepository,
        registry,
        permissions: new PermissionGate(freshRepository)
      });
      await lifecycle.startAll();

      expect(events).toEqual(["required"]);
      expect(registry.list().map((entry) => entry.pluginId)).toEqual([required.manifest.id]);
      expect(lifecycle.status()).toEqual(expect.arrayContaining([
        expect.objectContaining({ manifest: expect.objectContaining({ id: optional.manifest.id }), runtimeStatus: "safe-mode" }),
        expect.objectContaining({ manifest: expect.objectContaining({ id: required.manifest.id }), runtimeStatus: "running" })
      ]));
      expect(freshRepository.getStartupState()).toMatchObject({ consecutiveFailedStartups: 0, safeMode: true, incomplete: false });

      await lifecycle.enable(optional.manifest.id);
      expect(events).toEqual(["required"]);
      expect(lifecycle.status()).toEqual(expect.arrayContaining([
        expect.objectContaining({ manifest: expect.objectContaining({ id: optional.manifest.id }), enabled: true, runtimeStatus: "safe-mode" })
      ]));
    } finally {
      database.close();
    }
  });

  it("completes startup only after every attempted plugin settles and completed boots do not count as interrupted", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const definition: SystemPluginDefinition = { manifest: manifest("waiting"), start: () => waiting };
    const { database, repository, lifecycle } = await harness([definition]);
    try {
      const startup = lifecycle.startAll();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(repository.getStartupState()).toMatchObject({ incomplete: true, consecutiveFailedStartups: 0 });

      release();
      await startup;
      expect(repository.getStartupState()).toMatchObject({ incomplete: false, consecutiveFailedStartups: 0, safeMode: false });

      const freshRepository = new PluginRepository(database);
      freshRepository.beginStartup();
      expect(freshRepository.getStartupState()).toMatchObject({ incomplete: true, consecutiveFailedStartups: 0 });
      freshRepository.completeStartup();
    } finally {
      database.close();
    }
  });
});
