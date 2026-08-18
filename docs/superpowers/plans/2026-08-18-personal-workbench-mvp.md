# Personal Workbench MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-only, local-first personal workbench with an editable dashboard, personal profile, secure DeepSeek settings, AI-assisted daily reports, theme switching, and a Monday email reminder that runs while the web page is closed.

**Architecture:** A pnpm workspace contains a React/Vite browser UI, an Express TypeScript local server, and a shared Zod contracts package. The server owns SQLite, local files, DeepSeek calls, DPAPI-protected secrets, SMTP, and Windows Task Scheduler integration; the browser talks only to `http://127.0.0.1` APIs. Production runs as a loopback-only local service and serves the built UI.

**Tech Stack:** Node.js 24+, pnpm 11+, TypeScript, React, Vite, Express, Zod, better-sqlite3, Multer, Nodemailer, React Router, react-grid-layout, Vitest, Testing Library, Supertest, PowerShell, Windows DPAPI, Windows Task Scheduler.

**Spec:** `docs/superpowers/specs/2026-08-17-personal-workbench-design.md`

## Global Constraints

- Run only on the user's Windows computer; do not deploy or sync to a cloud service.
- Bind the server to `127.0.0.1`, never `0.0.0.0`.
- Store normal application data in SQLite under `%LOCALAPPDATA%\LYJWorkBench`.
- Store profile photos under `%LOCALAPPDATA%\LYJWorkBench\uploads`; SQLite stores only a generated relative filename.
- Protect DeepSeek and SMTP secrets with Windows DPAPI for the current user; never place them in browser storage, source files, logs, or ordinary SQLite columns.
- Keep the first AI tool limited to Daily Report with `今日完成` and `问题与风险`.
- Keep the password-vault navigation entry disabled and labelled `即将推出`; do not accept or store passwords.
- Use test-driven development for every behavior task.
- Commit after each task when the workspace is a Git repository. If it is not, record the completed task in this plan and continue without creating a remote.

## Locked File Structure

```text
package.json                         workspace scripts only
pnpm-workspace.yaml                 workspace membership
tsconfig.base.json                  shared TypeScript rules
apps/server/                        loopback API and production static host
  src/app.ts                        Express composition
  src/index.ts                      process entry point
  src/config/paths.ts               local app-data paths
  src/db/database.ts                SQLite connection and migrations
  src/db/migrations/001_init.sql    complete first-version schema
  src/platform/dpapi.ts             PowerShell DPAPI adapter
  src/modules/profile/              profile and image endpoints
  src/modules/preferences/          navigation, dashboard, and theme endpoints
  src/modules/settings/             provider/mail settings and secret status
  src/modules/daily-reports/        prompt, DeepSeek client, history endpoints
  src/modules/reminders/            notification channels and reminder runner
  tests/                             server unit/integration tests
apps/web/                           React UI
  src/app/                           router, shell, sidebar, error handling
  src/features/profile/             profile card and editor
  src/features/dashboard/           card registry and edit mode
  src/features/settings/            settings pages
  src/features/ai-office/            tool hub
  src/features/daily-report/        editor, result, copy, and history
  src/features/reminders/           reminder status/settings
  src/styles/                       theme tokens and global styles
  src/test/                         browser test setup
packages/contracts/src/             shared Zod request/response schemas
scripts/start-local.ps1             start production-local app
scripts/install-reminder-task.ps1   install Monday scheduled task
scripts/uninstall-reminder-task.ps1 remove only this app's scheduled task
README.md                            local setup, migration, and recovery
```

---

### Task 1: Bootstrap the Local Application Shell

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/src/index.ts`
- Create: `apps/server/package.json`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/tests/health.test.ts`
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/App.test.tsx`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/vite.config.ts`

**Interfaces:**
- Produces: `createApp(): Express` from `apps/server/src/app.ts`.
- Produces: `GET /api/health -> { status: "ok" }`.
- Produces: shared `ApiErrorSchema` and `HealthResponseSchema` from `@workbench/contracts`.
- Produces: React routes `/`, `/ai-office`, `/ai-office/daily-report`, `/reminders`, and `/settings`.

