import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { HealthResponseSchema, MailSettingsUpdateSchema } from "@workbench/contracts";
import { resolveAppPaths } from "./config/paths.js";
import { openDatabase, openOperationalDatabase } from "./db/database.js";
import { createProfileRouter, isPhotoUploadLimitError } from "./modules/profile/profile.routes.js";
import { createPreferencesRouter } from "./modules/preferences/preferences.routes.js";
import { PreferencesRepository } from "./modules/preferences/preferences.repository.js";
import { createDailyReportRouter } from "./modules/daily-reports/daily-report.routes.js";
import { createSettingsRouter, testMailConnection, type DeepSeekConnectionTester, type MailConnectionTester } from "./modules/settings/settings.routes.js";
import type { SecretStore } from "./platform/secret-store.js";
import { VaultService, type VaultScryptOptions } from "./modules/vault/vault.service.js";
import { createVaultRepositoryProvider } from "./modules/vault/vault.repository.js";
import { createVaultRouter } from "./modules/vault/vault.routes.js";
import { VaultIntegrityError, VaultLockedError } from "./modules/vault/vault.errors.js";
import {
  createLegacyWindowsSecretImporter,
  detectLegacyWindowsSecrets,
  type LegacySecretImporter
} from "./modules/vault/legacy-secret-import.js";
import { createReminderRouter } from "./modules/reminders/reminder.routes.js";
import type { NotificationChannel } from "./modules/reminders/notification-channel.js";
import { createAiPolishRouter } from "./modules/ai-polish/ai-polish.routes.js";
import { createHolidayRouter } from "./modules/calendar/holiday.routes.js";
import type { HolidayYearLoader } from "./modules/calendar/holiday.client.js";
import { createAiChatRouter } from "./modules/ai-chat/ai-chat.routes.js";
import { createAiPersonaRouter } from "./modules/ai-chat/ai-persona.routes.js";
import { BackupService, type BackupExporter } from "./modules/backup/backup.service.js";
import { createBackupRouter, type BackupReadStreamFactory } from "./modules/backup/backup.routes.js";
import { enforceLocalRequestBoundary } from "./security/request-boundary.js";
import { PluginRepository } from "./modules/plugins/plugin.repository.js";
import { ContributionRegistry } from "./kernel/contribution-registry.js";
import { PermissionGate } from "./kernel/permissions.js";
import { PluginLifecycle, type SystemPluginDefinition } from "./kernel/plugin-lifecycle.js";
import { compiledSystemPluginManifests } from "./system-plugins/manifests.js";
import { createPluginRouter } from "./modules/plugins/plugin.routes.js";
import { AiConnectionRepository } from "./modules/ai-gateway/ai-connection.repository.js";
import { createAiConnectionRouter } from "./modules/ai-gateway/ai-connection.routes.js";
import { AiGateway } from "./modules/ai-gateway/ai-gateway.js";
import { OpenAiAdapter } from "./modules/ai-gateway/openai.adapter.js";
import { AnthropicAdapter } from "./modules/ai-gateway/anthropic.adapter.js";
import {
  createPluginRouteGuard,
  createPluginStartupReadiness,
  type PluginRouteOwnership
} from "./kernel/plugin-route-guard.js";
import { VaultEnrollmentService, type EnrollmentMailer } from "./modules/vault/vault-enrollment.service.js";
import { enrollmentMailer as defaultEnrollmentMailer, sendRotatedRecoveryCode } from "./modules/mail/mail-transport.js";
import { generateRecoveryCode } from "./modules/vault/vault-recovery.crypto.js";
import { SettingsRepository } from "./modules/settings/settings.repository.js";
import { PasswordManagerService } from "./modules/password-manager/password-manager.service.js";
import { createPasswordManagerRepositoryProvider } from "./modules/password-manager/password-manager.repository.js";
import { createPasswordManagerRouter, passwordManagerNoStore } from "./modules/password-manager/password-manager.routes.js";

