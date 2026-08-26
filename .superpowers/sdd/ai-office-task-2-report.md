# AI Office Task 2 Report

Date: 2026-08-26
Branch: `codex/microkernel`

## Summary

Implemented a fixed, editable AI Office plugin grid backed by the Task 1 SQLite order API.

- Replaced the AI Office free-form `EditableSurfaceGrid` usage with a fixed card grid.
- Added native drag reorder plus accessible `上移` / `下移` controls.
- Added removable AI Office shortcuts and a `可添加插件` area for enabled installed plugins not already in the draft.
- Switched AI Office persistence to `api.getAiOfficeOrder()` / `api.updateAiOfficeOrder()`.
- Added one-time migration from legacy `lyj.ai-office.layout` and AI Office entries inside `lyj.plugin-placements.v1`.
- Moved Plugin Center’s AI Office toggle to the database-backed order API while leaving dashboard placement on existing localStorage behavior.
- Preserved dashboard and password-manager free-form grid behavior.

## Files Changed

- `apps/web/src/features/ai-office/FixedPluginGrid.tsx`
- `apps/web/src/features/ai-office/FixedPluginGrid.test.tsx`
- `apps/web/src/features/ai-office/AiOfficePage.tsx`
- `apps/web/src/features/ai-office/AiOfficePage.test.tsx`
- `apps/web/src/features/plugins/PluginManager.tsx`
- `apps/web/src/features/plugins/PluginManager.test.tsx`
- `apps/web/src/styles/global.css`
- Supporting test-fixture updates required by the new API usage:
  - `apps/web/src/app/App.integration.test.tsx`
  - `apps/web/src/features/daily-report/DailyReportPage.test.tsx`
  - `apps/web/src/features/plugins/PluginCenterPage.test.tsx`
  - `apps/web/src/features/settings/SettingsPage.test.tsx`
  - `apps/web/src/plugins/contributions.test.tsx`

## TDD Evidence

### RED

Command:
`pnpm --filter @workbench/web test -- src/features/ai-office/AiOfficePage.test.tsx src/features/ai-office/FixedPluginGrid.test.tsx src/features/plugins/PluginManager.test.tsx`

Result:
- Failed with 10 failing tests across 3 files.
- `AiOfficePage` still rendered the old free-form grid:
  - `.react-grid-layout` and `.react-resizable-handle` were present.
  - no fixed-grid edit controls such as `上移 日报生成`.
- AI Office page did not show fallback plugin cards from database order:
  - could not find the expected `智能便签` link.
- Plugin Manager still used localStorage-only AI Office placement:
  - `api.updateAiOfficeOrder` had zero calls.
  - UI still showed `从 AI 办公移除` instead of the new database-backed mutation flow.

### GREEN

1. Focused feature verification:

   Command:
   `pnpm --filter @workbench/web test -- src/features/ai-office/AiOfficePage.test.tsx src/features/ai-office/FixedPluginGrid.test.tsx src/features/plugins/PluginManager.test.tsx`

   Result:
   - Passed 20/20 tests

2. Web typecheck:

   Command:
   `pnpm --filter @workbench/web check`

   Result:
   - Passed (`tsc --noEmit`)

3. Follow-on fixture verification for existing web coverage touched by the new API usage:

   Commands:
   - `pnpm --filter @workbench/web test -- src/features/plugins/PluginCenterPage.test.tsx src/features/settings/SettingsPage.test.tsx`
   - `pnpm --filter @workbench/web test -- src/app/App.integration.test.tsx src/features/daily-report/DailyReportPage.test.tsx`
   - `pnpm --filter @workbench/web test -- src/plugins/contributions.test.tsx`

   Results:
   - Passed 15/15
   - Passed 9/9
   - Passed 12/12

## Full Verification

Command:
`pnpm test`

Result:
- `@workbench/contracts`: 31 passed
- `@workbench/server`: 448 passed, 11 skipped
- `@workbench/web`: 136 passed

## Implementation Notes

- `FixedPluginGrid` uses semantic list markup, native drag/drop, and explicit reorder/remove buttons instead of adding another drag dependency.
- AI Office card metadata prefers `ai-tool` contribution label/description/path/icon, then falls back to manifest name, `插件快捷入口`, first routable contribution path, and `grid`.
- AI Office load/save flow is protected against unmounts and stale async settlements.
- Legacy migration runs only when the database order is empty:
  - sorts legacy layout entries by `y`, then `x`, then source order
  - maps legacy `ai-tool` contribution IDs to installed plugin manifest IDs
  - appends AI Office entries from `lyj.plugin-placements.v1`
  - removes legacy keys only after successful persistence
- Plugin Center AI Office actions now do a read-modify-write cycle against the database order and expose duplicate-safe pending/error feedback in fixed Chinese copy.

## Self-Review

- Confirmed AI Office no longer imports or renders the free-form grid path.
- Confirmed dashboard and password-manager grid tests still pass unchanged.
- Confirmed fallback metadata behavior is covered: routable non-`ai-tool` plugins still render as AI Office cards from stored order.
- Confirmed save-failure and migration-failure flows retain user state and keep legacy retry data.
- Confirmed the final workspace suite is green without additional production edits after the focused feature implementation.

## Concerns

- No blocking implementation concern.
- `git diff --check` returned only pre-existing line-ending warnings about LF→CRLF normalization in the working copy; there were no whitespace or patch-format errors.
