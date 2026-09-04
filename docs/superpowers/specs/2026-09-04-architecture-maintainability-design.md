# Architecture and Maintainability Refactor Design

## Context

LYJ Workbench has a healthy verification baseline, with shared runtime schemas, a tested Express server, a React client, and a system-plugin kernel. Continued feature work has nevertheless concentrated responsibilities in several modification hotspots:

- `packages/contracts/src/index.ts` owns schemas and inferred types for many unrelated domains.
- `apps/web/src/lib/api.ts` exposes one client object for every browser-to-server interaction.
- `apps/server/src/app.ts` constructs dependencies, initializes plugin state, registers core and plugin routes, serves static files, and handles errors.
- `apps/server/src/modules/preferences/preferences.repository.ts` owns several preference domains and historical seed behavior.

The repository also lacks a single task control surface for multi-agent work, and its ignore rules do not currently protect all local package-store, operating-system, and SQLite artifacts from accidental staging.

The existing external behavior is valuable and well tested. This refactor therefore improves internal boundaries without redesigning the product.

## Goals

1. Reduce the responsibility and change surface of the main contract, browser API, server composition, and preference repository files.
2. Preserve all user-visible behavior and public integration points during the first refactor.
3. Make independent work packages explicit enough for multiple agents to implement without editing the same primary files.
4. Introduce durable global task tracking and a user-facing change log.
5. Prevent local SQLite data, SQLite sidecars, pnpm stores, and operating-system metadata from being staged by default.

## Non-goals

- Changing HTTP methods, paths, status codes, error codes, or response bodies.
- Changing SQLite schemas, migration versions, transaction semantics, or data locations.
- Changing UI layout, copy, workflows, or plugin behavior.
- Changing encryption, vault recovery, legacy DPAPI, backup, or secret-handling behavior.
- Replacing the existing plugin kernel or introducing third-party plugin execution.
- Removing compatibility aggregation entry points during this refactor.
- Deleting or relocating any existing local user-data file.

## Chosen Approach

Use incremental module extraction with compatibility entry points. Each extraction is independently verifiable and reversible. Shared foundations are completed serially; browser API, server composition, and preference repository work may proceed in parallel only after the shared contracts task is complete.

This is preferred over a limited two-file cleanup because it addresses the back-end composition and persistence hotspots as well as the front end. It is preferred over a one-shot vertical-slice migration because the latter would create a large diff, make regressions harder to isolate, and increase merge conflicts without providing proportional product value.

## Target Architecture

### Shared contracts

Domain files under `packages/contracts/src/` own their Zod schemas and inferred TypeScript types. Domains include vault, profile, preferences, settings, AI connections and features, reminders, and calendar; the existing plugin, surface, password-manager, and AI-persona modules remain independent.

`packages/contracts/src/index.ts` remains the supported compatibility entry point and re-exports every public symbol currently available from `@workbench/contracts`. Existing application imports do not have to change as part of the contract extraction. Domain modules must not import the root index, preventing circular dependencies.

### Browser API client

A transport module owns request execution, response parsing, mutation headers, abort propagation, and normalized API errors. Domain client modules own only endpoint methods and types for their feature area.

`apps/web/src/lib/api.ts` remains a compatibility entry point. It composes and exports the existing `api` object with the same method names and signatures. Feature components may continue importing this object, so the extraction does not require a broad call-site migration.

### Server composition

`createApp(options)` remains the server's public composition entry point and retains the current `CreateAppOptions` injection contract. Internal modules separate:

- dependency and service construction;
- core route registration;
- plugin-owned route registration;
- static application serving and terminal not-found behavior;
- centralized error handling.

Composition helpers receive explicit dependencies and do not introduce mutable module-level singletons. Initialization order remains observable-equivalent: preference defaults and compiled plugin reconciliation occur before operational repositories and plugin startup are used; request-boundary and no-store middleware remain ahead of protected routes; API fallbacks, static serving, and error middleware retain their current order.

### Preferences persistence

The public repository behavior and database ownership model remain compatible. Responsibilities are extracted behind focused internal collaborators for layout/navigation, appearance, AI Office ordering, and legacy/default seeding.

The extraction must preserve existing transaction boundaries, filtering of installed and enabled plugin contributions, validation failures, seed idempotency, and connection lifetime. It must not add a new generic repository abstraction or alter the database schema.

## Request and Data Flow

1. Browser feature code calls a method on the compatibility `api` object.
2. The method is supplied by one domain client and delegates transport concerns to the shared request executor.
3. Express receives the unchanged request through the local request boundary and body middleware.
4. A core or plugin-owned router handles the request using dependencies constructed by the server composition layer.
5. Repositories retain their existing operational database-provider pattern and transaction semantics.
6. The response returns through the unchanged transport parser and domain method signature.

No new network boundary, persistence boundary, or serialization format is introduced.

## Error Handling

- Existing API error envelopes and codes remain unchanged.
- Vault lock, vault integrity, photo upload limit, not-found, and internal-error mappings retain their current precedence.
- Browser request failures continue to use the existing normalized error behavior.
- Abort signals remain attached to the same browser operations that currently accept them.
- Plugin startup readiness and plugin-route guards remain mandatory for plugin-owned endpoints.
- A refactor task that changes an observable error or timing contract is considered failed and must be corrected before dependent tasks begin.

