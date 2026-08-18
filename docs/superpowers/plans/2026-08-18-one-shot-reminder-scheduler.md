# One-Shot Reminder Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the every-minute reminder task with one invisible Windows task scheduled only for the next required reminder wake-up.

**Architecture:** A pure server function calculates the next wake-up from reminder schedules, delivery history, and the holiday calendar. PowerShell registers one `-Once` trigger whose GUI-hosted VBScript action runs due reminders invisibly and then asks PowerShell to schedule the next wake-up. Reminder and holiday mutations also request best-effort rescheduling.

**Tech Stack:** TypeScript, Express, SQLite, PowerShell 5.1, VBScript/WScript, Vitest

## Global Constraints

- Never use a repeating Task Scheduler trigger.
- Keep the exact current-user task identity `\LYJWorkBench-ReminderRunner`.
- Preserve current-user DPAPI and SMTP access.
- Do not accept executable paths or commands from browser request data.
- Retry an unsent due occurrence no sooner than five minutes after its latest failed attempt.

---

### Task 1: Calculate and expose the next scheduler wake-up

**Files:**
- Create: `apps/server/src/modules/reminders/reminder-wake.ts`
- Modify: `apps/server/src/modules/reminders/generic-reminder.repository.ts`
- Modify: `apps/server/src/reminder-entry.ts`
- Test: `apps/server/tests/reminder-scheduler.test.ts`

**Interfaces:**
- Produces: `nextReminderWake(now, repository, calendar): Date | null`.
- Produces: `GenericReminderRepository.attemptFor(reminderId, scheduledFor)` returning the latest status and attempted time or `null`.
- Produces: CLI argument `--next-wake`, printing one JSON line `{ "nextRun": string | null }`.

- [ ] **Step 1: Write failing wake-up tests**

Add tests that create reminders and assert: the earliest future occurrence wins; an overdue occurrence without an attempt wakes immediately; a failed occurrence wakes at `attemptedAt + 5 minutes`; a successful occurrence is skipped; and no enabled schedulable reminder returns `null`.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @workbench/server test -- tests/reminder-scheduler.test.ts`

Expected: FAIL because `nextReminderWake` and `--next-wake` do not exist.

- [ ] **Step 3: Implement the wake-up calculator and CLI output**

For each enabled reminder, compare its future `nextRun` with `scheduledOccurrenceAtOrBefore`. If a due occurrence has not succeeded, select `now + 5 seconds` when no failure exists, otherwise select the later of `now + 5 seconds` and `attemptedAt + 5 minutes`. Return the earliest candidate and print it as ISO JSON from `reminder-entry.ts`.

- [ ] **Step 4: Run the focused test and verify pass**

Run: `pnpm --filter @workbench/server test -- tests/reminder-scheduler.test.ts`

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/server/src/modules/reminders apps/server/src/reminder-entry.ts apps/server/tests/reminder-scheduler.test.ts
git commit -m "feat: calculate the next reminder wake-up"
```

### Task 2: Register one invisible Windows task

**Files:**
- Create: `scripts/run-reminders-hidden.vbs`
- Modify: `scripts/sync-reminder-task.ps1`
- Modify: `packages/contracts/src/index.ts`
- Modify: `apps/server/src/modules/reminders/reminder-scheduler.ts`
- Modify: `apps/server/tests/reminder-scheduler.test.ts`
- Modify: `apps/web/src/features/reminders/ReminderPage.tsx`
- Modify: `apps/web/src/features/reminders/ReminderPage.test.tsx`

**Interfaces:**
- Extends `SchedulerStatus` with `nextRun: string | null`.
- PowerShell consumes the fixed `--next-wake` JSON and produces `{ installed, synchronized, taskName, message, nextRun }`.
- VBScript consumes exactly four arguments: Node path, reminder entry path, sync script path, project root.

- [ ] **Step 1: Write failing scheduler-boundary tests**

