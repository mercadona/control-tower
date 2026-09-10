# Project Readiness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a developer inspect the selected repository before starting a plan, with evidence-backed readiness findings and explicit unverified capabilities.

**Architecture:** A query depends on a project-setup inspection port and returns an immutable report. A Git/Docker adapter reads the selected checkout and its locally known remote base, with injected command execution and budgets. An HTTP boundary exposes the report to an explicit inspection button inside the start-plan form; the domain remains independent of Git, Docker, HTTP, and React. No persistent aggregate is introduced.

**Tech Stack:** TypeScript, Node.js, Express, React, Vitest, existing Git and Docker executables.

Tracking: https://github.com/mercadona/control-tower/issues/275

## Agreed scope

- Inspect; do not run repository commands, create worktrees/issues, build images,
  start containers, install dependencies, or modify permissions.
- Read the actual locally known `origin/HEAD` base, because that is where new
  worktrees start. Explain local/base drift and do not implicitly fetch.
- Inspect build/test/lint declarations, convention sources, ignored runtime state,
  and whether plans can be committed. No prerequisite to run ct-groom.
- Recognize direct pytest bounds and the reference repository's Make/script path.
  Unrecognized command chains remain unverified rather than inferred safe.
- Inspect a single supported Compose file, Docker availability/resources, service
  limits, readiness, fixed ports/names, bind mounts/build context, and existing
  containers belonging to its resolved project. Report unsupported/ambiguous
  Compose layouts and unperformed worktree execution as unverified.
- Use short command and total inspection budgets, output bounds, and hard process
  termination on timeout. Bound file and container counts. Never expose raw
  environment values or subprocess diagnostics containing credentials.
- Show Spanish product copy, technical evidence, next actions, observed checkout
  and base revision. Clear stale reports when the selected target changes.
- Keep the existing plan submission decision intact; this is a diagnostic, not a
  new approval gate. Installed-tool/session information remains available through
  the existing external-tools panel; remote model availability is not certified.

## Task 1: inspection report and bounded adapter

**Files:**
- Create `backend/src/domain/value-objects/project-readiness.ts`.
- Create `backend/src/domain/value-objects/readiness-finding.ts`.
- Create `backend/src/domain/ports/project-setup.ts`.
- Create `backend/src/application/queries/inspect-project.ts`.
- Create `backend/src/infrastructure/git-docker-project-setup.ts`.
- Modify `backend/src/infrastructure/tool-runner.ts` to accept optional explicit
  output and termination settings while preserving existing callers.
- Create `backend/__tests__/infrastructure/git-docker-project-setup.test.ts` and
  `backend/__tests__/application/inspect-project.test.ts`.

1. Write failing adapter tests with command-boundary doubles for a bounded
   reference checkout, missing declarations, automatic workers, unknown commands,
   local/base drift, unreachable Docker, malformed output, missing/mismatched
   mounts, ambiguous Compose files, and exhausted budgets.
2. Run `npm test --prefix backend -- git-docker-project-setup inspect-project`;
   confirm failure because the new behavior is absent.
3. Implement immutable findings (`ready`, `changes-required`, `unverified`), an
   exhaustive aggregate outcome, and an inspection query returning its result.
4. Implement the adapter using fixed read-only Git/Docker argument vectors and
   validated projections of their output. Keep missing, unreadable, and absent
   observations distinct. No arbitrary shell or Make execution.
5. Verify the focused suites and `npm run typecheck --prefix backend`.

## Task 2: HTTP integration

**Files:**
- Create `backend/src/infrastructure/project-readiness-route.ts`.
- Modify `backend/src/infrastructure/api-server.js` and `ct-api.mjs`.
- Create `backend/__tests__/infrastructure/project-readiness-route.test.ts`.

1. Write failing route tests for `POST /project-readiness` with `{repo, path}`,
   unknown fields, malformed requests, foreign origins, unsupported methods, and
   report projection. Verify the endpoint does not create a plan.
2. Add the boundary model and route using existing response/origin/body handling.
3. Inject inspection dependencies and budgets at the composition root. Bound
   concurrent inspections independently from plan creation.
4. Run the new route suite and backend type checks.

## Task 3: frontend inspection

**Files:**
- Create `frontend/src/app/project-readiness/ProjectReadiness.types.ts`, `client.ts`,
  and `components/project-readiness/ProjectReadiness.tsx` with its stylesheet.
- Create `frontend/src/__scenarios__/ProjectReadinessMother.ts` and component/client tests.
- Modify `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx`.
- Modify `frontend/vite.config.ts` to proxy the new endpoint.

1. Test explicit initiation, valid target requirements independent of ticket text,
   finding/evidence/action rendering, unknown transport or payload, repeat requests,
   changed targets, late responses, and absence of plan-creation requests.
2. Implement strict response validation and Spanish labels/actions. Abort and
   discard outdated requests; a previous target's result must never certify a new
   one. Keep findings visible and accessible without requiring a successful result.
3. Insert the inspection panel before the plan-submit button. It makes no request
   until the developer asks for inspection.
4. Run frontend tests and `npm run build --prefix frontend`.

## Task 4: end-to-end wiring and validation

1. Run backend type checks and the full backend/frontend suites. The baseline was
   1,364 backend fast tests and 670 frontend tests, all passing.
2. Exercise the real adapter against the reference checkout, with only read-only
   commands; record actual results, base revision, and remaining unsupported cases.
3. Run the production frontend build and whitespace checks.
4. Document endpoint semantics and limitations, update issue #275 with evidence,
   and report results. Commit/push only when the user explicitly requests them.
