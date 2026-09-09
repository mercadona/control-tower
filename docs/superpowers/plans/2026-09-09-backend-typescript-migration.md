# Backend TypeScript Migration Plan

> **For agentic workers:** implement one GitHub issue at a time. The issue owns
> its named files and must be rebased on current `main` before conversion.

**Goal:** Convert every production, test, and test-helper module under
`backend/` from JavaScript to strict TypeScript while feature delivery
continues.

**Architecture:** Node.js 24.12 executes erasable TypeScript directly. A strict
no-emit TypeScript check validates the mixed JavaScript/TypeScript graph, and a
fixed baseline rejects new JavaScript paths until the final closure removes the
baseline.

**Tech stack:** Node.js 24.12 or newer, TypeScript 5.8 or newer, native ESM,
Vitest 4, Express 5, GitHub Actions.

**Approved design:**
`docs/superpowers/specs/2026-09-09-backend-typescript-migration-design.md`

## GitHub publication

| Phase | Milestone | Issues |
|---|---|---|
| 0 | [Backend TypeScript 0 — Guardrails](https://github.com/mercadona/control-tower/milestone/2) | [#199](https://github.com/mercadona/control-tower/issues/199)–[#201](https://github.com/mercadona/control-tower/issues/201) |
| 1 | [Backend TypeScript 1 — Domain Foundations](https://github.com/mercadona/control-tower/milestone/3) | [#202](https://github.com/mercadona/control-tower/issues/202)–[#206](https://github.com/mercadona/control-tower/issues/206) |
| 2 | [Backend TypeScript 2 — Domain Contracts](https://github.com/mercadona/control-tower/milestone/4) | [#207](https://github.com/mercadona/control-tower/issues/207)–[#209](https://github.com/mercadona/control-tower/issues/209) |
| 3 | [Backend TypeScript 3 — Application](https://github.com/mercadona/control-tower/milestone/5) | [#210](https://github.com/mercadona/control-tower/issues/210)–[#215](https://github.com/mercadona/control-tower/issues/215) |
| 4 | [Backend TypeScript 4 — Adapters](https://github.com/mercadona/control-tower/milestone/6) | [#216](https://github.com/mercadona/control-tower/issues/216)–[#225](https://github.com/mercadona/control-tower/issues/225) |
| 5 | [Backend TypeScript 5 — HTTP and Runtime](https://github.com/mercadona/control-tower/milestone/7) | [#226](https://github.com/mercadona/control-tower/issues/226)–[#233](https://github.com/mercadona/control-tower/issues/233) |
| 6 | [Backend TypeScript 6 — Closure](https://github.com/mercadona/control-tower/milestone/8) | [#234](https://github.com/mercadona/control-tower/issues/234)–[#235](https://github.com/mercadona/control-tower/issues/235) |

## Global constraints

- New backend production modules, tests, and test helpers are TypeScript from
  Phase 0 onward.
- Preserve runtime classes, public names, HTTP contracts, persisted formats,
  process arguments, diagnostics, and timing behaviour.
- Use only erasable TypeScript syntax. Do not add enums, parameter properties,
  runtime namespaces, decorators, or path aliases.
- Treat external input as `unknown` and narrow it at the infrastructure edge.
- Keep the plugin in JavaScript. Its modules remain `.js` imports and the
  plugin never imports the backend.
- A conversion renames the owner, migrates its direct test, and updates every
  repository reference to the renamed path.
- Do not mix defect fixes, redesign, or unrelated cleanup into a conversion.
- A functional pull request wins an overlap. Rebase the migration on the
  merged behaviour before continuing.
- Run commands from `backend/`. Every issue passes `npm run typecheck`, its
  affected tests, the fast suite, and the full suite before handoff.
- All issue and milestone titles and bodies are English except for repository
  headings and values pinned by contract.

## Issue acceptance contract

Every issue created from this plan carries these requirements in addition to
its specific acceptance criteria:

- When the issue finishes, each production and test path it owns has the `.ts`
  extension and every repository reference names the real extension.
- When strict type-checking runs, it exits successfully without adding an
  explicit broad `any` escape.
- When the affected tests, fast suite, and full backend suite run, they exit
  successfully.
- When the diff is reviewed, it contains no intentional observable behaviour
  change.
- When another pull request has changed an owned file, the migration is rebased
  and applies types to the version on current `main`.

## Milestone 0 — Backend TypeScript 0 — Guardrails

**Entry condition:** `main` contains `d2c5eb6` or its descendants.
**Exit condition:** the mixed graph is type-checked in CI, new JavaScript paths
are rejected, and one production TypeScript module runs through existing tests.

### Issue 0.1 — Establish the TypeScript runtime and type-check gate

**Files:** `backend/package.json`, `backend/package-lock.json`,
`backend/tsconfig.json`, rename `backend/vitest.config.js` to
`backend/vitest.config.ts`, `.github/workflows/continuous-integration.yml`.

**Delivery:** Raise the backend engine floor to Node.js 24.12; add compatible
TypeScript and Node/Express types; add a strict `typecheck` script; configure
Node ESM, no emit, verbatim module syntax, erasable syntax, `allowJs`, and
disabled JavaScript checking; run type-checking before tests in CI.

**Depends on:** none.

### Issue 0.2 — Prevent new backend JavaScript during the migration

**Files:** `AGENTS.md`, `CLAUDE.md`,
`backend/conventions/this-repository.md`,
`backend/__tests__/typescript-migration-boundary.test.ts`,
`backend/__tests__/fixtures/javascript-migration-baseline.txt`.

**Delivery:** Document the temporary mixed-language rule in both agent entry
documents and its full policy in the backend convention. Record the 143
starting JavaScript paths in a fixed baseline and reject any JavaScript or MJS
path not present there.

**Depends on:** Issue 0.1.

### Issue 0.3 — Prove the mixed graph with SownWorkspace

**Files:** rename `backend/src/domain/value-objects/sown-workspace.js` to
`backend/src/domain/value-objects/sown-workspace.ts`; update its references in
`backend/src/infrastructure/git-workspace.js` and repository-wide consumers.

**Delivery:** Type the recently added value object without changing its frozen
runtime shape. Existing start-plan and git-workspace tests prove the mixed
JavaScript/TypeScript graph.

**Depends on:** Issue 0.2.

## Milestone 1 — Backend TypeScript 1 — Domain Foundations

**Entry condition:** Milestone 0 is closed.
**Exit condition:** every domain module except ports is TypeScript.

### Issue 1.1 — Migrate repository and workspace identifiers

**Files:** `backend/src/domain/value-objects/repository-name.ts`,
`backend/src/domain/value-objects/checkout-root.ts`,
`backend/src/domain/value-objects/workspace-location.ts`, plus every
repository reference to their former `.js` paths.

**Delivery:** Preserve validation, string conversion, equality, and freezing
while giving the three high-fanout identifiers explicit constructor and method
types.

**Depends on:** none inside this milestone.

### Issue 1.2 — Migrate user-story values

**Files:** `backend/src/domain/value-objects/user-story-key.ts`,
`backend/src/domain/value-objects/user-story-url.ts`,
`backend/src/domain/value-objects/user-story-reference.ts`,
`backend/src/domain/value-objects/user-story.ts`, plus all references.

**Delivery:** Preserve the Jira/GitHub reference discrimination and contract
examples while narrowing each constructor and factory result.

**Depends on:** Issue 1.1.

### Issue 1.3 — Migrate plan identity and request values

**Files:** `backend/src/domain/value-objects/plan-comment.ts`,
`backend/src/domain/value-objects/plan-issue-status.ts`,
`backend/src/domain/value-objects/plan-issue.ts`,
`backend/src/domain/value-objects/plan-target.ts`, plus all references.

**Delivery:** Express the closed plan-status vocabulary as literal types
without replacing its runtime object. Preserve all construction and validation
behaviour.

**Depends on:** Issue 1.1.

### Issue 1.4 — Migrate workflow state values

**Files:** `backend/src/domain/value-objects/change-asked.ts`,
`backend/src/domain/value-objects/harvest-outcome.ts`,
`backend/src/domain/value-objects/implementation-state.ts`,
`backend/src/domain/value-objects/plan-briefing.ts`,
`backend/src/domain/value-objects/plan-state.ts`,
`backend/src/domain/value-objects/plan-watch.ts`,
`backend/src/domain/value-objects/plans-in-flight.ts`,
`backend/src/domain/value-objects/prepared-workspace.ts`,
`backend/src/domain/value-objects/tool-session.ts`,
`backend/src/domain/value-objects/workspace-survey.ts`,
`frontend/src/app/implement-progress/ImplementProgress.contract.test.ts`, plus
all other references.

**Delivery:** Type the remaining immutable workflow values and update the
frontend contract reader when `implementation-state.js` becomes `.ts`.

**Depends on:** Issues 1.1, 1.2, and 1.3.

### Issue 1.5 — Migrate domain policies and exceptions

**Files:** `backend/src/domain/exceptions.ts`,
`backend/src/domain/policies/delivery-policy.ts`,
`backend/src/domain/policies/launch-policy.ts`,
`backend/src/domain/policies/retry-policy.ts`, plus all references.

**Delivery:** Preserve the exception hierarchy and policy decisions; type
closed outcomes as literal unions and keep every invalid input failure intact.

**Depends on:** Issues 1.3 and 1.4.

## Milestone 2 — Backend TypeScript 2 — Domain Contracts

**Entry condition:** Milestone 1 is closed.
**Exit condition:** all twelve domain port classes are TypeScript and their
application and adapter consumers type-check.

### Issue 2.1 — Type planning ports

**Files:** `backend/src/domain/ports/plan-agents.ts`,
`backend/src/domain/ports/plan-issues.ts`,
`backend/src/domain/ports/user-stories.ts`, plus all references.

**Delivery:** Type planning inputs and asynchronous results while retaining
the executable not-implemented failures used by tests and doubles.

**Depends on:** none inside this milestone.

### Issue 2.2 — Type workspace and delivery ports

**Files:** `backend/src/domain/ports/checkout-registry.ts`,
`backend/src/domain/ports/go-registry.ts`,
`backend/src/domain/ports/harvest.ts`,
`backend/src/domain/ports/workbench.ts`,
`backend/src/domain/ports/workspace.ts`, plus all references.

**Delivery:** Type filesystem, GO, harvest, reopening, and workspace contracts
without moving infrastructure concepts into the domain.

**Depends on:** none inside this milestone.

### Issue 2.3 — Type progress and review ports

**Files:** `backend/src/domain/ports/implementation-progress.ts`,
`backend/src/domain/ports/plan-progress.ts`,
`backend/src/domain/ports/pull-requests.ts`,
`backend/src/domain/ports/tool-sessions.ts`, plus all references.

**Delivery:** Type progress, pull-request review, and tool-session results
against the value objects established in Milestone 1.

**Depends on:** none inside this milestone.

## Milestone 3 — Backend TypeScript 3 — Application

**Entry condition:** Milestone 2 is closed.
**Exit condition:** all thirteen use cases and all thirteen application tests
are TypeScript.

### Issue 3.1 — Migrate StartPlan and its application test

**Files:** `backend/src/application/actions/start-plan.ts`,
`backend/__tests__/application/start-plan.test.ts`, plus infrastructure and
entrypoint references.

**Delivery:** Type the multi-repository start flow, partial failures,
`SownWorkspace` result, rollback paths, and injected ports without changing
ordering or recovery behaviour.

**Depends on:** none inside this milestone.

### Issue 3.2 — Migrate plan lifecycle actions

**Files:** `backend/src/application/actions/ask-plan-changes.ts`,
`backend/src/application/actions/implement-plan.ts`,
`backend/src/application/actions/review-plan.ts`, and their three matching
tests `backend/__tests__/application/ask-plan-changes.test.ts`,
`backend/__tests__/application/implement-plan.test.ts`, and
`backend/__tests__/application/review-plan.test.ts`, plus all references.

**Delivery:** Type the request, implementation, and review transitions while
preserving their domain failures and side-effect order.

**Depends on:** none inside this milestone.

### Issue 3.3 — Migrate delivery actions

**Files:** `backend/src/application/actions/harvest-delivery.ts`,
`backend/src/application/actions/request-fixes.ts`, and their two matching
tests `backend/__tests__/application/harvest-delivery.test.ts` and
`backend/__tests__/application/request-fixes.test.ts`, plus all references.

**Delivery:** Type harvest and requested-fix orchestration without changing
which port receives each effect.

**Depends on:** none inside this milestone.

### Issue 3.4 — Migrate plan-reading queries

**Files:** `backend/src/application/queries/read-changes-asked.ts`,
`backend/src/application/queries/read-plan-progress.ts`,
`backend/src/application/queries/read-plan-story.ts`, and their three matching
tests `backend/__tests__/application/read-changes-asked.test.ts`,
`backend/__tests__/application/read-plan-progress.test.ts`, and
`backend/__tests__/application/read-plan-story.test.ts`, plus all references.

**Delivery:** Type query parameters and result objects while retaining current
failure propagation.

**Depends on:** none inside this milestone.

### Issue 3.5 — Migrate implementation-reading queries

**Files:** `backend/src/application/queries/read-fixes-asked.ts`,
`backend/src/application/queries/read-implementation-progress.ts`, and their
two matching tests `backend/__tests__/application/read-fixes-asked.test.ts`
and `backend/__tests__/application/read-implementation-progress.test.ts`, plus
all references.

**Delivery:** Type delivery-state projection and review results without
changing the delivery policy.

**Depends on:** none inside this milestone.

### Issue 3.6 — Migrate survey queries

**Files:** `backend/src/application/queries/survey-external-tools.ts`,
`backend/src/application/queries/survey-workspaces.ts`, and their two matching
tests `backend/__tests__/application/survey-external-tools.test.ts` and
`backend/__tests__/application/survey-workspaces.test.ts`, plus all references.

**Delivery:** Type tool and workspace survey inputs and immutable results.

**Depends on:** none inside this milestone.

## Milestone 4 — Backend TypeScript 4 — Adapters

**Entry condition:** Milestone 3 is closed.
**Exit condition:** every non-HTTP infrastructure adapter and its direct tests
are TypeScript.

### Issue 4.1 — Migrate process execution primitives

**Files:** `backend/src/infrastructure/tool-runner.ts`,
`backend/src/infrastructure/external-tool.ts`,
`backend/src/infrastructure/invocation.ts`,
`backend/src/infrastructure/gh.ts`,
`backend/__tests__/infrastructure/tool-runner-real-process.test.ts`,
`backend/__tests__/infrastructure/invocation.test.ts`,
`backend/__tests__/sleep-double.ts`, plus all references.

**Delivery:** Type subprocess options, outputs, failures, retry conversations,
and CLI invocation parsing while retaining timeout and cleanup behaviour.

**Depends on:** none inside this milestone.

### Issue 4.2 — Migrate user-story adapters

**Files:** `backend/src/infrastructure/acli-user-stories.ts`,
`backend/src/infrastructure/gh-user-stories.ts`,
`backend/src/infrastructure/referred-user-stories.ts`, and their three matching
tests `backend/__tests__/infrastructure/acli-user-stories.test.ts`,
`backend/__tests__/infrastructure/gh-user-stories.test.ts`, and
`backend/__tests__/infrastructure/referred-user-stories.test.ts`, plus all
references.

**Delivery:** Type Jira/GitHub response parsing and reference routing while
keeping malformed external data at the boundary.

**Depends on:** Issue 4.1.

### Issue 4.3 — Migrate the GitHub plan-issue adapter

**Files:** `backend/src/infrastructure/gh-plan-issues.ts`,
`backend/__tests__/infrastructure/gh-plan-issues.test.ts`,
`backend/__tests__/infrastructure/plan-issue-body.test.ts`,
`backend/__tests__/infrastructure/plugin-contract.test.ts`, plus all
references.

**Delivery:** Type GitHub payloads and plugin-owned renderers while preserving
the parsed Spanish headings, label vocabulary, and issue body byte contracts.

**Depends on:** Issue 4.1.

### Issue 4.4 — Migrate the GitHub pull-request adapter

**Files:** `backend/src/infrastructure/gh-pull-requests.ts`,
`backend/__tests__/infrastructure/gh-pull-requests.test.ts`, plus all
references.

**Delivery:** Type pull-request and review payloads while preserving anchored
change requests and failure classification.

**Depends on:** Issue 4.1.

### Issue 4.5 — Migrate cmux plan agents and briefing

**Files:** `backend/src/infrastructure/cmux-plan-agents.ts`,
`backend/src/infrastructure/plan-agent-brief.ts`,
`backend/__tests__/infrastructure/cmux-plan-agents.test.ts`,
`backend/__tests__/infrastructure/plan-agent-brief.test.ts`, plus all
references.

**Delivery:** Type launch, resume, review, and fix conversations while keeping
the plugin prompt and shell quoting contracts unchanged.

**Depends on:** Issue 4.1.

### Issue 4.6 — Migrate GitWorkspace

**Files:** `backend/src/infrastructure/git-workspace.ts`,
`backend/__tests__/infrastructure/git-workspace.test.ts`, plus all references.

**Delivery:** Type git commands, filesystem operations, baseline measurement,
`SownWorkspace`, and rollback outcomes without altering command order or disk
formats.

**Depends on:** Issue 4.1.

### Issue 4.7 — Migrate worktree discovery and active-plan recovery

**Files:** `backend/src/infrastructure/worktree-plans.ts`,
`backend/src/infrastructure/active-plan-recovery.ts`,
`backend/__tests__/infrastructure/worktree-plans.test.ts`,
`backend/__tests__/infrastructure/active-plan-recovery.test.ts`,
`backend/__tests__/infrastructure/cmux-contract-real-process.test.ts`, plus all
references.

**Delivery:** Type recovered plan sessions across the cmux and filesystem
boundary while preserving uncertainty and malformed-session handling.

**Depends on:** Issues 4.5 and 4.6.

### Issue 4.8 — Migrate disk registries

**Files:** `backend/src/infrastructure/disk-checkout-registry.ts`,
`backend/src/infrastructure/disk-go-registry.ts`,
`backend/src/infrastructure/disk-implementation-start-registry.ts`, and their
three matching tests
`backend/__tests__/infrastructure/disk-checkout-registry.test.ts`,
`backend/__tests__/infrastructure/disk-go-registry.test.ts`, and
`backend/__tests__/infrastructure/disk-implementation-start-registry.test.ts`,
plus all references.

**Delivery:** Type persisted registry records and atomic writes while retaining
their current file formats and recovery behaviour.

**Depends on:** Issue 4.1.

### Issue 4.9 — Migrate dispatch and progress adapters

**Files:** `backend/src/infrastructure/dispatch-check-harvest.ts`,
`backend/src/infrastructure/dispatch-check-workbench.ts`,
`backend/src/infrastructure/plan-contract-progress.ts`,
`backend/src/infrastructure/run-file-progress.ts`, and their four matching
tests `backend/__tests__/infrastructure/dispatch-check-harvest.test.ts`,
`backend/__tests__/infrastructure/dispatch-check-workbench.test.ts`,
`backend/__tests__/infrastructure/plan-contract-progress.test.ts`, and
`backend/__tests__/infrastructure/run-file-progress.test.ts`, plus all
references.

**Delivery:** Type plugin command outputs and progress files while preserving
their exact command lines, path contracts, and error mapping.

**Depends on:** Issue 4.1.

### Issue 4.10 — Migrate external-tool probing

**Files:** `backend/src/infrastructure/probed-tool-sessions.ts`,
`backend/__tests__/infrastructure/probed-tool-sessions.test.ts`, plus all
references.

**Delivery:** Type the fixed probe catalogue and session outcomes while
preserving the distinction between missing, unknown, and ready.

**Depends on:** Issue 4.1.

## Milestone 5 — Backend TypeScript 5 — HTTP and Runtime

**Entry condition:** Milestone 4 is closed.
**Exit condition:** every production module in `backend/src/` is TypeScript and
the TypeScript entrypoint passes the real-process suite.

### Issue 5.1 — Migrate shared HTTP primitives

**Files:** `backend/src/infrastructure/http.ts`,
`backend/src/infrastructure/projection.ts`,
`backend/__tests__/reviews-spy.ts`, plus all route and test references.

**Delivery:** Type answers, refusals, body reading, origin filtering, and
closed projections without changing status codes or response shapes.

**Depends on:** none inside this milestone.

### Issue 5.2 — Migrate the start-plan route and request model

**Files:** `backend/src/infrastructure/start-plan-route.ts`,
`backend/__tests__/infrastructure/plan-request.test.ts`,
`backend/__tests__/infrastructure/plan-refusal.test.ts`, plus all references.

**Delivery:** Narrow raw JSON into the existing request vocabulary and type
accepted, partial, and refused results without changing wire keys.

**Depends on:** Issue 5.1.

### Issue 5.3 — Migrate implementation routes

**Files:** `backend/src/infrastructure/implement-plan-route.ts`,
`backend/src/infrastructure/implement-progress-route.ts`,
`backend/__tests__/infrastructure/implement-plan-route.test.ts`,
`backend/__tests__/infrastructure/implement-progress-route.test.ts`, plus all
references.

**Delivery:** Type implementation request parsing and progress projection while
preserving refusal codes and HTTP responses.

**Depends on:** Issue 5.1.

### Issue 5.4 — Migrate the review-plan route

**Files:** `backend/src/infrastructure/review-plan-route.ts`,
`backend/__tests__/infrastructure/review-plan-route.test.ts`, plus all
references.

**Delivery:** Type review and change-request input models and projections while
preserving the current closed outcomes.

**Depends on:** Issue 5.1.

### Issue 5.5 — Migrate session and survey routes

**Files:** `backend/src/infrastructure/plan-events-route.ts`,
`backend/src/infrastructure/active-plans-route.ts`,
`backend/src/infrastructure/external-tools-route.ts`,
`backend/__tests__/infrastructure/events-request.test.ts`,
`backend/__tests__/infrastructure/plan-events-route.test.ts`,
`backend/__tests__/infrastructure/external-tools-route.test.ts`, plus all
references.

**Delivery:** Type SSE/session state, recovered plans, and tool surveys without
changing event names or JSON payloads.

**Depends on:** Issue 5.1.

### Issue 5.6 — Migrate background conductors

**Files:** `backend/src/infrastructure/review-watch.ts`,
`backend/src/infrastructure/harvest-clock.ts`,
`backend/__tests__/infrastructure/review-watch.test.ts`,
`backend/__tests__/infrastructure/harvest-clock.test.ts`,
`backend/__tests__/infrastructure/pull-request-review-loop.test.ts`, plus all
references.

**Delivery:** Type timer ownership, polling results, review transitions, and
harvest sweeps while retaining cancellation and cleanup behaviour.

**Depends on:** none inside this milestone.

### Issue 5.7 — Migrate ApiServer and integrated HTTP tests

**Files:** `backend/src/infrastructure/api-server.ts`,
`backend/__tests__/infrastructure/api-server.test.ts`,
`backend/__tests__/infrastructure/refusal-codes.test.ts`, plus all references.

**Delivery:** Type Express requests, responses, lifecycle, and route mounting;
preserve the `{code, detail}` doctrine, protocol refusals, and process cleanup.

**Depends on:** Issues 5.2, 5.3, 5.4, and 5.5.

### Issue 5.8 — Migrate the backend entrypoint

**Files:** rename `backend/src/infrastructure/ct-api.mjs` to
`backend/src/infrastructure/ct-api.ts`; migrate
`backend/__tests__/infrastructure/ct-api-real-process.test.ts`; modify
`Makefile`, `README.md`, `backend/API.md`, and all remaining entrypoint
references.

**Delivery:** Type composition, environment parsing, process failure handling,
and shutdown. `make run-backend` starts `ct-api.ts` directly on Node.js 24.12.

**Depends on:** Issues 5.6 and 5.7.

## Milestone 6 — Backend TypeScript 6 — Closure

**Entry condition:** Milestone 5 is closed.
**Exit condition:** no `.js` or `.mjs` file remains under `backend/`; the
temporary baseline is gone; documentation, CI, type-checking, runtime, and all
tests describe the TypeScript backend.

### Issue 6.1 — Migrate the backend yardstick and convention tests

**Files:** `backend/__tests__/yardstick.ts`,
`backend/__tests__/yardstick.test.ts`,
`backend/__tests__/yardstick-real-process.test.ts`,
`backend/__tests__/conventions-no-restatement.test.ts`,
`backend/__tests__/infrastructure/no-window-titles-parsed.test.ts`,
`frontend/__tests__/yardstick.test.ts`, plus all references.

**Delivery:** Preserve the travelling-convention census and real-process
checks while teaching cross-package readers the final `.ts` paths.

**Depends on:** none inside this milestone.

### Issue 6.2 — Remove transitional JavaScript support from the backend

**Files:** `AGENTS.md`, `CLAUDE.md`,
`backend/conventions/this-repository.md`, `backend/tsconfig.json`,
`backend/__tests__/typescript-migration-boundary.test.ts`, remove
`backend/__tests__/fixtures/javascript-migration-baseline.txt`, and update
`backend/API.md`, `README.md`, `Makefile`, and CI where the final audit finds
stale JavaScript references.

**Delivery:** Replace the temporary migration rule with the permanent
TypeScript rule, remove the baseline, assert zero backend JavaScript/MJS paths,
and verify every documented command against the completed runtime.

**Depends on:** Issue 6.1.

## Milestone activation and closure

- Create all milestones and issues in `status:backlog`.
- Promote only Milestone 0 issues that have satisfied their intra-milestone
  dependencies.
- Close a milestone only after all its issues close as completed and its exit
  condition is verified on current `main`.
- Promote the next milestone only after the previous milestone closes.
- If a phase discovers an unplanned behavioural change, create a separate
  issue outside the migration milestone and keep the migration issue scoped to
  type conversion.

## Global verification

After Issue 6.2 merges, verify from a clean checkout that dependency
installation succeeds, strict type-checking succeeds, the fast suite succeeds,
the complete backend suite succeeds, `make run-backend` starts the TypeScript
entrypoint, and a repository search finds no JavaScript or MJS module below
`backend/`.
