# Architecture and Maintainability Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the repository's main modification hotspots while preserving every public contract, persisted value, HTTP behavior, and user-visible workflow, and establish a reliable multi-agent coordination surface.

**Architecture:** Keep the current root exports and `createApp(options)`/`api` compatibility entry points, but move ownership into domain-focused contract, browser-client, server-composition, and preference modules. Complete shared guardrails and contracts serially, execute the three non-overlapping extractions in parallel, then perform one integration review.

**Tech Stack:** TypeScript 5.7, Node.js 22, pnpm 11.19.0, Zod 3, React 19, Express 5, better-sqlite3, Vitest 3, Supertest.

**Spec:** `docs/superpowers/specs/2026-09-04-architecture-maintainability-design.md`

## Global Constraints

- Preserve all HTTP methods, paths, status codes, error codes, and response bodies.
- Preserve SQLite schemas, migration versions, transaction semantics, data locations, and repository connection lifetimes.
- Preserve UI layout, copy, workflows, plugin behavior, request cancellation, and plugin-startup waiting.
- Preserve encryption, vault recovery, legacy DPAPI, backup, and secret-handling behavior.
- Keep `@workbench/contracts`, `apps/web/src/lib/api.ts`, and `createApp(options)` as compatibility entry points.
- Do not add a generic repository abstraction, a network boundary, a persistence boundary, or a serialization format.
- Do not delete, move, read, or rewrite existing local user-data files.
- Use Node.js 22 and pnpm 11.19.0, as pinned by the repository.
- New behavior guardrails must assert observable exports, request behavior, composition results, or database outcomes rather than source text.
- Before every production change, run its new regression test and observe the expected failure; after the change, rerun it and observe a pass.
- A task may enter `DONE` only after diff review and recorded fresh verification evidence.

## File Structure

### Coordination and guardrails

- `.gitignore`: ignore local OS, package-store, and SQLite runtime artifacts.
- `CHANGELOG.md`: Keep a Changelog-compatible user/contributor history with an `Unreleased` section.
- `docs/TODO.md`: authoritative task ownership, dependency, status, and verification ledger.
- `packages/contracts/src/public-api.test.ts`: executable guardrail for the root runtime export surface.

### Shared contracts

- `packages/contracts/src/http.ts`: mutation header constants plus health and API error schemas/types.
- `packages/contracts/src/vault.ts`: vault status, setup, unlock, enrollment, recovery, and password-change schemas/types.
- `packages/contracts/src/profile.ts`: profile and custom-field schemas/types.
- `packages/contracts/src/preferences.ts`: dashboard, navigation, theme, appearance, and AI Office preference schemas/types.
- `packages/contracts/src/settings.ts`: legacy DeepSeek settings, mail settings, and connection-test schemas/types.
- `packages/contracts/src/ai-connections.ts`: AI provider and connection CRUD schemas/types.
- `packages/contracts/src/ai-features.ts`: daily-report, AI-polish, system-prompt, and chat schemas/types.
- `packages/contracts/src/reminders.ts`: legacy outbound and generic reminder schemas/types.
- `packages/contracts/src/calendar.ts`: holiday schemas/types.
- `packages/contracts/src/index.ts`: compatibility-only re-export barrel.

### Browser API

- `apps/web/src/lib/api/transport.ts`: request JSON/void helpers, mutation-header merge, error parsing, and backup download transport.
- `apps/web/src/lib/api/core.ts`: health, profile, preferences, settings, backup, and vault methods.
- `apps/web/src/lib/api/ai.ts`: AI connection, chat, polish, persona, and daily-report methods.
- `apps/web/src/lib/api/plugins.ts`: plugin and contribution methods.
- `apps/web/src/lib/api/reminders.ts`: reminder and calendar methods.
- `apps/web/src/lib/api.ts`: compatibility composition of the domain method objects.
- `apps/web/src/lib/api.test.ts`: unchanged behavior suite plus a composition identity test.

### Server composition

- `apps/server/src/app/dependencies.ts`: construct paths, repositories, vault, AI gateway, plugin lifecycle, and injectable services.
- `apps/server/src/app/core-routes.ts`: register health, vault, backup, profile, preference, settings, AI-connection, and plugin-management routes.
- `apps/server/src/app/plugin-routes.ts`: register every guarded system-plugin route with unchanged ownership.
- `apps/server/src/app/final-handlers.ts`: API fallback, static SPA serving, terminal fallback, and error middleware.
- `apps/server/src/app.ts`: define `CreateAppOptions`, call the composition helpers in current order, and return the Express app.
- `apps/server/tests/app-composition.test.ts`: observable middleware order, fallback, injection, and plugin-readiness guardrails.

### Preferences