## Multi-Agent Coordination

### Global task control

Create `docs/TODO.md` as the authoritative coordination surface. Every task entry contains:

- ID and title;
- status and priority;
- goal and explicit non-goals;
- dependencies;
- responsible agent;
- primary file ownership;
- acceptance commands;
- completion evidence;
- risks or blocking condition.

Statuses are `BACKLOG`, `READY`, `IN_PROGRESS`, `REVIEW`, `DONE`, and `BLOCKED`.

Only one agent owns a task at a time. Before editing, an agent records its identity on the task and changes the status to `IN_PROGRESS`. When implementation and task-level verification finish, it changes the task to `REVIEW` and records commands, exit codes, and test counts. A reviewer moves it to `DONE` only after checking the diff and verification evidence. A `BLOCKED` task states both the concrete cause and the condition that would unblock it.

Newly discovered work receives a new task ID instead of silently expanding the active task. Parallel tasks avoid overlapping primary files. If a shared compatibility export must change, the conflict is recorded in `docs/TODO.md` and resolved by the coordinating or integration agent.

### Change log

Create a root `CHANGELOG.md` following Keep a Changelog conventions. Completed, externally meaningful changes are recorded under `Unreleased` using appropriate categories such as Added, Changed, Fixed, and Security.

Plans, partially implemented work, agent assignments, and verification progress belong only in `docs/TODO.md`. A task updates the change log only after it reaches `DONE`; purely internal refactors are recorded when they materially improve contributor-facing architecture or repository safety.

## Work Packages and Dependencies

### ARCH-001: Architecture guardrails and repository hygiene

Add behavior-based architecture guardrails where a missing boundary can be observed, and extend ignore rules for `.DS_Store`, `.pnpm-store/`, SQLite databases, and SQLite sidecars. Create the initial `docs/TODO.md` and `CHANGELOG.md`. Do not delete existing untracked files.

### ARCH-002: Shared-contract domain extraction

Split the root contract module into domain-owned files while preserving the complete root export surface. This task follows ARCH-001 and is the prerequisite for all parallel extraction work.

### ARCH-003: Browser API domain extraction

Extract the shared transport and domain clients while retaining the compatibility `api` object. This task follows ARCH-002.

### ARCH-004: Server composition extraction

Extract dependency construction, route groups, static serving, and error handling while preserving `createApp(options)` and middleware order. This task follows ARCH-002.

### ARCH-005: Preference responsibility extraction

Extract focused internal preference collaborators without changing public repository behavior, SQL semantics, or seed results. This task follows ARCH-002.

### ARCH-006: Integration verification and documentation

Review the combined diff, resolve compatibility-entry conflicts, run the complete verification pipeline, update architectural documentation as required, move verified tasks to `DONE`, and finalize the `Unreleased` change log. This task follows ARCH-003, ARCH-004, and ARCH-005.

The execution topology is:

```text
ARCH-001
    |
ARCH-002
  / | \
003 004 005
  \ | /
 ARCH-006
```

ARCH-001 and ARCH-002 run serially. ARCH-003, ARCH-004, and ARCH-005 may run concurrently with distinct file ownership. ARCH-006 is an integration task and does not run concurrently with the extraction tasks.

## Testing Strategy

All behavior changes and refactor guardrails follow red-green-refactor discipline. Before writing a new test, the implementer names the realistic production regression it catches and derives expected values independently of the implementation.

Tests must exercise public exports, actual request behavior, composition results, or database outcomes. Tests that merely search source text for expected lines are not sufficient architecture protection.

Task-level verification includes the narrow affected tests, followed by the relevant workspace type check and test command. ARCH-006 runs:

```text
pnpm check
pnpm test
pnpm build
```

Final acceptance requires:

- all 620 currently passing tests still pass;
- the 12 existing platform-dependent skipped tests do not increase;
- every current root contract export remains available;
- existing browser API method names and signatures remain compatible;
- HTTP methods, paths, status codes, response shapes, and error precedence remain unchanged;
- SQLite schema and migration versions remain unchanged;
- `createApp(options)` retains its injection behavior;
- request cancellation and plugin startup-wait behavior remain unchanged;
- local SQLite files, SQLite sidecars, `.pnpm-store/`, and `.DS_Store` are ignored by default;
- production builds complete successfully on the local verification platform.

Windows-only DPAPI integration remains an explicit local Windows verification because hosted and macOS environments cannot provide its stable interactive-user prerequisites. The skip is not treated as new coverage loss.

## Rollback and Risk Control

Each ARCH task is a rollback boundary. No dependent task starts until its prerequisite is verified. If a task changes observable behavior, introduces a circular dependency, alters database results, or changes middleware ordering, that task is corrected or reverted before the task graph advances.

The main risks are hidden initialization dependencies, incomplete compatibility exports, request cancellation regressions, SQLite lifetime changes, and merge conflicts in shared entry points. Explicit dependency injection, compatibility barrels, behavior-level tests, preserved transaction ownership, narrow file ownership, and serial shared-foundation tasks mitigate these risks.

Existing untracked user data is outside the refactor's mutation scope. Repository hygiene changes prevent future accidental staging but never remove, move, or rewrite those files.