export interface CreateAppOptions {
  dataDir?: string;
  secretStore?: SecretStore;
  vaultScrypt?: VaultScryptOptions;
  vaultMonotonicNow?: () => number;
  platform?: NodeJS.Platform;
  legacySecretImporter?: LegacySecretImporter;
  allowLoopbackHttp?: boolean;
  deepSeekConnectionTester?: DeepSeekConnectionTester;
  mailConnectionTester?: MailConnectionTester;
  connectionTimeoutMs?: number;
  aiGateway?: Pick<AiGateway, "complete">;
  aiConnectionTester?: (id: string, signal: AbortSignal) => Promise<void>;
  reminderChannel?: NotificationChannel;
  holidayYearLoader?: HolidayYearLoader;
  now?: () => Date;
  webDistDir?: string;
  instanceToken?: string;
  profileDatabaseOpener?: typeof openDatabase;
  pluginDatabaseInitializer?: typeof openDatabase;
  systemPluginStartOverrides?: Readonly<Record<string, SystemPluginDefinition["start"] | undefined>>;
  backupNow?: () => Date;
  backupTempRoot?: string;
  backupExporter?: BackupExporter;
  backupCreateReadStream?: BackupReadStreamFactory;
  vaultEnrollmentMailer?: EnrollmentMailer;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const paths = resolveAppPaths(options);
  const initializedPluginDatabase = (options.pluginDatabaseInitializer ?? openDatabase)(paths);
  try {
    new PreferencesRepository(initializedPluginDatabase).initializeDefaults();
    new PluginRepository(initializedPluginDatabase)
      .reconcileSystemPlugins([...compiledSystemPluginManifests]);
  } finally {
    initializedPluginDatabase.close();
  }
  const pluginRepository = new PluginRepository(() => openOperationalDatabase(paths));
  const contributionRegistry = new ContributionRegistry();
  const permissionGate = new PermissionGate(pluginRepository);
  const pluginDefinitions: SystemPluginDefinition[] = compiledSystemPluginManifests.map((manifest) => ({
    manifest,
    start: options.systemPluginStartOverrides?.[manifest.id] ?? (() => undefined)
  }));
  const pluginLifecycle = new PluginLifecycle({
    definitions: pluginDefinitions,
    repository: pluginRepository,
    registry: contributionRegistry,
    permissions: permissionGate
  });
  const pluginStartup = createPluginStartupReadiness(pluginLifecycle.startAll());
  const pluginGuard = (pluginId: string, ownership: readonly PluginRouteOwnership[]) =>
    createPluginRouteGuard({ pluginId, ownership, lifecycle: pluginLifecycle, readiness: pluginStartup });
  const vault = new VaultService(createVaultRepositoryProvider(paths), { scrypt: options.vaultScrypt });
  const vaultEnrollment = new VaultEnrollmentService(vault, options.vaultEnrollmentMailer ?? defaultEnrollmentMailer, {
    now: options.now,
    persistMail: (mail) => {
      const database = openOperationalDatabase(paths);
      try {
        new SettingsRepository(database).saveMailSettings({
          smtpHost: mail.smtpHost,
          smtpPort: mail.smtpPort,
          transportMode: mail.transportMode,
          smtpUsername: mail.smtpUsername,
          fromAddress: mail.fromAddress
        }, true);
      } finally { database.close(); }
    }
  });
  const platform = options.platform ?? process.platform;
  let legacySecretImporter: LegacySecretImporter | undefined;
  const resolveLegacySecretImporter = (): LegacySecretImporter | undefined => {
    if (platform !== "win32") return undefined;
    if (legacySecretImporter) return legacySecretImporter;
    if (!detectLegacyWindowsSecrets(paths.secretsDir, platform)) return undefined;
    legacySecretImporter = options.legacySecretImporter ?? createLegacyWindowsSecretImporter(paths.secretsDir);
    return legacySecretImporter;
  };
  const secretStore = options.secretStore ?? vault;
  const aiConnectionRepository = new AiConnectionRepository(() => openOperationalDatabase(paths));
  const kernelAiGateway = new AiGateway({
    repository: aiConnectionRepository,
    secretStore,
    openai: new OpenAiAdapter(),
    anthropic: new AnthropicAdapter()
  });
  const aiGateway = options.aiGateway ?? kernelAiGateway;
  const aiConnectionTester = options.aiConnectionTester ?? ((id: string, signal: AbortSignal) => kernelAiGateway.testConnection(id, signal));

