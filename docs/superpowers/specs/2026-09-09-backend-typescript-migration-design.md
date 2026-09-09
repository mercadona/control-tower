# Backend TypeScript Migration Design

**Date:** 2026-09-09
**Status:** Approved
**Approved by:** repository owner in the planning conversation

## 1. Purpose

Migrate the local HTTP backend from JavaScript to TypeScript without pausing
feature delivery or changing its observable behaviour. The migration includes
production modules, tests, shared test helpers, the process entrypoint, and the
repository rules that govern new backend work.

The migration starts from `main` at `d2c5eb6`, where the backend contains 143
JavaScript files under `backend/src/` and `backend/__tests__/`: 86 production
modules and 57 test or test-helper modules.

## 2. Desired end state

- Every source, test, and test-helper module under `backend/` is TypeScript.
- The backend remains an ESM package and runs directly on Node.js without a
  generated `dist/` tree.
- TypeScript checks the backend in strict mode before Vitest runs.
- Node.js executes only erasable TypeScript syntax.
- The HTTP API, persisted formats, process invocations, diagnostics, and plugin
  contracts are unchanged by the migration.
- New backend modules and tests are TypeScript from the first migration phase.
- JavaScript remains supported only across the existing boundary from the
  backend to `plugin/`, which is outside this migration.

## 3. Runtime and type-checking architecture

The backend raises its runtime floor from Node.js 24 to Node.js 24.12. Node.js
24.12 made type stripping stable. It executes TypeScript by removing erasable
types but does not type-check them, so runtime execution and static validation
remain separate concerns.

The backend adds TypeScript 5.8 or newer and a `tsconfig.json` with strict
checking, ESM-compatible Node resolution, no emit, verbatim module syntax, and
erasable-syntax enforcement. Relative imports name their real extension:
`.ts` for migrated backend modules and `.js` for unmigrated backend modules or
modules owned by `plugin/`.

The transition starts with `allowJs` enabled and `checkJs` disabled. TypeScript
therefore understands the mixed graph without making untouched JavaScript part
of the migration scope. `allowJs` may remain after closure because the backend
intentionally consumes JavaScript from `plugin/`; the absence of JavaScript in
the backend itself is enforced independently.

The migration does not introduce enums, parameter properties, runtime
namespaces, decorators, path aliases, or TypeScript features that require code
generation. Existing frozen objects remain runtime objects and gain literal
types where useful. Existing port classes remain executable classes: converting
them to interfaces would remove behaviour that their tests and doubles observe.

