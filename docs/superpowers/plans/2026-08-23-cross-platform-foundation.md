# Cross-Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing workbench fully usable on Windows and macOS with one SQLite data file and portable encrypted secrets, while preserving SMTP/manual email and removing automatic reminder execution plus Windows scheduler dependencies.

**Architecture:** Keep the current React/Express application intact. Replace Windows-only startup, paths, and default secret storage with narrow cross-platform services; migrate binary profile data into SQLite; remove scheduler composition without removing reminder CRUD or schedule metadata. A one-time Windows-only importer may read legacy DPAPI blobs, but normal runtime code must not require PowerShell.

**Tech Stack:** TypeScript, Node.js 22, React 19, Express 5, SQLite/better-sqlite3, Zod, Node `crypto` (`scrypt`, AES-256-GCM), Vitest, Testing Library, Supertest

## Global Constraints

- Windows 11 and macOS are equal supported platforms; both use `pnpm install`, `pnpm dev`, `pnpm build`, and `pnpm local:start`.
- Preserve the current dirty worktree, including the uncommitted AI chat work; never reset or overwrite unrelated changes.
- Commit steps stage only task-owned hunks. If a listed file already contains unrelated user changes, use `git add -p` or leave that file uncommitted instead of sweeping those changes into the task commit.
- Preserve reminder CRUD, reminder date/repetition data, SMTP settings, SMTP connection testing, and manual reminder email sending.
- Remove automatic reminder sending, scheduler endpoints/UI, Windows Task Scheduler integration, PowerShell/VBScript reminder scripts, and their runtime tests.
- Preserve the cross-platform security regression coverage in `apps/server/tests/security-boundaries.test.ts`: production must bind only to canonical `127.0.0.1`, SPA fallback must never turn unknown `/api/*` routes into HTML, and dependency errors containing secrets must expose neither the secret-bearing message nor secret values in the HTTP response or application logs.
- Store user data, profile photos, encrypted secrets, and settings in `workbench.sqlite`; temporary runtime cache is not authoritative.
- Portable secrets use a user master password, Node `scrypt`, and AES-256-GCM; plaintext secrets and the master password never enter SQLite or logs.
- Existing Windows DPAPI blobs may be imported only by a one-time Windows adapter after explicit vault setup.
- No task may introduce platform-specific commands outside the platform adapter or legacy migration adapter.
- Task 1 may invoke `schtasks.exe` only through the tested Windows-only legacy retirement adapter. This one-way migration may query and delete the two exact historical root tasks; it must never create, update, enable, or synchronize a task, and non-Windows platforms must not spawn it.
- Every behavior change follows red-green TDD and ends with focused verification before commit.

---

### Task 1: Remove Automatic Reminder Execution and Scheduler Surfaces

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/modules/calendar/holiday.routes.ts`
- Modify: `apps/server/src/modules/reminders/reminder.routes.ts`
- Modify: `apps/server/src/modules/reminders/reminder.repository.ts`
- Modify: `apps/server/package.json`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `scripts/prepare-backup.ps1`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/reminders/ReminderPage.tsx`
- Modify: `apps/web/src/features/reminders/ReminderPage.test.tsx`
- Modify: `apps/web/src/app/App.integration.test.tsx`
- Modify: `apps/web/src/styles/global.css`
- Delete: `apps/server/src/reminder-entry.ts`
- Delete: `apps/server/src/modules/reminders/reminder-scheduler.ts`
- Delete: `apps/server/src/modules/reminders/reminder-wake.ts`
- Delete: `apps/server/src/modules/reminders/reminder.runner.ts`
- Delete: `apps/server/src/modules/reminders/generic-reminder.runner.ts`
- Delete: `apps/server/tests/reminder-scheduler.test.ts`
- Delete: `scripts/install-reminder-task.ps1`
- Delete: `scripts/sync-reminder-task.ps1`
- Delete: `scripts/uninstall-reminder-task.ps1`
- Delete: `scripts/run-reminders-hidden.vbs`
- Create: `scripts/clean-server-dist.mjs`
- Create: `scripts/clean-server-dist.d.mts`
- Create: `scripts/retire-legacy-reminder-tasks.mjs`
- Create: `scripts/retire-legacy-reminder-tasks.d.mts`
- Create: `apps/server/tests/server-build-clean.test.ts`
- Create: `apps/server/tests/legacy-reminder-retirement.test.ts`
- Modify: `apps/server/tests/backup-preparation.test.ts`
- Test: `apps/server/tests/generic-reminder.test.ts`
- Test: `apps/server/tests/reminder.test.ts`

