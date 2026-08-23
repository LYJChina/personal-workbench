import { Router, type Response } from "express";
import { performance } from "node:perf_hooks";
import { VaultSetupInputSchema, VaultStatusSchema, VaultUnlockInputSchema } from "@workbench/contracts";
import {
  InvalidMasterPasswordError,
  VaultIntegrityError,
  type VaultService
} from "./vault.service.js";

const COOLDOWN_FAILURES = 5;
const COOLDOWN_MS = 30_000;

interface VaultRouterDependencies {
  vault: Pick<VaultService, "status" | "setup" | "unlock" | "lock">;
  monotonicNow?: () => number;
}

function apiError(response: Response, status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

export function createVaultRouter({ vault, monotonicNow = () => performance.now() }: VaultRouterDependencies): Router {
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
        await vault.setup(parsed.data.masterPassword, {});
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