- [ ] **Step 1: Add failing server and web shell tests**

```ts
// apps/server/tests/health.test.ts
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /api/health", () => {
  it("reports a local healthy server", async () => {
    const response = await request(createApp()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
```

```tsx
// apps/web/src/app/App.test.tsx
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { App } from "./App";

it("shows the extensible workbench navigation", () => {
  render(<MemoryRouter><App /></MemoryRouter>);
  expect(screen.getByRole("link", { name: "我的主页" })).toBeVisible();
  expect(screen.getByRole("link", { name: /AI 办公/ })).toBeVisible();
  expect(screen.getByText("密码保险箱")).toHaveAttribute("aria-disabled", "true");
});
```

- [ ] **Step 2: Run tests and verify the workspace is not yet implemented**

Run: `pnpm install && pnpm test`

Expected: test commands fail because workspace packages and `createApp`/`App` do not exist yet.

- [ ] **Step 3: Implement the minimal workspace, health route, and routed shell**

Use these root scripts:

```json
{
  "private": true,
  "packageManager": "pnpm@11.19.0",
  "scripts": {
    "dev": "pnpm --parallel --filter @workbench/server --filter @workbench/web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "check": "pnpm -r check"
  }
}
```

Implement `createApp()` with JSON parsing, `GET /api/health`, a final JSON 404 handler, and a JSON error handler. Implement the React shell with a persistent sidebar and the five named routes. Render the password-vault item as a non-clickable element with `aria-disabled="true"` and `即将推出` copy.

- [ ] **Step 4: Run unit tests and production builds**

Run: `pnpm test && pnpm build`

Expected: all Task 1 tests pass; both server and web produce build output.

- [ ] **Step 5: Commit the shell**

```powershell
git add package.json pnpm-workspace.yaml tsconfig.base.json packages apps
git commit -m "feat: bootstrap local personal workbench"
```

---

### Task 2: Add SQLite Persistence and the Personal Profile

**Files:**
- Create: `apps/server/src/config/paths.ts`
- Create: `apps/server/src/db/database.ts`
- Create: `apps/server/src/db/migrations/001_init.sql`
- Create: `apps/server/src/modules/profile/profile.repository.ts`
- Create: `apps/server/src/modules/profile/profile.routes.ts`
- Create: `apps/server/tests/profile.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/features/profile/ProfileCard.tsx`
- Create: `apps/web/src/features/profile/ProfileEditor.tsx`
- Create: `apps/web/src/features/profile/ProfileCard.test.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Produces: `ProfileSchema`, `ProfileUpdateSchema`, and `ProfileResponse` in `@workbench/contracts`.
- Produces: `GET /api/profile`, `PUT /api/profile`, `POST /api/profile/photo`.
- Produces: `ProfileRepository.get()` and `ProfileRepository.update(input)`.
- Consumes: `createApp({ dataDir? })` with an optional temporary data directory for tests.

- [ ] **Step 1: Write failing API tests for persistence and safe photo upload**

```ts
it("persists profile fields and custom fields", async () => {
  const app = createApp({ dataDir: tempDir });
  const saved = await request(app).put("/api/profile").send({
    name: "李雨佳",
    birthday: "1995-06-18",
    employeeNumber: "LYJ-001",
    customFields: [{ label: "部门", value: "运营部" }]
  });
  expect(saved.status).toBe(200);
  const loaded = await request(createApp({ dataDir: tempDir })).get("/api/profile");
  expect(loaded.body.employeeNumber).toBe("LYJ-001");
  expect(loaded.body.customFields).toEqual([{ label: "部门", value: "运营部" }]);
});

