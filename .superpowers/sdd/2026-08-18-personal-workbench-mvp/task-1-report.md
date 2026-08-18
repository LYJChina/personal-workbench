# Task 1 Report: Bootstrap the Local Application Shell

## Implementation summary

Created a pnpm TypeScript workspace for the local-only LYJ Workbench with:

- shared Zod API contracts (`ApiErrorSchema` and `HealthResponseSchema`);
- an Express `createApp(): Express` factory, `GET /api/health`, JSON 404/error handling, and a server entry point bound to `127.0.0.1`;
- a Vite/React shell with a persistent sidebar and routes for `/`, `/ai-office`, `/ai-office/daily-report`, `/reminders`, and `/settings`;
- a non-clickable password-vault item with `aria-disabled="true"` and `即将推出`;
- focused Supertest and React Testing Library coverage for the required health and navigation contracts.

## RED evidence

Command:

```powershell
pnpm --filter @workbench/server test -- tests/health.test.ts
```

Relevant expected failure:

```text
Error: Cannot find module '../src/app' imported from 'apps/server/tests/health.test.ts'
```

Command:

```powershell
pnpm --filter @workbench/web test -- src/app/App.test.tsx
```

Relevant expected failure:

```text
Error: Failed to resolve import "./App" from "src/app/App.test.tsx". Does the file exist?
```

Both failures occurred before their production modules existed, demonstrating that the tests exercised the missing `createApp` and `App` behavior rather than passing against pre-existing code.

## GREEN evidence

Command:

```powershell
pnpm --filter @workbench/server test -- tests/health.test.ts
pnpm --filter @workbench/web test -- src/app/App.test.tsx
```

Passing output:

```text
apps/server: Test Files  1 passed (1); Tests  1 passed (1)
apps/web:    Test Files  1 passed (1); Tests  1 passed (1)
```

## Full verification

```powershell
pnpm test
pnpm build
pnpm check
```

Results:

- `pnpm test`: passed — server and web each ran one passing test; contracts had no test files and exited successfully with `--passWithNoTests`.
- `pnpm build`: passed — contracts and server TypeScript checks passed; Vite produced the web distribution.
- `pnpm check`: passed — TypeScript checks passed in contracts, server, and web.

## Files changed

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `tsconfig.base.json`
- `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`
- `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/src/app.ts`, `apps/server/src/index.ts`, `apps/server/tests/health.test.ts`
- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/app/App.tsx`, `apps/web/src/app/App.test.tsx`, `apps/web/src/styles/global.css`, `apps/web/src/test/setup.ts`

## Self-review

- Confirmed the root `dev`, `build`, `test`, and `check` scripts exactly match the task brief.
- Confirmed the server entry point binds explicitly to `127.0.0.1`.
- Confirmed no cloud integration, normal-data storage, profile upload handling, password handling, browser secret storage, or secret values were introduced.
- Confirmed all required routes are nested inside the persistent sidebar shell.
- Confirmed the vault item is a `span`, not a link/button, and carries `aria-disabled="true"` plus `即将推出`.
- Confirmed tests use real Express/Supertest and real React rendering without mocks, and that each required initial test was observed failing before implementation.
- Ran `git diff --check`; no whitespace errors were reported.

## Concerns

Vite's default bundled config loader could not read an ancestor directory in this restricted Windows workspace. The web scripts therefore use Vite's supported `--configLoader runner` mode. No functional application behavior is affected; it keeps web test and build execution reliable in this environment.
