# A finished slice is told apart from a lost one — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the backend records a harvest when it collects a merged slice, `/work-progress` answers `finished` for it, and the page shows «Slice #N entregado» instead of the stale-plan warning.

**Architecture:** `PlanRecords` (the port over `harness/`) grows two methods, one to record a harvest and one to find a harvested slice; `HarvestDelivery` records after a `collected` outcome; `InspectedWorkInventory` falls back to the harvested record and reads its pull request through a new journal-only method of `RunDelivery`; the frontend gets a hook that asks what became of a saved workflow no longer active.

**Tech Stack:** Node.js TypeScript (erasable syntax only) with vitest in `backend/`; React + TypeScript with vitest and Testing Library in `frontend/`.

**Spec:** `docs/superpowers/specs/2026-09-24-finished-slice-design.md`

## Global Constraints

- Code, tests, logs and docs in English; the product copy the page shows in Spanish.
- No comments or docstrings; every function hangs off a type (`plugin/conventions/style.md`).
- Backend modules are `.ts`, relative imports name `.ts`; frontend imports are absolute from `src/`.
- Backend tests run from `backend/` only; fast subset `npx vitest run --exclude '**/*-real-process.test.ts'`; `npm run typecheck` before the suite.
- Frontend: no semicolons, named exports, test names follow the neighbouring file's style.
- Wire fields snake_case: `harvested_at`, `pull_request`.
- Copy, verbatim: «Slice #N entregado», «En marcha: #M.», «No hay más slices en marcha en este repositorio.», «El slice seleccionado ha terminado.», «Cerrar», warning title «El plan guardado ya no está activo», warning description «El backend ya no tiene constancia de este plan. Descarta el estado para volver a empezar.»
- `/active-plans` does not change.

## Review Focus

1. A `harvest.json` written for a record whose conversation is not the one the page saved (a re-dispatched issue): the frontend must compare `agent` and not announce someone else's delivery.
2. A delivered slice whose delivery receipt is corrupt: the answer is `work-not-read`, never `finished` with an invented pull request and never `work-not-found`.
3. A `collected` harvest of a worktree the backend never dispatched: nothing written, no line printed, the sweep carries on.
4. The page reading `not-found` in the instant before the receipt lands: the warning must turn into the banner on the next poll, without a reload.
5. Several slices still in flight in the same checkout after one finishes: the banner names all of them, and slices of another checkout are not named.

---

### Task 1: `harness/<conversation>/harvest.json` on disk

**Files:**
- Create: `backend/src/domain/value-objects/harvested-work.ts`
- Modify: `backend/src/domain/ports/plan-records.ts`
- Modify: `backend/src/domain/exceptions.ts` (add `HarvestNotRecorded`)
- Modify: `backend/src/infrastructure/disk-plan-records.ts`
- Test: `backend/__tests__/infrastructure/disk-plan-records.test.ts`

**Interfaces:**
- Produces: `class HarvestedWork { readonly watch: PlanWatch; readonly harvestedAt: string }`
- Produces: `PlanRecords.recordHarvest(asked: { issue: number, repository: RepositoryName }): Promise<void>` — writes `{"version":1,"at":"<now>"}` next to the matching record's `dispatch.json`; does nothing when no record matches; raises `HarvestNotRecorded` when the write fails.
- Produces: `PlanRecords.harvested(asked: { issue: number, repository: RepositoryName }): Promise<HarvestedWork | null>` — `null` without a matching record or without `harvest.json`; `PlanAgentNotNamed` when it is unreadable; `PlanAgentNotLaunched` when the disk refuses.

