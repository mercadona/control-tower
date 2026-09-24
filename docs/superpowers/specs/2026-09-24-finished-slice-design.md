# A finished slice is told apart from a lost one — design

Brainstormed on 2026-09-24 for issue #540, after the end-to-end run of STAFF-128
on `mo.staff.django-playground`. It replaces the frontend-only approach of the
closed pull request #541, as the comment on #540 asked: the backend reports a
finished slice, and the frontend renders what it is told.

## Why

When a slice is merged and harvested, the page shows the warning «El plan
guardado ya no está activo». It shows between slices and, after the last one, it
never goes away. Seen with #974, #975 (STAFF-126) and #996 (STAFF-128), all of
them merged and harvested.

A slice leaves the backend's inventory for two reasons that nothing tells
apart:

- it **finished**: its pull request merged and the harvest removed its worktree;
- it was **lost**: its record was removed or its worktree deleted by hand.

## What the disk says today

Verified against the code and against the eight records of the end-to-end run.

- `DiskPlanRecords.inFlight` keeps a record of `harness/<conversation>/` only
  while its worktree exists or it carries cleanup evidence. Because of that
  filter, a harvested slice leaves `/active-plans` and makes `/work-progress`
  answer `work-not-found`, exactly as a lost one does.
- The harvest leaves no proof of its own. `dispatch-check --collect` removes the
  worktree, the branch and the cmux workspace, and at most loads a BigQuery row;
  it writes nothing under the state directory. `HarvestClock` only prints
  `harvest #N: collected` to the log.
- The harvest leaves the record in `harness/`. A deliberate cleanup
  (`/cleanup-plan`) moves it to `retired-harness/`.
- The delivery receipt (`run/publication/receipt.json`) proves push, pull
  request and release. It does not prove a merge. #973 was merged and harvested
  with no receipt, because its pull request was opened outside the backend.
  #986 has a receipt and an open pull request.
- The sweep harvests a slice and then, in the same pass, dispatches the next
  ready one (`harvest #974: collected`, then `relay: dispatched …#975`).

So "receipt and no worktree" is not a proof of a finished slice. The only
merge-backed event the backend witnesses is a `collected` harvest, because the
harvest removes a worktree only when its pull request is `MERGED`
(`CollectionPolicy`).

## Decisions

- **D-1 · The backend decides.** The frontend no longer infers "finished" from
  having seen the slice in review.
- **D-2 · Scope is one slice.** "Nothing else in flight in this repository" is
  read from `/active-plans` as it stands. "The story is complete" is out of
  scope; it would be a new story-level contract.
- **D-3 · Proof by a harvest receipt the backend writes (option B).** It is
  written when `HarvestClock` receives `collected`. Asking GitHub on every read
  (option A) was rejected.
- **D-4 · The finished state is served by `/work-progress`, not `/active-plans`.**
  `/active-plans` keeps meaning "in flight", so its readers — the automatic
  slice selection and the agents told to read it in `phase-prompt.ts` — learn
  nothing new, and the list does not grow with every finished slice.
- **D-5 · Accepted limits.** A harvest run by hand (`/ct-next`) writes no
  receipt, and the slices harvested before this change have none. Both still
  read as lost and show the warning.

## Section 1 — the harvest receipt (backend)

- **When.** Only when `HarvestClock` gets `collected` from
  `dispatch-check --collect`. With `kept`, `partial`, `waiting` or a failure
  nothing is written.
- **Where.** `harness/<conversation>/harvest.json`, next to `dispatch.json`. The
  conversation is the record of `harness/` whose repository and issue number
  match the harvested workspace. `DiskPlanRecords` already refuses two records
  for the same slice. A worktree with no record — one the backend did not
  dispatch — gets no receipt, and its harvest behaves as today.
- **What.** `{"version": 1, "at": "<ISO timestamp>"}`. The pull request is not
  copied: it comes from the delivery receipt when there is one.
- **When writing fails.** The worktree is already gone and nothing can be
  harvested again. The clock prints
  `harvest #N: collected, but its receipt could not be written: <cause>`, and the
  slice reads as lost. No retry.
