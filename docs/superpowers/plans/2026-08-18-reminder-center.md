# Reminder Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-coded outbound check-in reminder with a generic email reminder center, a locally cached Chinese statutory workday calendar, a homepage calendar, an upcoming-reminder timeline, and one-click Windows scheduler synchronization.

**Architecture:** One generic Windows scheduled task runs a reminder scanner every minute. SQLite stores reminder definitions, per-occurrence delivery attempts and claims, and holiday overrides; pure schedule functions calculate due occurrences in `Asia/Shanghai`. Express exposes validated CRUD, history, calendar-sync, dashboard, and scheduler endpoints; React renders the reminder center and two homepage cards.

**Tech Stack:** TypeScript, React, Vite, Express, Zod, better-sqlite3, Nodemailer, Vitest, Testing Library, Supertest, PowerShell, Windows Task Scheduler

## Global Constraints

- Run only on the user's Windows computer; do not deploy or sync to a cloud service.
- Bind the server to `127.0.0.1`, never `0.0.0.0`.
- Notification delivery is email only.
- Time calculations use `Asia/Shanghai`.
- A finite reminder consumes an occurrence only after successful email delivery.
- Workday reminders require locally cached holiday data and must pause when the relevant year is unknown.
- Holiday data updates only after the user clicks the update action.
- The scheduler endpoint may run only the fixed project PowerShell script and may not accept a command or path from the browser.
- Preserve the user's existing uncommitted `pnpm-workspace.yaml` change.

---

