# AI 模型趋势总结 Implementation Plan

> **For agentic workers:** Implement the tasks in order in this plan. Keep the service, source adapters, scheduler, and UI boundaries described below.

**Goal:** Add a model digest tool that fetches Hugging Face and OpenRouter model trends, summarizes them through the configured AI gateway, displays results, supports immediate runs with optional email, and sends scheduled workday digests.

**Architecture:** Keep collection in explicit server-side source adapters and use the existing AI gateway and SMTP notification channel. Persist profile email addresses, digest settings, and run state in SQLite; expose a plugin route backed by a React page. Keep `createApp` side-effect-free by default and start/stop the scheduled worker explicitly from the server entry point.

**Tech Stack:** TypeScript, Express, React, Zod contracts, SQLite (`better-sqlite3`), existing AI gateway, existing SMTP (`nodemailer`), Node fetch.

## Global Constraints

- Use Hugging Face Hub API and OpenRouter model ranking data as the only initial sources.
- Schedule automatic updates on weekdays at 09:00 in `Asia/Shanghai`.
- Use the currently configured default AI connection; do not introduce Pi Agent, nanobot, or a web browser agent.
- Use the existing SMTP sender; scheduled recipients come from selected profile emails.
- Manual runs use the same pipeline and do not send email unless the user opts in and selects recipients.
- Do not add or run automated tests unless the user asks to test or verify the implementation.
- `createApp()` must remain free of background-worker startup side effects unless explicitly enabled by the production entry point.
- Do not place email addresses, SMTP passwords, or AI API keys in prompts, localStorage, or logs.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/contracts/src/profile-emails.ts` | Schemas/types for labeled profile email addresses. |
| `packages/contracts/src/model-digest.ts` | Schemas/types for settings, normalized source records, digest runs, and run status. |
| `apps/server/src/db/migrations/008_profile_emails.sql` | Persist multiple labeled profile email addresses. |
| `apps/server/src/db/migrations/009_model_digest.sql` | Persist digest settings, source snapshots, generated summaries, and run/email status. |
| `apps/server/src/db/database.ts` | Register migrations and update the schema version. |
| `apps/server/src/modules/profile/profile.repository.ts` | Read and transactionally replace profile email records. |
| `apps/server/src/modules/profile/profile.routes.ts` | Validate and persist profile email updates through the existing profile API. |
| `apps/web/src/features/profile/ProfileEditor.tsx` | Add/edit/remove labeled email rows. |
| `apps/web/src/features/profile/ProfileCard.tsx` | Keep the saved profile response, including emails, current after save. |
| `apps/server/src/modules/model-digest/huggingface-source.ts` | Fetch and normalize Hugging Face trending models. |
| `apps/server/src/modules/model-digest/openrouter-source.ts` | Fetch and normalize OpenRouter ranking data. |
| `apps/server/src/modules/model-digest/model-digest.repository.ts` | Persist settings, serialized runs, status transitions, and latest successful digest. |
| `apps/server/src/modules/model-digest/model-digest.service.ts` | Orchestrate source collection, AI summary, persistence, and optional/scheduled email. |
| `apps/server/src/modules/model-digest/model-digest.scheduler.ts` | Run the scheduled workday job once per Shanghai local date and expose start/stop. |
| `apps/server/src/modules/model-digest/model-digest.routes.ts` | Read/update settings, start manual runs, and read run state/results. |
| `apps/server/src/modules/reminders/email-channel.ts` | Reuse the established SMTP behavior without exposing credentials. |
| `apps/server/src/app.ts` | Register model digest routes, plugin guard, and optional worker lifecycle. |
| `apps/server/src/index.ts` | Start the worker for the production/local server and stop it with the HTTP server. |
| `apps/server/src/system-plugins/manifests.ts` | Register the model summary system plugin and AI office tool contribution. |
| `apps/web/src/plugins/systemComponentRegistry.tsx` | Register the new React route component token. |
| `apps/web/src/lib/api.ts` | Add typed client methods for settings, manual execution, and run polling. |
| `apps/web/src/features/model-digest/ModelDigestPage.tsx` | Show latest summary, sources, scheduler status, recipient selection, and manual run controls. |
| `apps/web/src/styles/global.css` | Add focused layout styles for the digest cards and run controls. |

## Implementation Tasks

### Task 1: Add profile email and digest contracts plus database schema

**Files:**
- Create: `packages/contracts/src/profile-emails.ts`
- Create: `packages/contracts/src/model-digest.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/db/migrations/008_profile_emails.sql`
- Create: `apps/server/src/db/migrations/009_model_digest.sql`
- Modify: `apps/server/src/db/database.ts`

**Interfaces:**
- `ProfileEmailSchema`: `{ id: string; label: string; address: string }`, with an email address and bounded trimmed label.
- `ModelDigestSettingsSchema`: `{ enabled: boolean; recipientIds: string[]; schedule: { weekdays: number[]; localTime: "09:00"; timeZone: "Asia/Shanghai" } }`.
- `ModelDigestRunSchema`: run ID/type/status/timestamps, optional generated summary, normalized sources, recipient IDs, and email delivery status; never includes credentials.
- Export schemas and inferred types from the contracts package entry point.

- [ ] Create focused strict Zod schemas and inferred types; reject duplicate email IDs and duplicate recipient IDs.
- [ ] Add migration 008 with a profile-email table keyed by stable ID and ordered by position; enforce unique addresses case-insensitively per profile.
- [ ] Add migration 009 with model-digest settings and run tables; store run type, Shanghai scheduled date when applicable, normalized source snapshot JSON, summary text, status, email status, and failure category.
- [ ] Update `currentSchemaVersion` to 9 and append migrations 008 and 009 using the existing migration loader pattern.
- [ ] Review the SQL foreign-key and deletion behavior so removing a profile email cannot leave it eligible for a future send.

### Task 2: Add labeled email management to personal information

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/modules/profile/profile.repository.ts`
- Modify: `apps/server/src/modules/profile/profile.routes.ts`
- Modify: `apps/web/src/features/profile/ProfileEditor.tsx`
- Modify: `apps/web/src/features/profile/ProfileCard.tsx`