it("rejects a non-image profile upload", async () => {
  const response = await request(createApp({ dataDir: tempDir }))
    .post("/api/profile/photo")
    .attach("photo", Buffer.from("not an image"), { filename: "photo.txt", contentType: "text/plain" });
  expect(response.status).toBe(415);
});
```

- [ ] **Step 2: Run the profile API tests and verify failure**

Run: `pnpm --filter @workbench/server test -- profile.test.ts`

Expected: FAIL because the schema, database, and profile routes are absent.

- [ ] **Step 3: Implement paths, migrations, repository, routes, and upload rules**

`resolveAppPaths()` must default to `Join-Path $env:LOCALAPPDATA LYJWorkBench` semantics and accept a test override. Migration `001_init.sql` must create `profile`, `profile_custom_fields`, `daily_reports`, `dashboard_layouts`, `navigation_items`, `reminders`, and `app_settings` tables in one transaction.

Accept only JPEG, PNG, or WebP uploads up to 5 MB. Decode image signatures before accepting; do not trust only filename or MIME type. Generate a random server-side filename and expose the photo through `GET /api/profile/photo/:filename` only after validating that `:filename` is a basename present under the configured uploads directory.

- [ ] **Step 4: Write the failing profile UI test**

```tsx
it("edits and saves personal information", async () => {
  render(<ProfileCard initialProfile={emptyProfile} onSave={onSave} />);
  await user.click(screen.getByRole("button", { name: "编辑个人信息" }));
  await user.type(screen.getByLabelText("姓名"), "李雨佳");
  await user.type(screen.getByLabelText("员工编号"), "LYJ-001");
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ name: "李雨佳", employeeNumber: "LYJ-001" }));
});
```

- [ ] **Step 5: Implement profile loading, editing, custom fields, and photo selection**

Keep display and editor components separate. Disable save while a request is active, preserve entered values after API errors, display field-level validation messages, and revoke temporary object URLs after photo preview changes.

- [ ] **Step 6: Run profile tests and build**

Run: `pnpm --filter @workbench/server test -- profile.test.ts && pnpm --filter @workbench/web test -- ProfileCard.test.tsx && pnpm build`

Expected: all profile tests pass and production builds succeed.

- [ ] **Step 7: Commit profile persistence**

```powershell
git add apps/server/src/config apps/server/src/db apps/server/src/modules/profile apps/server/tests/profile.test.ts packages/contracts apps/web/src/features/profile apps/web/src/lib apps/web/src/app/App.tsx
git commit -m "feat: add local personal profile"
```

---

### Task 3: Implement the Extensible Dashboard, Sidebar Editor, and Themes

**Files:**
- Create: `apps/server/src/modules/preferences/preferences.repository.ts`
- Create: `apps/server/src/modules/preferences/preferences.routes.ts`
- Create: `apps/server/tests/preferences.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/features/dashboard/moduleRegistry.tsx`
- Create: `apps/web/src/features/dashboard/EditableDashboard.tsx`
- Create: `apps/web/src/features/dashboard/SidebarEditor.tsx`
- Create: `apps/web/src/features/dashboard/EditableDashboard.test.tsx`
- Create: `apps/web/src/app/Sidebar.tsx`
- Create: `apps/web/src/app/ThemeProvider.tsx`
- Create: `apps/web/src/styles/themes.css`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Produces: `DashboardLayoutSchema`, `NavigationItemSchema`, and `ThemeSchema`.
- Produces: `GET/PUT /api/preferences/layout`, `GET/PUT /api/preferences/navigation`, and `GET/PUT /api/preferences/theme`.
- Produces: `moduleRegistry: Record<ModuleId, ModuleDefinition>` where a definition has `id`, `title`, `minW`, `minH`, and `render()`.

- [ ] **Step 1: Write failing persistence tests for layout, navigation, and theme**

```ts
it("round-trips validated workbench preferences", async () => {
  const app = createApp({ dataDir: tempDir });
  await request(app).put("/api/preferences/layout").send([
    { moduleId: "profile", x: 0, y: 0, w: 4, h: 4, enabled: true }
  ]).expect(200);
  await request(app).put("/api/preferences/theme").send({ theme: "dark" }).expect(200);
  expect((await request(app).get("/api/preferences/theme")).body).toEqual({ theme: "dark" });
});
```

- [ ] **Step 2: Run preferences tests and verify failure**

Run: `pnpm --filter @workbench/server test -- preferences.test.ts`

Expected: FAIL because preference endpoints do not exist.

- [ ] **Step 3: Implement validated preference repositories and routes**

Reject unknown module IDs, duplicate navigation IDs, negative positions, and unsupported themes. Seed navigation with `home`, `ai-office`, `reminders`, `vault-coming-soon`, and `settings`. The vault item must remain disabled even if malformed client data tries to enable it.

- [ ] **Step 4: Write failing dashboard interaction tests**

```tsx
it("locks layout until edit mode is enabled", async () => {
  render(<EditableDashboard initialLayout={layout} onSave={onSave} />);
  expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "false");
  await user.click(screen.getByRole("button", { name: "编辑工作台" }));
  expect(screen.getByTestId("dashboard-grid")).toHaveAttribute("data-editable", "true");
  await user.click(screen.getByRole("button", { name: "完成编辑" }));
  expect(onSave).toHaveBeenCalled();
});
```

- [ ] **Step 5: Implement module registry, edit mode, sidebar ordering, and CSS-token themes**

Use `react-grid-layout` only inside `EditableDashboard`. Normal mode disables dragging and resizing. Persist only on “完成编辑”; if save fails, keep edit mode open and show an actionable error. Sidebar editing allows reorder and hide/restore but does not allow the required `home` or `settings` items to be deleted.

Define light and dark colors as CSS custom properties on `[data-theme]`; components may consume tokens but must not hard-code separate theme colors.

- [ ] **Step 6: Run preference/UI tests and build**

Run: `pnpm --filter @workbench/server test -- preferences.test.ts && pnpm --filter @workbench/web test -- EditableDashboard.test.tsx && pnpm build`

Expected: persistence and edit-mode tests pass; both themes compile without duplicate component trees.

- [ ] **Step 7: Commit the modular workbench**

```powershell
git add apps/server/src/modules/preferences apps/server/tests/preferences.test.ts packages/contracts apps/web/src/features/dashboard apps/web/src/app apps/web/src/styles
git commit -m "feat: add editable modular dashboard"
```

---

### Task 4: Add Secure DeepSeek and Mail Settings

**Files:**
- Create: `apps/server/src/platform/dpapi.ts`
- Create: `apps/server/src/modules/settings/settings.repository.ts`
- Create: `apps/server/src/modules/settings/settings.routes.ts`
- Create: `apps/server/tests/dpapi.test.ts`
- Create: `apps/server/tests/settings.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/features/settings/SettingsPage.tsx`
- Create: `apps/web/src/features/settings/SettingsPage.test.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Produces: `protectSecret(name: string, plaintext: string): Promise<void>` and `readSecret(name: string): Promise<string | null>`.
- Produces: `GET /api/settings`, `PUT /api/settings/deepseek`, `POST /api/settings/deepseek/test`, `PUT /api/settings/mail`, and `POST /api/settings/mail/test`.
- `GET /api/settings` returns only booleans such as `apiKeyConfigured` and `smtpPasswordConfigured`, never secret values.

