# LYJ Workbench Microkernel and System-Plugin Protocol Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a small, reversible plugin kernel and migrate AI chat, AI polish, daily reports, workday calendar, and reminders into system-plugin contributions without changing or losing their existing data.

**Architecture:** The core owns startup, SQLite, vault, SMTP transport, backup, profile, appearance, plugin state, and permission enforcement. System plugins declare the same versioned manifest/contribution format that third-party plugins will use later, but trusted React component tokens are resolved only by a compiled system-component map; plugins never receive Express, SQLite, or secrets. Registration is atomic and returns a revoker, so disabling or failing one plugin removes all of its navigation, routes, dashboard cards, AI tools, settings entries, guards, and subscriptions.

**Tech Stack:** TypeScript 5.7, Node.js 22, Express 5, React 19, React Router 7, SQLite via `better-sqlite3`, Zod, Vitest, pnpm 11.19.0.

## Global Constraints

- Start only after the foundation fix wave is committed and Windows/macOS hosted CI is green. A real cross-device database transfer remains a final external acceptance gate.
- Current schema version is `3`; this plan adds immutable migration `004_plugin_kernel.sql` and advances `PRAGMA user_version` to `4` through the existing transactional migration registry.
- Existing profile, dashboard layout, navigation choices, AI histories, calendar data, reminders, SMTP settings, vault data, and encrypted secrets remain in place.
- System plugins may be disabled but not uninstalled. Disabling never deletes business data.
- Profile, appearance, vault, backup/export, SMTP transport, plugin management, database migration, and request security remain core-owned.
- Third-party folder installation, iframe execution, package storage, declarative workflows, quotas, and AI cost accounting are explicitly out of scope until Plans 3–5.
- No plugin receives an Express instance, SQLite handle, filesystem path, vault key, provider key, SMTP password, or arbitrary Node.js execution.
- Every task follows RED → verify failure → minimal GREEN → focused regression → independent specification and quality/security review → checkpoint commit.

---

### Task 1: Versioned plugin contracts and manifest validation

**Files:**
- Create: `packages/contracts/src/plugins.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/plugins.test.ts`

**Interfaces:**
- Produces `PluginManifest`, `PluginPermission`, `PluginContribution`, `PluginRuntimeStatus`, `PluginSummary`, and their Zod schemas.
- Contribution component values are opaque strings; only the web system-component resolver maps them to React components.

- [ ] **Step 1: Write failing contract tests**

Cover a complete valid system manifest and rejection of duplicate contribution IDs, path traversal-like route paths, invalid semantic versions, unknown permissions, noncanonical plugin IDs, duplicate permissions, unsupported manifest versions, and duplicate component tokens.

```ts
const valid = {
  manifestVersion: 1,
  id: "lyj.system.reminders",
  name: "提醒事项",
  version: "1.0.0",
  author: "LYJ Workbench",
  kind: "system",
  platforms: ["win32", "darwin"],
  permissions: ["reminders:read", "reminders:write", "mail:send"],
  contributions: [
    { type: "navigation", id: "reminders", label: "提醒事项", path: "/reminders", icon: "bell", position: 20 },
    { type: "route", id: "reminders-page", path: "/reminders", component: "system.reminders.page" },
    { type: "dashboard", id: "upcoming-reminders", title: "近期提醒", component: "system.reminders.dashboard", minW: 4, minH: 5 }
  ]
};
expect(PluginManifestSchema.parse(valid).id).toBe("lyj.system.reminders");
```

- [ ] **Step 2: Run RED**

```text
pnpm --filter @workbench/contracts test -- src/plugins.test.ts
```

Expected: FAIL because `plugins.ts` and `PluginManifestSchema` do not exist.

- [ ] **Step 3: Implement the exact v1 contract**

Use these stable shapes:

```ts
export const PluginIdSchema = z.string().regex(/^lyj\.(?:system|plugin)\.[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100);
export const PluginPermissionSchema = z.enum([
  "storage:own", "profile:read", "profile:write",
  "reminders:read", "reminders:write", "ai:use", "mail:send"
]);
export const PluginContributionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigation"), id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), label: z.string().trim().min(1).max(100), path: z.string().regex(/^\/[a-z0-9/-]*$/), icon: z.string().regex(/^[a-z0-9-]+$/), position: z.number().int().min(0).max(10_000) }).strict(),
  z.object({ type: z.literal("route"), id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), path: z.string().regex(/^\/[a-z0-9/-]*$/), component: z.string().regex(/^system\.[a-z0-9.-]+$/) }).strict(),
  z.object({ type: z.literal("dashboard"), id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string().trim().min(1).max(100), component: z.string().regex(/^system\.[a-z0-9.-]+$/), minW: z.number().int().min(1).max(16), minH: z.number().int().min(1).max(100) }).strict(),
  z.object({ type: z.literal("ai-tool"), id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), label: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(500), path: z.string().regex(/^\/ai-office\/[a-z0-9/-]+$/), icon: z.string().regex(/^[a-z0-9-]+$/), position: z.number().int().min(0).max(10_000) }).strict(),
  z.object({ type: z.literal("settings"), id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), title: z.string().trim().min(1).max(100), component: z.string().regex(/^system\.[a-z0-9.-]+$/), position: z.number().int().min(0).max(10_000) }).strict()
]);
```

`PluginManifestSchema.superRefine` must reject duplicate permission strings, duplicate contribution `type:id` pairs, duplicate route paths within one manifest, and duplicate component tokens within one manifest. Export inferred types and `PluginSummarySchema` containing manifest, enabled, required, runtime status, permissions granted, and a fixed nullable error code.
The manifest `version` field must match exact stable semantic-version syntax `/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/`; prerelease and build metadata are deferred until third-party compatibility work in Plan 3.

- [ ] **Step 4: Run GREEN and workspace check**

```text
pnpm --filter @workbench/contracts test -- src/plugins.test.ts
pnpm --filter @workbench/contracts check
```

Expected: all plugin contract tests pass and TypeScript reports no errors.

- [ ] **Step 5: Commit checkpoint**

```text
git add packages/contracts/src/plugins.ts packages/contracts/src/plugins.test.ts packages/contracts/src/index.ts
git commit -m "feat: define system plugin contracts"
```

### Task 2: SQLite plugin state, audit, and schema v4

**Files:**
- Create: `apps/server/src/db/migrations/004_plugin_kernel.sql`
- Modify: `apps/server/src/db/database.ts`
- Create: `apps/server/src/modules/plugins/plugin.repository.ts`
- Create: `apps/server/tests/plugin-database.test.ts`
- Modify: `apps/server/tests/database.test.ts`
- Modify: `apps/server/tests/backup.test.ts`

**Interfaces:**
- Produces `PluginRepository.reconcileSystemPlugins(manifests)`, `list()`, `setEnabled(id, enabled)`, `recordAudit(event)`, `beginStartup()`, and `completeStartup()`.
- The repository stores manifest JSON only after parsing it through `PluginManifestSchema`.

- [ ] **Step 1: Write failing migration/repository tests**

Assert v3→v4 migration preserves all existing tables/data, seeds five system plugin records without enabling a missing/unknown plugin, is idempotent, rejects corrupt stored manifests with a fixed error, retains disabled state across reconcile, prevents disabling a required plugin, records sanitized audit rows, and appears in an exported backup.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @workbench/server test -- tests/plugin-database.test.ts tests/database.test.ts tests/backup.test.ts
```

Expected: FAIL because schema v4 and `PluginRepository` do not exist.

- [ ] **Step 3: Add immutable schema v4**

`004_plugin_kernel.sql` must create:

```sql
CREATE TABLE installed_plugins (
  plugin_id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system', 'third-party')),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  required INTEGER NOT NULL CHECK (required IN (0, 1)),
  runtime_status TEXT NOT NULL CHECK (runtime_status IN ('stopped', 'starting', 'running', 'failed', 'safe-mode')),
  last_error_code TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE plugin_permissions (
  plugin_id TEXT NOT NULL REFERENCES installed_plugins(plugin_id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plugin_id, permission)
);
CREATE TABLE plugin_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plugin_id TEXT,
  action TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'denied', 'failure')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX plugin_audit_plugin_created_idx ON plugin_audit_events(plugin_id, created_at DESC, id DESC);