Reference: [Node.js 24 TypeScript documentation](https://nodejs.org/download/release/v24.16.0/docs/api/typescript.html).

## 4. Behaviour-preserving conversion

A migration issue may add type annotations, type aliases, interfaces local to
their owner, readonly declarations, `import type`, and boundary narrowing. It
may rename `.js` or `.mjs` files to `.ts` and update every repository reference
to those files.

A migration issue does not change endpoint payloads, refusal codes, HTTP
statuses, command arguments, environment variables, filesystem formats,
timings, retry rules, log messages, frontend product copy, or the parsed
Spanish headings that are fixed by contract. It also does not redesign class
boundaries or perform unrelated cleanup. A behavioural defect discovered while
typing becomes a separate issue.

Values entering an infrastructure boundary start as `unknown` and are narrowed
before the application or domain consumes them. Explicit `any` is not a normal
escape hatch. A temporary untyped plugin seam must be local, named, and removed
when that seam receives an inferred or declared shape.

## 5. Working while the team changes the backend

The migration uses short-lived branches and independently mergeable pull
requests. There is no migration branch and no feature freeze.

`AGENTS.md` and `CLAUDE.md` receive the same concise rule: a new module or test
under `backend/` is born as TypeScript. The detailed temporary policy lives in
`backend/conventions/this-repository.md`. Existing JavaScript may still receive
functional changes when converting the whole owner would make the feature pull
request unsafe or substantially larger.

An executable architecture test records the 143 JavaScript files that existed
at the start. The baseline is a fixed superset: migrated files disappear from
the tree without requiring edits to the baseline, while any new JavaScript path
fails CI. This avoids turning the baseline into a conflict hotspot. The final
phase replaces the transitional check with a permanent assertion that no
JavaScript or MJS module exists in the backend.

Every migration issue declares the files it owns and all known repository-wide
references it must update. Issues with overlapping files or shared hotspots are
serialized. In particular, `api-server`, `git-workspace`, `gh-plan-issues`, and
`ct-api` are never migrated concurrently with another issue that owns the same
file.

When a functional pull request and a migration pull request overlap, the
functional change merges first. The migration branch then rebases on current
`main` and types the resulting behaviour. Migration work never restores an old
implementation over a newer functional change.

## 6. Test strategy

Each production conversion travels with its direct tests. A shared integration
test migrates with the last production group it spans, so earlier issues do not
repeatedly rewrite the same large test file. The three test helpers migrate with
their first stable consumer group or in the closure phase.

Every migration pull request must pass:

- `npm run typecheck` from `backend/`;
- the directly affected Vitest files;
- `npx vitest run --exclude '**/*-real-process.test.ts' --exclude '**/*-real-process.test.js'`;
- `npm test` before handoff.

The real-process tests remain the runtime proof. They must start the mixed graph
successfully during the transition and start the TypeScript entrypoint directly
once `ct-api.mjs` becomes `ct-api.ts`.

No migration issue earns new tests merely for annotations. A test changes when
its extension, imports, or compile-time fixtures must change. Existing
behavioural assertions remain intact.

## 7. Milestone model

One migration phase equals one GitHub milestone:

1. `Backend TypeScript 0 — Guardrails`
2. `Backend TypeScript 1 — Domain Foundations`
3. `Backend TypeScript 2 — Domain Contracts`
4. `Backend TypeScript 3 — Application`
5. `Backend TypeScript 4 — Adapters`
6. `Backend TypeScript 5 — HTTP and Runtime`
7. `Backend TypeScript 6 — Closure`

All milestones may exist from the start, but only issues in the active
milestone are promoted from `status:backlog` to `status:ready`. Dependencies
inside a milestone use the repository's normal slice-order contract.
Cross-milestone ordering is an operational gate: the next milestone is not
activated until the preceding milestone is closed.

A milestone closes only when all its issues are completed, strict type-checking
passes, the full backend suite passes, and its phase-specific JavaScript
reduction has been verified.

## 8. Phases

### Phase 0 — Guardrails

Introduce the runtime floor, strict TypeScript configuration, CI type-checking,
the temporary repository rules, the no-new-JavaScript check, and one small
production pilot. The phase proves that Node.js, Vitest, the yardstick, and the
mixed import graph agree before broad conversion starts.

### Phase 1 — Domain Foundations

Migrate value objects, policies, and the exception catalogue. Files are ordered
from identifiers and locations through composed workflow state. Repository-wide
references move with each owner.

### Phase 2 — Domain Contracts

Migrate the twelve executable port classes. Their runtime failure behaviour is
preserved while method parameters and results acquire domain types.

### Phase 3 — Application

Migrate all thirteen actions and queries with their thirteen direct tests.
Each issue owns a coherent use-case family and updates its infrastructure call
sites.

### Phase 4 — Adapters

Migrate non-HTTP infrastructure: process execution, external tools, GitHub,
Jira, cmux, filesystem registries, worktrees, progress readers, and the plugin
boundary. Large adapters receive dedicated issues.

### Phase 5 — HTTP and Runtime

Migrate HTTP primitives, request models, routes, background conductors, the API
server, and finally the process entrypoint. The last issue changes the start
command and the real-process test to `ct-api.ts`.

### Phase 6 — Closure

Migrate the remaining yardstick and convention tests, audit every repository
reference, remove the JavaScript baseline, make the permanent TypeScript rule
explicit, and prove that the backend contains no `.js` or `.mjs` modules.

## 9. Risks and controls

| Risk | Control |
|---|---|
| A feature merges while its module is being converted | Functional change merges first; migration rebases and retypes current behaviour |
| A rename breaks a consumer outside `backend/` | Every issue performs a repository-wide reference search; known frontend contract readers are listed explicitly |
| Type annotations conceal a behavioural refactor | Existing tests remain unchanged in meaning; behaviour changes move to separate issues |
| Runtime accepts code that does not type-check | CI runs `typecheck` as a separate mandatory command |
| TypeScript syntax needs transpilation | `erasableSyntaxOnly` rejects it before merge |
| New JavaScript prolongs the mixed state | A fixed baseline rejects every new backend JavaScript path |
| Shared tests or entrypoints become merge hotspots | Ownership and dependency metadata serialize overlapping issues |
| The plugin boundary becomes implicitly `any` | Boundary values are inferred or narrowed locally; the seam remains visible and scoped |

## 10. Success criteria

The migration is complete when all seven milestones are closed, every backend
source and test module is TypeScript, the permanent no-JavaScript assertion is
green, strict type-checking and the full suite pass, the backend starts through
`make run-backend`, and a contract comparison shows no intentional API or
runtime behaviour change.