- [ ] **Step 1: Write failing tests that prove secrets are encrypted and never returned**

```ts
it("does not return or persist the plaintext DeepSeek key", async () => {
  const app = createApp({ dataDir: tempDir, secretStore: fakeSecretStore });
  await request(app).put("/api/settings/deepseek").send({
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    apiKey: "secret-value"
  }).expect(200);
  const response = await request(app).get("/api/settings");
  expect(JSON.stringify(response.body)).not.toContain("secret-value");
  expect(readSqliteBytes(tempDir).toString()).not.toContain("secret-value");
});
```

- [ ] **Step 2: Run secret/settings tests and verify failure**

Run: `pnpm --filter @workbench/server test -- dpapi.test.ts settings.test.ts`

Expected: FAIL because DPAPI and settings routes do not exist.

- [ ] **Step 3: Implement the current-user DPAPI adapter and settings routes**

Invoke PowerShell with `-NoProfile -NonInteractive` and pass secret bytes through standard input, never command-line arguments. Use `System.Security.Cryptography.ProtectedData` with `DataProtectionScope.CurrentUser`. Write encrypted blobs atomically under the app data `secrets` directory with restrictive current-user ACLs. Unit tests use an injected in-memory `SecretStore`; Windows integration tests round-trip a disposable secret and delete its blob afterward.