- [ ] **Step 1: failing tests** in `disk-plan-records.test.ts`, arranged with `writeFile` (never with the piece under test):
  - `a_collected_harvest_is_recorded_beside_the_dispatch_of_the_slice_it_harvested` — seed `harness/<FIRST_AGENT>/dispatch.json` with `harvestedDescriptor()`, call `recordHarvest({ issue: 332, repository })`, read the file literally: `'{\n  "version": 1,\n  "at": "2026-09-15T10:00:00.000Z"\n}\n'`.
  - `a_harvest_of_a_slice_nobody_dispatched_writes_nothing` — no dispatch; `recordHarvest` resolves; `harness/` has no `harvest.json`.
  - `a_harvest_the_disk_refuses_to_record_is_told_as_not_recorded` — `HeadlessFiles` whose `writeOnce` raises `EACCES`; rejects with `HarvestNotRecorded`.
  - `a_harvested_slice_is_found_with_the_moment_it_was_harvested_although_its_worktree_is_gone` — seed dispatch + harvest.json, `exists: async () => false`; `harvested()` returns the watch of `FIRST_AGENT` and `'2026-09-15T10:00:00.000Z'`.
  - `a_slice_with_no_harvest_receipt_is_not_harvested` — dispatch only → `null`.
  - `an_unreadable_harvest_receipt_is_refused_instead_of_passing_for_a_harvest` — `harvest.json` = `'{"version":2}'` → rejects `PlanAgentNotNamed`.
