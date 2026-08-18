# Task 4 Report: Secure DeepSeek and Mail Settings

## Implementation

- Added shared contracts for DeepSeek settings, mail settings, connection-test results, and secret-free settings responses.
- Added `SecretStore` and a Windows-only `WindowsDpapiSecretStore` that:
  - validates names against the fixed `deepseek-api-key`, `smtp-password`, and disposable `dpapi-test-secret` allowlist;
  - invokes `powershell.exe` with `-NoProfile -NonInteractive`;
  - sends UTF-8 plaintext bytes only over the child process standard input;
  - uses `System.Security.Cryptography.ProtectedData` with `DataProtectionScope.CurrentUser`;
  - atomically moves/replaces encrypted blobs within `%LOCALAPPDATA%\LYJWorkBench\secrets` (or the injected test data directory);
  - disables inherited ACLs and grants full control only to the current Windows user SID;
  - clears transient byte buffers and emits only sanitized errors.
- Added SQLite-backed non-secret settings storage. Only DeepSeek base URL/model and SMTP host/port/transport/username/from-address enter `app_settings`.
- Added `GET /api/settings`, `PUT /api/settings/deepseek`, `POST /api/settings/deepseek/test`, `PUT /api/settings/mail`, and `POST /api/settings/mail/test`.
- Extended `createApp` compatibly with injected secret storage, provider/mail connection probes, timeout configuration, and a loopback-HTTP test option.
- Added bounded production probes: server-side `fetch` for DeepSeek and Nodemailer `verify()` for SMTP. Neither logger nor HTTP response receives credentials.
- Replaced the inline settings route page with separate DeepSeek, mail, and appearance sections. Saved secrets are represented only by configured booleans; replacement fields start empty and empty submissions omit secret properties. Appearance reuses the existing `ThemeProvider`.

## RED Evidence

Captured before production implementation on 2026-08-18:

- `pnpm --filter @workbench/server test -- dpapi.test.ts settings.test.ts`
  - Exit 1.
  - Both suites failed to load because `src/platform/dpapi` and `src/modules/settings/settings.routes` did not exist.
- `pnpm --filter @workbench/web test -- SettingsPage.test.tsx`
  - Exit 1.
  - Suite failed to resolve `./SettingsPage` because the component did not exist.

The failures were caused by the missing requested behavior, not syntax mistakes or pre-existing regressions.

During self-review, a new replacement-ACL regression test was also observed RED: `pnpm --filter @workbench/server test -- dpapi.test.ts -t "restores a current-user-only ACL"` exited 1 when the first overwrite implementation could not supply a null `File.Replace` backup path, and then correctly exposed that a broadened explicit `BUILTIN\Users` rule survived replacement. The final implementation uses a same-directory encrypted backup for atomic replacement, deletes it immediately, removes every explicit rule, and reapplies only the current user SID.

## GREEN Evidence

- `pnpm --filter @workbench/server test -- dpapi.test.ts settings.test.ts`
  - Exit 0 outside the sandbox, where the signed-in CurrentUser profile is available.
  - 2 files passed; 20 tests passed.
  - The disposable DPAPI tests passed, removed `dpapi-test-secret.bin`, and proved overwrite restores an exact current-user-only DACL.
- `pnpm --filter @workbench/web test -- SettingsPage.test.tsx`
  - Exit 0; 1 file passed; 12 tests passed.
- `pnpm test`
  - Exit 0 outside the sandbox for CurrentUser DPAPI access.
  - Contracts: no tests, permitted by the existing script.
  - Server: 5 files passed; 33 tests passed.
  - Web: 4 files passed; 22 tests passed.
- `pnpm build`
  - Exit 0; contracts/server type-check and web production build passed.
- `pnpm check`
  - Exit 0 for all workspace packages.
- `git diff --check`
  - Exit 0; only existing Windows LF-to-CRLF notices were emitted.

## Connection-Test Error Mapping

| Outcome | API status value | Sanitized message |
| --- | --- | --- |
| Success | `success` | `连接成功` |
| Provider/SMTP authentication rejection | `auth_failure` | `身份验证失败，请检查凭据` |
| Abort/timeout | `timeout` | `连接超时，请稍后重试` |
| DNS, refusal, socket, or other unreachable failure | `unreachable_host` | `无法连接到服务器` |

Injected probes exercised every category for both endpoints without external credentials. Production DeepSeek and SMTP probes were not run because no user credentials were supplied.

## Changed Files

- `.superpowers/sdd/2026-08-18-personal-workbench-mvp/task-4-report.md`
- `apps/server/package.json`
- `apps/server/src/app.ts`
- `apps/server/src/config/paths.ts`
- `apps/server/src/modules/settings/settings.repository.ts`
- `apps/server/src/modules/settings/settings.routes.ts`
- `apps/server/src/platform/dpapi.ts`
- `apps/server/tests/dpapi.test.ts`
- `apps/server/tests/settings.test.ts`
- `apps/web/src/app/App.tsx`
- `apps/web/src/features/settings/SettingsPage.test.tsx`
- `apps/web/src/features/settings/SettingsPage.tsx`
- `apps/web/src/lib/api.ts`
- `apps/web/src/styles/global.css`
- `packages/contracts/src/index.ts`
- `pnpm-lock.yaml`

## Self-Review

- Confirmed production process arguments contain only fixed PowerShell flags and the encoded, secret-free script; plaintext secret bytes go through standard input.
- Confirmed DPAPI uses `CurrentUser`, encrypted blobs are written within the resolved secrets directory, ACL inheritance is disabled, pre-existing explicit rules are removed, overwrite restores only the current SID, and the disposable integration blob is deleted.
- Confirmed no save response or `GET /api/settings` response contains a secret; only `apiKeyConfigured` and `smtpPasswordConfigured` are returned.
- Confirmed raw SQLite bytes do not contain either sentinel credential and non-secret settings survive a fresh app instance.
- Confirmed absent, empty, and whitespace-only secret replacements preserve the existing protected value.
- Confirmed HTTPS enforcement, explicit loopback-only HTTP allowance, SMTP port boundaries, and exact transport modes.
- Confirmed all external failures are caught before the app-wide logger and mapped to fixed category/message pairs.
- Confirmed the settings component never receives a saved secret, does not use browser storage, clears replacement fields after successful saves, and reuses the existing theme context.
- Searched production sources for test sentinel credentials, browser storage calls, credential logging, authorization handling, and secret field usage. No test sentinel appeared outside tests; the sole authorization header is constructed only inside the server-side probe.
- Reviewed the complete diff and preserved existing profile, dashboard, navigation, sidebar, and theme APIs.

## Cleanup Evidence

- The Windows DPAPI test explicitly deletes its disposable blob and verifies the path no longer exists. Atomic-overwrite encrypted backups are also deleted immediately and in the failure cleanup path.
- Each settings test removes its temporary data directory recursively after execution.
- No real DeepSeek API key or SMTP password was created, stored, logged, or sent during verification.

## Concerns

- Windows DPAPI `CurrentUser` fails under the restricted sandbox token because that token has no loaded user profile. The same test passes outside the sandbox under the signed-in user and is the relevant production execution context; encryption was not weakened or substituted.
- Real DeepSeek and SMTP connectivity was deliberately not claimed or exercised because the task supplied no credentials. The injected seams cover success and sanitized error mapping deterministically.
