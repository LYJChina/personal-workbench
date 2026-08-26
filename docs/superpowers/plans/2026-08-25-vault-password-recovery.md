# Vault Password Change and SMTP Recovery Implementation Plan

> **For Codex:** Execute this plan with `superpowers:test-driven-development`; use `superpowers:verification-before-completion` before claiming completion. Preserve the existing uncommitted multi-provider gateway work and stage only the files named by each task.

**Goal:** Add transactional master-password changes, one-time emailed recovery codes, SMTP-credential recovery, non-blocking SMTP health warnings, and safe lazy migration from the existing vault format.

**Architecture:** Upgrade the vault to envelope encryption: a random 32-byte DEK encrypts secrets and three independently derived KEKs may wrap that DEK (`password`, `recovery`, `smtp_recovery`). SQL migration 006 only adds v2 storage; the first successful v1 unlock performs the cryptographic conversion inside one SQLite transaction. Recovery mail and SMTP authentication are injected services so tests never contact real providers.

**Tech Stack:** TypeScript, Node crypto (`scrypt`, AES-256-GCM), Express, better-sqlite3, Nodemailer, React 19, Zod, Vitest, Testing Library.

---

## Provider boundary

- Ship editable presets for Gmail (`smtp.gmail.com:465`, TLS), QQ (`smtp.qq.com:465`, TLS), NetEase 163 (`smtp.163.com:465`, TLS), and Custom. Every preset must pass the existing server-side `transport.verify()` before setup or credential rotation.
- Do not ship an Outlook password preset in this phase. Microsoft's Outlook.com SMTP documentation requires Modern Auth/OAuth2; the current feature accepts SMTP authorization codes and Nodemailer username/password authentication.
- A preset is convenience data, not a trust decision. The submitted host, port, mode, username, sender, and authorization code are validated and tested by the backend.

## Task 1: Add contracts and migration 006