Validate the DeepSeek base URL as HTTPS except when a test-only option explicitly permits loopback HTTP. Validate SMTP port range and require TLS mode `starttls` or `tls`.

- [ ] **Step 4: Write the failing masked-settings UI test**

```tsx
it("shows configured status without displaying saved secrets", async () => {
  mockApi.getSettings.mockResolvedValue({ apiKeyConfigured: true, smtpPasswordConfigured: true });
  render(<SettingsPage api={mockApi} />);
  expect(await screen.findByText("API Key 已配置")).toBeVisible();
  expect(screen.queryByDisplayValue("secret-value")).not.toBeInTheDocument();
});
```

- [ ] **Step 5: Implement settings sections and explicit connection tests**

Separate DeepSeek, mail, and appearance sections. Secret inputs start empty and mean “leave unchanged” unless the user enters a replacement. Never place a fetched secret into component state. Connection tests show pending, success, authentication failure, timeout, and unreachable-host states.

- [ ] **Step 6: Run all settings tests and build**

Run: `pnpm --filter @workbench/server test -- dpapi.test.ts settings.test.ts && pnpm --filter @workbench/web test -- SettingsPage.test.tsx && pnpm build`

Expected: secrets remain absent from responses/SQLite, DPAPI round-trip succeeds on Windows, and settings UI tests pass.

- [ ] **Step 7: Commit secure settings**

```powershell
git add apps/server/src/platform apps/server/src/modules/settings apps/server/tests packages/contracts apps/web/src/features/settings apps/web/src/app/App.tsx
git commit -m "feat: add secure local provider settings"
```

---

### Task 5: Implement AI Office and Daily Report Generation

**Files:**
- Create: `apps/server/src/modules/daily-reports/daily-report.prompt.ts`
- Create: `apps/server/src/modules/daily-reports/deepseek.client.ts`
- Create: `apps/server/src/modules/daily-reports/daily-report.repository.ts`
- Create: `apps/server/src/modules/daily-reports/daily-report.routes.ts`
- Create: `apps/server/tests/daily-report.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/features/ai-office/AiOfficePage.tsx`
- Create: `apps/web/src/features/daily-report/DailyReportPage.tsx`
- Create: `apps/web/src/features/daily-report/DailyReportHistory.tsx`
- Create: `apps/web/src/features/daily-report/DailyReportPage.test.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Produces: `buildDailyReportMessages(input): ChatMessage[]`.
- Produces: `DeepSeekClient.generateDailyReport(input): Promise<{ content: string; model: string }>`.
- Produces: `POST /api/daily-reports/generate`, `GET /api/daily-reports`, and `GET/PUT /api/daily-reports/:id`.
- Consumes: DeepSeek base URL/model from SQLite and API key from `SecretStore`.

- [ ] **Step 1: Write failing prompt, provider-error, and history tests**

```ts
it("builds a constrained two-section prompt", () => {
  const messages = buildDailyReportMessages({ completed: "完成初稿", risks: "数据待确认" });
  expect(messages[0].role).toBe("system");
  expect(messages[0].content).toContain("今日完成");
  expect(messages[0].content).toContain("问题与风险");
  expect(messages[1].content).toContain("完成初稿");
});

