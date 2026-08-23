# LYJ Workbench Next-Session Handoff

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:requesting-code-review` for the foundation gate, then `superpowers:brainstorming` and `superpowers:writing-plans` before implementation. Use `superpowers:subagent-driven-development` to execute each approved plan task-by-task.

**Goal:** Resume next week from the completed cross-platform foundation and build the plugin architecture in independently testable phases.

**Architecture:** Keep the existing application running while moving extensible features behind a small kernel. Split the remaining work into four separate plans—kernel protocol, third-party plugin runtime, storage governance, and AI usage accounting—because they are independently reviewable subsystems with different security boundaries.

**Tech Stack:** TypeScript, Node.js 22, Express, React, SQLite via `better-sqlite3`, Vitest, pnpm 11.19.0.

## Current checkpoint

- Branch: `codex/microkernel`
- Latest commit: `bb4e3b3 feat: add portable database backup`
- Working tree at handoff: clean
- Completed foundation: automatic reminder scheduling removed; Windows/macOS paths and launcher; portable encrypted vault; legacy DPAPI import; profile photo in SQLite; online database export; Windows/macOS CI.
- Last verification: server 278 passed and 1 platform-capability skip; web 73 passed; `pnpm check`, `pnpm build`, and `git diff --check` passed.
- SMTP settings, connection testing, and manual email remain in core. Feishu and automatic background delivery remain deferred.

## Global constraints

- Windows and macOS must use the same `pnpm install`, `pnpm dev`, `pnpm build`, and `pnpm local:start` commands.
- `workbench.sqlite` remains the single authoritative user-data file.
- Existing data, reminders, SMTP configuration, AI history, profile, calendar, and dashboard layout must migrate in place.
- Third-party plugins must not receive SQLite, Express, vault secrets, SMTP passwords, provider API keys, or arbitrary Node.js execution.
- Every implementation task starts with a failing test, receives independent specification and security/quality review, and ends with full verification before commit.
- Do not implement Feishu, an Agent communication protocol, automatic reminder delivery, or trusted arbitrary-code plugins in these plans.

---

### Task 0: Close the cross-platform foundation gate

**Files:**
- Review: all changes from the merge base of `main` through `codex/microkernel`
- Reference: `docs/superpowers/plans/2026-08-23-cross-platform-foundation.md`
- Reference: `docs/superpowers/specs/2026-08-23-cross-platform-plugin-kernel-design.md`

- [ ] Run a whole-branch specification and security review, not only a Task 08 diff review.
- [ ] Fix every Critical or Important finding with a failing regression test first.
- [ ] Run the final foundation gate:

```text
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm build
git diff --check
```

- [ ] Confirm the Windows/macOS GitHub Actions run passes after pushing `bb4e3b3`.
- [ ] Record the foundation review result before beginning kernel code.

### Task 1: Write and execute Plan 2 — microkernel and system-plugin protocol

**Primary files expected in the detailed plan:**
- Create: `packages/contracts/src/plugins.ts` — versioned manifest, permissions, contributions, lifecycle status, validation-result contracts.
- Create: `apps/server/src/kernel/plugin-registry.ts` — atomic registration and reverse-order revocation.
- Create: `apps/server/src/kernel/plugin-lifecycle.ts` — discover, validate, enable, disable, failure isolation, and safe-mode state machine.
- Create: `apps/server/src/kernel/permissions.ts` — execution-point permission checks.
- Create: `apps/server/src/db/migrations/003_plugin_kernel.sql` — installed plugin metadata, status, permissions, audit events, and stored package metadata.
- Create: `apps/server/src/modules/plugins/plugin.repository.ts` and `plugin.routes.ts` — core plugin-management API.
- Create: `apps/web/src/plugins/contributionRegistry.tsx` — navigation, route, dashboard-card, AI-tool-card, and settings contribution registry.
- Modify: `apps/server/src/app.ts` — compose the kernel without giving plugins the Express instance.
- Modify: `apps/web/src/app/App.tsx`, `apps/web/src/app/Sidebar.tsx`, and `apps/web/src/features/dashboard/moduleRegistry.tsx` — consume registered contributions instead of fixed lists.
- Test: new focused kernel, registry, lifecycle, permissions, migration, routing, navigation, and dashboard tests.

**Required deliverable:** System plugins and future third-party plugins use the same versioned contribution/lifecycle protocol; disabling a plugin removes every contribution and subscription; one broken plugin cannot prevent core startup; safe mode loads only the kernel and essential core.

**First system-plugin migration order:** AI chat, AI polish, daily reports, workday calendar, then reminders. Keep profile, appearance, vault, backup, SMTP transport, plugin management, and core data management in the kernel/core.

### Task 2: Write and execute Plan 3 — third-party folder plugins and isolation

**Required deliverable:** Select a folder, validate `plugin.json`, normalize and hash files, store an immutable package in SQLite, display requested permissions, enable/disable/update/rollback/uninstall, and restore packages from the database on a new device.

**Security boundaries to specify before coding:** reject traversal, symlink/junction escape, alternate data streams, oversized files/packages, duplicate normalized paths, incompatible platforms/versions, undeclared domains, unsafe iframe capabilities, and unapproved permission growth. Third-party pages run in sandboxed iframes with a versioned message SDK and restrictive CSP. Background actions use declarative workflows only.

**Required example:** a harmless cross-platform sample plugin that contributes one AI Office card, one route, one dashboard card, and private data operations without direct database or network access.

### Task 3: Write and execute Plan 4 — plugin storage governance

**Required deliverable:** Private plugin CRUD with stable plugin-ID isolation; separate setting/business/history/cache/attachment classes; default 20 MB quota; warning at 80%; hard-limit enforcement under concurrent writes; per-class usage; history retention; oldest-cache eviction; export; and safe database compaction.

**Non-negotiable behavior:** automatic cleanup may delete only declared history/cache data. It must never delete settings, business records, profile data, reminders, or unknown classes. Uninstall keeps data by default and deletes it only after an explicit user choice.

### Task 4: Write and execute Plan 5 — AI usage, cache, and estimated cost center

**Required deliverable:** Route system and third-party plugin model calls through one kernel gateway; record provider/model/plugin/request, latency, status, input/output/cache tokens, reported-versus-estimated source, currency, price version, and estimated cost without storing prompts or responses.

**Required UI:** today/week/month totals, plugin/model grouping, success rate, latency, daily trend, token cache hit rate, request cache hit rate, estimated cost, price management, and monthly budget warning. Show cache metrics as unavailable when the provider supplies no cache data. Retain request details for 90 days and preserve long-term daily summaries.

### Task 5: Final product and migration gate

- [ ] Verify existing databases migrate in place and the exported database restores on Windows and macOS with the same master password.
- [ ] Verify all current system features still work after conversion to contributions.
- [ ] Verify plugin install/enable/disable/update/rollback/uninstall and safe mode.
- [ ] Verify permissions at execution points, private-data isolation, quotas, cleanup safety, and iframe/CSP boundaries.
- [ ] Verify API token, cache, pricing, cost, retention, and budget calculations.
- [ ] Update README with plugin installation, permissions, backup, storage, and usage-center instructions.
- [ ] Run full Windows/macOS CI and a final whole-branch specification/security review before merging.

## Resume commands

```text
cd C:\Users\liuyijie\Desktop\personal-workbench
git switch codex/microkernel
git status
git log -3 --oneline
pnpm install --frozen-lockfile
```

On macOS, use the cloned project path in the first command; every command after `cd` is identical.

## Next-session opening instruction

“Read `docs/superpowers/plans/2026-08-23-next-session-handoff.md`. Start with Task 0, perform the whole-branch foundation review, then write the detailed Plan 2 microkernel implementation plan. Use subagent-driven development and do not implement Feishu or automatic reminders.”