**Interfaces:**
- Consumes: Existing `GenericReminderRepository` CRUD and `EmailNotificationChannel.send()`.
- Produces: Reminder API with CRUD, history, dashboard listing, and `POST /api/reminders/:id/test`; no scheduler endpoints or automatic runner entry. Before Windows development/local startup, a one-way legacy adapter retires only `\LYJWorkBench-ReminderRunner` and `\LYJWorkBench-OutboundCheckin`; other platforms are no-op.

- [ ] **Step 1: Rewrite the web test to require a manual-only reminder page**

Remove scheduler mocks from `ReminderCenterApi`, then assert the page has manual email but no scheduler control:

```tsx
expect(screen.getByRole("button", { name: "测试邮件" })).toBeVisible();
expect(screen.queryByRole("button", { name: "同步系统计划" })).not.toBeInTheDocument();
expect(screen.queryByText(/系统计划/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Add API regression assertions for removed scheduler routes**

In `apps/server/tests/generic-reminder.test.ts`, keep CRUD and manual-send assertions, and add:

```ts
await request(app).get("/api/reminder-scheduler/status").expect(404);
await request(app).post("/api/reminder-scheduler/sync").expect(404);
```

Remove assertions that reminder/calendar mutations call `scheduler.sync()`.

- [ ] **Step 3: Run the focused tests and verify the old behavior fails**

Run:

```bash
pnpm --filter @workbench/server test -- tests/generic-reminder.test.ts tests/reminder.test.ts
pnpm --filter @workbench/web test -- src/features/reminders/ReminderPage.test.tsx src/app/App.integration.test.tsx
```

Expected: FAIL because scheduler routes, controls, and dependencies still exist.

- [ ] **Step 4: Remove scheduler composition while preserving manual email**

Make `ReminderRouterDependencies` contain only:

```ts
export interface ReminderRouterDependencies {
  secretStore: SecretStore;
  channel?: NotificationChannel;
  now?: () => Date;
}
```

Delete scheduler endpoints and every `resynchronize()` call. Keep `POST /reminders/:id/test` and the SMTP-backed `EmailNotificationChannel` unchanged.

Remove scheduler fields from contracts and legacy reminder responses. Keep recurrence schemas and `nextRun`, because they drive CRUD display and future plugins.

- [ ] **Step 5: Remove automatic execution files and Windows task scripts**

Delete only the files listed above. Do not delete `reminder.schedule.ts`, `generic-reminder.repository.ts`, `email-channel.ts`, SMTP settings, or attempt history. Remove the `reminder:run` package script.

Leave old scheduler tables in existing databases as inert compatibility data in this task; dropping them is unnecessary and risks destructive migration.

Add `clean-server-dist.mjs` before the server emit command so removed runner files cannot survive in `apps/server/dist` after an upgrade. Its deletion target is fixed from the script location and it rejects every CLI argument; use an injected remover to assert the fixed target, then cover stale `reminder-entry.js` and nested runner artifacts in the actual ignored server `dist` directory.

Add the Windows-only `retire-legacy-reminder-tasks.mjs` migration. Invoke one hidden `schtasks.exe /Query /FO CSV /NH`, strictly parse the first quoted CSV field, and delete only exact matches for the two full root paths. Run it through root `predev` and `prelocal:start`. Enumeration execution/nonzero/parse failures and deletion failures are fail-closed with one fixed sanitized error; only a successful enumeration with no exact match is a no-op. Do not use PowerShell and do not create or synchronize any task.

Remove scheduled-task handling from `prepare-backup.ps1`; until Task 8 replaces it, it only verifies the loopback server is stopped and reports the data location.

- [ ] **Step 6: Update UI copy and remove scheduler CSS/API methods**

Use this heading copy:

```tsx
<p>管理提醒事项，需要时可手动发送邮件。</p>
```

Remove `SchedulerStatus`, `getReminderSchedulerStatus`, `syncReminderScheduler`, scheduler state, banner, timestamp formatter, and `.scheduler-banner` styles.

- [ ] **Step 7: Run focused verification**

Run the two commands from Step 3 plus:

```bash
pnpm --filter @workbench/server test -- tests/legacy-reminder-retirement.test.ts tests/server-build-clean.test.ts tests/backup-preparation.test.ts
pnpm --filter @workbench/server check
pnpm --filter @workbench/web check
pnpm --filter @workbench/server build
pnpm --filter @workbench/web build
git diff --check
```

Expected: focused suites PASS; scheduler endpoints return 404; manual test email remains represented in UI and tests; server build removes stale runner output and rejects target overrides; macOS retirement is a no-op; Windows enumeration is fail-closed and deletion is limited to exact historical task paths parsed from quoted CSV; backup preparation never queries Task Scheduler.

- [ ] **Step 8: Commit**

```bash
git add -A -- package.json README.md packages/contracts/src/index.ts apps/server/src/app.ts apps/server/src/index.ts apps/server/src/modules/calendar apps/server/src/modules/reminders apps/server/src/reminder-entry.ts apps/server/tests/generic-reminder.test.ts apps/server/tests/reminder.test.ts apps/server/tests/reminder-scheduler.test.ts apps/server/tests/reminder-schedule.test.ts apps/server/tests/legacy-reminder-retirement.test.ts apps/server/tests/server-build-clean.test.ts apps/server/tests/backup-preparation.test.ts apps/server/package.json apps/web/src/lib/api.ts apps/web/src/features/reminders apps/web/src/app/App.integration.test.tsx apps/web/src/styles/global.css scripts docs/superpowers/plans/2026-08-23-cross-platform-foundation.md
git commit -m "refactor: remove automatic reminder scheduling"
```

### Task 2: Add Cross-Platform Data Paths

**Files:**
- Create: `apps/server/src/platform/app-data-path.ts`
- Create: `apps/server/tests/app-data-path.test.ts`
- Modify: `apps/server/src/config/paths.ts`

**Interfaces:**
- Consumes: `NodeJS.Platform`, a read-only environment map, and a home directory string.
- Produces: `resolveDefaultDataDir(input): string` and the existing `resolveAppPaths({ dataDir? })` behavior.

- [ ] **Step 1: Write platform path tests**

```ts
expect(resolveDefaultDataDir({
  platform: "win32", environment: { LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, homeDir: "C:\\Users\\me"
})).toBe("C:\\Users\\me\\AppData\\Local\\LYJWorkBench");

expect(resolveDefaultDataDir({
  platform: "darwin", environment: {}, homeDir: "/Users/me"
})).toBe("/Users/me/Library/Application Support/LYJWorkBench");
```

Also assert Windows falls back to `APPDATA`, macOS ignores Windows variables, and unsupported platforms fail with a clear message.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @workbench/server test -- tests/app-data-path.test.ts
```

Expected: FAIL because `resolveDefaultDataDir` does not exist.

- [ ] **Step 3: Implement the path resolver**

```ts
export interface DataDirEnvironment {
  readonly LOCALAPPDATA?: string;
  readonly APPDATA?: string;
}

export function resolveDefaultDataDir(input: {
  platform: NodeJS.Platform;
  environment: DataDirEnvironment;
  homeDir: string;
}): string {
  if (input.platform === "win32") {
    const base = input.environment.LOCALAPPDATA ?? input.environment.APPDATA;
    if (!base) throw new Error("Windows application data directory is unavailable");
    return join(base, "LYJWorkBench");
  }
  if (input.platform === "darwin") return join(input.homeDir, "Library", "Application Support", "LYJWorkBench");
  throw new Error(`Unsupported platform: ${input.platform}`);
}
```

Use `homedir()`, `process.platform`, and `process.env` only at the outer `resolveAppPaths` default call.

- [ ] **Step 4: Run the path tests**

Run the command from Step 2.

Expected: PASS on Windows; all OS cases are pure injected tests and therefore run on either CI host.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/platform/app-data-path.ts apps/server/src/config/paths.ts apps/server/tests/app-data-path.test.ts
git commit -m "feat: resolve workbench data paths across platforms"
```

### Task 3: Replace the PowerShell Launcher with a Node Launcher

**Files:**
- Create: `scripts/start-local.mjs`
- Create: `apps/server/tests/start-local.test.ts`
- Modify: `package.json`
- Modify: `apps/server/package.json`
- Modify: `apps/server/tests/security-boundaries.test.ts`
- Rename: `apps/server/tsconfig.reminder.json` to `apps/server/tsconfig.runtime.json`
- Delete: `scripts/start-local.ps1`

**Interfaces:**
- Consumes: built `apps/server/dist/index.js`, built `apps/web/dist/index.html`, `--port`, and `--no-open`.
- Produces: `pnpm local:start`, identical on Windows/macOS, with validated loopback port, health verification, optional browser open, and child cleanup; retains server-level regression coverage for strict `127.0.0.1` binding, SPA/API 404 separation, and sanitized dependency failures.

- [ ] **Step 1: Write launcher behavior tests around exported pure helpers**

`scripts/start-local.mjs` must export:

```js
export function parseStartArguments(argv) {}
export function browserCommand(platform, url) {}
export function buildChildEnvironment(env, { port, instanceToken }) {}
export async function waitForOwnedHealth(input) {}
export async function runLocalLauncher(options, dependencies) {}
export async function main(argv = process.argv.slice(2)) {}
```

Assert `--port 43123`, `--no-open`, invalid ports, Windows `explorer.exe`, macOS `open`, instance-token health ownership, timeout, and child-exit failure. Add a failing environment test with `PATH`, `HOME`, `SystemRoot`, `LOCALAPPDATA`, `APPDATA`, `LYJ_SECRET_SENTINEL`, `DEEPSEEK_API_KEY`, `SMTP_PASSWORD`, and an arbitrary application variable: the result must preserve `LOCALAPPDATA` and `APPDATA` so `resolveDefaultDataDir()` can find the Windows data directory, keep only the remaining operational allowlist plus launcher-owned values, and contain none of the secret/application inputs regardless of input-key casing. Include explicit assertions equivalent to:

```ts
expect(childEnv.LOCALAPPDATA).toBe(parentEnv.LOCALAPPDATA);
expect(childEnv.APPDATA).toBe(parentEnv.APPDATA);
expect(JSON.stringify(childEnv)).not.toMatch(/LYJ_SECRET_SENTINEL|DEEPSEEK_API_KEY|SMTP_PASSWORD|must-not-reach-child/i);
```

The production spawn options must consume this returned object directly; no test or implementation may spread `process.env` into the server child.

Test `runLocalLauncher()` through injected `spawnServer`, `waitForOwnedHealth`, `openBrowser`, and signal-subscription functions. Cover all of these lifecycle failures:

```ts
await expect(runLocalLauncher(options, dependenciesWithRejectedHealth)).rejects.toThrow();
expect(exactChild.kill).toHaveBeenCalledTimes(1);
expect(openBrowser).not.toHaveBeenCalled();

await expect(runLocalLauncher(options, dependenciesWithIncumbentHealthButWrongToken)).rejects.toThrow();
expect(exactChild.kill).toHaveBeenCalledTimes(1);
expect(openBrowser).not.toHaveBeenCalled();
```

The second case represents a port collision: an incumbent `/api/health` responder returns 200 without the launched instance token while the launched child exits. Also verify `SIGINT` and `SIGTERM` terminate and await the exact spawned child, successful owned health opens the browser at most once, and `--no-open` never calls `openBrowser`.

Add an import-safety test that imports `scripts/start-local.mjs` in a short-lived Node subprocess and expects exit code 0 without binding a port or spawning the server. This test enforces the ESM main-entry guard: importing helpers must have no startup side effects.

Move only the PowerShell-launcher-specific fixture cases out of `apps/server/tests/security-boundaries.test.ts` and express their platform-neutral equivalents against these Node helpers; do not remove the server security cases from that file.

Keep the following assertions in `apps/server/tests/security-boundaries.test.ts` as permanent, launcher-independent regressions:

```ts
expect(resolveServerHost(undefined)).toBe("127.0.0.1");
expect(resolveServerHost("127.0.0.1")).toBe("127.0.0.1");
expect(() => resolveServerHost("0.0.0.0")).toThrow("HOST must be exactly 127.0.0.1");

expect(clientRoute.status).toBe(200);
expect(apiRoute.status).toBe(404);
expect(apiRoute.type).toMatch(/json/);
expect(apiRoute.body).toEqual({ error: { message: "Not Found", code: "NOT_FOUND" } });

expect(response.body).toEqual({ error: { message: "Internal Server Error", code: "INTERNAL_ERROR" } });
expect(JSON.stringify(response.body)).not.toMatch(/Bearer|api[_-]?key|smtp|server-secret|mail-secret/i);
expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(/Bearer|api[_-]?key|smtp|server-secret|mail-secret/i);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @workbench/server test -- tests/start-local.test.ts tests/security-boundaries.test.ts
```

Expected: the new launcher tests FAIL because the Node launcher does not exist, while the launcher-independent security boundary cases continue to PASS.

- [ ] **Step 3: Implement the Node launcher**

Build the child environment from a small cross-platform operational allowlist. Match inherited names case-insensitively for Windows, preserve the original matched key spelling, ignore undefined values, and then set the four launcher-owned values. This function must be the only source of `spawnOptions.env`:

```js
const CHILD_ENV_ALLOWLIST = new Set([
  "PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "LOCALAPPDATA", "APPDATA",
  "LANG", "LC_ALL", "TZ", "TERM", "COLORTERM", "NO_COLOR", "FORCE_COLOR",
]);

export function buildChildEnvironment(env, { port, instanceToken }) {
  const childEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && CHILD_ENV_ALLOWLIST.has(key.toUpperCase())) {
      childEnv[key] = value;
    }
  }
  return {
    ...childEnv,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    LYJ_WORKBENCH_INSTANCE_TOKEN: instanceToken,
  };
}

