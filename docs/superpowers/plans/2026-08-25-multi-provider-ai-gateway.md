# Multi-provider AI Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the DeepSeek-only integration with a portable kernel AI gateway supporting OpenAI-compatible and Anthropic-native connections while preserving existing local data and secrets.

**Architecture:** Store connection metadata in normalized SQLite rows and API keys in the existing encrypted vault. AI features call one gateway, which selects an OpenAI or Anthropic adapter from the default connection and returns a provider-neutral result.

**Tech Stack:** TypeScript, Express, React, Zod, better-sqlite3, Vitest, Testing Library, Node.js fetch

## Global Constraints

- Production provider URLs require HTTPS; loopback HTTP is available only through the existing explicit test/development option.
- API keys never appear in API responses, logs, thrown messages, or plugin contribution data.
- Existing `deepseek.base_url`, `deepseek.model`, and `deepseek-api-key` data migrate without decryption or replacement.
- OpenAI-compatible and Anthropic-native protocols work identically on Windows and macOS.
- All three system AI features use the single default connection in this release.

---

### Task 1: Contracts and database migration

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/index.test.ts` or create focused tests beside the existing contract tests
- Create: `apps/server/src/db/migrations/005_ai_connections.sql`
- Modify: `apps/server/src/db/database.ts`
- Modify: `apps/server/tests/database.test.ts`

**Interfaces:**
- Produces: `AiProviderProtocol = "openai" | "anthropic"`
- Produces: `AiConnection`, `AiConnectionCreate`, and `AiConnectionUpdate` schemas and types
- Produces table: `ai_connections(id, name, protocol, base_url, model, secret_name, is_default, created_at, updated_at)`

- [ ] **Step 1: Write failing contract tests**

Assert that a valid OpenAI/Anthropic connection parses, response objects reject `apiKey` and `secretName`, IDs accept only stable lowercase identifiers, and update objects reject unknown keys.

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `pnpm --filter @workbench/contracts test`

Expected: FAIL because the AI connection schemas are not exported.

- [ ] **Step 3: Add the minimal Zod contracts**

Define strict schemas with `protocol`, `name`, `baseUrl`, `model`, `apiKeyConfigured`, and `isDefault`; create/update input schemas additionally accept optional `apiKey`.

- [ ] **Step 4: Write a failing legacy migration test**

Create a version-4 database containing `deepseek.base_url` and `deepseek.model`, upgrade it, and expect one `legacy-deepseek` OpenAI row whose `secret_name` is `deepseek-api-key` and `is_default` is `1`.

- [ ] **Step 5: Run the migration test and verify RED**

Run: `pnpm --filter @workbench/server test -- tests/database.test.ts`

Expected: FAIL because schema version 5 and `ai_connections` do not exist.

- [ ] **Step 6: Implement migration 5 and register it**

Create the table, a partial unique index for the default row, and insert `legacy-deepseek` using `COALESCE` queries over `app_settings` with the current DeepSeek defaults.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run: `pnpm --filter @workbench/contracts test && pnpm --filter @workbench/server test -- tests/database.test.ts`

Expected: all focused tests pass.

### Task 2: Connection repository and secure management API

**Files:**
- Create: `apps/server/src/modules/ai-gateway/ai-connection.repository.ts`
- Create: `apps/server/src/modules/ai-gateway/ai-connection.routes.ts`
- Modify: `apps/server/src/platform/secret-store.ts`
- Modify: `apps/server/src/modules/vault/vault.repository.ts`
- Modify: `apps/server/src/modules/vault/vault.service.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/server/tests/ai-connections.test.ts`

**Interfaces:**
- Produces: `AiConnectionRepository.list()`, `.get(id)`, `.getDefault()`, `.create(input)`, `.update(id, input)`, `.setDefault(id)`, `.delete(id)`
- Produces: `SecretStore.deleteSecret(name): Promise<void>`
- Produces API routes under `/api/settings/ai-connections`

- [ ] **Step 1: Write failing repository/API tests**

Cover list, create, update without replacing a key, update with a replacement key, atomic default switch, rejection of deleting the only connection, successful delete with key removal, duplicate/invalid IDs, and responses that contain neither `apiKey` nor `secretName`.

- [ ] **Step 2: Run the new test and verify RED**

Run: `pnpm --filter @workbench/server test -- tests/ai-connections.test.ts`

Expected: FAIL because routes and repository are missing.

- [ ] **Step 3: Add vault deletion support**

Implement `VaultRepository.deleteSecret(name)` with an exact parameterized delete and `VaultService.deleteSecret(name)` guarded by the unlocked key. Update existing in-memory test stores with a one-line map deletion method.

- [ ] **Step 4: Implement the repository transaction boundaries**

Use server-generated `randomUUID()` connection IDs, `ai-connection:<id>:api-key` secret names, parameterized SQL, and transactions for default switching and delete invariants.

- [ ] **Step 5: Implement strict management routes**

Validate all bodies with shared Zod schemas, validate URL shape before persistence, store keys only through `SecretStore`, and return fixed error codes for missing connection, invalid input, and final-connection deletion.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm --filter @workbench/server test -- tests/ai-connections.test.ts tests/vault.test.ts tests/settings.test.ts`

