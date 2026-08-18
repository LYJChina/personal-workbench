# Daily Dashboard Quote Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the large dashboard title with a deterministic daily Chinese quote and attribution.

**Architecture:** Keep the quote catalog and date-selection function in a focused dashboard module. The dashboard toolbar renders the selected quote and retains the existing edit action.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library

## Global Constraints

- No network, database, or new dependency.
- The same local date always selects the same quote.
- Remove “PERSONAL SPACE” and the dashboard “我的主页” heading only; keep sidebar navigation unchanged.

---

### Task 1: Daily quote selector and dashboard header

**Files:**
- Create: `apps/web/src/features/dashboard/dailyQuotes.ts`
- Modify: `apps/web/src/features/dashboard/EditableDashboard.tsx`
- Test: `apps/web/src/features/dashboard/EditableDashboard.test.tsx`
- Modify: `apps/web/src/app/App.integration.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Produces: `dailyQuote(date?: Date): { text: string; author: string }`
- Consumes: the browser's local date through `new Date()`.

- [ ] **Step 1: Write the failing test**

Assert that the dashboard does not render `PERSONAL SPACE` or a level-two “我的主页” heading, does render a quote and `——作者`, and still renders “编辑工作台”. Add a selector test proving two calls for the same date return the same item.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @workbench/web test -- src/features/dashboard/EditableDashboard.test.tsx`

Expected: FAIL because the old heading is still present and `dailyQuote` does not exist.

- [ ] **Step 3: Implement the smallest complete change**

Create a curated quote array and select it using a stable local calendar-day number. Render:

```tsx
<div className="dashboard-daily-quote">
  <p>{quote.text}</p>
  <cite>——{quote.author}</cite>
</div>
```

Keep the existing edit button and add compact typography styles. Update the app integration assertion to target the home region instead of the removed heading.

- [ ] **Step 4: Verify focused and full checks**

Run:

```powershell
pnpm --filter @workbench/web test
pnpm check
pnpm build
```

Expected: all commands exit with code 0.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/features/dashboard apps/web/src/app/App.integration.test.tsx apps/web/src/styles/global.css
git commit -m "feat: rotate a daily dashboard quote"
```