CREATE TABLE plugin_runtime_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Add migration version 4 to the existing ordered registry. Never edit versions 1–3 to add plugin tables.

- [ ] **Step 4: Implement repository transactions**

`reconcileSystemPlugins` performs one transaction: parse every manifest first; reject duplicate IDs; insert new system plugins enabled by default; update manifest/version without silently re-enabling existing disabled plugins; synchronize requested permission rows as granted for compiled system plugins; mark removed compiled plugins stopped but do not delete their data. Audit errors use codes only, never stack traces or manifest bodies.

- [ ] **Step 5: Run GREEN and backup regression**

```text
pnpm --filter @workbench/server test -- tests/plugin-database.test.ts tests/database.test.ts tests/backup.test.ts
pnpm --filter @workbench/server check
```

Expected: focused suites pass; exported SQLite contains plugin state and audit tables; migration recovery tests remain green.

- [ ] **Step 6: Commit checkpoint**

```text
git add apps/server/src/db/migrations/004_plugin_kernel.sql apps/server/src/db/database.ts apps/server/src/modules/plugins/plugin.repository.ts apps/server/tests/plugin-database.test.ts apps/server/tests/database.test.ts apps/server/tests/backup.test.ts
git commit -m "feat: persist system plugin state"
```

### Task 3: Atomic contribution registry, permissions, and lifecycle

**Files:**
- Create: `apps/server/src/kernel/contribution-registry.ts`
- Create: `apps/server/src/kernel/permissions.ts`
- Create: `apps/server/src/kernel/plugin-lifecycle.ts`
- Create: `apps/server/tests/plugin-registry.test.ts`
- Create: `apps/server/tests/plugin-lifecycle.test.ts`
- Create: `apps/server/tests/plugin-permissions.test.ts`

**Interfaces:**
- Produces `ContributionRegistry.register(pluginId, contributions): () => void`.
- Produces `PermissionGate.assert(pluginId, permission): void` with fixed `PLUGIN_PERMISSION_DENIED`.
- Produces `PluginLifecycle.startAll()`, `enable(id)`, `disable(id)`, `status()`, and `isEnabled(id)`.

- [ ] **Step 1: Write failing atomicity and lifecycle tests**

