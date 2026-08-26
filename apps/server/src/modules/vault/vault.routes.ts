import { Router, type Response } from "express";
import { performance } from "node:perf_hooks";
import {
  VaultChangePasswordInputSchema,
  VaultConfirmRecoveryInputSchema,
  VaultEnrollmentInputSchema,
  VaultRecoveryCodeResetInputSchema,
  VaultRecoveryStatusSchema,
  VaultSetupInputSchema,
  VaultSmtpResetInputSchema,
  VaultStatusSchema,
  VaultUnlockInputSchema
} from "@workbench/contracts";
import {
  InvalidMasterPasswordError,
  VaultIntegrityError,
  type VaultService
} from "./vault.service.js";
import { InvalidRecoveryMaterialError } from "./vault.errors.js";
import type { VaultEnrollmentService } from "./vault-enrollment.service.js";
import { readEligibleLegacySecrets, type LegacySecretImporter } from "./legacy-secret-import.js";

const COOLDOWN_FAILURES = 5;
const COOLDOWN_MS = 30_000;

interface VaultRouterDependencies {
  vault: Pick<VaultService, "status" | "setup" | "unlock" | "lock"> & Partial<Pick<VaultService,
    "changePassword" | "recoveryStatus" | "confirmRecovery" | "resetWithRecoveryCode" | "resetWithSmtp">>;
  resolveLegacySecretImporter?: () => LegacySecretImporter | undefined;
  monotonicNow?: () => number;
  enrollment?: VaultEnrollmentService;
  verifySmtpRecovery?: (email: string, authorizationCode: string) => Promise<void>;
  onUnlocked?: () => Promise<void>;
  afterRecoveryCodeReset?: () => Promise<void>;
}

function apiError(response: Response, status: number, message: string, code: string): void {
  response.status(status).json({ error: { message, code } });
}

export function createVaultRouter({ vault, resolveLegacySecretImporter, monotonicNow = () => performance.now(), enrollment, verifySmtpRecovery, onUnlocked, afterRecoveryCodeReset }: VaultRouterDependencies): Router {
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

  router.post("/vault/enroll", async (request, response) => {
    const parsed = VaultEnrollmentInputSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "注册与邮箱配置无效", "VALIDATION_ERROR");
    await serialize(async () => {
      try {
        if (!enrollment) throw new Error("Enrollment unavailable");
        if (vault.status().configured) return apiError(response, 409, "保险库已经设置", "VAULT_ALREADY_CONFIGURED");
        await enrollment.setup(parsed.data);
        if (!vault.recoveryStatus) throw new Error("Recovery unavailable");
        response.status(201).json(VaultRecoveryStatusSchema.parse(vault.recoveryStatus()));
      } catch {
        if (!response.headersSent) apiError(response, 502, "SMTP 验证或恢复邮件发送失败", "RECOVERY_MAIL_FAILED");
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
        void onUnlocked?.().catch(() => undefined);
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

  router.get("/vault/recovery/status", (_request, response) => {
    if (!vault.recoveryStatus) return apiError(response, 501, "恢复功能不可用", "RECOVERY_NOT_AVAILABLE");
    response.json(VaultRecoveryStatusSchema.parse(vault.recoveryStatus()));
  });

  router.put("/vault/password", async (request, response) => {
    const parsed = VaultChangePasswordInputSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "密码输入无效", "VALIDATION_ERROR");
    await serialize(async () => {
      try {
        if (!vault.changePassword) throw new Error("Recovery unavailable");
        await vault.changePassword(parsed.data.currentPassword, parsed.data.newPassword);
        response.status(204).end();
      } catch (error) {
        if (error instanceof InvalidMasterPasswordError) return apiError(response, 401, "当前主密码不正确", "INVALID_MASTER_PASSWORD");
        apiError(response, 500, "主密码修改失败", "PASSWORD_CHANGE_FAILED");
      }
    });
  });

  router.post("/vault/recovery/confirm", async (request, response) => {
    const parsed = VaultConfirmRecoveryInputSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "确认码格式无效", "VALIDATION_ERROR");
    try {
      if (!vault.confirmRecovery) throw new Error("Recovery unavailable");
      vault.confirmRecovery(parsed.data.confirmationCode);
      response.status(204).end();
    } catch {
      apiError(response, 401, "确认码无效或已过期", "CONFIRMATION_CODE_INVALID");
    }
  });

  router.post("/vault/recovery/code-reset", async (request, response) => {
    const parsed = VaultRecoveryCodeResetInputSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "恢复输入无效", "VALIDATION_ERROR");
    await serialize(async () => {
      try {
        if (!vault.resetWithRecoveryCode) throw new InvalidRecoveryMaterialError();
        await vault.resetWithRecoveryCode(parsed.data.recoveryCode, parsed.data.newPassword);
        try { await afterRecoveryCodeReset?.(); } catch { /* password reset remains successful; recovery stays disabled */ }
        response.status(204).end();
      } catch {
        apiError(response, 401, "恢复信息无效", "INVALID_RECOVERY_MATERIAL");
      }
    });
  });

  router.post("/vault/recovery/smtp-reset", async (request, response) => {
    const parsed = VaultSmtpResetInputSchema.safeParse(request.body);
    if (!parsed.success) return apiError(response, 400, "SMTP 恢复输入无效", "VALIDATION_ERROR");
    await serialize(async () => {
      try {
        if (!vault.resetWithSmtp) throw new InvalidRecoveryMaterialError();
        if (!verifySmtpRecovery) throw new InvalidRecoveryMaterialError();
        await verifySmtpRecovery(parsed.data.smtpEmail, parsed.data.smtpPassword);
        await vault.resetWithSmtp(parsed.data.smtpEmail, parsed.data.smtpPassword, parsed.data.newPassword);
        response.status(204).end();
      } catch {
        apiError(response, 401, "SMTP 恢复信息无效或暂时不可用", "SMTP_RECOVERY_UNAVAILABLE");
      }
    });
  });

  return router;
}
