# Task 5 Report: AI Office and Daily Report Generation

## Implementation

- Added shared contracts for validated daily-report input, persisted report records, and output edits.
- Added a fixed server-side Chinese prompt builder. It treats both user fields only as source material, prohibits invented numbers/results/dates/work items, uses only the approved `今日完成` and `问题与风险` section headings, omits empty sections, and requests plain text rather than JSON or Markdown code fences.
- Added an OpenAI-compatible DeepSeek client that:
  - constructs the prompt only on the loopback server;
  - sets a 30,000 ms abort timer;
  - uses `redirect: "manual"` and rejects every 3xx response;
  - creates the bearer Authorization header only at the injected provider/fetch boundary;
  - validates the completion content and actual returned model;
  - converts provider/auth/rate-limit/abort/malformed-response failures into category-only errors without reading or returning raw upstream bodies.
- Added a SQLite repository over the existing `daily_reports` table. Successful generations persist original input, generated content, actual model, and ISO created/updated timestamps. History is ordered by creation time and ID descending; edits change only output and `updatedAt`.
- Added `POST /api/daily-reports/generate`, `GET /api/daily-reports`, `GET /api/daily-reports/:id`, and `PUT /api/daily-reports/:id`.
- Extended `createApp` compatibly with an injected `DailyReportGenerator`. Tests use a credential-free stub; production uses `DeepSeekClient`.
- The generation route reads base URL/model from SQLite and reads `deepseek-api-key` from `SecretStore` for every generation request. It reuses the canonical provider URL validator and the explicit loopback-HTTP test exception from secure settings.
- Added an AI Office tool hub with one small `日报填写` link/card and a separate daily-report page inside the persistent shell.
- Added input/result separation, duplicate-submit prevention, retained inputs after error, Settings guidance for missing configuration, clipboard success/failure feedback, automatic history refresh, newest-first history previews, reopen, edit, save, and accurate failed-save feedback.
- No migration was added because `001_init.sql` already defines every required `daily_reports` column.

## Prompt and HTTP Error Mapping

| Condition | Result |
| --- | --- |
| Missing key or invalid/missing provider settings | HTTP 409, `DEEPSEEK_NOT_CONFIGURED`, with Settings guidance |
| Provider 401/403 | HTTP 401, `DEEPSEEK_AUTH_FAILED` |
| Provider 429 | HTTP 429, `DEEPSEEK_RATE_LIMITED` |
| Abort after 30 seconds | HTTP 504, `DEEPSEEK_TIMEOUT` |
| Redirect, other provider status, network failure, or invalid response shape | HTTP 502, `DEEPSEEK_UPSTREAM_ERROR` |
| Invalid report body or ID | HTTP 400, `VALIDATION_ERROR` |
| Missing report ID | HTTP 404, `NOT_FOUND` |

All provider-facing failures use fixed messages. API keys, Authorization values, thrown raw provider messages, and upstream response bodies are not included in API responses or logs.

## RED Evidence

Captured before production implementation on 2026-08-18:

- `pnpm --filter @workbench/server test -- daily-report.test.ts`
  - The first sandboxed attempt was excluded because Windows returned `EPERM` before Vitest loaded.
  - The identical permitted run exited 1.
  - The suite failed to load because `src/modules/daily-reports/daily-report.prompt` did not exist.
- `pnpm --filter @workbench/web test -- DailyReportPage.test.tsx`
  - Exit 1.
  - The suite failed to resolve `./DailyReportPage` because the component did not exist.

Both failures were caused by the absent requested feature. The complete required server and web tests existed before the production modules were added.

The first server GREEN attempt then caught a real provider-boundary issue: spreading public settings forwarded `apiKeyConfigured` to the injected generator. The route was narrowed to explicit `baseUrl`, `model`, `apiKey`, `completed`, and `risks` fields. The rerun passed 17/17 tests. The first web GREEN attempt rendered the intended output but exposed newline-sensitive `<pre>` queries; assertions were corrected to inspect the accessible result region and user-visible content. Clipboard setup ordering was also corrected before the focused suite passed 7/7.

## GREEN and Verification Evidence

- `pnpm --filter @workbench/server test -- daily-report.test.ts`
  - Exit 0; 1 file and 17 tests passed.
- `pnpm --filter @workbench/web test -- DailyReportPage.test.tsx`
  - Exit 0; 1 file and 7 tests passed.
- `pnpm test`
  - Exit 0.
  - Contracts: no test files, permitted by the existing script.
  - Server: 6 files and 75 tests passed.
  - Web: 5 files and 29 tests passed.
- `pnpm build`
  - Exit 0; contracts/server type-check and web production build passed; 83 web modules transformed.
- `pnpm check`
  - Exit 0 for contracts, server, and web.
- `git diff --check`
  - Exit 0; only the repository's existing Windows LF-to-CRLF notices were emitted.

## Changed Files

- `.superpowers/sdd/2026-08-18-personal-workbench-mvp/task-5-report.md`
- `apps/server/src/app.ts`
- `apps/server/src/modules/daily-reports/daily-report.prompt.ts`
- `apps/server/src/modules/daily-reports/deepseek.client.ts`
- `apps/server/src/modules/daily-reports/daily-report.repository.ts`
- `apps/server/src/modules/daily-reports/daily-report.routes.ts`
- `apps/server/src/modules/settings/settings.routes.ts`
- `apps/server/tests/daily-report.test.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/features/ai-office/AiOfficePage.tsx`
- `apps/web/src/features/daily-report/DailyReportHistory.tsx`
- `apps/web/src/features/daily-report/DailyReportPage.test.tsx`
- `apps/web/src/features/daily-report/DailyReportPage.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/styles/global.css`
- `packages/contracts/src/index.ts`

## Self-Review

- Re-read the Task 5 brief line by line and mapped every required interface, prompt rule, error status, persistence rule, and UI state to implementation and test evidence.
- Confirmed `SecretStore.readSecret("deepseek-api-key")` occurs inside the generation request handler, never during app construction, and only its returned plaintext reaches the injected provider boundary.
- Confirmed the browser sends only `completed` and `risks`; it cannot supply the system prompt, base URL, model, API key, or Authorization header.
- Confirmed generation reuses the hardened canonical URL validator, production remains HTTPS-only, and provider fetch uses manual redirect handling.
- Confirmed provider failures are caught inside the daily-report route before the app-wide logger. Generic injected errors containing credential-like sentinels still produce only the fixed 502 response.
- Confirmed persistence happens only after `generateDailyReport` resolves successfully; every mapped failure leaves history empty.
- Confirmed report edits preserve `completed`, `risks`, `model`, and `createdAt`, while changing only `content` and advancing `updatedAt`.
- Confirmed history ordering is stable for timestamp ties through descending ID order.
- Confirmed the hub card is not registered as a home-dashboard module and the independent page remains inside the existing shell.
- Confirmed input fields are not cleared on failure, pending generation disables repeat submits, clipboard feedback distinguishes success/failure, and edit feedback reports success only after the PUT resolves.
- Searched production sources for all test credential sentinels, Authorization/API-key handling, raw request logging, and console calls. No sentinel appears outside tests; the new Authorization header exists only in `deepseek.client.ts`; daily-report routes do not log request bodies, secrets, headers, or raw provider errors.
- Reviewed the complete diff and left design/plan documents unchanged.

## Concerns

- No real DeepSeek request was made because no user credential was supplied. The injected client/fetch seams cover the complete request shape, 30-second abort, redirect refusal, response parsing, and error mapping deterministically.
- The existing initial migration already contained the report table, so schema-upgrade behavior was not needed or changed.