it("saves input and generated output only after DeepSeek succeeds", async () => {
  deepSeek.generateDailyReport.mockResolvedValue({ content: "今日完成\n1. 完成初稿\n\n问题与风险\n数据待确认", model: "deepseek-chat" });
  const response = await request(app).post("/api/daily-reports/generate").send({ completed: "完成初稿", risks: "数据待确认" });
  expect(response.status).toBe(201);
  expect((await request(app).get("/api/daily-reports")).body.items).toHaveLength(1);
});
```

- [ ] **Step 2: Run daily-report server tests and verify failure**

Run: `pnpm --filter @workbench/server test -- daily-report.test.ts`

Expected: FAIL because prompt, client, repository, and routes are absent.

- [ ] **Step 3: Implement the fixed prompt, provider client, persistence, and routes**

The system prompt must require professional Chinese, preserve facts, forbid invented metrics or outcomes, omit empty sections, and return plain text with the two approved headings. Send a 30-second abort timeout. Map missing configuration to HTTP 409, provider authentication failure to 401, rate limit to 429, timeout to 504, and other upstream failure to 502. Never include authorization headers or upstream response bodies in logs.

Persist a report only when generation succeeds. Permit editing the saved output with `PUT /api/daily-reports/:id`; retain original input and update `updated_at`.

- [ ] **Step 4: Write the failing three-level AI Office UI test**

```tsx
it("opens Daily Report from the AI Office tool card and copies the result", async () => {
  render(<App />, { wrapper: TestRouter });
  await user.click(screen.getByRole("link", { name: /AI 办公/ }));
  await user.click(screen.getByRole("link", { name: "日报填写" }));
  await user.type(screen.getByLabelText("今日完成"), "完成初稿");
  await user.type(screen.getByLabelText("问题与风险"), "数据待确认");
  await user.click(screen.getByRole("button", { name: "使用 DeepSeek 生成" }));
  expect(await screen.findByText(/完成初稿/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "复制全文" }));
  expect(navigator.clipboard.writeText).toHaveBeenCalled();
});
```

- [ ] **Step 5: Implement AI Office hub, editor/result split view, copy, and history**

The sidebar route opens the AI Office hub; the hub shows one small `日报填写` tool card; the card opens `/ai-office/daily-report`. Preserve input after failures, disable duplicate submissions, show the generated result separately, confirm clipboard success/failure, and list history newest-first with date, preview, reopen, and edit actions.

- [ ] **Step 6: Run daily-report tests and build**

Run: `pnpm --filter @workbench/server test -- daily-report.test.ts && pnpm --filter @workbench/web test -- DailyReportPage.test.tsx && pnpm build`

Expected: prompt constraints, error mapping, persistence, three-level navigation, copy, and history tests pass.

- [ ] **Step 7: Commit AI daily reports**

```powershell
git add apps/server/src/modules/daily-reports apps/server/tests/daily-report.test.ts packages/contracts apps/web/src/features/ai-office apps/web/src/features/daily-report apps/web/src/app/App.tsx
git commit -m "feat: add DeepSeek daily report workflow"
```

---

### Task 6: Add Email Reminder Delivery and Windows Scheduling

**Files:**
- Create: `apps/server/src/modules/reminders/notification-channel.ts`
- Create: `apps/server/src/modules/reminders/email-channel.ts`
- Create: `apps/server/src/modules/reminders/reminder.repository.ts`
- Create: `apps/server/src/modules/reminders/reminder.runner.ts`
- Create: `apps/server/src/modules/reminders/reminder.routes.ts`
- Create: `apps/server/src/reminder-entry.ts`
- Create: `apps/server/tests/reminder.test.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/package.json`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/web/src/features/reminders/ReminderPage.tsx`
- Create: `apps/web/src/features/reminders/ReminderPage.test.tsx`
- Create: `scripts/install-reminder-task.ps1`
- Create: `scripts/uninstall-reminder-task.ps1`

**Interfaces:**
- Produces: `NotificationChannel.send(message: NotificationMessage): Promise<DeliveryResult>`.
- Produces: `runDueReminders(now: Date, deps): Promise<ReminderRunSummary>`.
- Produces: `GET/PUT /api/reminders/outbound-checkin`, `POST /api/reminders/outbound-checkin/test`.
- Produces: `pnpm --filter @workbench/server reminder:run -- --reminder outbound-checkin`.

- [ ] **Step 1: Write failing idempotency, success, and failure-log tests**

```ts
it("sends the Monday reminder once for a local calendar date", async () => {
  const monday = new Date("2026-08-24T09:00:00+08:00");
  await runDueReminders(monday, deps);
  await runDueReminders(monday, deps);
  expect(emailChannel.send).toHaveBeenCalledTimes(1);
});

it("records failure without marking the reminder delivered", async () => {
  emailChannel.send.mockRejectedValue(new Error("smtp unavailable"));
  const summary = await runDueReminders(new Date("2026-08-24T09:00:00+08:00"), deps);
  expect(summary.failed).toBe(1);
  expect(repository.wasDelivered("outbound-checkin", "2026-08-24")).toBe(false);
});
```

