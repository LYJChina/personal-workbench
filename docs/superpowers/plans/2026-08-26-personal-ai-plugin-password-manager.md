# Personal AI, Plugin Surfaces, and Password Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task with review gates.

**Goal:** Add editable AI persona context, a first-class plugin center with draggable/resizable dashboard and AI-office cards, and a secure independent password-manager system plugin with local-first credential import.

**Architecture:** Keep the microkernel responsible for plugin lifecycle, permissions, database migrations, encrypted services, and surface layout persistence. Treat profile, AI chat, calendar, reminders, and password manager as system-plugin contributions. Store the password manager in a separate encrypted domain with a dedicated DEK and short-lived unlock session; never expose credential contents to third-party plugins or remote AI.

**Tech Stack:** TypeScript, Express, React, Zod contracts, SQLite/better-sqlite3, scrypt, AES-256-GCM, react-grid-layout, Vitest, GitHub Actions on Windows/macOS.

## Global Constraints

- Preserve all existing uncommitted user changes; never reset or clean the workspace.
- Do not store API keys, password-manager fields, raw import text, or model prompts containing credentials in logs, localStorage, sessionStorage, URLs, or plaintext SQLite columns.
- Remote AI import receives only fully redacted placeholders; raw credentials are never sent to OpenAI, Anthropic, DeepSeek, or another remote provider.
- The password manager has an independent password, independent DEK, independent unlock session, and default 10-minute idle lock.
- Personal profile is a required system plugin: movable and resizable, never uninstallable or disableable.
- Password-manager records, position, size, search, CRUD, and import behavior must be covered by tests before integration.
- Every task uses TDD: write a failing test, observe the failure, implement the smallest change, then rerun focused tests.