Extend the service and controlled PowerShell tests to require one `-Once` trigger at the CLI-provided time, `StartWhenAvailable`, no repetition interval, and an action whose executable is `wscript.exe`. Assert that no next wake removes the exact task and returns `installed=false`, `synchronized=true`, `nextRun=null`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @workbench/server test -- tests/reminder-scheduler.test.ts`

Expected: FAIL because the script still creates a repeating Node action.

- [ ] **Step 3: Implement the hidden one-shot task**

Create a VBScript that uses `WScript.Shell.Run(command, 0, True)` to run `node --run-due`, then `powershell.exe -WindowStyle Hidden -File sync-reminder-task.ps1`, returning a nonzero code if either command fails. Update PowerShell to parse `--next-wake`, unregister the exact task when `nextRun` is null, otherwise register one `-Once` trigger with `New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 5)` and a `wscript.exe //B //NoLogo` action. Status-only must reject the old repeating/Node action as unsynchronized.

- [ ] **Step 4: Display next execution without changing the button workflow**

Add nullable `nextRun` to the contract and display `下次执行：<China local date/time>` when present. When synchronized with no installed task, display `暂无待执行提醒`.

- [ ] **Step 5: Run server and page focused tests**

Run:

```powershell
pnpm --filter @workbench/server test -- tests/reminder-scheduler.test.ts
pnpm --filter @workbench/web test -- src/features/reminders/ReminderPage.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 6: Commit**

```powershell
git add scripts packages/contracts apps/server/src/modules/reminders apps/server/tests/reminder-scheduler.test.ts apps/web/src/features/reminders
git commit -m "feat: schedule reminders invisibly at the next due time"
```

### Task 3: Reschedule after configuration changes and verify migration

**Files:**
- Modify: `apps/server/src/modules/reminders/reminder.routes.ts`
- Modify: `apps/server/src/modules/calendar/holiday.routes.ts`
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/tests/generic-reminder.test.ts`
- Modify: `apps/server/tests/reminder-schedule.test.ts`
- Modify: `README.md`

**Interfaces:**
- Reminder create/update/delete routes invoke `ReminderScheduler.sync()` after the database mutation.
- Holiday synchronization invokes the same scheduler after calendar rows are committed.
- Synchronization failure is best-effort: the saved reminder/calendar response remains successful and the manual sync button remains the repair path.

- [ ] **Step 1: Write failing route tests**

Inject a scheduler mock, create/update/delete a reminder, synchronize a holiday year, and assert one `sync()` request follows each successful mutation. Add a rejection case proving saved data is still returned when task synchronization fails.

- [ ] **Step 2: Run focused route tests and verify failure**

Run: `pnpm --filter @workbench/server test -- tests/generic-reminder.test.ts tests/reminder-schedule.test.ts`

Expected: FAIL because mutation routes do not reschedule.

- [ ] **Step 3: Implement best-effort rescheduling**

Convert mutation routes to async handlers, save first, then call a shared helper that catches scheduler errors and logs only a fixed sanitized message. Inject the scheduler into the holiday router from `createApp`.

- [ ] **Step 4: Update operational documentation**

Document that the task is a single invisible wake-up, is automatically replaced after reminder/calendar changes, and may be manually repaired with “同步系统计划”. Remove every-minute wording.

- [ ] **Step 5: Run complete verification**

Run:

```powershell
pnpm --filter @workbench/server test
pnpm --filter @workbench/web test
pnpm check
pnpm build
git diff --check
```

Expected: all tests and checks exit with code 0.

- [ ] **Step 6: Replace and inspect the current task**

Run the verified `sync-reminder-task.ps1` once, then read the exact task. Confirm its action is `wscript.exe`, it has one non-repeating trigger, and its next run matches the earliest active reminder or it is absent when no reminder is active.

- [ ] **Step 7: Commit**

```powershell
git add apps/server README.md
git commit -m "feat: reschedule after reminder configuration changes"
```
