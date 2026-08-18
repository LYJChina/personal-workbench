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

During self-review, a new replacement-ACL regression test was also observed RED: `pnpm --filter @workbench/server test -- dpapi.test.ts -t "restores a current-user-only ACL"` exited 1 when the first overwrite implementation could not supply a null `File.Replace` backup path, and then correctly exposed that a broadened explicit `BUILTIN\Users` rule survived replacement. That implementation used a same-directory encrypted backup for atomic replacement, removed every explicit rule, and reapplied only the current user SID. Fix Round 1 below supersedes its original backup-deletion timing.

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

- The Windows DPAPI test explicitly deletes its disposable blob and verifies the path no longer exists. Atomic-overwrite encrypted backups are deleted only after final target ACL verification; the failure path restores the previous blob and leaves no temporary or backup file.
- Each settings test removes its temporary data directory recursively after execution.
- No real DeepSeek API key or SMTP password was created, stored, logged, or sent during verification.

## Concerns

- Windows DPAPI `CurrentUser` fails under the restricted sandbox token because that token has no loaded user profile. The same test passes outside the sandbox under the signed-in user and is the relevant production execution context; encryption was not weakened or substituted.
- Real DeepSeek and SMTP connectivity was deliberately not claimed or exercised because the task supplied no credentials. The injected seams cover success and sanitized error mapping deterministically.

## Fix Round 1 (2026-08-18)

### Findings Addressed

1. DeepSeek base URLs now accept only an HTTPS origin plus path. Userinfo, query delimiters/parameters, and fragments are rejected. The explicit test-only exception still permits loopback HTTP with the same shape restrictions. The production probe sets `redirect: "manual"`; every 3xx is mapped to the existing sanitized `unreachable_host` result without requesting or exposing the `Location` target.
2. DPAPI overwrite now hardens and verifies the existing target before replacement. Both the old target and new temporary blob therefore have current-user-only DACLs before `File.Replace`. The encrypted backup remains until the final target DACL is applied and verified. Any post-replacement failure removes the new target, restores the previous protected blob, reapplies/verifies its safe ACL, and preserves a safe backup rather than deleting recovery data if restoration itself cannot complete.

### RED Evidence

- `pnpm --filter @workbench/server test -- settings.test.ts`
  - Exit 1; 4 failed and 17 passed.
  - Credential-bearing URL, query URL, and fragment URL each returned 200 instead of 400.
  - The controlled redirect probe resolved successfully because fetch followed the 302 and reached the second local server.
- `pnpm --filter @workbench/server test -- dpapi.test.ts`
  - Exit 1; 2 failed and 3 passed.
  - Both injected interruption cases resolved instead of rejecting because the old implementation had no pre-replacement or post-replacement failure seam and no rollback behavior.

The initial sandboxed settings RED attempt was excluded from TDD evidence because Windows returned `EPERM` before Vitest could collect tests. The identical command outside the sandbox produced the behavior-level failures above.

### GREEN and Verification Evidence

- `pnpm --filter @workbench/server test -- settings.test.ts`
  - Exit 0; 21 tests passed.
- `pnpm --filter @workbench/server test -- dpapi.test.ts`
  - Exit 0; 5 tests passed, including the two interruption/rollback cases.
- `pnpm --filter @workbench/server test -- dpapi.test.ts settings.test.ts`
  - Exit 0; 2 files and 26 tests passed.
- `pnpm --filter @workbench/web test -- SettingsPage.test.tsx`
  - Exit 0; 1 file and 12 tests passed.
- `pnpm test`
  - Exit 0.
  - Server: 5 files and 39 tests passed.
  - Web: 4 files and 22 tests passed.
- `pnpm build`
  - Exit 0; contracts/server type-check and web production build passed.
- `pnpm check`
  - Exit 0 for every workspace package.
- `git diff --check`
  - Exit 0; only Windows LF-to-CRLF notices were emitted.

### Covering Tests and Security Reasoning

- `rejects DeepSeek base URLs containing userinfo, query, or fragment` prevents credentials or redirect-like parameters from entering SQLite and the probe boundary.
- `does not follow a provider redirect to another target` uses two real loopback HTTP servers. The first emits a 302 to the second; the probe returns a sanitized failure and the second server's request count remains zero.
- `hardens a broadened existing blob before replacement begins` adds `BUILTIN\Users:Read`, injects failure immediately after existing-target hardening, and proves the old secret remains readable only to the current SID with no extra files.
- `restores the previous safe blob when final ACL application fails` broadens the old DACL, injects failure after atomic replacement and before final target ACL application, then proves the previous plaintext round-trips, the restored DACL contains only the current SID, and the secrets directory contains only the expected blob.
- The failure seams can only force a sanitized failure; they cannot bypass DPAPI or ACL enforcement and are not exposed through `createApp`.