## Task 1: Freeze shared contracts and migration allocation

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/surfaces.ts`
- Create: `packages/contracts/src/password-manager.ts`
- Test: `packages/contracts/src/password-manager.test.ts`
- Test: `packages/contracts/src/surfaces.test.ts`
- Modify: `docs/superpowers/specs/2026-08-26-ai-persona-profile-context-design.md` only if contract names need clarification

**Interfaces:**
- `SurfaceId = "dashboard" | "ai-office"`
- `SurfaceLayoutItem = { itemId: string; surface: SurfaceId; x: number; y: number; w: number; h: number; enabled: boolean }`
- `PasswordManagerStatus = { configured: boolean; unlocked: boolean; idleTimeoutMinutes: number }`
- `PasswordManagerEntrySummary = { id: string; name: string; website: string; username: string; notes: string; customFields: Array<{ label: string; value: string }>; createdAt: string; updatedAt: string }`
- `PasswordManagerEntryDetail = PasswordManagerEntrySummary & { password: string }`
- `PasswordManagerEntryInput = { name: string; website?: string; username: string; password: string; notes?: string; customFields?: Array<{ label: string; value: string }> }`
- `PasswordManagerImportPreview = { items: PasswordManagerEntryInput[]; duplicates: string[]; warnings: string[]; source: "local" | "redacted-ai" }`

- [ ] Write strict Zod schemas and export inferred types.
- [ ] Add tests for unknown fields, field length limits, valid IDs, layout bounds, and import preview shape.
- [ ] Run `pnpm --filter @workbench/contracts test` and `pnpm --filter @workbench/contracts check`; observe the new tests fail before implementation.
- [ ] Commit only contract files with `feat: define password manager and surface contracts`.

## Task 2: Editable surface grid and plugin center

**Files:**
- Create: `apps/web/src/features/layout/EditableSurfaceGrid.tsx`
- Create: `apps/web/src/features/layout/EditableSurfaceGrid.test.tsx`
- Create: `apps/web/src/features/plugins/PluginCenterPage.tsx`
- Create: `apps/web/src/features/plugins/PluginCenterPage.test.tsx`
- Modify: `apps/web/src/features/dashboard/EditableDashboard.tsx`
- Modify: `apps/web/src/features/ai-office/AiOfficePage.tsx`
- Modify: `apps/web/src/features/plugins/PluginManager.tsx`
- Test: `apps/web/src/features/dashboard/EditableDashboard.test.tsx`
- Test: `apps/web/src/features/ai-office/AiOfficePage.test.tsx`

**Interfaces:**
- `EditableSurfaceGrid({ surface, items, renderItem, editing, onLayoutChange })`
- `PluginCenterPage` consumes existing plugin list/toggle APIs and renders system/third-party sections.

- [ ] Write failing tests for dashboard and AI-office drag/resize persistence, new contribution defaults, disabled contribution restoration, and mobile non-destructive layout.
- [ ] Extract grid mechanics without changing the existing `DashboardLayout` persistence shape.
- [ ] Upgrade AI Office tools from fixed links to grid items with saved surface coordinates.
- [ ] Add plugin-center route and make plugin management visible above Settings in the sidebar; preserve Settings functionality until integration removes the duplicate panel.
- [ ] Run focused web tests and commit `feat: add plugin center and editable surfaces`.

## Task 3: Independent password-manager cryptography and persistence

**Files:**
- Create: `apps/server/src/db/migrations/007_password_manager.sql`
- Create: `apps/server/src/modules/password-manager/password-manager.crypto.ts`
- Create: `apps/server/src/modules/password-manager/password-manager.repository.ts`
- Create: `apps/server/tests/password-manager-crypto.test.ts`
- Create: `apps/server/tests/password-manager-repository.test.ts`
- Modify: `apps/server/src/db/database.ts` only for migration registration

**Interfaces:**
- `PasswordManagerCrypto.createVault(password): Promise<WrappedCredentialDek>`
- `PasswordManagerCrypto.unlockVault(password, wrapper): Promise<Buffer>`
- `PasswordManagerRepository.createEntry(encryptedPayload, layout): EntryRow`
- `PasswordManagerRepository.listEntries(): EntryRow[]`
- `PasswordManagerRepository.updateEntry(id, encryptedPayload, version): EntryRow`
- `PasswordManagerRepository.deleteEntry(id): void`

- [ ] Write failing tests for independent KDF/DEK creation, wrong password, nonce/tag/AAD tampering, record swap rejection, and transaction rollback.
- [ ] Add migration tables for metadata, encrypted records, and layouts; do not store any credential field plaintext.
- [ ] Reuse only the existing cross-platform crypto primitives, with a separate key namespace and AAD bound to record ID and format version.
- [ ] Ensure database backup contains ciphertext only and migration is idempotent.
- [ ] Run focused server tests and commit `feat: add independent password manager storage`.

## Task 4: Password-manager unlock session and CRUD API

**Files:**
- Create: `apps/server/src/modules/password-manager/password-manager.service.ts`
- Create: `apps/server/src/modules/password-manager/password-manager.routes.ts`
- Create: `apps/server/tests/password-manager-api.test.ts`
- Modify: `apps/server/src/app.ts` only during final integration

**Interfaces:**
- `GET /api/password-manager/status`
- `POST /api/password-manager/setup`
- `POST /api/password-manager/unlock`
- `POST /api/password-manager/lock`
- `GET /api/password-manager/entries`
- `POST /api/password-manager/entries`
- `PUT /api/password-manager/entries/:id`
- `DELETE /api/password-manager/entries/:id`
- `POST /api/password-manager/entries/:id/reveal`
- `PUT /api/password-manager/layout`

- [ ] Write failing tests for independent lock state while the main vault is unlocked, fixed locked errors, rate-limited failures, idle timeout, CRUD, optimistic version conflicts, and cache-control/no-store.
- [ ] Implement in-memory DEK lifetime, random short-lived HttpOnly/SameSite session, explicit lock, service shutdown cleanup, and 10-minute idle timeout.
- [ ] Return password only from explicit reveal/copy endpoint; list responses never include it.
- [ ] Add strict CSRF/request provenance checks using existing conventions.
- [ ] Run focused API/security tests and commit `feat: add password manager service and API`.

## Task 5: Password-manager page, cards, and local-first import

**Files:**
- Create: `apps/web/src/features/password-manager/PasswordManagerPage.tsx`
- Create: `apps/web/src/features/password-manager/PasswordManagerPage.test.tsx`
- Create: `apps/web/src/features/password-manager/CredentialCard.tsx`
- Create: `apps/web/src/features/password-manager/CredentialEditorDialog.tsx`
- Create: `apps/web/src/features/password-manager/BulkImportDialog.tsx`
- Create: `apps/web/src/features/password-manager/importParser.ts`
- Create: `apps/web/src/features/password-manager/importParser.test.ts`
- Create: `apps/web/src/features/password-manager/passwordManagerApi.ts`
- Create: `apps/web/src/features/password-manager/password-manager.css`

**Interfaces:**
- `parseLocalImport(text): PasswordManagerImportPreview`
- `redactImportForAi(preview): { redactedText: string; placeholders: Map<string, string> }`
- `restoreRedactedAiResult(result, placeholders): PasswordManagerImportPreview`

- [ ] Write failing parser tests for CSV/TSV/JSON/tagged text, missing fields, duplicate detection, limits, and malformed input.
- [ ] Implement lock gate, search, cards, CRUD, password reveal state, per-field copy, delete confirmation, and in-memory cleanup on lock/unmount.
- [ ] Reuse the editable surface grid for card position/size while keeping credential UUIDs separate from dashboard module IDs.
- [ ] Implement local preview-first import; never save before explicit confirmation.
- [ ] Implement optional redacted-AI assistance only for structural ambiguity; assert request bodies contain placeholders and no raw credential values.
- [ ] Run focused web tests and commit `feat: add password manager cards and safe import`.

## Task 6: AI persona and system prompt integration

**Files:**
- Create/modify according to `docs/superpowers/specs/2026-08-26-ai-persona-profile-context-design.md`
- Test: `apps/server/tests/ai-persona.test.ts`
- Test: `apps/web/src/features/ai-chat/AiChatCard.test.tsx`
- Test: `apps/web/src/features/profile/ProfileCard.test.tsx`

- [ ] Add the persona migration and strict API contracts.
- [ ] Add editable profile portrait generation, assistant name/personality/custom prompt/final prompt settings, and fusion preview.
- [ ] Inject the final system prompt once per stateless provider request without storing it as a visible chat message.
- [ ] Synchronize saved profile name into the sidebar brand and display configured assistant name in the chat.
- [ ] Stabilize chat geometry and preserve the existing `新对话` clearing behavior.
- [ ] Run focused persona, chat, profile, and provider tests; commit `feat: add editable AI persona context`.

## Task 7: System-plugin manifests and final application assembly

**Files:**
- Modify: `apps/server/src/system-plugins/manifests.ts`
- Modify: `apps/web/src/plugins/systemComponentRegistry.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/Sidebar.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/modules/preferences/preferences.repository.ts`
- Create: `apps/server/tests/password-manager-plugin.test.ts`
- Test: `apps/web/src/plugins/contributions.test.tsx`

- [ ] Add required `lyj.system.profile` and stoppable `lyj.system.password-manager` manifests with navigation, route, and dashboard contributions.
- [ ] Register password-manager component tokens and guarded routes.
- [ ] Put 插件中心 above 设置 and remove the old disabled vault placeholder without deleting data.
- [ ] Ensure disabling the password-manager plugin hides all contributions but retains encrypted records and layout.
- [ ] Ensure third-party manifests cannot request credential permissions.
- [ ] Run plugin lifecycle, contribution, preferences, and password-manager integration tests; commit `feat: assemble password manager and plugin surfaces`.

## Task 8: Integration verification and platform gates

**Files:**
- Modify: `.github/workflows/cross-platform.yml` only if required by new test commands
- Create: `apps/server/tests/password-manager-cross-boundary.test.ts`
- Create: `docs/superpowers/plans/2026-08-26-personal-ai-plugin-password-manager-verification.md` only for recorded manual evidence

- [ ] Test migration from the current database schema without losing existing profile, AI, vault, plugin, or layout state.
- [ ] Assert known credential plaintext is absent from raw SQLite, logs, API errors, backups, DOM before unlock, and local browser storage.
- [ ] Verify Windows and macOS workflows, `pnpm dev`, `pnpm build`, and `pnpm local:start`.
- [ ] Run `pnpm test`, `pnpm check`, `pnpm build`, and `git diff --check`.
- [ ] Perform manual UI checks for independent unlock, reveal/copy, drag/resize, safe import preview, AI prompt injection, and `新对话` clearing.
- [ ] Commit only after all gates are green with `chore: verify personal AI plugin and password manager features`.