const child = spawn(process.execPath, [serverEntry], {
  cwd: projectRoot,
  env: buildChildEnvironment(process.env, { port, instanceToken }),
  stdio: "inherit",
  windowsHide: true,
});
```

`runLocalLauncher(options, dependencies)` owns exactly one child. Put cleanup in `try/finally`: on health timeout, token mismatch followed by child exit, port collision, startup error, `SIGINT`, or `SIGTERM`, terminate that child if still alive and await its `exit`/`close` event before returning or rejecting. Call the injected `openBrowser` only after the health endpoint returns the matching instance header and only when `options.openBrowser === true`; a failed or foreign health response must never open it.

Open only the fixed loopback URL. Use direct `spawn("explorer.exe", [url])` on Windows and `spawn("open", [url])` on macOS; do not use a shell. Implement the ESM entry guard so imports remain side-effect free:

```js
const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  main().catch(() => {
    console.error("Local launcher failed");
    process.exitCode = 1;
  });
}
```

- [ ] **Step 4: Update build and root scripts**

Use:

```json
{
  "local:start": "node scripts/start-local.mjs"
}
```

Rename the server emit config to describe the whole runtime and make `build` use `tsc -p tsconfig.runtime.json`.

- [ ] **Step 5: Run launcher and build tests**

Run:

```bash
pnpm --filter @workbench/server test -- tests/start-local.test.ts tests/health.test.ts tests/security-boundaries.test.ts
pnpm build
node scripts/start-local.mjs --no-open --port 43123
```

Expected: tests and build PASS, including import safety, sensitive-environment stripping, exact-child cleanup, no browser open on health failure/port collision, strict canonical loopback rejection, client-route SPA fallback with JSON `/api/*` 404 behavior, and response/log redaction of secret-bearing dependency errors; the final command prints `LYJ Workbench is ready at http://127.0.0.1:43123`. Stop it with `Ctrl+C` and verify the port no longer listens.

- [ ] **Step 6: Commit**

```bash
git add -A -- package.json apps/server/package.json apps/server/tsconfig.reminder.json apps/server/tsconfig.runtime.json apps/server/tests/start-local.test.ts apps/server/tests/security-boundaries.test.ts scripts/start-local.mjs scripts/start-local.ps1
git commit -m "feat: add cross-platform local launcher"
```

### Task 4: Implement the Portable Encrypted Vault

**Files:**
- Create: `apps/server/src/platform/secret-store.ts`
- Create: `apps/server/src/modules/vault/vault.crypto.ts`
- Create: `apps/server/src/modules/vault/vault.repository.ts`
- Create: `apps/server/src/modules/vault/vault.service.ts`
- Create: `apps/server/tests/vault.test.ts`
- Modify: `apps/server/src/db/migrations/001_init.sql`
- Modify: imports from `apps/server/src/platform/dpapi.ts` across server modules/tests

**Interfaces:**
- Produces: `SecretStore`, `VaultService.status()`, `setup(masterPassword, initialSecrets)`, `unlock(masterPassword)`, `lock()`, `protectSecret()`, and `readSecret()`.
- Consumes: one `AppPaths`, SQLite, and Node crypto.

- [ ] **Step 1: Write vault crypto and persistence tests**

Cover setup, wrong password, unlock after service recreation, secret replacement, ciphertext tamper rejection, unique nonces, empty secret rejection, and no plaintext occurrence in the raw database file.

Use injected `N = 16, r = 1, p = 1` only in unit tests. Production assembly uses `N = 65_536, r = 8, p = 1` with `maxmem = 128 * 1024 * 1024` bytes; these parameters are stored in `vault_metadata` so future upgrades do not make old databases unreadable.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @workbench/server test -- tests/vault.test.ts
```

Expected: FAIL because vault modules and tables do not exist.

- [ ] **Step 3: Add vault tables**

```sql
CREATE TABLE IF NOT EXISTS vault_metadata (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  salt BLOB NOT NULL,
  verifier_nonce BLOB NOT NULL,
  verifier_ciphertext BLOB NOT NULL,
  verifier_tag BLOB NOT NULL,
  scrypt_n INTEGER NOT NULL,
  scrypt_r INTEGER NOT NULL,
  scrypt_p INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vault_secrets (
  name TEXT PRIMARY KEY,
  nonce BLOB NOT NULL,
  ciphertext BLOB NOT NULL,
  auth_tag BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- [ ] **Step 4: Implement crypto primitives**

Expose no raw key outside this module:

```ts
export async function deriveVaultKey(password: string, params: ScryptParameters): Promise<Buffer>;
export function encryptVaultValue(key: Buffer, plaintext: Buffer): EncryptedValue;
export function decryptVaultValue(key: Buffer, value: EncryptedValue): Buffer;
```

Use a 32-byte key, 16-byte salt, 12-byte GCM nonce, and a fixed versioned verifier plaintext. Convert authentication failures to `InvalidMasterPasswordError` during unlock and `VaultIntegrityError` for stored secrets.

- [ ] **Step 5: Implement repository and in-memory service lifecycle**

The service owns only the derived key in memory. `lock()` fills the key buffer with zeroes before dropping it. `protectSecret` and `readSecret` throw `VaultLockedError` unless unlocked. `setup()` inserts metadata and initial secrets in one SQLite transaction.

- [ ] **Step 6: Move the shared interface out of DPAPI**

```ts
export interface SecretStore {
  protectSecret(name: string, plaintext: string): Promise<void>;
  readSecret(name: string): Promise<string | null>;
}
```

Update consumers to import from `platform/secret-store.ts`. Do not delete DPAPI implementation until Task 6 imports legacy values.

- [ ] **Step 7: Run vault and existing provider tests**

Run:

```bash
pnpm --filter @workbench/server test -- tests/vault.test.ts tests/settings.test.ts tests/ai-chat.test.ts tests/ai-polish.test.ts tests/daily-report.test.ts
```

Expected: PASS; provider tests continue using injected in-memory stores.

- [ ] **Step 8: Commit**

```bash
git add -- apps/server/src/platform/secret-store.ts apps/server/src/modules/vault apps/server/src/db/migrations/001_init.sql apps/server/tests/vault.test.ts apps/server/src/modules/settings apps/server/src/modules/reminders/email-channel.ts apps/server/src/modules/daily-reports apps/server/src/modules/ai-polish apps/server/src/modules/ai-chat apps/server/tests
git commit -m "feat: add portable encrypted secret vault"
```

### Task 5: Add Vault Setup and Unlock UX

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/modules/vault/vault.routes.ts`
- Create: `apps/server/tests/vault-api.test.ts`
- Modify: `apps/server/src/app.ts`
- Create: `apps/web/src/features/vault/VaultGate.tsx`
- Create: `apps/web/src/features/vault/VaultGate.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: the singleton `VaultService` created once by `createApp`.
- Produces: `GET /api/vault/status`, `POST /api/vault/setup`, `POST /api/vault/unlock`, `POST /api/vault/lock`, and a front-end gate.

- [ ] **Step 1: Add failing API tests**

Assert:

```ts
await request(app).get("/api/vault/status").expect(200, { configured: false, unlocked: false });
await request(app).post("/api/vault/setup").send({ masterPassword: "correct horse battery staple" }).expect(201);
await request(app).post("/api/vault/lock").expect(204);
await request(app).post("/api/vault/unlock").send({ masterPassword: "wrong password" }).expect(401);
```

Also assert that five consecutive failed unlocks cause a 30-second in-memory cooldown and that responses never contain verifier/ciphertext fields. Successful unlock resets the failure counter; restarting the local server clears only the cooldown, not vault encryption.

- [ ] **Step 2: Add failing UI tests**

Require setup when unconfigured, unlock when configured but locked, confirmation input during setup, visible wrong-password error, and app rendering after successful unlock.

- [ ] **Step 3: Run API and UI tests to verify failure**

Run:

```bash
pnpm --filter @workbench/server test -- tests/vault-api.test.ts
pnpm --filter @workbench/web test -- src/features/vault/VaultGate.test.tsx
```

Expected: FAIL because routes and gate do not exist.

- [ ] **Step 4: Add contracts and routes**

```ts
export const VaultStatusSchema = z.object({ configured: z.boolean(), unlocked: z.boolean() });
export const VaultSetupInputSchema = z.object({ masterPassword: z.string().min(12).max(1024) });
export const VaultUnlockInputSchema = VaultSetupInputSchema;
```

Create the vault service once in `createApp`, pass it to vault routes and as the default `SecretStore` for settings, AI, and SMTP consumers.

- [ ] **Step 5: Implement `VaultGate`**

Wrap `Shell` with a gate that loads status first. The gate must not render routes that immediately read secrets until setup/unlock succeeds. Keep the derived key only in the server process; the browser sends the password only to the loopback vault endpoint over the existing same-origin API.

- [ ] **Step 6: Run focused tests**

Run the commands from Step 3 plus:

```bash
pnpm --filter @workbench/server test -- tests/settings.test.ts tests/ai-chat.test.ts
pnpm --filter @workbench/web test -- src/features/settings/SettingsPage.test.tsx src/app/App.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -- packages/contracts/src/index.ts apps/server/src/modules/vault apps/server/src/app.ts apps/server/tests/vault-api.test.ts apps/web/src/features/vault apps/web/src/app/App.tsx apps/web/src/lib/api.ts apps/web/src/styles/global.css
git commit -m "feat: add portable vault setup and unlock"
```

### Task 6: Import Legacy Windows DPAPI Secrets Once

**Files:**
- Rename: `apps/server/src/platform/dpapi.ts` to `apps/server/src/platform/legacy-windows-dpapi.ts`
- Create: `apps/server/src/modules/vault/legacy-secret-import.ts`
- Create: `apps/server/tests/legacy-secret-import.test.ts`
- Modify: `apps/server/src/modules/vault/vault.routes.ts`
- Modify: `apps/web/src/features/vault/VaultGate.tsx`
- Modify: `apps/web/src/features/vault/VaultGate.test.tsx`

**Interfaces:**
- Consumes: legacy blob directory, platform, and the known names `deepseek-api-key` and `smtp-password`.
- Produces: `readLegacySecrets(): Promise<Record<string, string>>` used only before the first vault setup transaction.

- [ ] **Step 1: Write platform and atomicity tests**

Assert macOS returns no legacy secrets without spawning a process. On Windows, inject a fake importer and assert both known values enter `setup(masterPassword, initialSecrets)` in one call. If either legacy read fails, assert no vault metadata or secrets are written.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @workbench/server test -- tests/legacy-secret-import.test.ts
```

Expected: FAIL because the importer does not exist.

- [ ] **Step 3: Restrict the legacy implementation**

Move the current PowerShell/DPAPI code unchanged behind:

```ts
export interface LegacySecretImporter {
  readAvailableSecrets(): Promise<Record<string, string>>;
}
```

Instantiate it only when `process.platform === "win32"` and legacy blob files exist. It must never be the default `SecretStore`.

- [ ] **Step 4: Integrate setup and UI disclosure**

Before first setup, read all legacy plaintext into memory. If successful, pass it to the single vault setup transaction and zero temporary buffers/references afterward. Show “检测到旧版 Windows 密钥，将在设置主密码后迁移” without displaying secret values.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @workbench/server test -- tests/legacy-secret-import.test.ts tests/vault.test.ts tests/vault-api.test.ts
pnpm --filter @workbench/web test -- src/features/vault/VaultGate.test.tsx
```

Expected: PASS on Windows; platform-injected unit cases also cover macOS behavior.

- [ ] **Step 6: Commit**

```bash
git add -A -- apps/server/src/platform/dpapi.ts apps/server/src/platform/legacy-windows-dpapi.ts apps/server/src/modules/vault apps/server/tests/legacy-secret-import.test.ts apps/web/src/features/vault
git commit -m "feat: migrate legacy DPAPI secrets into portable vault"
```

### Task 7: Store Profile Photos Inside SQLite

**Files:**
- Modify: `apps/server/src/db/migrations/001_init.sql`
- Modify: `apps/server/src/db/database.ts`
- Modify: `apps/server/src/modules/profile/profile.repository.ts`
- Modify: `apps/server/src/modules/profile/profile.routes.ts`
- Modify: `apps/server/tests/profile.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/profile/ProfileCard.tsx`
- Modify: `apps/web/src/features/profile/ProfileCard.test.tsx`

**Interfaces:**
- Consumes: existing `photo_filename` and `uploads` folder only for one-time migration.
- Produces: profile photo BLOB and MIME type in SQLite, stable `GET /api/profile/photo` endpoint, and no authoritative upload file.

- [ ] **Step 1: Rewrite profile tests for database-backed photos**

After upload, assert the response exposes a stable photo URL/version and that a fresh app instance serves the bytes from SQLite even after the source upload directory is absent. Add a migration test that starts with an old filename plus file, opens the database, and verifies the BLOB was imported.

- [ ] **Step 2: Run the profile test and verify it fails**

Run:

```bash
pnpm --filter @workbench/server test -- tests/profile.test.ts
```

Expected: FAIL because photos are still filesystem-authoritative.

- [ ] **Step 3: Add profile BLOB columns and migration**

Add nullable `photo_blob BLOB`, `photo_mime TEXT`, and `photo_version INTEGER NOT NULL DEFAULT 0`. In an idempotent migration, import a safely resolved legacy file only when `photo_blob IS NULL`; update the row in a transaction. Never delete the legacy file during the migration.

- [ ] **Step 4: Replace filename repository methods**

```ts
setPhoto(photo: { bytes: Buffer; mimeType: string }): ProfileResponse;
getPhoto(): { bytes: Buffer; mimeType: string; version: number } | null;
```

Replace `ProfileResponse.photoFilename` with `photoVersion: number | null`. The web client renders `/api/profile/photo?v=${photoVersion}` when non-null. Serve `GET /api/profile/photo` with the stored MIME type, `ETag` derived from version, `nosniff`, and no filesystem path parameter. Keep the 5 MB and image signature checks.

- [ ] **Step 5: Run profile and web profile tests**

Run:

```bash
pnpm --filter @workbench/server test -- tests/profile.test.ts
pnpm --filter @workbench/web test -- src/features/profile/ProfileCard.test.tsx src/app/App.integration.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -- packages/contracts/src/index.ts apps/server/src/db apps/server/src/modules/profile apps/server/tests/profile.test.ts apps/web/src/lib/api.ts apps/web/src/features/profile apps/web/src/app/App.integration.test.tsx
git commit -m "feat: store profile photos in sqlite"
```

### Task 8: Add Portable Backup Verification and Dual-Platform CI

**Files:**
- Create: `apps/server/src/modules/backup/backup.service.ts`
- Create: `apps/server/src/modules/backup/backup.routes.ts`
- Create: `apps/server/tests/backup.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Delete: `scripts/prepare-backup.ps1`
- Delete: `apps/server/tests/backup-preparation.test.ts`
- Create: `.github/workflows/cross-platform.yml`
- Modify: `README.md`

**Interfaces:**
- Produces: `POST /api/backup/export` returning one consistent SQLite backup download and a Settings-page action.
- Consumes: `better-sqlite3` backup support and current `AppPaths.databasePath`.

- [ ] **Step 1: Write a backup integration test**

Create live profile/settings/reminder records, call the export endpoint, open the downloaded database with `better-sqlite3`, and assert `PRAGMA integrity_check` returns `ok` plus the inserted rows. Assert the source database remains usable after export.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
pnpm --filter @workbench/server test -- tests/backup.test.ts
```

Expected: FAIL because the portable export endpoint does not exist.

- [ ] **Step 3: Implement safe SQLite export**

Use SQLite's online backup API to a unique temporary file, validate the copy, stream it as `LYJWorkBench-backup-YYYY-MM-DD.sqlite`, and remove only that exact temporary file after response completion. Do not shell out and do not stop the application.

- [ ] **Step 4: Add the Settings UI**

Add a “备份与迁移” section with one “导出数据库” button and copy that states the exported file contains profile data, encrypted secrets, settings, reminders, and history. Do not claim plaintext secrets are readable without the master password.

- [ ] **Step 5: Add Windows/macOS CI matrix**

```yaml
strategy:
  matrix:
    os: [windows-latest, macos-latest]
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: 22
      cache: pnpm
  - run: corepack enable
  - run: pnpm install --frozen-lockfile
  - run: pnpm check
  - run: pnpm test
  - run: pnpm build
```

No PowerShell-specific test may remain in the normal matrix.

- [ ] **Step 6: Rewrite README startup, storage, backup, and security sections**

Document the same four commands for both platforms, both data paths, vault unlock behavior, one-file export/import, retained SMTP/manual email, and the absence of automatic reminder delivery.

- [ ] **Step 7: Run phase verification**

Run:

```bash
pnpm --filter @workbench/server test -- tests/security-boundaries.test.ts
pnpm test
pnpm check
pnpm build
git diff --check
rg -n -i "powershell|\.ps1|\.vbs|wscript|scheduledtask|windows task scheduler" apps packages scripts package.json README.md --glob '!**/legacy-windows-dpapi.ts'
```

Expected: the focused security suite first proves canonical `127.0.0.1` binding, SPA/API 404 separation, and response/log secret redaction; all tests/check/build PASS; diff check is clean; the final search finds no runtime dependency outside the explicitly named one-time legacy importer documentation/code.

- [ ] **Step 8: Commit**

```bash
git add -A -- .github/workflows/cross-platform.yml README.md apps/server/src/modules/backup apps/server/src/app.ts apps/server/tests/backup.test.ts apps/server/tests/backup-preparation.test.ts apps/web/src/lib/api.ts apps/web/src/features/settings scripts/prepare-backup.ps1 docs/superpowers
git commit -m "feat: establish cross-platform workbench foundation"
```

## Phase Completion Gate

Before starting the plugin-kernel plan:

1. Run the full Task 8 verification on Windows.
2. Require the macOS CI job to pass install, test, check, build, launcher helper tests, `security-boundaries.test.ts`, vault tests, database migration tests, and backup tests.
3. Manually move an exported test database from one platform to the other, unlock it with the same master password, and verify AI/SMTP configured state without sending a real model request or email.
4. Verify reminder CRUD and manual test-send remain visible while scheduler controls and automatic runner artifacts are absent.
5. Record any intentionally retained Windows-only code as legacy import code with no normal-runtime call path.
