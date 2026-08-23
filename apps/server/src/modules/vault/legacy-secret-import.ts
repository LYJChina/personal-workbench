import { existsSync } from "node:fs";
import { join } from "node:path";
import { WindowsDpapiSecretStore } from "../../platform/legacy-windows-dpapi.js";
import type { SecretStore } from "../../platform/secret-store.js";

export const legacySecretNames = ["deepseek-api-key", "smtp-password"] as const;

export interface LegacySecretImporter {
  readAvailableSecrets(): Promise<Record<string, string>>;
}

export function detectLegacyWindowsSecrets(secretsDir: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" && legacySecretNames.some((name) => existsSync(join(secretsDir, `${name}.bin`)));
}

export function createLegacyWindowsSecretImporter(
  secretsDir: string,
  secretStore: Pick<SecretStore, "readSecret"> = new WindowsDpapiSecretStore(secretsDir)
): LegacySecretImporter {

  return {
    async readAvailableSecrets(): Promise<Record<string, string>> {
      const availableSecrets: Record<string, string> = {};
      try {
        for (const name of legacySecretNames) {
          const value = await secretStore.readSecret(name);
          if (value !== null) availableSecrets[name] = value;
        }
        return { ...availableSecrets };
      } finally {
        for (const name of Object.keys(availableSecrets)) delete availableSecrets[name];
      }
    }
  };
}

export async function readEligibleLegacySecrets(importer: LegacySecretImporter): Promise<Record<string, string>> {
  let availableSecrets: Record<string, string> | undefined;
  const eligibleSecrets: Record<string, string> = {};
  try {
    availableSecrets = await importer.readAvailableSecrets();
    for (const name of legacySecretNames) {
      const value = availableSecrets[name];
      if (typeof value === "string") eligibleSecrets[name] = value;
    }
    return { ...eligibleSecrets };
  } finally {
    if (availableSecrets) {
      for (const name of Object.keys(availableSecrets)) delete availableSecrets[name];
    }
    for (const name of Object.keys(eligibleSecrets)) delete eligibleSecrets[name];
  }
}