**Interfaces:**
- Extend `ProfileResponse` with `emails: ProfileEmail[]`; extend `ProfileUpdate` to accept email rows with stable IDs for saved entries and absent IDs for new entries.
- `ProfileRepository.get()` returns email rows ordered by position.
- `ProfileRepository.update(input)` saves profile fields, custom fields, and email rows in one transaction; new email IDs are generated by the server.

- [ ] Add the email list to profile response/update schemas while preserving compatibility with existing profile data (existing profiles read as an empty list).
- [ ] Update the repository query to return saved profile email IDs, labels, and addresses.
- [ ] In the existing profile update transaction, replace the email list and return the canonical persisted rows; reject reused IDs belonging to another profile.
- [ ] Add a labeled-email editor section with add/remove controls and browser email validity hints; do not place addresses into custom fields.
- [ ] Ensure a saved profile response replaces local editor state so generated IDs are used by later recipient selections.

### Task 3: Implement the two bounded public source adapters

**Files:**
- Create: `apps/server/src/modules/model-digest/huggingface-source.ts`
- Create: `apps/server/src/modules/model-digest/openrouter-source.ts`
- Use types from: `packages/contracts/src/model-digest.ts`

**Interfaces:**
- `ModelTrendSource.fetch(signal?: AbortSignal): Promise<ModelSourceSnapshot>`.
- `ModelSourceSnapshot`: `{ sourceId: "huggingface" | "openrouter"; fetchedAt: string; items: ModelTrendItem[] }`.
- `ModelTrendItem`: `{ sourceId; modelId; name; url; category: string | null; metrics: Record<string, string | number>; updatedAt: string | null }`.

- [ ] Implement Hugging Face fetching through the documented Hub API with a bounded trending result count, timeout, abort support, and field validation.
- [ ] Implement OpenRouter fetching through its documented model ranking/data interface with a bounded weekly/trending result count, timeout, abort support, and field validation.
- [ ] Normalize source-specific fields while preserving source IDs, source-specific metric names, model page URLs, and timestamps.
- [ ] Treat malformed payloads, non-2xx responses, timeouts, and rate limits as safe source errors without returning raw upstream response text to the UI.
- [ ] Exclude unsafe URLs and never infer capability scores or parameter counts from model names.

### Task 4: Implement persistence and the shared digest pipeline

**Files:**
- Create: `apps/server/src/modules/model-digest/model-digest.repository.ts`
- Create: `apps/server/src/modules/model-digest/model-digest.service.ts`
- Reuse: `apps/server/src/modules/ai-gateway/ai-gateway.types.ts`
- Reuse: `apps/server/src/modules/reminders/email-channel.ts`

**Interfaces:**
- `ModelDigestService.startRun(input: { type: "scheduled" | "manual"; recipientIds: string[]; sendEmail: boolean }): Promise<string>` returns a durable run ID after storing a queued run.
- `ModelDigestService.getRun(id: string): ModelDigestRun | null` returns current status and result.
- `ModelDigestRepository.claimScheduledDate(localDate: string): boolean` atomically prevents duplicate scheduled work for that Shanghai date.
- `ModelDigestRepository.updateRun(id, update): ModelDigestRun` persists each status transition.

