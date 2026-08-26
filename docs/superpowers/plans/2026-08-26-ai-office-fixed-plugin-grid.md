# AI Office Fixed Plugin Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the free-form AI Office grid with fixed-size, reorderable plugin cards and render Plugin Center in a dedicated sidebar section.

**Architecture:** Store AI Office membership and order as a validated ordered ID list in SQLite preferences. The web page renders a responsive fixed-card grid, edits a local draft through add/remove/reorder operations, and saves atomically. Sidebar rendering separates the plugin-center route from workspace navigation without changing plugin lifecycle ownership.

**Tech Stack:** React 19, TypeScript, Express, Zod, better-sqlite3, Vitest, Testing Library.

## Global Constraints

- AI Office cards use one fixed visual size and never expose resize controls.
- Editing supports adding enabled installed plugins, removing page shortcuts, drag reorder, and keyboard up/down reorder.
- Removing a card does not uninstall or delete plugin data.
- Ordering persists in the local SQLite database, not only localStorage.
- Plugin Center remains responsible for install, enable, disable, uninstall, permissions, and versions.
- Dashboard and password manager free-form grids must remain unchanged.

---

### Task 1: Persist AI Office membership and order

**Files:**
- Modify: `packages/contracts/src/surfaces.ts`
- Modify: `packages/contracts/src/surfaces.test.ts`
- Modify: `apps/server/src/modules/preferences/preferences.repository.ts`
- Modify: `apps/server/src/modules/preferences/preferences.routes.ts`
- Modify: `apps/server/tests/preferences.test.ts`
- Modify: `apps/web/src/lib/api.ts`

**Interfaces:**
- Produces: `AiOfficeOrderSchema`, `AiOfficeOrder`, `GET /preferences/ai-office-order`, `PUT /preferences/ai-office-order`, `api.getAiOfficeOrder()`, and `api.updateAiOfficeOrder(order)`.
- Validation: IDs are unique non-empty strings; repository filters IDs to enabled installed AI-tool or route contributions before returning them.

- [ ] **Step 1: Write failing contract and server tests**

Add assertions that duplicate IDs fail schema validation, the endpoint round-trips `[{ itemId: "polish", position: 0 }]`, and invalid or uninstalled IDs return `400 VALIDATION_ERROR`.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @workbench/contracts test -- src/surfaces.test.ts && pnpm --filter @workbench/server test -- tests/preferences.test.ts`

Expected: failures because the schema and routes do not exist.

- [ ] **Step 3: Implement schema, SQLite preference methods, routes, and web API**

Use the exact public shape:

```ts
export const AiOfficeOrderItemSchema = z.object({
  itemId: z.string().min(1).max(100),
  position: z.number().int().nonnegative()
}).strict();
export const AiOfficeOrderSchema = AiOfficeOrderItemSchema.array();
export type AiOfficeOrder = z.infer<typeof AiOfficeOrderSchema>;
```

Persist JSON under `app_settings.key = 'ai-office-order'`. Save only unique contiguous positions and validate IDs against enabled installed plugin contributions.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the commands from Step 2 plus `pnpm --filter @workbench/web check`.

Expected: all focused tests pass with zero TypeScript errors.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src/surfaces.ts packages/contracts/src/surfaces.test.ts apps/server/src/modules/preferences/preferences.repository.ts apps/server/src/modules/preferences/preferences.routes.ts apps/server/tests/preferences.test.ts apps/web/src/lib/api.ts
git commit -m "feat: persist AI office plugin order"
```

### Task 2: Replace free-form AI Office layout with fixed reorderable cards

**Files:**
- Create: `apps/web/src/features/ai-office/FixedPluginGrid.tsx`
- Create: `apps/web/src/features/ai-office/FixedPluginGrid.test.tsx`
- Modify: `apps/web/src/features/ai-office/AiOfficePage.tsx`
- Modify: `apps/web/src/features/ai-office/AiOfficePage.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: `AiOfficeOrder`, `api.getAiOfficeOrder()`, `api.updateAiOfficeOrder(order)` and enabled `AiOfficeTool[]` contributions.
- Produces: `FixedPluginGrid` with `items`, `editing`, `onReorder`, and `onRemove` props.

- [ ] **Step 1: Write failing page and grid tests**

Test that the page renders fixed cards without `.react-grid-layout` or resize handles, adds an available plugin, removes a shortcut without uninstalling, reorders through drag and up/down controls, saves through the API, and retains draft state after a rejected save.

Also test one-time migration ordering: legacy `SurfaceLayoutItem[]` is sorted by `y`, then `x`, then source order; legacy localStorage placement is imported only when the database order has not been initialized.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @workbench/web test -- src/features/ai-office/AiOfficePage.test.tsx src/features/ai-office/FixedPluginGrid.test.tsx`

