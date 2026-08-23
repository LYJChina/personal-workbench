# Dashboard AI Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a locally persisted OpenAI-compatible chat card to the right side of the homepage and make all four default dashboard cards equal-sized and user-resizable.

**Architecture:** Shared Zod contracts define chat messages and the fourth dashboard module. An Express chat module owns local message persistence and requests the configured model through the existing DPAPI-protected settings boundary. React renders the chat as a dashboard module; the existing grid editor persists drag and resize changes, using a 16-column desktop grid and a 4-column mobile grid.

**Tech Stack:** TypeScript, React 19, React Grid Layout, Express 5, SQLite/better-sqlite3, Zod, Vitest, Testing Library, Supertest

## Global Constraints

- Reuse the existing configured OpenAI-compatible base URL, model and DPAPI-encrypted API key.
- Never expose the API key to the browser or an API response.
- Persist chat messages only in the local SQLite database.
- Send at most the latest 20 messages and a bounded amount of text as model context.
- Keep the existing mobile single-column dashboard behavior.
- Preserve manually customized dashboard layouts when seeding the new module.

---

### Task 1: Chat contracts, storage and model client

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/db/migrations/001_init.sql`
- Create: `apps/server/src/modules/ai-chat/ai-chat.repository.ts`
- Create: `apps/server/src/modules/ai-chat/ai-chat.client.ts`
- Test: `apps/server/tests/ai-chat.test.ts`

**Interfaces:**
- Produces `AiChatMessage`, `AiChatInput`, `AiChatRole` and schemas with roles `user | assistant`.
- Produces `AiChatRepository.list()`, `create(role, content, model)`, and `clear()`.
- Produces `AiChatGenerator.generate({ baseUrl, model, apiKey, messages })`.

- [ ] Write a failing repository test that opens a fresh database, creates user and assistant messages, verifies chronological listing, clears them, and verifies an empty list.
- [ ] Run `pnpm --filter @workbench/server test -- ai-chat.test.ts` and verify failure because the chat module/table does not exist.
- [ ] Add the exact schemas, table, repository mapping and OpenAI-compatible `/chat/completions` client with the existing 30-second timeout and failure categories.
- [ ] Run the focused test and verify repository and client tests pass.

### Task 2: Safe chat API and bounded context

**Files:**
- Create: `apps/server/src/modules/ai-chat/ai-chat.routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/server/tests/ai-chat.test.ts`

**Interfaces:**
- Produces `GET /api/ai-chat/messages`, `POST /api/ai-chat/messages`, and `DELETE /api/ai-chat/messages`.
- Produces web API methods `getAiChatMessages()`, `sendAiChatMessage(content)`, and `clearAiChatMessages()`.

- [ ] Add failing route tests for listing, sending with prior context, missing API configuration, upstream failure preserving the user message, and clearing history.
- [ ] Run the focused server test and verify 404/missing-router failures.
- [ ] Implement the router using `AiChatInputSchema`, `deepseek-api-key`, the existing safe base-URL rule, the latest 20 messages capped at 30,000 characters, and safe error responses.
- [ ] Register injectable generator dependencies in `createApp` and add typed web client methods.
- [ ] Run the focused server tests and server/contracts type checks.

### Task 3: Seed the equal-sized four-card dashboard

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/modules/preferences/preferences.repository.ts`
- Modify: `apps/web/src/features/dashboard/EditableDashboard.tsx`
- Modify: `apps/web/src/features/dashboard/moduleRegistry.tsx`
- Test: `apps/server/tests/preferences.test.ts`
- Test: `apps/web/src/features/dashboard/EditableDashboard.test.tsx`

**Interfaces:**
- Adds module ID `ai-chat`.
- Desktop grid has 16 columns; mobile grid remains 4 columns.
- Default modules use `{ w: 4, h: 5 }` at `x = 0, 4, 8, 12`.

- [ ] Add failing server tests proving a fresh layout contains four equal cards and an old customized layout is preserved while `ai-chat` is appended.
- [ ] Add a failing web test proving desktop layout uses 16 columns and editing exposes resizable cards.
- [ ] Run the two focused suites and verify failures for the missing module/default.
- [ ] Extend the schema width limit to 16, implement versioned layout seeding, switch the desktop grid to 16 columns, and set all module minimums to fit a 4-column card.
- [ ] Run both focused suites and verify they pass.

### Task 4: Homepage chat card

**Files:**
- Create: `apps/web/src/features/ai-chat/AiChatCard.tsx`
- Create: `apps/web/src/features/ai-chat/AiChatCard.test.tsx`
- Modify: `apps/web/src/features/dashboard/moduleRegistry.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/app/App.integration.test.tsx`

**Interfaces:**
- `AiChatCard` consumes an injectable API with list/send/clear methods.
- Renders an accessible log, textbox, send button and new-conversation action.

- [ ] Add failing component tests for initial messages, Enter send, Shift+Enter, disabled duplicate send, error display, and confirmed clearing.
- [ ] Run `pnpm --filter @workbench/web test -- AiChatCard.test.tsx` and verify failure because the card does not exist.
- [ ] Implement the chat card with optimistic user rendering, autoscroll, local failure feedback and accessible controls.
- [ ] Add responsive card styles and register it as the fourth module.
- [ ] Run focused UI and application integration tests.

### Task 5: Full verification and visual QA

**Files:**
- Modify only files required by failures found during verification.

- [ ] Run `pnpm test`, `pnpm check`, and `pnpm build`; require zero failures.
- [ ] Reload the running homepage and verify four equal cards, chat placement, message scrolling, edit-mode resize affordance and no browser console errors.
- [ ] Temporarily verify a narrow viewport has no horizontal overflow, then restore the default viewport.