- [ ] Implement repository methods to load settings and email contacts, create/claim runs atomically, update status, and retrieve the latest successful summary.
- [ ] Make the service a single-run worker: reject or report a second run while one run is active.
- [ ] Run both source adapters, require both snapshots to succeed, and persist source data before calling the AI gateway.
- [ ] Build a constrained summary prompt from normalized source facts only; instruct the model to separate Hugging Face community trend from OpenRouter token usage and preserve source URLs.
- [ ] Save a generated summary before email delivery so a mail failure does not discard readable results.
- [ ] Send scheduled mail to the configured recipient IDs; send manual mail only when `sendEmail` is true and explicit recipient IDs are valid.
- [ ] Record source, AI, and SMTP failures with safe public categories; retain the previous successful result when collection or summarization fails.
- [ ] Ensure the prompt contains no email addresses, SMTP credentials, or AI API keys.

### Task 5: Add scheduler lifecycle and model digest API

**Files:**
- Create: `apps/server/src/modules/model-digest/model-digest.scheduler.ts`
- Create: `apps/server/src/modules/model-digest/model-digest.routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/system-plugins/manifests.ts`
- Reuse: `apps/server/src/kernel/plugin-route-guard.ts`

**Interfaces:**
- `ModelDigestScheduler.start(): () => void` starts an unreferenced polling timer and returns a stop function.
- `GET /api/model-digest`: settings, latest successful digest, last run, next run, and configured profile emails.
- `PUT /api/model-digest/settings`: validate enabled state and selected profile email IDs.
- `POST /api/model-digest/runs`: start a manual run with explicit `sendEmail` and optional recipient IDs; respond with the run ID.
- `GET /api/model-digest/runs/:id`: return durable queued/running/succeeded/failed state.

- [ ] Implement the scheduler using an injected clock; calculate weekdays and 09:00 in `Asia/Shanghai`, and claim one run per local date before execution.
- [ ] Do not start background timers from ordinary `createApp()` calls; add an explicit app option/lifecycle handle so the worker is started only by `index.ts` and stopped when the HTTP server closes.
- [ ] Add plugin manifest contributions for `/ai-office/model-digest` and `system.model-digest.page`; request only `ai:use` and `mail:send` capabilities needed by the feature.
- [ ] Mount the API router behind the model-digest plugin route guard and reuse the app's existing `aiGateway`, `secretStore`, and mail settings.
- [ ] Validate that selected recipient IDs exist and that SMTP/default AI setup is ready before enabling scheduled sends; return user-safe validation errors.
- [ ] Implement manual run endpoints as durable background work so client navigation does not abort collection or email delivery.

### Task 6: Add the AI Office model digest page

**Files:**
- Create: `apps/web/src/features/model-digest/ModelDigestPage.tsx`
- Create: `apps/web/src/features/model-digest/model-digest.css`
- Modify: `apps/web/src/plugins/systemComponentRegistry.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/styles/global.css`
- Reuse: `apps/web/src/plugins/ContributionProvider.tsx`

**Interfaces:**
- Typed API methods matching `GET/PUT /api/model-digest`, `POST /api/model-digest/runs`, and `GET /api/model-digest/runs/:id`.
- The page consumes digest settings, profile email contacts, latest successful digest, last run, and next scheduled time.

- [ ] Register the new component token and typed API methods.
- [ ] Render the latest digest with generated time, source labels, metric definitions, and clickable original model links.
- [ ] Add the scheduled-email enable switch and profile-email multi-select; show a clear disabled state until valid recipients and services are configured.
- [ ] Add “立即获取并总结”; poll durable run state and display source collection, summarization, and delivery outcomes.
- [ ] Keep manual email delivery unchecked by default; when explicitly enabled, require the user to select one or more profile emails for that run only.
- [ ] Display API/network/model/mail errors without replacing the last successful digest; do not claim email delivery when SMTP failed.
- [ ] Style loading, empty, partial configuration, running, success, and failure states using existing workbench design tokens.

### Task 7: Integrate and review the end-to-end behavior

**Files:**
- Review: `docs/superpowers/specs/2026-09-28-ai-model-digest-design.md`
- Review: `docs/superpowers/plans/2026-09-28-ai-model-digest.md`
- Review touched implementation files from Tasks 1–6.

- [ ] Compare each changed behavior against the accepted design and remove any implementation that adds arbitrary web browsing, a general agent runtime, or sends manual-run emails without explicit opt-in.
- [ ] Review the final diff for leaked addresses/secrets, unsafe upstream URLs, unbounded source responses, or background work starting from an ordinary `createApp()` call.

## Coverage Review

- Personal mailbox list and multi-recipient selection: Tasks 1, 2, 4, and 6.
- Hugging Face and OpenRouter source retrieval: Tasks 3 and 4.
- Default model API summary: Task 4.
- Scheduled workday delivery and idempotency: Tasks 4 and 5.
- Immediate run, status display, and opt-in email: Tasks 4, 5, and 6.
- Local persistence, failure behavior, and no credential leakage: Tasks 1, 4, 5, and 7.
- UI registration and AI Office availability: Tasks 5 and 6.