- [ ] **Step 2: Run reminder tests and verify failure**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts`

Expected: FAIL because notification interfaces and reminder runner are absent.

- [ ] **Step 3: Implement notification abstraction, SMTP channel, and idempotent runner**

Store the weekly rule, enabled state, local time, recipient, subject, and body in SQLite. Load SMTP password only at send time. Record attempts with a sanitized status and error category; never store SMTP server responses that may contain credentials. Mark delivery only after Nodemailer resolves successfully. Use China local time from the system and a `(reminder_id, local_date)` unique key to prevent duplicates.

Keep `NotificationChannel` generic so an enterprise-WeChat channel can be added without changing reminder rules.

- [ ] **Step 4: Write the failing reminder settings UI test**

```tsx
it("configures the Monday email reminder and sends a test", async () => {
  render(<ReminderPage api={mockApi} />);
  await user.type(screen.getByLabelText("收件邮箱"), "me@example.com");
  await user.click(screen.getByRole("button", { name: "保存提醒" }));
  await user.click(screen.getByRole("button", { name: "发送测试邮件" }));
  expect(await screen.findByText("测试邮件已发送")).toBeVisible();
});
```

- [ ] **Step 5: Implement reminder UI and task installer scripts**

`install-reminder-task.ps1` must resolve the project path, verify `node.exe` and the built reminder entry exist, and create only the task `LYJWorkBench-OutboundCheckin` for Mondays at the configured time under the current user. The action runs the compiled reminder entry with an explicit working directory. `uninstall-reminder-task.ps1` must resolve and remove only that exact task after confirming its name; it must not enumerate and delete other tasks.

The reminder page shows enabled state, next run, recipient, local time, last delivery, last failure category, save, and test-send actions.

- [ ] **Step 6: Run reminder tests and inspect scheduled-task commands without installing**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts && pnpm --filter @workbench/web test -- ReminderPage.test.tsx && powershell -NoProfile -File scripts/install-reminder-task.ps1 -WhatIf`

Expected: tests pass; `-WhatIf` prints exactly one task named `LYJWorkBench-OutboundCheckin` and makes no system change.

- [ ] **Step 7: Commit reminder support**

```powershell
git add apps/server/src/modules/reminders apps/server/src/reminder-entry.ts apps/server/tests/reminder.test.ts apps/server/package.json packages/contracts apps/web/src/features/reminders scripts
git commit -m "feat: add local Monday email reminder"
```

---

### Task 7: Production-Local Startup, End-to-End Verification, and Handoff

**Files:**
- Create: `scripts/start-local.ps1`
- Create: `apps/server/tests/security-boundaries.test.ts`
- Create: `apps/web/src/app/App.integration.test.tsx`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `package.json`
- Create: `README.md`
- Modify: `docs/superpowers/plans/2026-08-18-personal-workbench-mvp.md`

**Interfaces:**
- Produces: `pnpm local:start` and `scripts/start-local.ps1`.
- Production server serves `apps/web/dist` and APIs from one loopback origin.
- Produces documented local data, backup, restore, scheduled-task install, and migration procedures.

- [ ] **Step 1: Write failing security-boundary and integrated-navigation tests**

```ts
it("defaults to loopback and redacts secrets from errors", async () => {
  expect(resolveServerHost()).toBe("127.0.0.1");
  const response = await request(app).post("/api/daily-reports/generate").send({ completed: "x", risks: "" });
  expect(JSON.stringify(response.body)).not.toMatch(/Bearer|api[_-]?key|smtp/i);
});
```

The browser integration test must navigate Home → AI Office → Daily Report → Settings → Reminders, toggle theme, enter/exit edit mode, and confirm the disabled vault item never becomes a link.

- [ ] **Step 2: Run the focused integration tests and verify failure**

Run: `pnpm --filter @workbench/server test -- security-boundaries.test.ts && pnpm --filter @workbench/web test -- App.integration.test.tsx`

