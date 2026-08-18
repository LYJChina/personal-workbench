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

## Fix Round 1 (2026-08-18)

### Findings Addressed

1. Generation success and the subsequent history refresh now have separate UI error phases. Once the POST resolves, the generated report remains displayed and the generation pending state ends. A refresh failure produces the distinct non-blocking status `日报已生成并保存，但历史记录刷新失败，请勿重复生成`; it does not populate the generation error alert or expose the raw refresh exception.
2. Provider generation and local SQLite persistence now have separate server error boundaries. Only `generateDailyReport` failures enter DeepSeek category mapping. A repository insertion failure after provider success is replaced with the sanitized local error `Daily report persistence failed`, then handled by the existing generic HTTP 500 boundary; it cannot be mislabeled as `DEEPSEEK_UPSTREAM_ERROR` or leak the database error.

### RED Evidence

- `pnpm --filter @workbench/server test -- daily-report.test.ts`
  - Exit 1; 1 failed and 17 passed.
  - The real SQLite `BEFORE INSERT` failing trigger ran after one successful injected provider call, but the route returned HTTP 502 instead of the literal expected HTTP 500.
- `pnpm --filter @workbench/web test -- DailyReportPage.test.tsx`
  - Exit 1; 1 failed and 7 passed.
  - Generation succeeded and its result rendered, but the second `getDailyReports` rejection appeared as the form's `role="alert"` with the raw `history-refresh-raw-error` message instead of a distinct history warning.

Both failures directly reproduced the reviewed boundary defects before production changes.

### GREEN and Verification Evidence

- `pnpm --filter @workbench/server test -- daily-report.test.ts`
  - Exit 0; 1 file and 18 tests passed.
- `pnpm --filter @workbench/web test -- DailyReportPage.test.tsx`
  - Exit 0; 1 file and 8 tests passed.
- `pnpm test`
  - Exit 0.
  - Contracts: no test files, permitted by the existing script.
  - Server: 6 files and 76 tests passed.
  - Web: 5 files and 30 tests passed.
- `pnpm build`
  - Exit 0; contracts/server type-check and web production build passed; 83 web modules transformed.
- `pnpm check`
  - Exit 0 for contracts, server, and web.
- `git diff --check`
  - Exit 0; only Windows LF-to-CRLF notices were emitted.

### Covering Tests and Security Reasoning

- `keeps a successful result and shows a distinct warning when only history refresh fails` provides an initial successful history load followed by a failed automatic refresh. It proves the result remains visible, the provider-facing generation method is called once, no main alert or raw ancillary error is shown, and the warning explicitly tells the user not to regenerate.
- `maps a local persistence failure to a sanitized 500 after one successful provider call` installs a real SQLite trigger that rejects only report insertion. It proves the provider was called once, the response is the generic 500 payload, subsequent history is empty, neither the response nor logger contains the trigger sentinel/key/Bearer value, and no DeepSeek error code is returned.
- The local persistence catch deliberately discards the original SQLite error before invoking the global handler. Provider response content, credentials, and database diagnostic text therefore cannot flow into the generic logger through this path.

### Concerns

- The UI warning intentionally leaves the generated result available for copying even though history could not be reloaded. The successful server response is authoritative that the report was saved; retrying generation would risk a duplicate row.
- No deferred Minor findings were changed in this round.