Expected: all focused tests pass.

### Task 3: Provider-neutral gateway and two adapters

**Files:**
- Create: `apps/server/src/modules/ai-gateway/ai-gateway.types.ts`
- Create: `apps/server/src/modules/ai-gateway/openai.adapter.ts`
- Create: `apps/server/src/modules/ai-gateway/anthropic.adapter.ts`
- Create: `apps/server/src/modules/ai-gateway/ai-gateway.ts`
- Create: `apps/server/tests/ai-gateway.test.ts`

**Interfaces:**
- Consumes: `AiConnectionRepository.getDefault()` and `SecretStore.readSecret()`
- Produces: `AiGateway.complete(input: { messages: AiGatewayMessage[]; temperature?: number; maxTokens?: number; signal?: AbortSignal }): Promise<{ content: string; model: string }>`
- Produces: normalized error categories `not_configured | auth | rate_limit | timeout | upstream`

- [ ] **Step 1: Write failing OpenAI adapter tests**

Assert `/chat/completions`, Bearer auth, exact message JSON, manual redirects, response parsing, and fixed auth/rate-limit/timeout/upstream errors.

- [ ] **Step 2: Run and verify OpenAI RED**

Run: `pnpm --filter @workbench/server test -- tests/ai-gateway.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the minimal OpenAI adapter and verify GREEN**

Use injected `fetch`, a 30-second abort controller, and never include response text in errors.

- [ ] **Step 4: Write failing Anthropic adapter tests**

Assert `/messages`, `x-api-key`, `anthropic-version`, system-message extraction, text-block parsing, and the same normalized errors.

- [ ] **Step 5: Implement the Anthropic adapter and verify GREEN**

Send only Anthropic-supported roles in `messages`, merge system messages into the top-level `system`, and require a non-empty text block and model.

- [ ] **Step 6: Write failing gateway selection tests**

Assert adapter selection by protocol, default-connection lookup at request time, secret lookup by stored name, and `not_configured` when no default/key exists.

- [ ] **Step 7: Implement the gateway and run focused tests**

Run: `pnpm --filter @workbench/server test -- tests/ai-gateway.test.ts`

Expected: all gateway tests pass.

### Task 4: Migrate system AI features to the gateway

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/modules/ai-chat/ai-chat.routes.ts`
- Modify: `apps/server/src/modules/ai-polish/ai-polish.routes.ts`
- Modify: `apps/server/src/modules/daily-reports/daily-report.routes.ts`
- Modify: `apps/server/tests/ai-chat.test.ts`
- Modify: `apps/server/tests/ai-polish.test.ts`
- Modify: `apps/server/tests/daily-report.test.ts`

