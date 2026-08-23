import { Router, type Response } from "express";
import { performance } from "node:perf_hooks";
import { VaultSetupInputSchema, VaultStatusSchema, VaultUnlockInputSchema } from "@workbench/contracts";
import {
  InvalidMasterPasswordError,
  VaultIntegrityError,
  type VaultService
} from "./vault.service.js";
import { readEligibleLegacySecrets, type LegacySecretImporter } from "./legacy-secret-import.js";

const COOLDOWN_FAILURES = 5;
const COOLDOWN_MS = 30_000;

interface VaultRouterDependencies {
  vault: Pick<VaultService, "status" | "setup" | "unlock" | "lock">;
  resolveLegacySecretImporter?: () => LegacySecretImporter | undefined;
  monotonicNow?: () => number;
}

function apiError(response: Response, status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

export function createVaultRouter({ vault, resolveLegacySecretImporter, monotonicNow = () => performance.now() }: VaultRouterDependencies): Router {
  const router = Router();
  let consecutiveFailures = 0;
  let cooldownUntil = 0;
  let lifecycleTail: Promise<void> = Promise.resolve();

  function serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = lifecycleTail.then(operation, operation);
    lifecycleTail = result.then(() => undefined, () => undefined);
    return result;
  }

  router.get("/vault/status", (_request, response) => {
    try {
      response.json(VaultStatusSchema.parse(vault.status()));
    } catch {
      apiError(response, 500, "保险库数据无法验证", "VAULT_INTEGRITY_ERROR");
    }
  });

  router.get("/vault/legacy-import-status", (_request, response) => {
    try {
      const status = vault.status();
      response.json({ detected: !status.configured && resolveLegacySecretImporter?.() !== undefined });
    } catch {
      apiError(response, 500, "保险库数据无法验证", "VAULT_INTEGRITY_ERROR");
    }
  });

  router.post("/vault/setup", async (request, response) => {
    const parsed = VaultSetupInputSchema.safeParse(request.body);
    if (!parsed.success) {
      apiError(response, 400, "主密码须为 12 至 1024 个字符", "VALIDATION_ERROR");
      return;
    }
    await serialize(async () => {
      try {
        if (vault.status().configured) {
          apiError(response, 409, "保险库已经设置", "VAULT_ALREADY_CONFIGURED");
          return;
        }
        const legacySecretImporter = resolveLegacySecretImporter?.();
        let initialSecrets: Record<string, string> = {};
        try {
          if (legacySecretImporter) initialSecrets = await readEligibleLegacySecrets(legacySecretImporter);
        } catch {
          apiError(response, 500, "旧版密钥迁移失败", "LEGACY_SECRET_IMPORT_FAILED");
          return;
        }
        try {
          await vault.setup(parsed.data.masterPassword, initialSecrets);
        } finally {
          for (const name of Object.keys(initialSecrets)) delete initialSecrets[name];
        }
        consecutiveFailures = 0;
        cooldownUntil = 0;
        response.status(201).json(VaultStatusSchema.parse(vault.status()));
      } catch (error) {
        if (error instanceof VaultIntegrityError) {
          apiError(response, 500, "保险库数据无法验证", "VAULT_INTEGRITY_ERROR");
          return;
        }
        apiError(response, 500, "保险库设置失败", "VAULT_SETUP_FAILED");
      }
    });
  });

  router.post("/vault/unlock", async (request, response) => {
    const parsed = VaultUnlockInputSchema.safeParse(request.body);
    if (!parsed.success) {
      apiError(response, 400, "主密码须为 12 至 1024 个字符", "VALIDATION_ERROR");
      return;
    }
    await serialize(async () => {
      try {
        if (!vault.status().configured) {
          apiError(response, 409, "保险库尚未设置", "VAULT_NOT_CONFIGURED");
          return;
        }
      } catch {
        apiError(response, 500, "保险库数据无法验证", "VAULT_INTEGRITY_ERROR");
        return;
      }

      const currentTime = monotonicNow();
      if (cooldownUntil > currentTime) {
        apiError(response, 429, "尝试次数过多，请稍后再试", "TOO_MANY_ATTEMPTS");
        return;
      }
      if (cooldownUntil !== 0) {
        cooldownUntil = 0;
        consecutiveFailures = 0;
      }

      try {
        await vault.unlock(parsed.data.masterPassword);
        consecutiveFailures = 0;
        cooldownUntil = 0;
        response.status(204).end();
      } catch (error) {
        if (error instanceof InvalidMasterPasswordError) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= COOLDOWN_FAILURES) cooldownUntil = monotonicNow() + COOLDOWN_MS;
          apiError(response, 401, "主密码不正确", "INVALID_MASTER_PASSWORD");
          return;
        }
        if (error instanceof VaultIntegrityError) {
          apiError(response, 500, "保险库数据无法验证", "VAULT_INTEGRITY_ERROR");
          return;
        }
        apiError(response, 500, "保险库解锁失败", "VAULT_UNLOCK_FAILED");
      }
    });
  });

  router.post("/vault/lock", async (_request, response) => {
    await serialize(async () => {
      vault.lock();
      response.status(204).end();
    });
  });

  return router;
}
