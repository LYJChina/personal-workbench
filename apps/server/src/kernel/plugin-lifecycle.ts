import type {
  PluginContribution,
  PluginManifest,
  PluginSummary
} from "@workbench/contracts";
import { ContributionRegistry } from "./contribution-registry";
import type { PermissionGate } from "./permissions";
import type { PluginRepository } from "../modules/plugins/plugin.repository";

export interface SystemPluginDefinition {
  manifest: PluginManifest;
  start(context: Readonly<{
    registry: ContributionRegistry;
    permissions: PermissionGate;
  }>): void | (() => void) | Promise<void | (() => void)>;
}

export interface PluginLifecycleDependencies {
  definitions: SystemPluginDefinition[];
  repository: PluginRepository;
  registry: ContributionRegistry;
  permissions: PermissionGate;
}

interface ActivePlugin {
  cleanup?: () => void;
  revokers: Array<() => void>;
}

const pluginStartFailedCode = "PLUGIN_START_FAILED" as const;
const pluginContributionOwnerMismatchCode = "PLUGIN_CONTRIBUTION_OWNER_MISMATCH";

class ScopedContributionRegistry extends ContributionRegistry {
  readonly #pluginId: string;
  readonly #target: ContributionRegistry;
  readonly #revokers: Array<() => void>;

  public constructor(
    pluginId: string,
    target: ContributionRegistry,
    revokers: Array<() => void>
  ) {
    super();
    this.#pluginId = pluginId;
    this.#target = target;
    this.#revokers = revokers;
  }

  public override register(pluginId: string, contributions: PluginContribution[]): () => void {
    if (pluginId !== this.#pluginId) throw new Error(pluginContributionOwnerMismatchCode);
    const revoke = this.#target.register(pluginId, contributions);
    this.#revokers.push(revoke);
    return revoke;
  }

  public override list(type?: PluginContribution["type"]) {
    return this.#target.list(type);
  }
}

export class PluginLifecycle {
  private readonly definitions: SystemPluginDefinition[];
  private readonly definitionsById: Map<string, SystemPluginDefinition>;
  private readonly repository: PluginRepository;
  private readonly registry: ContributionRegistry;
  private readonly permissions: PermissionGate;
  private readonly active = new Map<string, ActivePlugin>();
  private operation: Promise<void> = Promise.resolve();

  public constructor(dependencies: PluginLifecycleDependencies) {
    this.definitions = [...dependencies.definitions].sort((left, right) =>
      left.manifest.id.localeCompare(right.manifest.id)
    );
    this.definitionsById = new Map(this.definitions.map((definition) => [definition.manifest.id, definition]));
    if (this.definitionsById.size !== this.definitions.length) throw new Error("Duplicate system plugin ID");
    this.repository = dependencies.repository;
    this.registry = dependencies.registry;
    this.permissions = dependencies.permissions;
  }

  public startAll(): Promise<void> {
    return this.enqueue(async () => {
      const startup = this.repository.beginStartup();
      const summaries = new Map(this.repository.list().map((summary) => [summary.manifest.id, summary]));

      for (const definition of this.definitions) {
        const summary = summaries.get(definition.manifest.id);
        if (!summary?.enabled || this.active.has(definition.manifest.id)) continue;
        if (startup.safeMode && !summary.required) {
          this.repository.setRuntimeStatus(definition.manifest.id, "safe-mode", null);
          continue;
        }
        await this.startDefinition(definition);
      }

      this.repository.completeStartup();
    });
  }

  public enable(id: string): Promise<void> {
    return this.enqueue(async () => {
      const definition = this.definitionsById.get(id);
      if (!definition) throw new Error("Plugin not found");
      this.repository.setEnabled(id, true);
      if (this.active.has(id)) return;

      const summary = this.summary(id);
      if (this.repository.getStartupState().safeMode && !summary.required) {
        this.repository.setRuntimeStatus(id, "safe-mode", null);
        return;
      }
      await this.startDefinition(definition);
    });
  }

  public disable(id: string): Promise<void> {
    return this.enqueue(async () => {
      const summary = this.summary(id);
      if (!summary.enabled) return;
      if (summary.required) {
        this.repository.setEnabled(id, false);
        return;
      }

      const active = this.active.get(id);
      this.runCleanup(active?.cleanup);
      this.revokeAll(active?.revokers ?? []);
      this.active.delete(id);
      this.repository.setEnabled(id, false);
      this.repository.setRuntimeStatus(id, "stopped", null);
    });
  }

  public status(): PluginSummary[] {
    return this.repository.list();
  }

  public isEnabled(id: string): boolean {
    return this.repository.list().find((summary) => summary.manifest.id === id)?.enabled ?? false;
  }

  public resetSafeMode(): void {
    this.repository.resetSafeMode();
  }

  private async startDefinition(definition: SystemPluginDefinition): Promise<void> {
    const revokers: Array<() => void> = [];
    let cleanup: (() => void) | undefined;
    this.repository.setRuntimeStatus(definition.manifest.id, "starting", null);

    try {
      revokers.push(this.registry.register(definition.manifest.id, definition.manifest.contributions));
      const scopedRegistry = new ScopedContributionRegistry(definition.manifest.id, this.registry, revokers);
      cleanup = (await definition.start({ registry: scopedRegistry, permissions: this.permissions })) ?? undefined;
      this.repository.setRuntimeStatus(definition.manifest.id, "running", null);
      this.active.set(definition.manifest.id, { cleanup, revokers });
    } catch {
      this.runCleanup(cleanup);
      this.revokeAll(revokers);
      this.active.delete(definition.manifest.id);
      this.repository.setRuntimeStatus(definition.manifest.id, "failed", pluginStartFailedCode);
    }
  }

  private summary(id: string): PluginSummary {
    const summary = this.repository.list().find((entry) => entry.manifest.id === id);
    if (!summary) throw new Error("Plugin not found");
    return summary;
  }

  private runCleanup(cleanup?: () => void): void {
    try {
      cleanup?.();
    } catch {
      // Plugin cleanup failures must not leave core-owned contributions registered.
    }
  }

  private revokeAll(revokers: Array<() => void>): void {
    for (let index = revokers.length - 1; index >= 0; index -= 1) {
      try {
        revokers[index]!();
      } catch {
        // A failed plugin revoker must not prevent later revocation or core state persistence.
      }
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => undefined);
    return result;
  }
}