**Interfaces:**
- Consumes: `AiGateway.complete(...)`
- Removes feature-level knowledge of DeepSeek settings and `deepseek-api-key`

- [ ] **Step 1: Change one feature test per module to require the gateway**

Inject a recording gateway and assert each feature sends the expected unified messages and stores the returned model.

- [ ] **Step 2: Run the three suites and verify RED**

Run: `pnpm --filter @workbench/server test -- tests/ai-chat.test.ts tests/ai-polish.test.ts tests/daily-report.test.ts`

Expected: FAIL because routes still read DeepSeek settings and clients directly.

- [ ] **Step 3: Migrate routes and app composition**

Construct one gateway in `createApp`, inject it into all three routers, map normalized errors to provider-neutral Chinese messages, and retain existing request cancellation behavior.

- [ ] **Step 4: Remove duplicated live clients after all consumers move**

Delete only adapter code made unreachable by the gateway; keep prompt builders and repositories unchanged.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter @workbench/server test -- tests/ai-chat.test.ts tests/ai-polish.test.ts tests/daily-report.test.ts tests/security-boundaries.test.ts`

Expected: all focused tests pass and no response contains supplier secrets.

### Task 5: Multi-connection settings interface and legacy compatibility

**Files:**
- Create: `apps/web/src/features/settings/AiConnectionsPanel.tsx`
- Create: `apps/web/src/features/settings/AiConnectionsPanel.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/lib/api.test.ts`
- Modify: `apps/server/src/modules/settings/settings.routes.ts`
- Modify: `apps/server/src/modules/settings/settings.repository.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: AI connection management endpoints
- Produces: Chinese “模型服务” panel with create, edit, test, default, and delete actions
- Preserves: legacy DeepSeek endpoints as adapters to `legacy-deepseek`

- [ ] **Step 1: Write failing API client and panel tests**

Assert rendering of both protocol labels, configured/default chips, adding Anthropic, editing without key replacement, testing one connection, setting default, guarded deletion, and fixed user-facing errors.

- [ ] **Step 2: Run web tests and verify RED**

Run: `pnpm --filter @workbench/web test -- src/lib/api.test.ts src/features/settings/AiConnectionsPanel.test.tsx src/features/settings/SettingsPage.test.tsx`

Expected: FAIL because the client methods and panel do not exist.

- [ ] **Step 3: Implement API client and focused panel**

Keep connection-local draft state inside `AiConnectionsPanel`; refresh authoritative data after every mutation; disable duplicate submissions; clear password fields after successful saves.

- [ ] **Step 4: Replace the DeepSeek form in SettingsPage**

Keep mail, plugin, backup, and appearance sections unchanged. Update page copy from “DeepSeek” to “模型服务”.

- [ ] **Step 5: Implement compatibility routes and documentation**

Map old DeepSeek GET/save/test behavior to `legacy-deepseek` without exposing the new secret name, and document both supported protocols and the migration behavior.

- [ ] **Step 6: Run focused web/server tests and verify GREEN**

Run: `pnpm --filter @workbench/web test -- src/lib/api.test.ts src/features/settings/AiConnectionsPanel.test.tsx src/features/settings/SettingsPage.test.tsx && pnpm --filter @workbench/server test -- tests/settings.test.ts tests/ai-connections.test.ts`

Expected: all focused tests pass.

### Task 6: Full verification

**Files:**
- Modify only files required by failures directly caused by Tasks 1-5

**Interfaces:**
- Verifies all preceding deliverables together

- [ ] **Step 1: Run the complete test suite**

Run: `pnpm test`

Expected: contracts, server, and web suites all pass.

- [ ] **Step 2: Run static checking**

Run: `pnpm check`

Expected: all TypeScript checks pass.

- [ ] **Step 3: Build production artifacts**

Run: `pnpm build`

Expected: server runtime output and Vite web bundle build successfully.

- [ ] **Step 4: Check repository hygiene**

Run: `git diff --check && git status --short --branch`

Expected: no whitespace errors and only intentional source, test, migration, and documentation changes.