Cover collision rollback with zero partial registrations, reverse-order revocation, idempotent disable, denied permissions at execution time, one plugin startup failure not blocking another, cleanup after partial start, persisted enable state, and safe mode after three interrupted startups.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @workbench/server test -- tests/plugin-registry.test.ts tests/plugin-lifecycle.test.ts tests/plugin-permissions.test.ts
```

Expected: FAIL because kernel modules do not exist.

- [ ] **Step 3: Implement registry and permission gate**

Use this registration contract:

```ts
export interface RegisteredContribution {
  pluginId: string;
  contribution: PluginContribution;
}
export class ContributionRegistry {
  register(pluginId: string, contributions: PluginContribution[]): () => void;
  list(type?: PluginContribution["type"]): RegisteredContribution[];
}
```

Validate all collisions before mutating the map. The returned revoker removes only entries whose owner is the registering plugin and can be called repeatedly. `PermissionGate` reads grants from `PluginRepository` on every capability execution; UI hiding is never treated as authorization.

- [ ] **Step 4: Implement lifecycle and safe mode**

```ts
export interface SystemPluginDefinition {
  manifest: PluginManifest;
  start(context: Readonly<{ registry: ContributionRegistry; permissions: PermissionGate }>): void | (() => void) | Promise<void | (() => void)>;
}
```

At startup, call `beginStartup()`. If the previous marker was incomplete, increment `consecutive_failed_startups`; at 3 enter safe mode and do not start optional system plugins. Start plugins sequentially in stable plugin-ID order. A failed plugin is marked failed, its revoker/cleanup runs, and the next plugin still starts. `completeStartup()` clears the marker only after all attempted plugins settle. Disable calls cleanup then revoker before persisting stopped state.

- [ ] **Step 5: Run GREEN**

```text
pnpm --filter @workbench/server test -- tests/plugin-registry.test.ts tests/plugin-lifecycle.test.ts tests/plugin-permissions.test.ts
pnpm --filter @workbench/server check
```

- [ ] **Step 6: Commit checkpoint**

```text
git add apps/server/src/kernel apps/server/tests/plugin-registry.test.ts apps/server/tests/plugin-lifecycle.test.ts apps/server/tests/plugin-permissions.test.ts
git commit -m "feat: add reversible plugin lifecycle"
```

### Task 4: Compiled system manifests and guarded plugin APIs

**Files:**
- Create: `apps/server/src/system-plugins/manifests.ts`
- Create: `apps/server/src/modules/plugins/plugin.routes.ts`
- Create: `apps/server/src/kernel/plugin-route-guard.ts`
- Modify: `apps/server/src/app.ts`
- Modify: existing AI/reminder/calendar route composition in `apps/server/src/app.ts`
- Create: `apps/server/tests/plugin-api.test.ts`
- Modify: `apps/server/tests/security-boundaries.test.ts`

**Interfaces:**
- Produces five immutable manifests with IDs `lyj.system.ai-chat`, `lyj.system.ai-polish`, `lyj.system.daily-reports`, `lyj.system.workday-calendar`, and `lyj.system.reminders`.
- Produces `GET /api/plugins`, `PUT /api/plugins/:id/enabled`, `GET /api/plugins/contributions`, and `POST /api/plugins/safe-mode/reset`.

- [ ] **Step 1: Write failing API/guard tests**

Assert all five manifests reconcile on first boot; disabling hides contributions and causes that plugin's existing API endpoints to return fixed 404 `PLUGIN_DISABLED`; data remains; re-enable restores access; unknown IDs and attempts to disable required core entries fail safely; system plugins cannot be uninstalled; mutation provenance remains required; safe mode lists but does not start optional plugins.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @workbench/server test -- tests/plugin-api.test.ts tests/security-boundaries.test.ts
```

- [ ] **Step 3: Define exact system contributions**

- `ai-chat`: dashboard `ai-chat` → `system.ai-chat.dashboard`.
- `ai-polish`: route `/ai-office/polish` → `system.ai-polish.page`; AI tool `ai-polish`.
- `daily-reports`: route `/ai-office/daily-report` → `system.daily-reports.page`; AI tool `daily-report`.
- `workday-calendar`: dashboard `workday-calendar` → `system.workday-calendar.dashboard`.
- `reminders`: navigation `reminders`, route `/reminders` → `system.reminders.page`, dashboard `upcoming-reminders` → `system.reminders.dashboard`.

The core continues to own `/`, `/ai-office`, `/settings`, vault gating, profile, backup, appearance, SMTP settings/transport, and plugin management.

- [ ] **Step 4: Add guarded composition**

`plugin-route-guard.ts` checks lifecycle state at request time before invoking existing plugin-owned routers. It never hands the router or Express app to the plugin definition. The compiled core still constructs those routers with their current dependencies.

- [ ] **Step 5: Run GREEN and full server regression**

```text
pnpm --filter @workbench/server test -- tests/plugin-api.test.ts tests/security-boundaries.test.ts
pnpm --filter @workbench/server test
pnpm --filter @workbench/server check
```

- [ ] **Step 6: Commit checkpoint**

```text
git add apps/server/src/system-plugins apps/server/src/modules/plugins apps/server/src/kernel/plugin-route-guard.ts apps/server/src/app.ts apps/server/tests/plugin-api.test.ts apps/server/tests/security-boundaries.test.ts
git commit -m "feat: compose guarded system plugins"
```

### Task 5: Web contribution registry and dynamic shell

