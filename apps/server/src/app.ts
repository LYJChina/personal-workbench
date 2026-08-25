import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { HealthResponseSchema } from "@workbench/contracts";
import { resolveAppPaths } from "./config/paths.js";
import { openDatabase, openOperationalDatabase } from "./db/database.js";
import { createProfileRouter, isPhotoUploadLimitError } from "./modules/profile/profile.routes.js";
import { createPreferencesRouter } from "./modules/preferences/preferences.routes.js";
import { PreferencesRepository } from "./modules/preferences/preferences.repository.js";
import { createDailyReportRouter } from "./modules/daily-reports/daily-report.routes.js";
import { DeepSeekClient, type DailyReportGenerator } from "./modules/daily-reports/deepseek.client.js";
import { createSettingsRouter, type DeepSeekConnectionTester, type MailConnectionTester } from "./modules/settings/settings.routes.js";
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
import { AiPolishClient, type AiPolishGenerator } from "./modules/ai-polish/ai-polish.client.js";
import { createHolidayRouter } from "./modules/calendar/holiday.routes.js";
import type { HolidayYearLoader } from "./modules/calendar/holiday.client.js";
import { AiChatClient, type AiChatGenerator } from "./modules/ai-chat/ai-chat.client.js";
import { createAiChatRouter } from "./modules/ai-chat/ai-chat.routes.js";
import { BackupService, type BackupExporter } from "./modules/backup/backup.service.js";
import { createBackupRouter, type BackupReadStreamFactory } from "./modules/backup/backup.routes.js";
import { enforceLocalRequestBoundary } from "./security/request-boundary.js";
import { PluginRepository } from "./modules/plugins/plugin.repository.js";
import { ContributionRegistry } from "./kernel/contribution-registry.js";
import { PermissionGate } from "./kernel/permissions.js";
import { PluginLifecycle, type SystemPluginDefinition } from "./kernel/plugin-lifecycle.js";
import { compiledSystemPluginManifests } from "./system-plugins/manifests.js";
import { createPluginRouter } from "./modules/plugins/plugin.routes.js";
import {
  createPluginRouteGuard,
  createPluginStartupReadiness,
  type PluginRouteOwnership
} from "./kernel/plugin-route-guard.js";

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
  deepSeekClient?: DailyReportGenerator;
  aiPolishClient?: AiPolishGenerator;
  aiChatClient?: AiChatGenerator;
  reminderChannel?: NotificationChannel;
  holidayYearLoader?: HolidayYearLoader;
  now?: () => Date;
  webDistDir?: string;
  instanceToken?: string;
  profileDatabaseOpener?: typeof openDatabase;
  pluginDatabaseInitializer?: typeof openDatabase;
  backupNow?: () => Date;
  backupTempRoot?: string;
  backupExporter?: BackupExporter;
  backupCreateReadStream?: BackupReadStreamFactory;
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
    start: () => undefined
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
  const deepSeekClient = options.deepSeekClient ?? new DeepSeekClient();
  const aiPolishClient = options.aiPolishClient ?? new AiPolishClient();
  const aiChatClient = options.aiChatClient ?? new AiChatClient();

  app.use(enforceLocalRequestBoundary);
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    if (options.instanceToken) {
      response.setHeader("X-LYJ-Workbench-Instance", options.instanceToken);
    }
    response.json(HealthResponseSchema.parse({ status: "ok" }));
  });

  app.use("/api", createVaultRouter({ vault, resolveLegacySecretImporter, monotonicNow: options.vaultMonotonicNow }));
  app.use("/api", createBackupRouter({
    exporter: options.backupExporter ?? new BackupService(paths, {
      now: options.backupNow,
      tempRoot: options.backupTempRoot
    }),
    createFileStream: options.backupCreateReadStream
  }));

  app.use("/api", createProfileRouter(paths, { openDatabase: options.profileDatabaseOpener }));
  app.use("/api", createPreferencesRouter(paths));
  app.use("/api", createPluginRouter({
    lifecycle: pluginLifecycle,
    registry: contributionRegistry,
    readiness: pluginStartup
  }));
  app.use("/api", pluginGuard("lyj.system.daily-reports", [
    { path: "/daily-reports", descendants: true }
  ]), createDailyReportRouter(paths, {
    secretStore,
    deepSeekClient,
    allowLoopbackHttp: options.allowLoopbackHttp
  }));
  app.use("/api", pluginGuard("lyj.system.ai-polish", [
    { path: "/ai-polish", descendants: true }
  ]), createAiPolishRouter(paths, {
    secretStore,
    generator: aiPolishClient,
    allowLoopbackHttp: options.allowLoopbackHttp
  }));
  app.use("/api", pluginGuard("lyj.system.ai-chat", [
    { path: "/ai-chat", descendants: true }
  ]), createAiChatRouter(paths, {
    secretStore,
    generator: aiChatClient,
    allowLoopbackHttp: options.allowLoopbackHttp
  }));
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
  app.use("/api", createSettingsRouter(paths, {
    secretStore,
    allowLoopbackHttp: options.allowLoopbackHttp,
    deepSeekConnectionTester: options.deepSeekConnectionTester,
    mailConnectionTester: options.mailConnectionTester,
    connectionTimeoutMs: options.connectionTimeoutMs
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