  const passwordManager = new PasswordManagerService(createPasswordManagerRepositoryProvider(paths));
  app.use(passwordManagerNoStore);
  app.use(enforceLocalRequestBoundary);
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    if (options.instanceToken) {
      response.setHeader("X-LYJ-Workbench-Instance", options.instanceToken);
    }
    response.json(HealthResponseSchema.parse({ status: "ok" }));
  });

  app.use("/api", createVaultRouter({
    vault,
    enrollment: vaultEnrollment,
    resolveLegacySecretImporter,
    monotonicNow: options.vaultMonotonicNow,
    verifySmtpRecovery: async (email, authorizationCode) => {
      const database = openOperationalDatabase(paths);
      try {
        const mail = new SettingsRepository(database).getMailSettings(true);
        if (mail.smtpUsername.trim().toLowerCase() !== email.trim().toLowerCase()) throw new Error("SMTP identity mismatch");
        await (options.mailConnectionTester ?? testMailConnection)({ ...mail, smtpPassword: authorizationCode, timeoutMs: options.connectionTimeoutMs ?? 8_000 });
      } finally { database.close(); }
    },
    onUnlocked: async () => {
      const smtpPassword = await vault.readSecret("smtp-password");
      if (!smtpPassword) return vault.recordSmtpHealth("unknown");
      const database = openOperationalDatabase(paths);
      let mail;
      try {
        mail = new SettingsRepository(database).getMailSettings(true);
      } finally { database.close(); }
      if (!MailSettingsUpdateSchema.safeParse(mail).success) return vault.recordSmtpHealth("unknown");
      try {
        await (options.mailConnectionTester ?? testMailConnection)({ ...mail, smtpPassword, timeoutMs: options.connectionTimeoutMs ?? 8_000 });
        vault.recordSmtpHealth("valid");
      } catch (error) {
        const code = (error as { code?: string }).code;
        vault.recordSmtpHealth(code === "EAUTH" || code === "EENVELOPE" ? "invalid" : "unreachable");
      }
    },
    afterRecoveryCodeReset: async () => {
      const recoveryEmail = vault.recoveryEmail();
      const smtpPassword = await vault.readSecret("smtp-password");
      if (!recoveryEmail || !smtpPassword) return;
      const database = openOperationalDatabase(paths);
      let mail;
      try { mail = new SettingsRepository(database).getMailSettings(true); }
      finally { database.close(); }
      if (!MailSettingsUpdateSchema.safeParse(mail).success) return;
      const generated = generateRecoveryCode();
      try {
        await sendRotatedRecoveryCode({ ...mail, smtpPassword }, recoveryEmail, generated.display);
        await vault.rotateRecoveryCode(generated.display);
      } finally { generated.entropy.fill(0); }
    }
  }));
  app.use("/api", createBackupRouter({
    exporter: options.backupExporter ?? new BackupService(paths, {
      now: options.backupNow,
      tempRoot: options.backupTempRoot
    }),
    createFileStream: options.backupCreateReadStream
  }));

  app.use("/api", createProfileRouter(paths, { openDatabase: options.profileDatabaseOpener }));
  app.use("/api", createPreferencesRouter(paths));
  app.use("/api", createAiConnectionRouter({
    repository: aiConnectionRepository,
    secretStore,
    allowLoopbackHttp: options.allowLoopbackHttp,
    tester: aiConnectionTester
  }));
  app.use("/api", createPluginRouter({
    lifecycle: pluginLifecycle,
    registry: contributionRegistry,
    readiness: pluginStartup
  }));
  app.use("/api", pluginGuard("lyj.system.daily-reports", [
    { path: "/daily-reports", descendants: true }
  ]), createDailyReportRouter(paths, {
    gateway: aiGateway
  }));
  app.use("/api", pluginGuard("lyj.system.ai-polish", [
    { path: "/ai-polish", descendants: true }
  ]), createAiPolishRouter(paths, {
    gateway: aiGateway
  }));
  app.use("/api", pluginGuard("lyj.system.ai-chat", [
    { path: "/ai-chat", descendants: true }
  ]), createAiChatRouter(paths, {
    gateway: aiGateway
  }));
  app.use("/api", pluginGuard("lyj.system.ai-chat", [
    { path: "/ai-chat/persona", descendants: true }
  ]), createAiPersonaRouter(paths, { gateway: aiGateway }));
  app.use("/api", pluginGuard("lyj.system.reminders", [
    { path: "/reminders", descendants: true },
    { path: "/reminder-attempts", descendants: true },
    { path: "/dashboard/upcoming-reminders", descendants: false }
  ]), createReminderRouter(paths, {
    secretStore,
    channel: options.reminderChannel,
    now: options.now
  }));
  app.use("/api", pluginGuard("lyj.system.workday-calendar", [
    { path: "/calendar", descendants: true }
  ]), createHolidayRouter(paths, {
    loader: options.holidayYearLoader,
    now: options.now
  }));
  app.use("/api", pluginGuard("lyj.system.password-manager", [
    { path: "/password-manager", descendants: true }
  ]), createPasswordManagerRouter({ passwordManager }));
  app.use("/api", createSettingsRouter(paths, {
    secretStore,
    allowLoopbackHttp: options.allowLoopbackHttp,
    deepSeekConnectionTester: options.deepSeekConnectionTester,
    mailConnectionTester: options.mailConnectionTester,
    connectionTimeoutMs: options.connectionTimeoutMs,
    aiConnectionTester: options.deepSeekConnectionTester ? undefined : aiConnectionTester,
    smtpCredentialUpdater: options.secretStore ? undefined : async (input) => vault.updateSmtpCredentials(input.currentPassword, input.smtpUsername, input.smtpPassword, input)
  }));

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
  });

  if (options.webDistDir) {
    app.use(express.static(options.webDistDir));
    app.use((request, response, next) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        next();
        return;
      }
      response.sendFile("index.html", { root: options.webDistDir, dotfiles: "deny" }, (error) => {
        if (error) next(error);
      });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: { message: "Not Found", code: "NOT_FOUND" } });
  });

  app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
    if (request.aborted || response.destroyed) return;
    if (isPhotoUploadLimitError(error)) {
      response.status(413).json({ error: { message: "Profile photo must be 5 MB or smaller", code: "PAYLOAD_TOO_LARGE" } });
      return;
    }
    if (error instanceof VaultLockedError) {
      response.status(423).json({ error: { message: "保险库已锁定", code: "VAULT_LOCKED" } });
      return;
    }
    if (error instanceof VaultIntegrityError) {
      response.status(500).json({ error: { message: "保险库数据无法验证", code: "VAULT_INTEGRITY_ERROR" } });
      return;
    }
    console.error("Unhandled server error");
    response.status(500).json({ error: { message: "Internal Server Error", code: "INTERNAL_ERROR" } });
  });

  return app;
}