- **Shape.** `HarvestReceipt` is a value object. Writing and finding receipts is
  a domain port implemented on disk beside `DiskPlanRecords`. `HarvestClock`
  receives the port by injection, as it already receives `harvest` and `relay`.

## Section 2 — `/work-progress` answers `finished` (backend)

- `TrackedWork` gains a fourth condition,
  `{phase: 'finished', harvestedAt, pullRequest}`, where `pullRequest` is
  `{number, url}` or `null`.
- `InspectedWorkInventory.find` looks in the active inventory first, as today.
  When the slice is not there, it looks for the matching `harness/` record that
  carries `harvest.json`. When it finds it, the answer is `finished`, with the
  pull request read from the delivery receipt if one exists. Otherwise
  `WorkNotFound`, as now. A finished slice has no worktree, so it cannot be
  active; if both were ever true, active wins.
- `ReadWorkProgress` passes the condition through, as it does for `uncertain`.
- The answer keeps `{repo, issue, agent, progress}`; the new variant is:

  ```json
  {"repo":"owner/name","issue":996,"agent":"93620788-018a-4d99-909a-b4b516473931","progress":{
    "phase":"finished","harvested_at":"2026-09-24T09:30:00.000Z",
    "pull_request":{"number":998,"url":"https://github.com/owner/name/pull/998"}}}
  ```

  Field names are snake_case, like the existing `pull_request` and
  `total_tasks`.
- `work-not-found` now means exactly "neither in flight nor recorded as
  harvested". An unreadable or corrupt `harvest.json` answers `work-not-read`,
  like any other inventory evidence that cannot be read.
- `/active-plans` does not change. `backend/API.md` documents the new variant
  and the narrowed meaning of `work-not-found`.

## Section 3 — the frontend renders what it is told

- **Contract reader and client** (`frontend/src/app/work-progress/`). The reader
  accepts the `finished` variant. The client returns the `work-not-found`
  refusal as its own outcome, `not-found`, instead of folding it into
  `unavailable`.
- **`Home`, when the saved workflow is missing from `/active-plans`.** It asks
  `/work-progress` for the saved identity (repository, issue, conversation).
  Today that read runs only for a confirmed workflow. By answer:
  - **`finished`**: an informative banner, not a warning. «Slice #N entregado»,
    with a link to the pull request when there is one. Under it, «En marcha:
    #M.» when another slice of the same repository and checkout is in
    `/active-plans`, or «No hay más slices en marcha en este repositorio.» when
    none is. A **Cerrar** button clears the saved workflow. The stage subtitle
    reads «El slice seleccionado ha terminado.» `finished` is final, so polling
    stops.
  - **`not-found`**: the warning, with its copy corrected — title «El plan
    guardado ya no está activo», description «El backend ya no tiene constancia
    de este plan. Descarta el estado para volver a empezar.» — with no cmux and
    no «crear una solicitud nueva». Polling continues every three seconds. That
    covers the instant between the worktree being removed and the receipt being
    written: the next read turns the warning into the banner.
  - **no answer yet, or the backend unreachable**: it stays on «Comprobando que
    el plan sigue activo». Nobody is warned until the backend says `not-found`.
- **Not touched.** The automatic slice selection
  (`useAutomaticSliceSelection`); the «El trabajo incierto ya no figura como
  activo» variant; the «No se puede confirmar el estado de implementación» card.

## Testing

- Backend:
  - the clock writes the receipt on `collected` and on nothing else;
  - it reports a write failure and does not retry it;
  - it writes nothing for a worktree with no record;
  - the inventory answers `finished` with and without a delivery receipt,
    `WorkNotFound` with no receipt, and `work-not-read` with a corrupt receipt;
  - the route projects the `finished` variant.
- Frontend:
  - the contract reader, fed the backend's literal payloads (`finished` with and
    without a pull request, and the `work-not-found` refusal), as #543 did;
  - `Home`: delivered with a successor; delivered with none, then **Cerrar**;
    `not-found` that turns into `finished`; `not-found` that stays a warning.

## Out of scope

- Telling that a whole story is complete.
- Harvests run by hand, and slices harvested before this change (D-5).
- The other end-to-end findings of 2026-09-24: the stale recovery card, the
  `status:in-review` label left on closed issues, the `CT_STATE_DIR` mismatch.