- [ ] **Step 2:** `cd backend && npx vitest run __tests__/infrastructure/disk-plan-records.test.ts` — FAIL (methods missing).
- [ ] **Step 3: implement.**
  - `harvested-work.ts`: frozen class with `watch`, `harvestedAt`.
  - `exceptions.ts`: `export class HarvestNotRecorded extends HarvestFailure {}` after `HarvestNotUnderstood`.
  - `plan-records.ts`: the two methods throwing `must implement`, like their siblings.
  - `disk-plan-records.ts`: `static readonly HARVEST_RECEIPT = 'harvest.json'`; a `HarvestReceiptRecord` class in the same file (boundary model, one consumer) with `static text(at: string): string` and `static read(text: string): string` that demands exactly `version` and `at`, `version === 1`, `at` an ISO timestamp (reuse `DispatchRecord`'s shape by making its timestamp check a static both call — one rule of what a timestamp is); `recordHarvest` finds `this.#matching(await this.#descriptors(), asked)`, returns when `null`, writes with `this.files.writeOnce`, and turns any failure into `HarvestNotRecorded(`${path} could not be written: ${String(cause)}`)`; `harvested` finds the match, `#read`s the receipt, returns `null` when absent, `new HarvestedWork({ watch, harvestedAt })` when readable, `PlanAgentNotNamed(`${path} cannot be read as a harvest receipt: …`)` when not.
- [ ] **Step 4:** the same vitest command — PASS; break by hand the `version` check and the "no record" return, see each test go red, restore.
- [ ] **Step 5:** commit `feat(backend): record the harvest of a collected slice beside its dispatch`.

### Task 2: the harvest sweep records what it collected

**Files:**
- Modify: `backend/src/application/actions/harvest-delivery.ts`
- Modify: `backend/src/infrastructure/harvest-clock.ts` (a line for `HarvestNotRecorded`)
- Modify: `backend/src/infrastructure/ct-api.ts` (`#harvestClock` receives `records`)
- Test: `backend/__tests__/application/harvest-delivery.test.ts`, `backend/__tests__/infrastructure/harvest-clock.test.ts`

**Interfaces:**
- Consumes: `PlanRecords.recordHarvest` (Task 1).
- Produces: `new HarvestDelivery({ harvest, records })`.

- [ ] **Step 1: failing tests.** In `harvest-delivery.test.ts` a `PlanRecordsDouble extends PlanRecords` that pushes each `recordHarvest` argument and can be told to raise:
  - `a_collected_slice_is_recorded_as_harvested_under_its_issue_and_repository` — `COLLECTED` → records asked `[{ issue: 42, repository }]`.
  - `a_slice_the_plugin_did_not_collect_is_not_recorded_as_harvested` — `it.each` over `WAITING`, `KEPT`, `PARTIAL` → nothing asked.
  - `a_harvest_that_could_not_be_read_records_nothing` — `HarvestNotRead` → nothing asked.
  - `a_harvest_that_could_not_be_recorded_travels_out_typed` — records raise `HarvestNotRecorded('disk full')` → rejects with it.
  In `harvest-clock.test.ts`: `a_collected_slice_whose_harvest_could_not_be_recorded_says_so_and_the_sweep_goes_on` — the harvest answers `new HarvestNotRecorded('harness/x/harvest.json could not be written: EACCES')` → stderr line `harvest #42: collected, but its receipt could not be written: harness/x/harvest.json could not be written: EACCES\n` and the trace still reaches `relay`. The existing `every_harvest_failure_the_catalogue_declares_has_a_line…` goes red by itself until the line exists.
- [ ] **Step 2:** `npx vitest run __tests__/application/harvest-delivery.test.ts __tests__/infrastructure/harvest-clock.test.ts` — FAIL.
- [ ] **Step 3: implement.** `HarvestDelivery` takes `{ harvest, records }`; `execute` collects, and when the outcome is `HarvestOutcome.COLLECTED` awaits `records.recordHarvest({ issue: params.prepared.issueNumber, repository: params.repository })` before answering. `SweepLine.#BY_FAILURE` gains `[HarvestNotRecorded, (prepared, failure) => `harvest #${prepared.issueNumber}: collected, but its receipt could not be written: ${failure.message}\n`]`. `ct-api.ts`: pass `records` into `#harvestClock` and into `new HarvestDelivery`.
- [ ] **Step 4:** same command — PASS; `npm run typecheck`; remove the `COLLECTED` condition by hand, see the three negative cases go red, restore.
- [ ] **Step 5:** commit `feat(backend): the harvest sweep records every slice it collected`.

### Task 3: the pull request of a delivered slice, read from the journal alone

**Files:**
- Modify: `backend/src/domain/ports/run-delivery.ts`
- Modify: `backend/src/infrastructure/checked-run-delivery.ts`
- Modify: `backend/__tests__/run-delivery-double.ts`, `backend/__tests__/infrastructure/run-plan-recovery.test.ts` (the two local doubles)
- Test: `backend/__tests__/infrastructure/checked-run-delivery*.test.ts` (the non-real-process one that already arranges a journal with a receipt)

**Interfaces:**
- Produces: `RunDelivery.recordedPullRequest(watch: PlanWatch): Promise<DeliveredPullRequest | null>` — `null` when the journal holds no intent or no receipt; `RunDeliveryUncertain` when either cannot be validated; asks neither git nor GitHub and does not need the worktree.

- [ ] **Step 1: failing tests**, reusing the file's journal arrange:
  - `a_delivered_slice_names_its_pull_request_from_the_receipt_although_its_worktree_is_gone` — journal with intent + push/pull-request/release evidence + receipt, worktree removed, `gh` double that raises on any request → `{ number, url }` of the receipt.
  - `a_slice_with_no_delivery_receipt_names_no_pull_request` → `null`.
  - `a_receipt_that_names_another_revision_is_refused` — receipt `sha` altered → rejects `RunDeliveryUncertain`.
- [ ] **Step 2:** run that test file — FAIL.
- [ ] **Step 3: implement** in `CheckedRunDelivery`: read `intent.json` (`null` → `null`), `#parseIntent`, read `receipt.json` (`null` → `null`), `return this.#validateReceipt(watch, intent, receipt)`. Add `abstract recordedPullRequest(watch)` to the port; the three test doubles answer `null`.
- [ ] **Step 4:** PASS; typecheck; break the `null` return for a missing receipt by hand, see red, restore.
- [ ] **Step 5:** commit `feat(backend): name a delivered slice's pull request from its journal alone`.

### Task 4: `/work-progress` answers `finished`

**Files:**
- Modify: `backend/src/domain/value-objects/tracked-work.ts`, `backend/src/domain/value-objects/work-progress.ts`
- Modify: `backend/src/infrastructure/inspected-work-inventory.ts`
- Modify: `backend/src/application/queries/read-work-progress.ts`
- Modify: `backend/src/infrastructure/work-progress-route.ts`
- Modify: `backend/src/infrastructure/ct-api.ts` (inventory gets `records`, `delivery: runDelivery`)
- Modify: `backend/API.md`
- Test: `backend/__tests__/infrastructure/inspected-work-inventory.test.ts`, `backend/__tests__/application/read-work-progress.test.ts`, `backend/__tests__/infrastructure/work-progress-route.test.ts`

**Interfaces:**
- Consumes: `PlanRecords.harvested` (Task 1), `RunDelivery.recordedPullRequest` (Task 3).
- Produces: `WorkCondition` member `{ phase: 'finished', harvestedAt: string, pullRequest: DeliveredPullRequest | null }`; the wire variant `{"phase":"finished","harvested_at":"…","pull_request":{"number":998,"url":"…"}|null}`.

- [ ] **Step 1: failing tests.**
  - Inventory (records and delivery doubled): `answers_finished_with_its_pull_request_for_a_harvested_slice_no_longer_active`; `answers_finished_without_a_pull_request_when_the_slice_was_delivered_outside_the_backend`; `an_active_slice_is_never_read_as_finished` (active + harvested → `implementing`, harvested not asked); `a_slice_neither_active_nor_harvested_is_not_found`; `an_unreadable_harvest_receipt_is_not_read_rather_than_not_found` (`PlanAgentNotNamed` → `WorkNotRead`); `an_unprovable_delivery_receipt_is_not_read_rather_than_finished` (`RunDeliveryUncertain` → `WorkNotRead`).
  - Use case: `passes_a_finished_condition_through_without_reading_plan_or_execution` (plan, activity and implementation doubles raise if asked).
  - Route: `returns_the_literal_finished_contract` — body `{repo:'owner/name',issue:7,agent:'conversation-7',progress:{phase:'finished',harvested_at:'2026-09-24T09:30:00.000Z',pull_request:{number:998,url:'https://github.com/owner/name/pull/998'}}}`.
- [ ] **Step 2:** run the three files — FAIL.
- [ ] **Step 3: implement.** `InspectedWorkInventory` constructor `{ inspection, plans, records, delivery }`; when `plans.find` is `null` it calls `records.harvested`, then `delivery.recordedPullRequest(harvested.watch)`, mapping `PlanAgentFailure` and `RunDeliveryFailure` to `WorkNotRead`, `null` to `WorkNotFound`. `ReadWorkProgress`: `case 'finished': return new ReadWorkProgressResult(new WorkProgress(watch, work.condition))`. `WorkProgressDetail` includes the finished member. Route `#detail`: `case 'finished'` projects `harvested_at` and `pull_request`. `API.md`: the `finished` row, its example, and `work-not-found` = "neither in flight nor recorded as harvested".
- [ ] **Step 4:** PASS; typecheck; drop the active-first order by hand, see `an_active_slice_is_never_read_as_finished` go red, restore.
- [ ] **Step 5:** commit `feat(backend): /work-progress answers finished for a harvested slice`.

### Task 5: the frontend reads `finished` and `not-found`

**Files:**
- Modify: `frontend/src/app/work-progress/WorkProgress.types.ts`, `contract.ts`, `client.ts`, `useWorkProgress.ts`
- Create: `frontend/src/app/work-progress/useWorkConclusion.ts`
- Test: `backend/__tests__/infrastructure/work-progress-contract.test.ts` (literal payloads into the real reader), `frontend/src/app/work-progress/useWorkProgress.test.ts`

**Interfaces:**
- Produces: `WorkProgress` member `{ phase: 'finished'; harvestedAt: string; pullRequest: { number: number; url: string } | null }`.
- Produces: `WorkProgressOutcome` member `{ kind: 'not-found'; detail: string }`; `useWorkProgress` keeps treating it as unavailable.
- Produces: `useWorkConclusion(identity: WorkIdentity | null): WorkConclusion` with `WorkConclusion = { kind: 'checking' } | { kind: 'finished'; harvestedAt: string; pullRequest: … | null } | { kind: 'not-found' }` — polls every 3 s, stops on `finished`, keeps the last conclusion on an unavailable read.

- [ ] **Step 1: failing tests.** Contract: `reads_the_real_backend_finished_projection_with_and_without_its_pull_request`. Client via `useWorkConclusion` (fetch stubbed): `turns_a_work_not_found_refusal_into_not_found`; `moves_from_not_found_to_finished_on_a_later_poll_and_stops_polling`; `keeps_checking_while_the_backend_is_unreachable`; `rejects_a_finished_answer_for_another_conversation` (agent mismatch → stays `checking`).
- [ ] **Step 2:** run them — FAIL.
- [ ] **Step 3: implement** the contract case, the client branch on `code === 'work-not-found'`, the `useWorkProgress` fold of `not-found` into unavailable, and the hook.
- [ ] **Step 4:** PASS; `npm --prefix frontend run build`.
- [ ] **Step 5:** commit `feat(frontend): read a finished slice and a slice the backend no longer knows`.

### Task 6: `Home` announces the delivered slice

**Files:**
- Modify: `frontend/src/pages/home/Home.tsx`
- Modify: `frontend/src/app/slice-session/useAutomaticSliceSelection.ts` (export the same-checkout rule so `Home` does not write it twice)
- Modify: `frontend/src/__scenarios__/WorkProgressMother.ts` (`finished(issue, pullRequest)`)
- Modify: `frontend/README.md`
- Test: `frontend/src/pages/home/__tests__/Home.slicesInFlight.test.tsx`

- [ ] **Step 1: failing tests** (the file's `backendWith` gains an optional `finished` map answering `/work-progress` for a slice no longer listed):
  - `should announce the delivered slice and the one still running in its checkout instead of warning`
  - `should announce the last delivered slice and clear it when closed`
  - `should name every slice still running in the checkout and none of another checkout`
  - `should turn the warning into the announcement once the backend records the harvest`
  - `should keep warning with the corrected copy when the backend has no record of the slice` (replaces the assertion of `a saved workflow the backend no longer reports leaves the other slices standing`)
- [ ] **Step 2:** run the file — FAIL.
- [ ] **Step 3: implement.** `useWorkConclusion` with the saved identity while `reconciliation === 'stale' && uncertainRequest === null`; the stale block renders by conclusion: `finished` → informative `Banner` titled «Slice #N entregado», description «En marcha: #M.» (joined with «, » for several) or «No hay más slices en marcha en este repositorio.», a line «Pull request: #P» linking it when present, as `ImplementProgress` already writes it, and a **Cerrar** button calling `discardStaleWorkflow`; `not-found` → the warning with the corrected copy and **Descartar estado**; `checking` → «Comprobando que el plan sigue activo». Stage subtitle «El slice seleccionado ha terminado.» on `finished`. README: the finished rule beside the handoff.
- [ ] **Step 4:** PASS; `npm --prefix frontend run build`; the whole frontend suite.
- [ ] **Step 5:** commit `feat(frontend): announce a delivered slice instead of the stale-plan warning`.

### Task 7: close

- [ ] Backend: `npm run typecheck` and the fast subset, then the whole suite with bounded workers.
- [ ] Frontend: build and whole suite.
- [ ] Mutation sweep over the new lines, declared in the pull request.
- [ ] Pull request titled `feat: tell a finished slice apart from a lost one` with the design in its body; Project 16 item to `In Review`.