**Files:**
- Create: `apps/web/src/plugins/systemComponentRegistry.tsx`
- Create: `apps/web/src/plugins/ContributionProvider.tsx`
- Create: `apps/web/src/plugins/PluginRoutes.tsx`
- Create: `apps/web/src/plugins/contributions.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/Sidebar.tsx`
- Modify: `apps/web/src/features/dashboard/moduleRegistry.tsx`
- Modify: `apps/web/src/features/dashboard/EditableDashboard.tsx`
- Modify: `apps/web/src/features/ai-office/AiOfficePage.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces `usePluginContributions()` with typed enabled navigation, routes, dashboard modules, AI tools, settings sections, loading, and fixed error state.
- Consumes only `GET /api/plugins/contributions`; it never trusts component names outside the compiled resolver.

- [ ] **Step 1: Write failing dynamic-contribution tests**

Test enabled contributions render in stable position order; unknown component tokens fail closed without crashing the shell; duplicate IDs from the server are rejected; disabling removes route/nav/card/tool immediately; core profile card and core routes remain; existing dashboard rows survive while a disabled module is hidden; re-enable restores the saved layout.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @workbench/web test -- src/plugins/contributions.test.tsx src/app/App.integration.test.tsx src/features/dashboard/EditableDashboard.test.tsx
```

- [ ] **Step 3: Implement the compiled resolver**

```ts
export const systemComponentRegistry = {
  "system.ai-chat.dashboard": AiChatCard,
  "system.ai-polish.page": AiPolishPage,
  "system.daily-reports.page": DailyReportPage,
  "system.workday-calendar.dashboard": WorkdayCalendarCard,
  "system.reminders.page": ReminderPage,
  "system.reminders.dashboard": UpcomingRemindersCard
} satisfies Record<string, React.ComponentType>;
```

Do not use dynamic imports from manifest paths and do not execute manifest-provided JavaScript.

- [ ] **Step 4: Replace fixed UI lists with contributions**

`App.tsx` keeps core routes and renders `PluginRoutes`. `Sidebar` merges core navigation with enabled navigation contributions and preserves user visibility/position preferences. `moduleRegistry.tsx` keeps only the core profile module and derives system dashboard modules from contributions. `AiOfficePage` renders enabled AI-tool contributions. Loading/failure leaves core pages usable and shows a non-sensitive banner.

- [ ] **Step 5: Run GREEN and web regression**

```text
pnpm --filter @workbench/web test -- src/plugins/contributions.test.tsx src/app/App.integration.test.tsx src/features/dashboard/EditableDashboard.test.tsx
pnpm --filter @workbench/web test
pnpm --filter @workbench/web check
```

- [ ] **Step 6: Commit checkpoint**

```text
git add apps/web/src/plugins apps/web/src/app/App.tsx apps/web/src/app/Sidebar.tsx apps/web/src/features/dashboard apps/web/src/features/ai-office/AiOfficePage.tsx apps/web/src/lib/api.ts
git commit -m "feat: render system plugin contributions"
```

### Task 6: Preserve legacy navigation/layout while plugins toggle

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/modules/preferences/preferences.repository.ts`
- Modify: `apps/server/src/modules/preferences/preferences.routes.ts`
- Modify: `apps/server/tests/preferences.test.ts`
- Modify: `apps/web/src/features/dashboard/SidebarEditor.tsx`
- Modify: `apps/web/src/features/dashboard/EditableDashboard.tsx`
- Modify: relevant web dashboard/sidebar tests

**Interfaces:**
- Existing IDs `ai-chat`, `workday-calendar`, `upcoming-reminders`, and `reminders` remain stable.
- User preference APIs accept registered contribution IDs but reject arbitrary unknown IDs.

- [ ] **Step 1: Write failing compatibility tests**

Use a populated pre-kernel database. Prove old layout/navigation rows map to enabled contribution IDs, disabled plugin rows remain stored, unregistered IDs are rejected, user coordinates/size/visibility are unchanged across disable/re-enable, and core navigation entries cannot be removed.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @workbench/server test -- tests/preferences.test.ts tests/plugin-database.test.ts
pnpm --filter @workbench/web test -- src/features/dashboard/EditableDashboard.test.tsx src/app/App.integration.test.tsx
```

- [ ] **Step 3: Generalize validation without accepting unknown IDs**