### Cleanup and Concerns

- Both local redirect-test servers are closed in `finally` even when assertions fail.
- Every DPAPI test uses a unique temporary directory; rollback tests additionally assert no temporary or backup filename remains.
- Plaintext test values still travel to PowerShell only through standard input. Failure-point metadata contains no secret and is passed separately through the child environment.
- CurrentUser DPAPI verification still requires execution outside the restricted sandbox under the signed-in Windows profile. No weaker encryption or ACL fallback was introduced.
- No real DeepSeek or SMTP credentials were used, and no external provider connection was attempted.

## Fix Round 2 (2026-08-18)

### Findings Addressed

1. DeepSeek validation now inspects the raw URL authority for the userinfo delimiter. This closes the WHATWG URL normalization gap where `https://@api.deepseek.com/v1` and `https://:@api.deepseek.com/v1` produce empty `username` and `password` properties. The check is limited to the authority, so an `@` in a legitimate path is not confused with credentials. Existing parsed username/password checks continue to reject encoded or non-empty userinfo variants.
2. Every DPAPI protect subprocess now receives `LYJ_WORKBENCH_DPAPI_FAILURE_POINT` explicitly from the store's internal option, defaulting to an empty string. An ambient parent-process variable can no longer activate the test-only PowerShell failure seam on the normal production path.

### RED Evidence

- `pnpm --filter @workbench/server test -- settings.test.ts`
  - Exit 1; 2 failed and 21 passed.
  - Both exact empty-userinfo forms returned 200 instead of 400: `https://@api.deepseek.com/v1` and `https://:@api.deepseek.com/v1`.
- `pnpm --filter @workbench/server test -- dpapi.test.ts`
  - Exit 1; 1 failed and 5 passed.
  - With the parent environment set to `before_final_target_acl`, a normal `WindowsDpapiSecretStore` save failed with the sanitized `Windows DPAPI operation failed` error, proving the ambient variable reached the child.

The initial sandboxed settings RED attempt was excluded from behavior evidence because Windows returned `EPERM` before Vitest could collect tests. The identical command outside the sandbox produced the two expected assertion failures.

### GREEN and Verification Evidence

- `pnpm --filter @workbench/server test -- settings.test.ts`
  - Exit 0; 23 tests passed.
- `pnpm --filter @workbench/server test -- dpapi.test.ts`
  - Exit 0; 6 tests passed.
- `pnpm --filter @workbench/server test -- dpapi.test.ts settings.test.ts`
  - Exit 0; 2 files and 29 tests passed.
- `pnpm --filter @workbench/web test -- SettingsPage.test.tsx`
  - Exit 0; 1 file and 12 tests passed.
- `pnpm test`
  - Exit 0.
  - Server: 5 files and 42 tests passed.
  - Web: 4 files and 22 tests passed.
- `pnpm build`
  - Exit 0; contracts/server type-check and web production build passed.
- `pnpm check`
  - Exit 0 for every workspace package.
- `git diff --check`
  - Exit 0; only Windows LF-to-CRLF notices were emitted.

### Covering Tests and Security Reasoning

- `rejects empty raw userinfo syntax in the DeepSeek base URL` covers both normalized-empty forms verbatim. The validator extracts only the raw authority between `://` and the first path, query, or fragment delimiter, then rejects any `@`; parsed username/password validation remains defense in depth for non-empty and encoded userinfo.
- `ignores an ambient DPAPI failure point on the normal production path` sets the parent variable to a real injected failure point, constructs the store without test options, successfully protects and reads the disposable secret, and restores the original parent environment in `finally`.
- The PowerShell command line remains fixed and secret-free. The new child environment value is either an internal enum value used by controlled tests or an empty string; it never contains plaintext secret material.

### Cleanup and Concerns

- The ambient-variable test restores the exact prior environment state in `finally`, including deleting the variable when it was originally absent.
- All DPAPI test blobs remain isolated in unique temporary directories removed by the existing `afterEach`; the focused suite also revalidated interruption rollback cleanup and exact current-user-only ACLs.
- CurrentUser DPAPI verification still requires execution outside the restricted sandbox under the signed-in Windows profile. No weaker encryption or ACL fallback was introduced.
- No real DeepSeek or SMTP credentials were used, and no external provider connection was attempted.