**Files:**
- Create: `apps/server/src/db/migrations/006_vault_recovery.sql`
- Modify: `apps/server/src/db/database.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `apps/server/tests/database.test.ts`
- Test: `packages/contracts/src/vault-recovery.test.ts`

**Step 1 — RED:** Add contract tests for the exact public shapes:

```ts
expect(VaultRecoveryStatusSchema.parse({
  state: "active", maskedEmail: "l***@example.com", smtpHealth: "valid", checkedAt: null
})).toEqual(expect.objectContaining({ state: "active" }));
expect(() => VaultRecoveryCodeResetInputSchema.parse({ recoveryCode: "short", newPassword: "short" })).toThrow();
expect(() => VaultSmtpResetInputSchema.parse({ smtpEmail: "x@example.com", smtpPassword: "", newPassword: "123456789012" })).toThrow();
```

Add a database test expecting schema version `6` and tables `vault_key_wrappers` and `vault_recovery`.

Run: `pnpm --filter @workbench/contracts test -- vault-recovery.test.ts && pnpm --filter @workbench/server test -- database.test.ts`
Expected: FAIL because schemas and migration 006 do not exist.

**Step 2 — GREEN:** Add these schemas/types to contracts:

```ts
const MasterPasswordSchema = z.string().min(12).max(1024);
export const VaultRecoveryStateSchema = z.enum(["disabled", "pending", "active"]);
export const SmtpHealthSchema = z.enum(["unknown", "valid", "invalid", "unreachable"]);
export const VaultRecoveryStatusSchema = z.object({
  state: VaultRecoveryStateSchema,
  maskedEmail: z.string().nullable(),
  smtpHealth: SmtpHealthSchema,
  checkedAt: z.string().datetime().nullable()
});
export const VaultChangePasswordInputSchema = z.object({ currentPassword: MasterPasswordSchema, newPassword: MasterPasswordSchema });
export const VaultRecoveryCodeResetInputSchema = z.object({ recoveryCode: z.string().min(20).max(200), newPassword: MasterPasswordSchema });
export const VaultSmtpResetInputSchema = z.object({ smtpEmail: z.string().email(), smtpPassword: z.string().min(1).max(1024), newPassword: MasterPasswordSchema });
export const VaultConfirmRecoveryInputSchema = z.object({ confirmationCode: z.string().regex(/^\d{6}$/) });
```

Extend setup input with `masterPassword`, `provider`, full mail settings, `smtpPassword`, and `recoveryEmail`. Add response/error-facing types only; never expose wrapper fields or recovery-code text.

Create migration 006 with:

```sql
ALTER TABLE vault_metadata ADD COLUMN format_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE vault_key_wrappers (
  kind TEXT PRIMARY KEY CHECK (kind IN ('password','recovery','smtp_recovery')),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  salt BLOB NOT NULL, kdf_n INTEGER NOT NULL, kdf_r INTEGER NOT NULL,
  kdf_p INTEGER NOT NULL, kdf_maxmem INTEGER NOT NULL,
  nonce BLOB NOT NULL, ciphertext BLOB NOT NULL, auth_tag BLOB NOT NULL,
  active INTEGER NOT NULL CHECK (active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE vault_recovery (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT, state TEXT NOT NULL DEFAULT 'disabled' CHECK (state IN ('disabled','pending','active')),
  confirmation_digest BLOB, confirmation_expires_at TEXT, confirmation_attempts INTEGER NOT NULL DEFAULT 0,
  resend_available_at TEXT, smtp_health TEXT NOT NULL DEFAULT 'unknown' CHECK (smtp_health IN ('unknown','valid','invalid','unreachable')),
  smtp_checked_at TEXT, generation INTEGER NOT NULL DEFAULT 0
);
INSERT INTO vault_recovery (id) VALUES (1);
```

Register version 6 in `database.ts` and set `currentSchemaVersion = 6`.

**Step 3:** Re-run the two tests; expected PASS.

**Step 4:** Commit only Task 1 files:

```powershell
git add apps/server/src/db/migrations/006_vault_recovery.sql apps/server/src/db/database.ts apps/server/tests/database.test.ts packages/contracts/src/index.ts packages/contracts/src/vault-recovery.test.ts
git commit -m "feat: add vault recovery storage contracts"
```

## Task 2: Build wrapper and recovery-code cryptography

**Files:**
- Modify: `apps/server/src/modules/vault/vault.crypto.ts`
- Create: `apps/server/src/modules/vault/vault-recovery.crypto.ts`
- Test: `apps/server/tests/vault-recovery-crypto.test.ts`

**Step 1 — RED:** Test deterministic normalization, 160-bit minimum entropy, wrapper round trips, wrong-secret failures, and buffer clearing hooks:

```ts
const code = generateRecoveryCode();
expect(code.display).toMatch(/^LYJ(?:-[A-Z2-9]{4}){8}$/);
expect(code.entropy.length).toBeGreaterThanOrEqual(20);
const wrapped = await wrapDek(dek, "secret", scryptOptions, "recovery", 1);
expect(await unwrapDek(wrapped, "secret", "recovery")).toEqual(dek);
await expect(unwrapDek(wrapped, "wrong", "recovery")).rejects.toThrow(InvalidRecoveryMaterialError);
expect(normalizeSmtpIdentity(" User@Example.COM ", " code ")).toBe("user@example.com\0code");
```

Run: `pnpm --filter @workbench/server test -- vault-recovery-crypto.test.ts`
Expected: FAIL because the module does not exist.

**Step 2 — GREEN:** Implement:

```ts
export type WrapperKind = "password" | "recovery" | "smtp_recovery";
export interface DekWrapper extends EncryptedValue {
  kind: WrapperKind; generation: number; salt: Buffer; scrypt: VaultScryptOptions;
}
export function generateDek(): Buffer;
export function generateRecoveryCode(): { display: string; entropy: Buffer };
export function normalizeRecoveryCode(value: string): string;
export function normalizeSmtpIdentity(email: string, authorizationCode: string): string;
export async function wrapDek(dek: Buffer, material: string, scrypt: VaultScryptOptions, kind: WrapperKind, generation: number): Promise<DekWrapper>;
export async function unwrapDek(wrapper: DekWrapper, material: string, expectedKind: WrapperKind): Promise<Buffer>;
```

Use type-and-generation-specific AAD (`lyj-vault-wrapper:${kind}:v${generation}`), independent 16-byte salts, existing scrypt parameter validation, AES-256-GCM, constant-shaped errors, and `finally { buffer.fill(0) }` for transient buffers.

**Step 3:** Re-run test; expected PASS.

**Step 4:** Commit Task 2 files with `git commit -m "feat: add vault key wrapper cryptography"`.

## Task 3: Add v2 repository operations and lazy v1 migration

**Files:**
- Modify: `apps/server/src/modules/vault/vault.repository.ts`
- Modify: `apps/server/src/modules/vault/vault.service.ts`
- Modify: `apps/server/src/modules/vault/vault.errors.ts`
- Test: `apps/server/tests/vault.test.ts`

**Step 1 — RED:** Extend vault tests to prove:

1. New setup stores `format_version = 2`, a password wrapper, and secrets encrypted by a DEK.
2. Existing v1 database unlocks with the old password and becomes v2.
3. Injected failure after the first secret re-encryption rolls back metadata, every secret, and wrappers.
4. Wrong old password performs no migration.

Add an explicit repository fault hook in test options instead of monkey-patching SQLite:

```ts
const vault = new VaultService(database, { scrypt: fastScrypt, migrationFault: "after-first-secret" });
await expect(vault.unlock("correct old password")).rejects.toThrow();
expect(readFormatVersion(database)).toBe(1);
```

Run: `pnpm --filter @workbench/server test -- vault.test.ts`
Expected: FAIL on v2 expectations.

**Step 2 — GREEN:** Add repository APIs:

```ts
readFormatVersion(): 1 | 2;
readWrapper(kind: WrapperKind, activeOnly?: boolean): DekWrapper | null;
replaceWrapper(wrapper: DekWrapper): void;
readAllSecrets(): ReadonlyMap<string, EncryptedValue>;
migrateV1ToV2(input: { metadata: VaultMetadata; passwordWrapper: DekWrapper; verifier: EncryptedValue; secrets: ReadonlyMap<string, EncryptedValue> }): void;
runTransaction<T>(operation: () => T): T;
```

Change in-memory `key` semantics to always mean DEK for format 2. On v1 unlock, derive the legacy key, verify it, decrypt all secrets, generate a DEK, re-encrypt verifier/secrets, wrap the DEK with the supplied password, and commit all changes in one transaction. Clear legacy key, plaintext buffers, and discarded DEK on every exit path.

**Step 3:** Re-run `vault.test.ts`; expected PASS.

**Step 4:** Commit Task 3 files with `git commit -m "feat: migrate vault to envelope encryption"`.

## Task 4: Implement password changes and both recovery transactions

**Files:**
- Create: `apps/server/src/modules/vault/vault-recovery.service.ts`
- Modify: `apps/server/src/modules/vault/vault.service.ts`
- Modify: `apps/server/src/modules/vault/vault.repository.ts`
- Test: `apps/server/tests/vault-recovery.test.ts`

**Step 1 — RED:** Add service tests for:

- current password required; success invalidates old password but preserves the unlocked session and all secret values;
- database fault leaves the old password valid;
- recovery code works exactly once;
- SMTP recovery requires both online auth and local wrapper decryption;
- a rotated/revoked SMTP authorization code fails without revealing which check failed;
- successful recovery forces a new password wrapper;
- failed replacement-email delivery leaves new password valid, old recovery code invalid, and state `disabled`.

Use injected fakes:

```ts
const recovery = new VaultRecoveryService({ vault, repositoryProvider, mailer: fakeMailer, smtpVerifier: fakeVerifier, clock: fakeClock });
await recovery.resetWithRecoveryCode({ recoveryCode, newPassword });
await expect(recovery.resetWithRecoveryCode({ recoveryCode, newPassword: another })).rejects.toThrow(InvalidRecoveryMaterialError);
```

Run: `pnpm --filter @workbench/server test -- vault-recovery.test.ts`
Expected: FAIL because service does not exist.

**Step 2 — GREEN:** Implement public methods:

```ts
changePassword(currentPassword: string, newPassword: string): Promise<void>;
resetWithRecoveryCode(input: RecoveryCodeReset): Promise<void>;
resetWithSmtp(input: SmtpReset): Promise<void>;
recoveryStatus(): VaultRecoveryStatus;
```

Password changes replace only the password wrapper. Code recovery unwraps DEK, replaces password wrapper, deactivates the used recovery wrapper, increments generation, commits security state, then sends/activates the replacement recovery wrapper. If mail fails, commit `disabled`; never reactivate the used wrapper. SMTP recovery calls `smtpVerifier` first, then unwraps with normalized email+authorization code, and commits password wrapper + encrypted SMTP secret + new SMTP wrapper atomically.

**Step 3:** Re-run test; expected PASS.

**Step 4:** Commit Task 4 files with `git commit -m "feat: add vault password and recovery transactions"`.

## Task 5: Create recovery mail, provider presets, enrollment, and SMTP health

**Files:**
- Create: `apps/server/src/modules/mail/mail-transport.ts`
- Create: `apps/server/src/modules/vault/vault-enrollment.service.ts`
- Modify: `apps/server/src/modules/settings/settings.routes.ts`
- Modify: `apps/server/src/modules/settings/settings.repository.ts`
- Modify: `apps/server/src/modules/vault/vault.service.ts`
- Test: `apps/server/tests/vault-enrollment.test.ts`
- Test: `apps/server/tests/settings.test.ts`
- Create: `apps/web/src/features/vault/smtpPresets.ts`
- Test: `apps/web/src/features/vault/smtpPresets.test.ts`

**Step 1 — RED:** Test that setup verifies SMTP before persisting, sends one mail containing both codes, stores no plaintext codes, leaves state `pending`, confirms only with the six-digit code, and handles resend expiry/cooldown. Test health mapping: `EAUTH => invalid`; timeout/network => `unreachable`; success => `valid`. Test preset values and that selecting Custom leaves fields editable.

Run: `pnpm --filter @workbench/server test -- vault-enrollment.test.ts settings.test.ts && pnpm --filter @workbench/web test -- smtpPresets.test.ts`
Expected: FAIL.

**Step 2 — GREEN:** Extract reusable Nodemailer transport creation from settings routes:

```ts
export interface MailTransportConfig { smtpHost: string; smtpPort: number; transportMode: "starttls" | "tls"; smtpUsername: string; fromAddress: string; }
export async function verifyMailTransport(config: MailTransportConfig, password: string, signal?: AbortSignal): Promise<void>;
export async function sendRecoveryMail(config: MailTransportConfig, password: string, input: { to: string; recoveryCode: string; confirmationCode: string }, signal?: AbortSignal): Promise<void>;
```

Enrollment generates a long recovery code and six-digit confirmation code using `randomInt(0, 1_000_000)`, stores only an HMAC/digest of the confirmation code plus expiry, stores the inactive recovery wrapper, encrypts the SMTP password under the DEK, creates the SMTP wrapper, and sends the plaintext code exactly once from an in-memory buffer that is cleared afterward. Confirmation activates the recovery wrapper. Resend replaces only the confirmation digest/code; it does not rotate the pending recovery code.

SMTP settings updates that change username/password must require `currentPassword` and call one transaction that writes settings, encrypted password, and `smtp_recovery` wrapper. Keep the existing mail test endpoint.

Add client presets:

```ts
export const smtpPresets = {
  gmail: { host: "smtp.gmail.com", port: 465, transportMode: "tls" },
  qq: { host: "smtp.qq.com", port: 465, transportMode: "tls" },
  netease163: { host: "smtp.163.com", port: 465, transportMode: "tls" },
  custom: null
} as const;
```

**Step 3:** Re-run tests; expected PASS.

**Step 4:** Commit Task 5 files with `git commit -m "feat: enroll email recovery and monitor smtp"`.

## Task 6: Expose protected HTTP APIs and cooldowns

**Files:**
- Modify: `apps/server/src/modules/vault/vault.routes.ts`
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/tests/vault-api.test.ts`
- Test: `apps/server/tests/security-boundaries.test.ts`

**Step 1 — RED:** Add API tests for:

```text
POST /api/vault/setup
POST /api/vault/recovery/confirm
GET  /api/vault/recovery/status
PUT  /api/vault/password
POST /api/vault/recovery/code-reset
POST /api/vault/recovery/smtp-reset
POST /api/vault/recovery/resend
POST /api/vault/recovery/rotate
```

Assert exact fixed error codes, origin protection, serialized lifecycle mutations, five-failure cooldown using an injected monotonic clock, masked email only, and absence of `recoveryCode`, SMTP password, DEK, wrapper ciphertext, Nodemailer response text, and stack traces in all JSON/log captures.

Run: `pnpm --filter @workbench/server test -- vault-api.test.ts security-boundaries.test.ts`
Expected: FAIL on missing routes.

**Step 2 — GREEN:** Extend the existing serialized router and shared cooldown tracker. Return `204` for successful mutations, `201` for initial setup, and only `VaultRecoveryStatusSchema` for status. Map errors to:

```text
INVALID_RECOVERY_MATERIAL
SMTP_RECOVERY_UNAVAILABLE
INVALID_MASTER_PASSWORD
CONFIRMATION_CODE_INVALID
CONFIRMATION_CODE_EXPIRED
TOO_MANY_ATTEMPTS
RECOVERY_MAIL_FAILED
VAULT_INTEGRITY_ERROR
```

Trigger SMTP health verification after successful normal unlock without awaiting it; catch all errors and persist the classified health result. Do not delay or reverse the `204` unlock response.

**Step 3:** Re-run tests; expected PASS.

**Step 4:** Commit Task 6 files with `git commit -m "feat: expose secure vault recovery api"`.

## Task 7: Build setup, confirmation, and locked recovery UI

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/features/vault/VaultGate.tsx`
- Modify: `apps/web/src/features/vault/VaultGate.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Step 1 — RED:** Add accessible UI tests that cover:

- first setup fields, preset auto-fill, editable custom fields, and password confirmation;
- pending confirmation survives a remount and supports resend;
- locked screen switches between normal password, long-code recovery, and SMTP recovery;
- both recovery forms require new password confirmation before submit;
- SMTP auth code and recovery code use password inputs and are cleared after success/failure;
- no recovery code is ever rendered from an API response.

Run: `pnpm --filter @workbench/web test -- VaultGate.test.tsx`
Expected: FAIL.

**Step 2 — GREEN:** Add typed API methods matching Task 6. Refactor `VaultGate` into local views (`setup`, `confirm`, `unlock`, `recover-code`, `recover-smtp`) while keeping the outer gate responsible for status refresh. Use autocomplete values `new-password`, `current-password`, and `off` for recovery material. Present fixed Chinese messages from error codes, not server internals.

**Step 3:** Re-run test; expected PASS.

**Step 4:** Commit Task 7 files with `git commit -m "feat: add vault enrollment and recovery screens"`.

## Task 8: Add Account & Security management and global SMTP warning

**Files:**
- Create: `apps/web/src/features/settings/AccountSecurityPanel.tsx`
- Create: `apps/web/src/features/settings/AccountSecurityPanel.test.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.tsx`
- Modify: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/app/App.integration.test.tsx`
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/styles/global.css`

**Step 1 — RED:** Test password change, masked recovery email/status, resend, rotate, and recovery-email replacement all require current password where specified. Add app integration tests showing:

- `invalid`: persistent “SMTP 授权已失效，请更新” banner linking to settings;
- `unreachable`: softer “暂时无法检测 SMTP” message;
- `valid`: no warning;
- none of these blocks navigation or vault unlock.

Run: `pnpm --filter @workbench/web test -- AccountSecurityPanel.test.tsx SettingsPage.test.tsx App.integration.test.tsx`
Expected: FAIL.

**Step 2 — GREEN:** Add `AccountSecurityPanel` above mail settings. Load recovery status once after unlock and refresh it after security actions. Keep SMTP configuration in the existing mail section; explain that it is shared by recovery and manual mail. Require current password when rotating recovery or changing recovery email and clear all password fields in `finally`.

**Step 3:** Re-run tests; expected PASS.

**Step 4:** Commit Task 8 files with `git commit -m "feat: add account security management ui"`.

## Task 9: Document migration, verify portability, and finish safely

**Files:**
- Modify: `README.md`
- Modify: `docs/PLUGIN_DEVELOPMENT.md` if it exists; otherwise modify the existing plugin developer guide found by `rg --files docs | rg -i 'plugin'`
- Modify: `.github/workflows/cross-platform.yml`
- Test: `apps/server/tests/plugin-security.test.ts`
- Test: `apps/server/tests/backup.test.ts`
- Test: `apps/server/tests/ci-workflow.test.ts`

**Step 1 — RED:** Extend tests to assert recovery tables/wrappers are absent from plugin DB capabilities and API responses, database exports retain wrappers without plaintext material, and CI runs the vault recovery suite on both `windows-latest` and `macos-latest`.

Run: `pnpm --filter @workbench/server test -- plugin-security.test.ts backup.test.ts ci-workflow.test.ts`
Expected: FAIL until documentation/workflow/security allowlists are updated.

**Step 2 — GREEN:** Document setup, recovery failure modes, database migration, Gmail app-password prerequisite, editable QQ/163 presets, Custom SMTP, and Outlook OAuth exclusion. Explicitly state that copying the SQLite database preserves recovery wrappers, but recovery still requires the independent password, active long code, or unchanged valid SMTP authorization code.

**Step 3 — focused verification:**

```powershell
pnpm --filter @workbench/contracts test
pnpm --filter @workbench/server test -- vault-recovery-crypto.test.ts vault.test.ts vault-recovery.test.ts vault-enrollment.test.ts vault-api.test.ts security-boundaries.test.ts
pnpm --filter @workbench/web test -- VaultGate.test.tsx AccountSecurityPanel.test.tsx SettingsPage.test.tsx App.integration.test.tsx
```

Expected: all PASS, no skipped recovery tests except explicit live-provider tests (which must not run in CI).

**Step 4 — complete verification:**

```powershell
pnpm test
pnpm check
pnpm build
git diff --check
git status --short
```

Expected: all commands exit 0; `git diff --check` prints nothing. Review `git status` and stage only Task 9 files, leaving unrelated pre-existing changes untouched.

**Step 5:** Commit Task 9 files with `git commit -m "docs: document portable vault recovery"`.

**Step 6:** Push `codex/microkernel`, wait for the cross-platform workflow, and require green Windows and macOS jobs before merge. If either fails, use `superpowers:systematic-debugging`; do not increase timeouts without identifying the blocked operation.

---

## Execution notes

- Use fast scrypt settings only through test dependency injection; production wrappers always use the validated production parameters.
- Never email, log, snapshot, return, or render plaintext recovery codes outside the one intended recovery email.
- Do not allow plugins to query `vault_metadata`, `vault_key_wrappers`, `vault_recovery`, or `vault_secrets`.
- Preserve current SMTP settings as the single source of truth. There must not be a second SMTP configuration table.
- Live SMTP tests are manual opt-in tests and must never be required for normal CI.
- Because the working tree already contains uncommitted AI gateway work, every commit command must use the explicit file list shown in its task.