Replace compile-time enum-only validation with a repository/route validator that builds the allowed ID set from core IDs plus currently installed contribution IDs. Keep stable string types bounded by `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and 100 characters. Never delete preference rows merely because a plugin is disabled.

- [ ] **Step 4: Run GREEN**

Run the commands from Step 2 plus workspace type checks.

- [ ] **Step 5: Commit checkpoint**

```text
git add packages/contracts/src/index.ts apps/server/src/modules/preferences apps/server/tests/preferences.test.ts apps/server/tests/plugin-database.test.ts apps/web/src/features/dashboard apps/web/src/app/App.integration.test.tsx
git commit -m "feat: preserve plugin layout preferences"
```

### Task 7: Nontechnical plugin management and safe-mode UI

**Files:**
- Create: `apps/web/src/features/plugins/PluginManager.tsx`
- Create: `apps/web/src/features/plugins/PluginManager.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Consumes plugin list/toggle/safe-mode reset APIs.
- Exposes no folder installation, update, uninstall, quota, or third-party permission approval controls in Plan 2.

- [ ] **Step 1: Write failing user-flow tests**

Assert Settings shows system plugin name, status, contribution summary, and on/off switch; disabling requires no technical knowledge; failed plugin shows a fixed recoverable message; safe mode explains that optional tools are paused and offers reset; system plugin has no uninstall button; toggles disable while pending and rollback visually on failure.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @workbench/web test -- src/features/plugins/PluginManager.test.tsx src/features/settings/SettingsPage.test.tsx
```

- [ ] **Step 3: Implement management UI**

Use Chinese product copy: `系统插件`, `已启用`, `已停用`, `启动失败`, `安全模式`, `重新尝试正常启动`. Never show stack traces, database fields, manifest JSON, or permission internals as error details. Display declared permissions as human-readable labels only.

- [ ] **Step 4: Run GREEN and accessibility regression**

```text
pnpm --filter @workbench/web test -- src/features/plugins/PluginManager.test.tsx src/features/settings/SettingsPage.test.tsx
pnpm --filter @workbench/web test
pnpm --filter @workbench/web check
```

- [ ] **Step 5: Commit checkpoint**

```text
git add apps/web/src/features/plugins apps/web/src/features/settings apps/web/src/lib/api.ts
git commit -m "feat: manage system plugins in settings"
```

### Task 8: Foundation-to-kernel final gate

**Files:**
- Modify: `README.md`
- Test: all workspace suites

- [ ] **Step 1: Add final integration assertions**

The real app integration test must cover: normal startup; all five plugins enabled; each plugin disabled/re-enabled; retained data/layout; one failed plugin while core and others load; safe mode; vault locked behavior; manual SMTP only; backup containing plugin state; no third-party installation UI yet.

- [ ] **Step 2: Run the complete local gate**

```text
pnpm install --frozen-lockfile --offline
pnpm test
pnpm check
pnpm build
git diff --check
```

Expected: all suites pass; only an explicitly documented platform-capability test may skip.

- [ ] **Step 3: Run production/reference security scans**

Confirm no plugin receives Express/SQLite/vault secret objects, no arbitrary manifest component import exists, no automatic reminder runner returns, and no PowerShell/VBScript dependency is introduced outside the one-time legacy Windows adapter.

- [ ] **Step 4: Update documentation**

README must explain system plugins, enable/disable behavior, safe mode, retained plugin data, core-vs-plugin ownership, same Windows/macOS commands, backup inclusion, and the fact that third-party folder installation arrives in Plan 3.

- [ ] **Step 5: Independent whole-plan review**

Generate a review package from the Task 1 base through Task 8 head. Require separate specification and security/quality reviewers. Fix every Critical and Important finding with a failing regression and re-review until both verdicts are PASS.

- [ ] **Step 6: Hosted and device gates**

Push the reviewed branch and confirm both `windows-latest` and `macos-latest` Actions jobs pass. On an available Mac, restore an exported Windows database, unlock with the same master password, verify profile/photo/appearance/reminders/history/plugin state, and run explicit DeepSeek/SMTP connection tests without exposing secrets.

- [ ] **Step 7: Commit documentation checkpoint**

```text
git add README.md
git commit -m "docs: document system plugin kernel"
```

## Execution handoff

After the foundation fix commit is pushed and hosted CI is green, execute with `superpowers:subagent-driven-development`: one fresh implementer per task, one independent task reviewer after each task, and a final whole-branch review after Task 8. Do not begin Plan 3 folder installation inside this plan.