Expected: FAIL until production hosting, redaction, and final integrated behavior are wired.

- [ ] **Step 3: Implement production-local startup and static serving**

Build the web app first, then have Express serve `apps/web/dist` with SPA fallback after all `/api` routes. Reject any configured non-loopback host in production. `start-local.ps1` resolves its own directory, sets no secret environment variables, starts the compiled server in the foreground, and opens `http://127.0.0.1:<configured-port>` only after the health endpoint succeeds.

- [ ] **Step 4: Write the operator README with exact local procedures**

Document prerequisites, `pnpm install`, development start, production build/start, DeepSeek configuration, SMTP configuration, scheduled reminder install/uninstall, local data location, safe backup while the server is stopped, restore, and transfer to another Windows computer. State that DPAPI secret blobs cannot be transferred to a different Windows account; API and SMTP secrets must be re-entered after migration.

- [ ] **Step 5: Run the full verification suite**

Run: `pnpm check && pnpm test && pnpm build`

Expected: all type checks, tests, and production builds pass with zero secret values in snapshots or output.

- [ ] **Step 6: Perform a local smoke test**

Run: `pnpm local:start`

Verify through the local browser: profile survives restart; light/dark themes persist; layout edit persists; DeepSeek missing-config guidance works; configured generation returns two sections; copy feedback appears; history reopens; reminder test mail reports its real result; the vault remains disabled.

- [ ] **Step 7: Update this plan with verification evidence and commit**

Append the exact verification date, command results, and any deliberately skipped external tests under a new `## Execution Evidence` section. Do not mark an external DeepSeek or SMTP test successful unless it actually ran with user-provided credentials.

```powershell
git add scripts/start-local.ps1 apps/server apps/web package.json README.md docs/superpowers/plans/2026-08-18-personal-workbench-mvp.md
git commit -m "feat: complete local personal workbench mvp"
```

## Execution Evidence

Verification date: 2026-08-18 (Asia/Shanghai).

- Baseline before Task 7: `pnpm test` passed with 102 server tests and 37 web tests.
- Required RED: `pnpm --filter @workbench/server test -- security-boundaries.test.ts` failed 18/18 for missing host/port validation, static hosting, sanitized logging, and launcher behavior. `pnpm --filter @workbench/web test -- App.integration.test.tsx` failed 1/1 on the Daily Report card's non-concise accessible link name.
- Additional smoke regressions were captured RED before fixes: a dot-directory web build fixture returned 500 instead of the SPA document, and abrupt launcher termination left its controlled child alive.
- Focused GREEN: `security-boundaries.test.ts` passed 20/20, including success, health-failure cleanup, abrupt-launcher cleanup, environment sanitization, static/API routing, and error redaction; `App.integration.test.tsx` passed 1/1 across Home → AI Office → Daily Report → Settings → Reminders.
- `pnpm test`: passed; server 122/122 and web 38/38 (160 tests total; contracts intentionally has no test files).
- `pnpm build`: passed; server TypeScript emitted successfully and Vite built 84 modules into `apps/web/dist`.
- `pnpm check`: passed for contracts, server, and web.
- `powershell -NoProfile -File scripts/install-reminder-task.ps1 -WhatIf`: passed and described exactly one `LYJWorkBench-OutboundCheckin` registration for Monday 09:00; no scheduled task was installed or changed.
- `pnpm local:start -- -NoOpen`: health-gated startup succeeded on `127.0.0.1:3001`; `/api/health` returned 200 JSON, `/ai-office/daily-report` returned 200 HTML through the SPA fallback, and `/api/does-not-exist` returned 404 JSON. After terminating the launcher, no listener remained on the exact port.
- `git diff --check`: passed. Secret-sentinel scanning found sentinel values only in deliberate negative test fixtures and none in production source, scripts, or documentation.
- No browser was opened during automated verification. Real DeepSeek generation/connection, real SMTP connection/delivery, a real Task Scheduler installation, and cross-account DPAPI migration were deliberately skipped because no user credentials or external-effect authorization were provided. No success is claimed for those checks.
