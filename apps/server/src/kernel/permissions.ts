import type { PluginPermission } from "@workbench/contracts";
import type { PluginRepository } from "../modules/plugins/plugin.repository";

export const pluginPermissionDeniedCode = "PLUGIN_PERMISSION_DENIED";

export class PluginPermissionDeniedError extends Error {
  public readonly code = pluginPermissionDeniedCode;

  public constructor() {
    super(pluginPermissionDeniedCode);
    this.name = "PluginPermissionDeniedError";
  }
}

export class PermissionGate {
  readonly #repository: PluginRepository;

  public constructor(repository: PluginRepository) {
    this.#repository = repository;
  }

  public assert(pluginId: string, permission: PluginPermission): void {
    if (!this.#repository.isPermissionGranted(pluginId, permission)) {
      throw new PluginPermissionDeniedError();
    }
  }
}