- `apps/server/src/modules/preferences/preference-defaults.ts`: core layout/navigation constants.
- `apps/server/src/modules/preferences/preference-seeder.ts`: idempotent historical/default seeding transaction.
- `apps/server/src/modules/preferences/preference-contributions.ts`: installed/enabled contribution-ID resolution and AI Office filtering.
- `apps/server/src/modules/preferences/preferences.repository.ts`: public facade and SQL operations, delegating extracted responsibilities.
- `apps/server/tests/preferences.test.ts`: public repository and raw-row preservation tests.

---

### Task 1 (ARCH-001): Coordination Baseline and Repository Hygiene

**Dependencies:** None.

**Ownership:** `.gitignore`, `CHANGELOG.md`, `docs/TODO.md`, `packages/contracts/src/public-api.test.ts`. Do not edit extraction files owned by later tasks.

**Files:**
- Modify: `.gitignore`
- Create: `CHANGELOG.md`
- Create: `docs/TODO.md`
- Create: `packages/contracts/src/public-api.test.ts`

**Interfaces:**
- Consumes: current runtime exports from `@workbench/contracts` and the task graph in the approved spec.
- Produces: task records `ARCH-001` through `ARCH-006`; executable root export inventory; ignore rules consumed by every later task.

- [ ] **Step 1: Record the task claim**

Create `docs/TODO.md` with this exact structure and set ARCH-001's agent name before editing other owned files:

```markdown
# Global Work Queue

This file is the authoritative coordination surface for multi-agent work. Claim a `READY` task by recording one responsible agent and changing it to `IN_PROGRESS` before editing. Only a reviewer may move `REVIEW` to `DONE`.

| ID | Priority | Status | Depends on | Responsible agent | Primary ownership |
|---|---|---|---|---|---|
| ARCH-001 | P0 | IN_PROGRESS | — | `root-coordinator` | `.gitignore`, `CHANGELOG.md`, `docs/TODO.md`, `packages/contracts/src/public-api.test.ts` |
| ARCH-002 | P0 | BLOCKED | ARCH-001 | — | `packages/contracts/src/**` except existing plugin/surface/password-manager/AI-persona modules |
| ARCH-003 | P1 | BLOCKED | ARCH-002 | `—` | `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/**`, `apps/web/src/lib/api.test.ts` |
| ARCH-004 | P1 | BLOCKED | ARCH-002 | `—` | `apps/server/src/app.ts`, `apps/server/src/app/**`, `apps/server/tests/app-composition.test.ts` |
| ARCH-005 | P1 | BLOCKED | ARCH-002 | `—` | `apps/server/src/modules/preferences/**`, `apps/server/tests/preferences.test.ts` |
| ARCH-006 | P0 | BLOCKED | ARCH-003, ARCH-004, ARCH-005 | `—` | integration fixes, `README.md`, `CHANGELOG.md`, `docs/TODO.md` |

## Task records

### ARCH-001 — Coordination baseline and repository hygiene
- Goal: protect local artifacts and establish executable/export and collaboration guardrails.
- Non-goals: deleting local files; restructuring application modules.
- Acceptance: `pnpm --filter @workbench/contracts test`; `git check-ignore` checks listed in the implementation plan.
- Evidence: pending.
- Risks/blockers: none.

### ARCH-002 — Shared-contract domain extraction
- Goal: move contract ownership into domain modules while preserving the root export surface.
- Non-goals: changing schemas, types, validation, or application imports.
- Acceptance: `pnpm --filter @workbench/contracts check && pnpm --filter @workbench/contracts test`.
- Evidence: pending.
- Risks/blockers: blocked until ARCH-001 is `DONE`.

### ARCH-003 — Browser API domain extraction
- Goal: isolate transport and domain endpoint clients while preserving the `api` object.
- Non-goals: changing call sites, endpoints, headers, abort behavior, or errors.
- Acceptance: `pnpm --filter @workbench/web check && pnpm --filter @workbench/web test -- src/lib/api.test.ts`.
- Evidence: pending.
- Risks/blockers: blocked until ARCH-002 is `DONE`.

### ARCH-004 — Server composition extraction
- Goal: separate dependency construction, route groups, and final handlers while preserving `createApp(options)`.
- Non-goals: changing middleware order, HTTP behavior, initialization order, or injected dependencies.
- Acceptance: `pnpm --filter @workbench/server check && pnpm --filter @workbench/server test -- tests/app-composition.test.ts tests/health.test.ts tests/plugin-api.test.ts tests/security-boundaries.test.ts`.
- Evidence: pending.
- Risks/blockers: blocked until ARCH-002 is `DONE`.

### ARCH-005 — Preference responsibility extraction
- Goal: isolate defaults, seeding, and contribution lookup while preserving SQL and public repository behavior.
- Non-goals: changing schema, seed outputs, transactions, validation, or connection lifetime.
- Acceptance: `pnpm --filter @workbench/server check && pnpm --filter @workbench/server test -- tests/preferences.test.ts`.
- Evidence: pending.
- Risks/blockers: blocked until ARCH-002 is `DONE`.

### ARCH-006 — Integration verification and documentation
- Goal: review the combined result, run the full pipeline, and record completed changes.
- Non-goals: introducing new refactors or product behavior.
- Acceptance: `pnpm check && pnpm test && pnpm build`.
- Evidence: pending.
- Risks/blockers: blocked until ARCH-003, ARCH-004, and ARCH-005 are `DONE`.
```

- [ ] **Step 2: Add a failing public-export guardrail**

Create `packages/contracts/src/public-api.test.ts`. The break it catches is accidentally dropping a runtime schema or constant from the root package during domain extraction.

```ts
import { describe, expect, it } from "vitest";
import * as contracts from "./index";

const expectedRuntimeExports = [
  "WORKBENCH_MUTATION_HEADER_NAME",
  "WORKBENCH_MUTATION_HEADER_VALUE",
  "ApiErrorSchema",
  "HealthResponseSchema",
  "VaultStatusSchema",
  "ProfileSchema",
  "DashboardLayoutSchema",
  "AppearanceSettingsSchema",
  "AiConnectionSchema",
  "MailSettingsSchema",
  "DailyReportSchema",
  "AiPolishRecordSchema",
  "AiChatMessageSchema",
  "GenericReminderSchema",
  "HolidayDaySchema",
  "PluginManifestSchema",
  "PasswordManagerEntryDetailSchema",
  "AiPersonaSettingsSchema"
] as const;

describe("root contract compatibility", () => {
  it("exports representative runtime contracts from every domain", () => {
    for (const name of expectedRuntimeExports) {
      expect(contracts, `missing root export ${name}`).toHaveProperty(name);
    }
  });
});
```

- [ ] **Step 3: Run the new guardrail and record its baseline**

Run: `pnpm --filter @workbench/contracts test -- src/public-api.test.ts`

Expected: PASS because this is a characterization test of the current compatibility surface. Record the pass in ARCH-001 evidence. This is the explicit TDD exception for a test-only guardrail; no production code exists yet to make it fail.

- [ ] **Step 4: Demonstrate the missing ignore behavior**

Run:

```bash
git check-ignore -q .DS_Store
git check-ignore -q .pnpm-store/store.json
git check-ignore -q apps/server/LYJWorkBench/workbench.sqlite
git check-ignore -q apps/server/LYJWorkBench/workbench.sqlite-wal
```

Expected before editing `.gitignore`: each command exits 1, proving the local-artifact protection is missing.

- [ ] **Step 5: Add precise ignore rules**

Append these rules to `.gitignore`:

```gitignore
.DS_Store
.pnpm-store/
*.sqlite
*.sqlite-wal
*.sqlite-shm
```

Do not delete or move any matching local file.

- [ ] **Step 6: Verify the ignore rules**

Run the four `git check-ignore -q` commands from Step 4 again.

Expected: each exits 0. Run `git status --short` and confirm the existing database, `.pnpm-store/`, and `.DS_Store` no longer appear, without deleting them.

- [ ] **Step 7: Create the initial change log**

Create `CHANGELOG.md`:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses an `Unreleased` section until release versioning is introduced.

## [Unreleased]

### Security

- Prevent local SQLite databases, SQLite sidecars, pnpm stores, and operating-system metadata from being staged by default.
```

- [ ] **Step 8: Verify and submit ARCH-001 for review**

Run: `pnpm --filter @workbench/contracts check && pnpm --filter @workbench/contracts test`

Expected: type check exits 0 and all contract tests pass. Update ARCH-001 evidence with the command, exit code, and test count; change its status to `REVIEW`. Commit:

```bash
git add .gitignore CHANGELOG.md docs/TODO.md packages/contracts/src/public-api.test.ts
git commit -m "chore: establish architecture refactor guardrails"
```

After review, mark ARCH-001 `DONE` and ARCH-002 `READY` in `docs/TODO.md` in the next task's claim commit.

### Task 2 (ARCH-002): Split Shared Contracts by Domain

**Dependencies:** ARCH-001 is `DONE`.

**Ownership:** `packages/contracts/src/index.ts`, the nine new domain files, and relevant contract tests. The coordinator alone updates `docs/TODO.md`. Do not modify existing `plugins.ts`, `surfaces.ts`, `password-manager.ts`, or `ai-persona.ts` except through the root barrel.

**Files:**
- Create: `packages/contracts/src/http.ts`
- Create: `packages/contracts/src/vault.ts`
- Create: `packages/contracts/src/profile.ts`
- Create: `packages/contracts/src/preferences.ts`
- Create: `packages/contracts/src/settings.ts`
- Create: `packages/contracts/src/ai-connections.ts`
- Create: `packages/contracts/src/ai-features.ts`
- Create: `packages/contracts/src/reminders.ts`
- Create: `packages/contracts/src/calendar.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/public-api.test.ts`

**Interfaces:**
- Consumes: every runtime and type export currently defined by `packages/contracts/src/index.ts`.
- Produces: domain modules with the same symbol names; root `index.ts` re-exporting `./http`, `./vault`, `./profile`, `./preferences`, `./settings`, `./ai-connections`, `./ai-features`, `./reminders`, `./calendar`, `./plugins`, `./surfaces`, `./password-manager`, and `./ai-persona`.

- [ ] **Step 1: Claim ARCH-002 through the coordinator and strengthen the export guardrail**

Before the worker edits files, the coordinator sets ARCH-001 to `DONE`, records the worker identity on ARCH-002, and sets ARCH-002 to `IN_PROGRESS`. The worker then expands `expectedRuntimeExports` so it contains every `export const` name reported by:

```bash
rg '^export const ' packages/contracts/src/index.ts
```

Write each name as a literal string in the array; do not generate expectations from the module under test. This catches the realistic regression of dropping any runtime root export.

- [ ] **Step 2: Run the strengthened guardrail**

Run: `pnpm --filter @workbench/contracts test -- src/public-api.test.ts`

Expected: PASS against the current monolithic root. Save the output as the pre-refactor characterization baseline.

- [ ] **Step 3: Prove the domain entry points do not exist**

Temporarily add these static imports to `public-api.test.ts`:

```ts
import { HealthResponseSchema } from "./http";
import { VaultStatusSchema } from "./vault";
import { ProfileSchema } from "./profile";
import { DashboardLayoutSchema } from "./preferences";
import { MailSettingsSchema } from "./settings";
import { AiConnectionSchema } from "./ai-connections";
import { AiChatMessageSchema } from "./ai-features";
import { GenericReminderSchema } from "./reminders";
import { HolidayDaySchema } from "./calendar";

void [HealthResponseSchema, VaultStatusSchema, ProfileSchema, DashboardLayoutSchema,
  MailSettingsSchema, AiConnectionSchema, AiChatMessageSchema, GenericReminderSchema,
  HolidayDaySchema];
```

Run: `pnpm --filter @workbench/contracts check`

Expected: FAIL with module-not-found errors for the new domain paths.

- [ ] **Step 4: Move contracts into exact domain ownership**

Move declarations without changing their code:

- `http.ts`: mutation-header constants, `ApiErrorSchema`, `HealthResponseSchema`, and inferred types.
- `vault.ts`: `MasterPasswordSchema` and every symbol prefixed `Vault` or `SmtpHealth`.
- `profile.ts`: `CustomFieldSchema`, `ProfileSchema`, `ProfileUpdateSchema`, and inferred types.
- `preferences.ts`: symbols prefixed `Preference`, `Module`, `Dashboard`, `Navigation`, `Theme`, `Appearance`, or `AiOffice`.
- `settings.ts`: symbols prefixed `DeepSeek`, `Mail`, `Settings`, or `ConnectionTest`.
- `ai-connections.ts`: symbols prefixed `AiProvider` or `AiConnection`.
- `ai-features.ts`: symbols prefixed `DailyReport`, `AiPolish`, `AiSystemPrompt`, or `AiChat`.
- `reminders.ts`: symbols prefixed `Reminder` or `GenericReminder`.
- `calendar.ts`: symbols prefixed `Holiday`.

Each domain module imports `z` directly. If one domain uses a schema owned by another domain, import from the relative domain file, never from `./index`. Keep schema bodies, `.strict()` calls, refinements, limits, enum values, and inferred type names byte-for-byte equivalent.

Replace the root implementation with explicit barrels:

```ts
export * from "./http";
export * from "./vault";
export * from "./profile";
export * from "./preferences";
export * from "./settings";
export * from "./ai-connections";
export * from "./ai-features";
export * from "./reminders";
export * from "./calendar";
export * from "./plugins";
export * from "./surfaces";
export * from "./password-manager";
export * from "./ai-persona";
```

- [ ] **Step 5: Verify domain imports and the complete compatibility surface**

Run:

```bash
pnpm --filter @workbench/contracts check
pnpm --filter @workbench/contracts test
pnpm check
```

Expected: all commands exit 0; every contract test passes; application workspaces compile through the unchanged root import path.

- [ ] **Step 6: Submit ARCH-002 for review**

Send ARCH-002 evidence to the coordinator, which records it and sets the task to `REVIEW`. Commit only the worker-owned contract files:

```bash
git add packages/contracts/src
git commit -m "refactor: split shared contracts by domain"
```

After review, mark ARCH-002 `DONE` and ARCH-003, ARCH-004, and ARCH-005 `READY`. Commit that shared status transition before parallel agents claim work:

```bash
git add docs/TODO.md
git commit -m "chore: open parallel architecture tasks"
```

### Task 3 (ARCH-003): Split the Browser API by Domain

**Dependencies:** ARCH-002 is `DONE`.

**Ownership:** `apps/web/src/lib/api.ts`, `apps/web/src/lib/api/**`, and `apps/web/src/lib/api.test.ts`. The coordinator alone updates `docs/TODO.md`.

**Files:**
- Create: `apps/web/src/lib/api/transport.ts`
- Create: `apps/web/src/lib/api/core.ts`
- Create: `apps/web/src/lib/api/ai.ts`
- Create: `apps/web/src/lib/api/plugins.ts`
- Create: `apps/web/src/lib/api/reminders.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/api.test.ts`

**Interfaces:**
- Consumes: contract types from `@workbench/contracts`; browser `fetch`; existing endpoint paths and options.
- Produces: `requestJson<T>(path: string, options?: RequestInit): Promise<T>`, `requestVoid(path: string, options?: RequestInit): Promise<void>`, `exportDatabase(): Promise<string>`, domain method objects, and the existing `api` object with unchanged member signatures.

- [ ] **Step 1: Claim ARCH-003 through the coordinator and add a failing composition test**

Before the worker edits files, the coordinator records its identity and sets ARCH-003 to `IN_PROGRESS`. In `api.test.ts`, the worker adds:

```ts
import { aiApi } from "./api/ai";
import { coreApi } from "./api/core";
import { pluginApi } from "./api/plugins";
import { reminderApi } from "./api/reminders";

it("composes every domain client into the compatibility API", () => {
  expect(api).toEqual({ ...coreApi, ...aiApi, ...pluginApi, ...reminderApi });
});
```

The break it catches is leaving a domain method out of the compatibility object after extraction.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @workbench/web test -- src/lib/api.test.ts`

Expected: FAIL with module-not-found errors for `./api/core`, `./api/ai`, `./api/plugins`, and `./api/reminders`.

- [ ] **Step 3: Extract transport without changing behavior**

Move the current low-level request, error, header, response, and backup-download functions into `api/transport.ts`. Export exactly:

```ts
export async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T>;
export async function requestVoid(path: string, options: RequestInit = {}): Promise<void>;
export async function exportDatabase(): Promise<string>;
```

Preserve mutation-header injection for every non-GET/HEAD request, caller headers, `AbortSignal`, response parsing, sanitized backup filenames, DOM cleanup, and `URL.revokeObjectURL` in failure and success paths.

- [ ] **Step 4: Extract domain method objects**

Move existing methods unchanged:

- `coreApi`: health, profile, layout/navigation/theme/appearance/AI Office preferences, legacy settings, vault setup/unlock/recovery/enrollment/password change, and backup export.
- `aiApi`: AI connections, daily reports, AI polish and prompt management, AI chat, and AI persona.
- `pluginApi`: plugin summaries, contributions, enablement, and safe-mode reset.
- `reminderApi`: legacy outbound reminder, generic reminders and attempts, test sends, upcoming reminders, and calendar read/sync.

Each file imports only the contract types it needs and the transport helpers it calls. Define the four objects as `export const coreApi = { ... }`, `export const aiApi = { ... }`, `export const pluginApi = { ... }`, and `export const reminderApi = { ... }`; retain the exact method parameter and return types already inferred by the current implementation.

- [ ] **Step 5: Restore the compatibility entry point**

Replace `api.ts` with:

```ts
import { aiApi } from "./api/ai";
import { coreApi } from "./api/core";
import { pluginApi } from "./api/plugins";
import { reminderApi } from "./api/reminders";

export const api = {
  ...coreApi,
  ...aiApi,
  ...pluginApi,
  ...reminderApi
};
```

Do not migrate feature call sites in this task.

- [ ] **Step 6: Verify GREEN and regression behavior**

Run:

```bash
pnpm --filter @workbench/web test -- src/lib/api.test.ts
pnpm --filter @workbench/web check
pnpm --filter @workbench/web test
```

Expected: composition test and all existing API behavior tests pass, type check exits 0, and the complete web test suite passes.

- [ ] **Step 7: Submit ARCH-003 for review**

Send fresh evidence to the coordinator, which records it and sets ARCH-003 to `REVIEW`. Commit only worker-owned files:

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api apps/web/src/lib/api.test.ts
git commit -m "refactor: split browser API by domain"
```

### Task 4 (ARCH-004): Extract Server Composition

**Dependencies:** ARCH-002 is `DONE`.

**Ownership:** `apps/server/src/app.ts`, `apps/server/src/app/**`, and `apps/server/tests/app-composition.test.ts`. The coordinator alone updates `docs/TODO.md`.

**Files:**
- Create: `apps/server/src/app/dependencies.ts`
- Create: `apps/server/src/app/core-routes.ts`
- Create: `apps/server/src/app/plugin-routes.ts`
- Create: `apps/server/src/app/final-handlers.ts`
- Create: `apps/server/tests/app-composition.test.ts`
- Modify: `apps/server/src/app.ts`

**Interfaces:**
- Consumes: `CreateAppOptions`, Express `Express`, existing repository/router constructors, and plugin lifecycle/guard APIs.
- Produces: `createAppDependencies(options: CreateAppOptions): AppDependencies`, `registerCoreRoutes(app: Express, dependencies: AppDependencies): void`, `registerPluginRoutes(app: Express, dependencies: AppDependencies): void`, `registerFinalHandlers(app: Express, dependencies: Pick<AppDependencies, "options">): void`; unchanged `createApp(options?: CreateAppOptions): Express`.

- [ ] **Step 1: Claim ARCH-004 through the coordinator and add an observable fallback-order test**

Before the worker edits files, the coordinator records its identity and sets ARCH-004 to `IN_PROGRESS`. The worker creates `apps/server/tests/app-composition.test.ts`:

```ts
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app";

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("application composition", () => {
  it("keeps API fallback ahead of SPA fallback", async () => {
    const root = await mkdtemp(join(tmpdir(), "workbench-composition-"));
    roots.push(root);
    const web = join(root, "web");
    await mkdir(web);
    await writeFile(join(web, "index.html"), "<main>workbench shell</main>");
    const app = createApp({ dataDir: join(root, "data"), webDistDir: web });

    await request(app).get("/api/missing").expect(404, {
      error: { message: "Not Found", code: "NOT_FOUND" }
    });
    const spa = await request(app).get("/client-route").expect(200);
    expect(spa.text).toContain("workbench shell");
    await request(app).post("/client-route").expect(404, {
      error: { message: "Not Found", code: "NOT_FOUND" }
    });
  });
});
```

The break it catches is registering static SPA fallback before the API/terminal fallbacks or serving the SPA for mutation requests.

- [ ] **Step 2: Verify the characterization test and establish a mutation RED**

Run: `pnpm --filter @workbench/server test -- tests/app-composition.test.ts`

Expected: PASS against current composition. Then temporarily move the `/api` fallback below static serving in a working diff, rerun the test, and confirm it FAILS because `/api/missing` returns HTML. Revert only that temporary mutation before extraction. This proves the regression test catches the intended break.

- [ ] **Step 3: Extract dependency construction**

Move path resolution, database initialization/reconciliation, plugin lifecycle, guard factory, vault/enrollment/import resolution, secret store, AI gateway/connections, and password-manager construction into `createAppDependencies`.

Define `AppDependencies` with named fields for every value used by route registration, including `options`, `paths`, `pluginLifecycle`, `contributionRegistry`, `pluginStartup`, `pluginGuard`, `vault`, `vaultEnrollment`, `resolveLegacySecretImporter`, `secretStore`, `aiConnectionRepository`, `kernelAiGateway`, `aiGateway`, `aiConnectionTester`, and `passwordManager`. Do not broaden fields to `any`; infer or import concrete existing types.

Keep the preference default initialization and compiled-plugin reconciliation `try/finally` block unchanged and before operational repository creation. Keep closures that open/close operational databases unchanged.

- [ ] **Step 4: Extract core and plugin route registration**

`registerCoreRoutes` installs, in current order: password-manager no-store, local request boundary, JSON parsing, health, vault, backup, profile, preferences, AI connections, plugin management, and settings.

`registerPluginRoutes` installs, in current order: daily reports, AI polish, AI chat messages, AI persona, reminders, workday calendar, and password manager. Copy each exact plugin ID and route-ownership array. Keep each existing router dependency and option fallback unchanged.

- [ ] **Step 5: Extract final handlers and reduce `createApp` to orchestration**

`registerFinalHandlers` installs the `/api` 404, optional static directory, GET/HEAD SPA fallback, terminal 404, and error middleware in that exact order. Preserve the photo limit, vault lock, vault integrity, aborted/destroyed response, log sanitization, and internal-error branches.

The final `createApp` body is:

```ts
export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const dependencies = createAppDependencies(options);
  registerCoreRoutes(app, dependencies);
  registerPluginRoutes(app, dependencies);
  registerFinalHandlers(app, dependencies);
  return app;
}
```

Keep `CreateAppOptions` exported from `app.ts`; use `import type` from `app.ts` inside helpers so runtime cycles are not introduced.

- [ ] **Step 6: Verify GREEN and all high-risk composition boundaries**

Run:

```bash
pnpm --filter @workbench/server test -- tests/app-composition.test.ts tests/health.test.ts tests/plugin-api.test.ts tests/security-boundaries.test.ts tests/vault-api.test.ts tests/settings.test.ts
pnpm --filter @workbench/server check
pnpm --filter @workbench/server test
```

Expected: all selected tests and the full server suite pass; type check exits 0; skipped Windows integration count does not increase.

- [ ] **Step 7: Submit ARCH-004 for review**

Send evidence to the coordinator, which records it and sets ARCH-004 to `REVIEW`. Commit only worker-owned files:

```bash
git add apps/server/src/app.ts apps/server/src/app apps/server/tests/app-composition.test.ts
git commit -m "refactor: extract server composition modules"
```

### Task 5 (ARCH-005): Extract Preference Responsibilities

**Dependencies:** ARCH-002 is `DONE`.

**Ownership:** `apps/server/src/modules/preferences/**` and `apps/server/tests/preferences.test.ts`. The coordinator alone updates `docs/TODO.md`.

**Files:**
- Create: `apps/server/src/modules/preferences/preference-defaults.ts`
- Create: `apps/server/src/modules/preferences/preference-seeder.ts`
- Create: `apps/server/src/modules/preferences/preference-contributions.ts`
- Modify: `apps/server/src/modules/preferences/preferences.repository.ts`
- Modify: `apps/server/tests/preferences.test.ts`

**Interfaces:**
- Consumes: `Database.Database`, current contract schemas/types, and `PluginManifestSchema`.
- Produces: `defaultLayout`, `defaultNavigation`, `seedPreferences(database: Database.Database): void`, and `PreferenceContributionCatalog` with `installedIds()` and `enabledPluginIds()`; unchanged public `PreferencesRepository` methods.

- [ ] **Step 1: Claim ARCH-005 through the coordinator and add a direct idempotency regression test**

Before the worker edits files, the coordinator records its identity and sets ARCH-005 to `IN_PROGRESS`. The worker adds to `preferences.test.ts`:

```ts
it("keeps seeded raw rows byte-for-byte stable across repeated default initialization", () => {
  const paths = resolveAppPaths({ dataDir: tempDir });
  const database = openDatabase(paths);
  const repository = new PreferencesRepository(database);
  repository.initializeDefaults();
  database.prepare("UPDATE app_settings SET updated_at = '2000-01-01 00:00:00'").run();
  database.prepare("UPDATE dashboard_layouts SET updated_at = '2000-01-01 00:00:00'").run();
  database.prepare("UPDATE navigation_items SET updated_at = '2000-01-01 00:00:00'").run();
  const before = readRawPreferenceRows(tempDir);

  repository.initializeDefaults();

  expect(readRawPreferenceRows(tempDir)).toEqual(before);
  database.close();
});
```

The break it catches is an extracted seeder rewriting existing values or timestamps on repeated initialization.

- [ ] **Step 2: Verify the test protects the intended mutation**

Run: `pnpm --filter @workbench/server test -- tests/preferences.test.ts`

Expected: PASS on current code. Temporarily replace one `INSERT OR IGNORE` in `seed()` with `INSERT OR REPLACE`, rerun, and confirm the new test FAILS due to changed raw rows or timestamps. Revert the temporary mutation before extraction.

- [ ] **Step 3: Extract immutable defaults**

Move `coreDashboardIds`, `coreNavigation`, `defaultLayout`, and `defaultNavigation` to `preference-defaults.ts`. Export only the values used outside that file, retain `as const`/type annotations, labels, paths, positions, dimensions, visibility, disabled state, and ordering exactly.

- [ ] **Step 4: Extract seeding as one transaction**

Move the body of the current private `seed()` method to:

```ts
export function seedPreferences(database: Database.Database): void {
  const seed = database.transaction(() => {
    // existing seed statements and legacy-layout detection, unchanged
  });
  seed();
}
```

Import defaults from `preference-defaults.ts`. Preserve every setting key, SQL statement, legacy-layout predicate, insert mode, and transaction boundary. `PreferencesRepository.initializeDefaults()` delegates to `seedPreferences(this.database)`; its constructor remains side-effect free.

- [ ] **Step 5: Extract contribution lookup**

Create `PreferenceContributionCatalog` with constructor `constructor(private readonly database: Database.Database)`. Move installed manifest parsing and enabled-plugin queries behind:

```ts
public installedIds(): { dashboard: Set<string>; navigation: Set<string> };
public enabledPluginIds(): Set<string>;
```

Initialize each returned set with core IDs from `preference-defaults.ts`. Preserve malformed-manifest validation, plugin ID equality checking, ordering, and enabled filtering. Keep AI Office positional normalization in the repository, using `catalog.enabledPluginIds()`.

- [ ] **Step 6: Verify GREEN and persistence behavior**

Run:

```bash
pnpm --filter @workbench/server test -- tests/preferences.test.ts tests/plugin-database.test.ts tests/plugin-api.test.ts
pnpm --filter @workbench/server check
pnpm --filter @workbench/server test
```

Expected: the new idempotency test and all existing preference/plugin persistence tests pass; full server tests pass; type check exits 0.

- [ ] **Step 7: Submit ARCH-005 for review**

Send evidence to the coordinator, which records it and sets ARCH-005 to `REVIEW`. Commit only worker-owned files:

```bash
git add apps/server/src/modules/preferences apps/server/tests/preferences.test.ts
git commit -m "refactor: separate preference responsibilities"
```

### Task 6 (ARCH-006): Integration Review, Verification, and Documentation

**Dependencies:** ARCH-003, ARCH-004, and ARCH-005 have passed review.

**Ownership:** combined diff review, narrowly required integration fixes, `README.md`, `CHANGELOG.md`, and `docs/TODO.md`. No new architecture extraction is allowed.

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/TODO.md`
- Modify if contributor guidance is useful: `README.md`
- Modify only when integration verification exposes a regression: files already owned by ARCH-002 through ARCH-005

**Interfaces:**
- Consumes: reviewed outputs from ARCH-002 through ARCH-005.
- Produces: one verified branch state, final `Unreleased` entries, and completed evidence for ARCH-001 through ARCH-006.

- [ ] **Step 1: Claim integration and reconcile task states**

After reviewing each task's diff and evidence, set ARCH-003, ARCH-004, and ARCH-005 to `DONE`; set ARCH-006 to `IN_PROGRESS` with the integration agent. If any review fails, return only that task to `IN_PROGRESS` and leave ARCH-006 `BLOCKED`.

- [ ] **Step 2: Audit the combined diff against the spec**

Run:

```bash
git diff f01321c..HEAD --stat
git diff --check f01321c..HEAD
rg "from [\"']\./index[\"']" packages/contracts/src --glob '!index.ts' --glob '!*.test.ts'
git status --short
```

Expected: no whitespace errors; no domain module imports the contracts root; only intentional files are changed; local data files are absent from status because they are ignored, not deleted.

Review these invariants manually in the diff:

- the root contract barrel includes all old and new domain exports;
- `api` contains every original method exactly once;
- Express middleware and route registration order matches the pre-refactor `app.ts`;
- preference SQL, setting keys, validation, and transactions are unchanged;
- no secret value, local database, or generated artifact is staged.

- [ ] **Step 3: Run narrow cross-boundary verification**

Run:

```bash
pnpm --filter @workbench/contracts test
pnpm --filter @workbench/web test -- src/lib/api.test.ts src/app/App.integration.test.tsx
pnpm --filter @workbench/server test -- tests/app-composition.test.ts tests/preferences.test.ts tests/plugin-api.test.ts tests/security-boundaries.test.ts
```

Expected: every selected test passes and the existing platform-dependent skips do not increase.

- [ ] **Step 4: Run the full fresh verification gate**

Run exactly:

```bash
pnpm check && pnpm test && pnpm build
```

Expected: all type checks exit 0; at least the baseline 620 tests pass; no more than the baseline 12 platform-dependent tests are skipped; both server and web production builds exit 0.

If a command fails, record the exact command and failure under ARCH-006, return the owning task to `IN_PROGRESS`, fix through a new red-green cycle, and rerun the complete gate from the beginning.

- [ ] **Step 5: Finalize contributor-facing documentation**

Under `CHANGELOG.md` → `Unreleased`, retain the Security entry and add:

```markdown
### Changed

- Split shared contracts, browser API clients, server composition, and preference persistence into focused internal modules while preserving compatibility entry points.
- Added a global task ledger with dependency, ownership, review, and verification evidence for coordinated multi-agent development.
```

Add a short `Multi-agent development` section to `README.md` only if the task ledger is intended for ongoing contributor use:

```markdown
## Multi-agent development

Use `docs/TODO.md` as the authoritative task queue. Claim only a `READY` task, respect its file ownership and dependencies, and record fresh verification evidence before requesting review. Completed externally meaningful changes belong in `CHANGELOG.md`; plans and in-progress work do not.
```

- [ ] **Step 6: Close the task ledger and commit integration evidence**

Set ARCH-006 to `REVIEW` and record the full command, exit code, passed test count, skipped count, and build result. After independent diff review confirms every spec constraint, set ARCH-006 to `DONE`. Commit:

```bash
git add CHANGELOG.md docs/TODO.md README.md
git commit -m "docs: record maintainability refactor"
```

- [ ] **Step 7: Produce the completion report**

Report:

- commit IDs for ARCH-001 through ARCH-006;
- files added and compatibility entry points retained;
- exact `pnpm check`, `pnpm test`, and `pnpm build` outcomes;
- final passed and skipped test counts;
- Windows DPAPI integration not executed on macOS, with the existing Windows command from `README.md`;
- confirmation that local SQLite and package-store artifacts were ignored without being deleted.