Expected: failures because `FixedPluginGrid` and the fixed editing workflow do not exist.

- [ ] **Step 3: Implement the minimal fixed grid**

Use semantic list markup and native drag events. In edit mode each card exposes “上移”, “下移”, and “移出 AI 办公”; the available-plugin section exposes “添加”. Saving converts the ordered IDs to contiguous positions.

Remove `EditableSurfaceGrid` from AI Office only. Convert legacy coordinate layout to ordered IDs with a pure `migrateAiOfficeOrder` helper, persist the result through the preferences API, and clear the obsolete `lyj.ai-office.layout` key after successful migration.

CSS contract:

```css
.ai-fixed-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18rem), 18rem));
  gap: 1rem;
  align-items: stretch;
}
.ai-fixed-card { width: 100%; min-height: 6.875rem; }
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2 and `pnpm --filter @workbench/web check`.

Expected: all focused tests pass and AI Office imports no free-form grid component.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/features/ai-office/FixedPluginGrid.tsx apps/web/src/features/ai-office/FixedPluginGrid.test.tsx apps/web/src/features/ai-office/AiOfficePage.tsx apps/web/src/features/ai-office/AiOfficePage.test.tsx apps/web/src/styles/global.css
git commit -m "feat: add fixed AI office plugin grid"
```

### Task 3: Give Plugin Center a dedicated sidebar section

**Files:**
- Modify: `apps/web/src/app/Sidebar.tsx`
- Modify: `apps/web/src/features/dashboard/EditableDashboard.test.tsx`
- Modify: `apps/web/src/styles/global.css`

**Interfaces:**
- Consumes: existing `NavigationItem[]` and `/plugins` route.
- Produces: `.sidebar-workspace-nav` and `.sidebar-plugin-nav` regions with the Plugin Center excluded from workspace mapping.

- [ ] **Step 1: Write failing sidebar test**

Assert that “插件中心” is inside navigation labelled “插件”, while “我的主页” and “AI 办公” remain inside navigation labelled “工作区”, and “设置” remains in the footer.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @workbench/web test -- src/features/dashboard/EditableDashboard.test.tsx`

Expected: failure because the labelled navigation sections do not exist.

- [ ] **Step 3: Implement sidebar grouping and section styles**

Partition visible items into `plugins`, `settings`, and workspace items. Render an uppercase “插件” label and a dedicated `<nav aria-label="插件">` without changing saved navigation records.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2 and `pnpm --filter @workbench/web check`.

Expected: all sidebar tests pass.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/app/Sidebar.tsx apps/web/src/features/dashboard/EditableDashboard.test.tsx apps/web/src/styles/global.css
git commit -m "feat: separate plugin navigation section"
```

### Task 4: Cross-feature regression and production verification

**Files:**
- Modify only files required by a discovered regression.

**Interfaces:**
- Verifies the completed feature against dashboard, password manager, plugin center, preferences, and navigation boundaries.

- [ ] **Step 1: Run all tests**

Run: `pnpm test`

Expected: contracts, server, and web suites all pass; environment-specific skips remain documented skips.

- [ ] **Step 2: Run type checks and production builds**

Run: `pnpm check; pnpm build; git diff --check`

Expected: all commands exit successfully.

- [ ] **Step 3: Verify the running UI**

Open `/ai-office` and confirm fixed cards do not fill the screen, edit mode reorders without resize handles, refresh retains order, and Plugin Center appears in its own sidebar section. Confirm dashboard and password-manager resize handles remain available.

- [ ] **Step 4: Commit any verification-only correction**

If no correction is needed, do not create an empty commit. Otherwise stage only the corrected files and commit with a scoped `fix:` message.