### Task 1: Add Generic Reminder Contracts and Database Migration

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/server/src/db/migrations/002_generic_reminders.sql`
- Modify: `apps/server/src/db/database.ts`
- Test: `apps/server/tests/reminder.test.ts`

**Interfaces:**
- Produces: `ReminderLifecycle`, `ReminderScheduleType`, `ReminderInput`, `ReminderRecord`, `ReminderAttemptRecord`, `HolidayDay`, `SchedulerStatus`.
- Produces tables: `reminders_v2`, `reminder_attempts_v2`, `reminder_claims_v2`, `holiday_calendar_days`, `holiday_calendar_syncs`.

- [ ] **Step 1: Add a failing migration test**

```ts
it("migrates outbound check-in into a generic recurring reminder", () => {
  const { database } = createRepository();
  const row = database.prepare("SELECT name, lifecycle, schedule_type FROM reminders_v2").get();
  expect(row).toEqual({ name: "外勤打卡", lifecycle: "recurring", schedule_type: "weekly" });
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts`
Expected: FAIL because `reminders_v2` does not exist.

- [ ] **Step 3: Add exact shared schemas**

```ts
export const ReminderLifecycleSchema = z.enum(["once", "finite", "recurring"]);
export const ReminderScheduleTypeSchema = z.enum(["once", "daily", "workday", "weekly", "monthly"]);
export const ReminderInputSchema = z.object({
  name: z.string().trim().min(1).max(100), enabled: z.boolean(),
  lifecycle: ReminderLifecycleSchema, scheduleType: ReminderScheduleTypeSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  localTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7),
  monthDay: z.number().int().min(1).max(31).nullable(),
  totalOccurrences: z.number().int().min(1).max(10000).nullable(),
  recipient: z.string().trim().email().max(500),
  subject: z.string().trim().min(1).max(500), body: z.string().trim().min(1).max(20000)
});
```

- [ ] **Step 4: Add migration 002 and register it**

Create v2 tables with `scheduled_for` ISO timestamps as occurrence keys, foreign keys using `ON DELETE CASCADE` for claims and `ON DELETE SET NULL` for retained attempt history. Copy `outbound-checkin` with deterministic ID `outbound-checkin`, `name='外勤打卡'`, `lifecycle='recurring'`, `schedule_type='weekly'`, `weekdays_json='[1]'`, and existing email fields. Register migration `002_generic_reminders.sql` after `001_init.sql` in `database.ts`.

- [ ] **Step 5: Run migration tests**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts`
Expected: PASS for migration and repeat-open idempotency.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts/src/index.ts apps/server/src/db apps/server/tests/reminder.test.ts
git commit -m "feat: add generic reminder storage"
```

---

### Task 2: Implement Holiday-Aware Schedule Calculation

**Files:**
- Create: `apps/server/src/modules/reminders/reminder.schedule.ts`
- Create: `apps/server/src/modules/calendar/holiday.repository.ts`
- Test: `apps/server/tests/reminder-schedule.test.ts`
- Test: `apps/server/tests/holiday-calendar.test.ts`

**Interfaces:**
- Produces: `nextOccurrence(reminder, after, calendar): Date | null`.
- Produces: `dueOccurrences(reminder, from, through, calendar, maxLookbackDays): Date[]`.
- Produces: `HolidayRepository.isKnownYear(year)`, `isWorkday(localDate)`, `replaceYear(year, days, source)`.

- [ ] **Step 1: Write failing recurrence tests**

```ts
it.each([
  ["daily", "2026-08-18T01:00:00.000Z"],
  ["weekly", "2026-08-24T01:00:00.000Z"],
  ["monthly", "2026-09-18T01:00:00.000Z"]
])("calculates %s recurrence", (scheduleType, expected) => {
  expect(nextOccurrence(makeReminder({ scheduleType }), now, calendar)?.toISOString()).toBe(expected);
});

it("runs on a weekend makeup workday and skips a statutory holiday", () => {
  expect(calendar.isWorkday("2026-10-10")).toBe(true);
  expect(calendar.isWorkday("2026-10-01")).toBe(false);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @workbench/server test -- reminder-schedule.test.ts holiday-calendar.test.ts`
Expected: FAIL because the schedule and calendar modules are absent.

- [ ] **Step 3: Implement pure schedule functions**

Convert candidate local date/time values to UTC with explicit `Asia/Shanghai` helpers, iterate calendar dates rather than adding 24-hour UTC durations, return `null` after a once/finite reminder is complete, skip invalid monthly dates, and cap catch-up at seven local dates.

- [ ] **Step 4: Implement transactional holiday storage**

`replaceYear` validates every date belongs to the requested year, accepts only `holiday` and `makeup_workday`, deletes and inserts that year inside one immediate transaction, and writes a successful sync record only after all inserts succeed.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @workbench/server test -- reminder-schedule.test.ts holiday-calendar.test.ts`
Expected: PASS including leap year, month-end, unknown-year, holiday, and makeup-workday cases.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/modules/reminders/reminder.schedule.ts apps/server/src/modules/calendar apps/server/tests
git commit -m "feat: calculate holiday-aware reminder schedules"
```

---

### Task 3: Replace the Single Reminder Repository and Runner

**Files:**
- Replace: `apps/server/src/modules/reminders/reminder.repository.ts`
- Modify: `apps/server/src/modules/reminders/reminder.runner.ts`
- Modify: `apps/server/src/reminder-entry.ts`
- Test: `apps/server/tests/reminder.test.ts`

**Interfaces:**
- Produces repository methods `list()`, `get(id)`, `create(input)`, `update(id,input)`, `delete(id)`, `listAttempts()`, `findDue(from,through)`.
- Produces runner `runDueReminders(now, dependencies): Promise<ReminderRunSummary>` scanning every due reminder.

- [ ] **Step 1: Add failing CRUD and execution tests**

```ts
it("creates, updates, lists and deletes a reminder", () => {
  const created = repository.create(validInput);
  expect(repository.list().map(item => item.id)).toContain(created.id);
  expect(repository.update(created.id, { ...validInput, name: "更新后" }).name).toBe("更新后");
  repository.delete(created.id);
  expect(() => repository.get(created.id)).toThrow("Reminder not found");
});

it("increments a finite reminder only after successful delivery", async () => {
  await runDueReminders(now, { repository, calendar, channel: failingChannel });
  expect(repository.get(id).successfulOccurrences).toBe(0);
  await runDueReminders(later, { repository, calendar, channel: successChannel });
  expect(repository.get(id).successfulOccurrences).toBe(1);
});
```

- [ ] **Step 2: Verify focused failure**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts`
Expected: FAIL on missing generic repository methods.

- [ ] **Step 3: Implement repository and occurrence leases**

Use `randomUUID()` for new IDs. Key delivery claims and attempt uniqueness by `(reminder_id, scheduled_for)`. Retain the existing lease heartbeat. On success, atomically insert the success attempt, delete the claim, and increment `successful_occurrences`; on failure, insert or update the failed attempt without incrementing.

- [ ] **Step 4: Generalize the runner and entry point**

Remove `--reminder outbound-checkin`; the entry accepts `--run-due` and scans all due reminders. A workday reminder whose year is unknown is skipped with a diagnostic outcome, not sent. Summary counts every checked, sent, failed and calendar-blocked occurrence.

- [ ] **Step 5: Run reminder tests**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts`
Expected: PASS for concurrency, retry, finite completion, once completion and multiple reminders.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/modules/reminders apps/server/src/reminder-entry.ts apps/server/tests/reminder.test.ts
git commit -m "feat: run generic email reminders"
```

---

### Task 4: Expose Reminder CRUD, History and Dashboard APIs

**Files:**
- Modify: `apps/server/src/modules/reminders/reminder.routes.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/server/tests/reminder.test.ts`

**Interfaces:**
- Produces REST routes from design section 8 except calendar and scheduler routes.
- Produces web API methods `listReminders`, `createReminder`, `updateReminder`, `deleteReminder`, `listReminderAttempts`, `testReminder`, `getUpcomingReminders`.

- [ ] **Step 1: Add failing route tests**

```ts
expect((await request(app).post("/api/reminders").send(validInput)).status).toBe(201);
expect((await request(app).get("/api/reminders?status=pending")).body.items).toHaveLength(1);
expect((await request(app).delete(`/api/reminders/${id}`)).status).toBe(204);
expect((await request(app).get("/api/dashboard/upcoming-reminders")).body.items[0].nextRun).toBeTruthy();
```

- [ ] **Step 2: Verify route tests fail**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts`
Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement validated routes**

Return `201` for create, `204` for delete, `404` for unknown UUIDs, and `400` for invalid discriminated lifecycle/schedule combinations. Test-send uses current reminder content and never writes a formal occurrence or increments counts.

- [ ] **Step 4: Add typed web client methods**

Map each route through `requestJson`, encode filter query values with `URLSearchParams`, and treat a successful `204` delete as `Promise<void>`.

- [ ] **Step 5: Run server and contract checks**

Run: `pnpm --filter @workbench/server test -- reminder.test.ts; pnpm --filter @workbench/contracts check; pnpm --filter @workbench/web check`
Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/modules/reminders/reminder.routes.ts apps/server/tests/reminder.test.ts apps/web/src/lib/api.ts packages/contracts/src/index.ts
git commit -m "feat: add reminder center APIs"
```

---

### Task 5: Add Manual Holiday Synchronization APIs

**Files:**
- Create: `apps/server/src/modules/calendar/holiday.client.ts`
- Create: `apps/server/src/modules/calendar/holiday.routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/server/tests/holiday-calendar.test.ts`

**Interfaces:**
- Produces `GET /api/calendar?from&to` and `POST /api/calendar/sync`.
- Produces client `fetchHolidayYear(year, fetchImpl): Promise<HolidayDay[]>` with one fixed HTTPS source base URL.

- [ ] **Step 1: Add failing API tests with an injected fetch stub**

```ts
const response = await request(app).post("/api/calendar/sync").send({ years: [2026, 2027] });
expect(response.status).toBe(200);
expect(response.body.updatedYears).toContain(2026);
expect((await request(app).get("/api/calendar?from=2026-10-01&to=2026-10-10")).body.days).toContainEqual(
  expect.objectContaining({ localDate: "2026-10-01", dayType: "holiday" })
);
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @workbench/server test -- holiday-calendar.test.ts`
Expected: FAIL with 404 responses.

- [ ] **Step 3: Implement fixed-source fetch and validation**

Set a 15-second timeout, reject non-HTTPS redirects outside the configured source host, validate all returned dates and types with Zod, and replace a year only after the complete payload passes validation. Permit partial success when the next year is not yet published.

- [ ] **Step 4: Register routes and web client methods**

Inject the holiday client in tests through `createApp` options. Return local coverage years and last sync time with calendar reads.

- [ ] **Step 5: Run calendar tests**

Run: `pnpm --filter @workbench/server test -- holiday-calendar.test.ts`
Expected: PASS for success, timeout, malformed payload, partial next-year result and transaction rollback.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/modules/calendar apps/server/src/app.ts apps/server/tests/holiday-calendar.test.ts apps/web/src/lib/api.ts
git commit -m "feat: sync Chinese holiday calendar"
```

---

### Task 6: Add One-Click Windows Scheduler Synchronization

**Files:**
- Replace: `scripts/install-reminder-task.ps1`
- Create: `apps/server/src/modules/reminders/reminder-scheduler.ts`
- Modify: `apps/server/src/modules/reminders/reminder.routes.ts`
- Test: `apps/server/tests/reminder-scheduler.test.ts`

**Interfaces:**
- Produces `getSchedulerStatus(): Promise<SchedulerStatus>` and `syncScheduler(): Promise<SchedulerStatus>`.
- Produces `GET /api/reminder-scheduler/status` and `POST /api/reminder-scheduler/sync`.

- [ ] **Step 1: Add failing scheduler service and script tests**

```ts
expect(await service.syncScheduler()).toEqual(expect.objectContaining({ installed: true, synchronized: true }));
expect(invocation.file).toBe("powershell.exe");
expect(invocation.args).toEqual(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", fixedScriptPath]);
```

PowerShell dry-run assertions must verify task name `LYJWorkBench-ReminderRunner`, argument `--run-due`, one-minute repetition, current-user limited principal, fixed node path, fixed compiled entry path, and project working directory.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @workbench/server test -- reminder-scheduler.test.ts`
Expected: FAIL because the scheduler service is absent and the old script is weekly.

- [ ] **Step 3: Implement the fixed scheduler service**

Resolve the script from the configured project root, use `execFile` without a shell, pass no request-body arguments, cap runtime at 30 seconds, and map stderr/exit failures to safe diagnostic codes. Query only the exact root task `\LYJWorkBench-ReminderRunner`.

- [ ] **Step 4: Replace the PowerShell task definition**

Register a current-user limited task whose action runs `node.exe <fixed reminder-entry.js> --run-due`; use a once trigger beginning at the next minute with a one-minute repetition interval and a long repetition duration. Make registration idempotent with `-Force` and emit a compact JSON status object.

- [ ] **Step 5: Add routes and run tests**

Run: `pnpm --filter @workbench/server test -- reminder-scheduler.test.ts reminder.test.ts`
Expected: PASS with no command injection path and correct WhatIf behavior.

- [ ] **Step 6: Commit**

```powershell
git add scripts/install-reminder-task.ps1 apps/server/src/modules/reminders apps/server/tests/reminder-scheduler.test.ts
git commit -m "feat: sync reminder scheduler from the app"
```

---

### Task 7: Build the Reminder Center UI

**Files:**
- Replace: `apps/web/src/features/reminders/ReminderPage.tsx`
- Create: `apps/web/src/features/reminders/ReminderList.tsx`
- Create: `apps/web/src/features/reminders/ReminderEditor.tsx`
- Create: `apps/web/src/features/reminders/ReminderHistory.tsx`
- Modify: `apps/web/src/features/reminders/ReminderPage.test.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/styles/skins.css`

**Interfaces:**
- Consumes generic reminder and scheduler API methods from Tasks 4 and 6.
- Produces a route-level page with pending/history columns, lifecycle filter, CRUD editor and scheduler sync action.

- [ ] **Step 1: Replace hard-coded UI tests with failing generic behavior tests**

```tsx
expect(await screen.findByRole("heading", { name: "提醒事项" })).toBeVisible();
await user.click(screen.getByRole("button", { name: "新建提醒" }));
await user.type(screen.getByLabelText("提醒名称"), "提交报销");
await user.click(screen.getByRole("button", { name: "保存提醒" }));
expect(api.createReminder).toHaveBeenCalled();
await user.click(screen.getByRole("button", { name: "同步系统计划" }));
expect(api.syncReminderScheduler).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Verify the UI tests fail**

Run: `pnpm --filter @workbench/web test -- ReminderPage.test.tsx`
Expected: FAIL because the current page exposes one fixed reminder.

- [ ] **Step 3: Implement focused components**

`ReminderList` owns filtering and ordered cards. `ReminderEditor` uses conditional fields for lifecycle and schedule type and preserves entered values on API failure. `ReminderHistory` uses an independently scrollable list. `ReminderPage` owns data loading, dialog state, destructive delete confirmation, test-send feedback and scheduler status.

- [ ] **Step 4: Add responsive styles**

Use existing design tokens. Render two columns at desktop widths and one column below 760px. Give pending and history lists `max-height: 34rem; overflow-y: auto`; preserve keyboard focus outlines and labeled controls.

- [ ] **Step 5: Run UI tests and type check**

Run: `pnpm --filter @workbench/web test -- ReminderPage.test.tsx; pnpm --filter @workbench/web check`
Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/reminders apps/web/src/styles
git commit -m "feat: build generic reminder center"
```

---

### Task 8: Add Homepage Calendar and Upcoming Reminder Cards

**Files:**
- Create: `apps/web/src/features/calendar/WorkdayCalendarCard.tsx`
- Create: `apps/web/src/features/reminders/UpcomingRemindersCard.tsx`
- Modify: `apps/web/src/features/dashboard/moduleRegistry.tsx`
- Modify: `apps/web/src/features/dashboard/EditableDashboard.tsx`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/modules/preferences/preferences.repository.ts`
- Test: `apps/web/src/features/dashboard/EditableDashboard.test.tsx`

**Interfaces:**
- Adds dashboard module IDs `workday-calendar` and `upcoming-reminders`.
- Consumes calendar and upcoming reminder API methods.

- [ ] **Step 1: Add failing dashboard tests**

```tsx
expect(await screen.findByRole("heading", { name: "中国工作日日历" })).toBeVisible();
expect(screen.getByText("休")).toBeVisible();
expect(screen.getByText("班")).toBeVisible();
expect(screen.getByRole("region", { name: "近期提醒" })).toHaveTextContent("提交报销");
```

- [ ] **Step 2: Verify dashboard tests fail**

Run: `pnpm --filter @workbench/web test -- EditableDashboard.test.tsx`
Expected: FAIL because only the profile module is registered.

- [ ] **Step 3: Implement calendar card**

Render a Monday-first month grid, previous/next/today controls, holiday `休` and makeup-workday `班` markers, coverage status, last sync time and a manual update button that requests current and next year. An unknown year displays a warning and never labels guessed workdays.

- [ ] **Step 4: Implement upcoming card and dashboard registration**

Fetch upcoming reminders ordered by `nextRun`, render them in a fixed-height scroll area, and navigate to `/reminders?selected=<id>` on click. Seed both new modules into existing dashboard preferences without changing existing user positions.

- [ ] **Step 5: Run dashboard and integration tests**

Run: `pnpm --filter @workbench/web test -- EditableDashboard.test.tsx App.integration.test.tsx; pnpm --filter @workbench/server test -- preferences.test.ts`
Expected: PASS with existing profile layout preserved.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/features/calendar apps/web/src/features/reminders/UpcomingRemindersCard.tsx apps/web/src/features/dashboard packages/contracts/src/index.ts apps/server/src/modules/preferences apps/web/src/features/dashboard/EditableDashboard.test.tsx
git commit -m "feat: show calendar and reminders on dashboard"
```

---

### Task 9: Complete Integration, Documentation and Visual Verification

**Files:**
- Modify: `README.md`
- Modify: `scripts/uninstall-reminder-task.ps1`
- Modify: `scripts/prepare-backup.ps1`
- Modify: affected integration and security tests

**Interfaces:**
- Produces final supported install, uninstall, backup and recovery workflow for `\LYJWorkBench-ReminderRunner`.

- [ ] **Step 1: Update system-task safety tests**

Assert uninstall and backup scripts target only `\LYJWorkBench-ReminderRunner`, never enumerate or alter other scheduled tasks, and keep `-WhatIf` support.

- [ ] **Step 2: Update documentation**

Document generic reminder creation, one-click scheduler sync, manual holiday update, local calendar storage, task name, production build requirement, backup behavior and same-account restore behavior.

- [ ] **Step 3: Run the full verification suite**

Run: `pnpm test; pnpm check; pnpm build`
Expected: every command exits 0 with no failing tests or TypeScript errors.

- [ ] **Step 4: Verify the running app**

Reload `http://127.0.0.1:5173/reminders`, create/edit/delete a non-sending disabled reminder, confirm both reminder columns, open the homepage, switch calendar months, confirm timeline ordering, and inspect browser console errors. Do not send a real email or synchronize the real Windows task during automated verification.

- [ ] **Step 5: Commit**

```powershell
git add README.md scripts apps packages
git commit -m "docs: complete reminder center workflow"
```
