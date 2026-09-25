# The focused view follows the story through implementation — Execution spec

**Handoff origen:** `docs/superpowers/specs/mercadona__control-tower-585-design.md`
**Fecha de congelación:** 2026-09-25
**Estado:** CONGELADA

## Hipótesis del experimento

**The bet:** with the focused view covering implementation, the person driving a
story follows its milestone from the first slice to the last merge on that one
page — every slice that needs them is shown with the single action that fits it,
and nothing on the page belongs to another story or offers an action that is not
possible.

**How we will know it failed:** during the first milestone driven after the last
slice merges, the person has to leave the page (a terminal, GitHub, the state
files) to learn what a slice is doing or what it needs, or the page shows a
slice of another story, an action that the backend refuses as impossible, or
the "repositorio en rojo" notice when no baseline was red.

**Anti-scope — what this milestone does NOT do:** showing running slices after
"Cancelar la sesión" (another story); reopening a session after an explicit
close; starting a second story while a milestone is in flight; changing the
first three steps of the focused view, except for the ended-session notice with
"Reabrir la sesión" that D-8 puts in every step; the plugin's telemetry fields `summary`
and `duration_ms`; any feature flag.

## Decisiones congeladas

- **D-1 · Span of step 4** — implementation goes from the first slice started to the last merge; the focused view keeps its header and four steps, with step 4 in progress. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-2 · Only the milestone in flight** — while a milestone is in flight the page shows only that milestone; slices of other stories do not appear and no other story is started until it ends. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-3 · The centre is a compact list** — every issue of the milestone (pending, running, delivered) on one line: number, title, step, task X of Y, time in the current step and pull request link, under "Issues del milestone" with "X de N entregadas". *(Procedencia: historia mercadona/control-tower#585.)*
- **D-4 · A line expands** — into its tasks with their status, what the judge found, and the agent's last tool and last message, so the page never looks frozen. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-5 · Needs the person** — a slice that needs the person is marked with what happened and the one action that fits it: "Hablar con la sesión" for a judge veto, the single recovery button for an uncertain state. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-6 · Baseline notice** — "El repositorio ya estaba en rojo antes de empezar…" appears only when some slice's baseline was red. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-7 · Session panel** — "Hablar con la sesión" opens the coordinating session's terminal in a panel over the list. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-8 · Reopen** — a session that ended by itself shows "La sesión coordinadora se ha cerrado" and "Reabrir la sesión" in every step; reopening resumes the same conversation by its identifier and, only when that is impossible, opens a new one with the prompt of the current step. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-8a · Ended-session copy per step** — in step 4 the notice says "Los slices siguen en marcha. Reábrela para volver a hablar con ellos; conserva lo que ya se habló."; in steps 1 to 3 it says "Reábrela para seguir; conserva lo que ya se habló." *(Procedencia: hablada — «"Los slices siguen en marcha…" solo en el paso 4; en los pasos 1 a 3, "Reábrela para seguir; conserva lo que ya se habló."».)*
- **D-9 · Completed** — with every issue delivered: "Milestone completado" and one action, "Cerrar la sesión y volver al inicio". *(Procedencia: historia mercadona/control-tower#585.)*
- **D-10 · Cancel unchanged** — "Cancelar la sesión" stays as today; after it the page is the start form and running slices are not shown. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-11 · No leftover** — everything the person cannot act on and does not need is removed, with every piece of code, test, fixture, field, route and doc left without a reader. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-12 · One backend read** — `GET /milestone-progress` reads the held coordinating session's milestone (same source as `/epic-groom`) through query `ReadMilestoneProgress` returning value object `MilestoneProgress` of `SliceLine`s, composed from existing ports plus two new ones: the current implementation call's activity and the slice's baseline. *(Procedencia: historia mercadona/control-tower#582.)*
- **D-13 · Reopen action** — `POST /coordinating-session/reopen` (action `ReopenCoordinatingSession`) resumes with `claude --resume <id>` when the transcript exists, and otherwise opens a new conversation with the prompt of the story's step, a new implementation prompt for step 4. *(Procedencia: historia mercadona/control-tower#582.)*
- **D-13a · The backend deduces the step for the reopen prompt** — spec not frozen: brainstorming; frozen but not authorized: groom; gate 2 authorized: implementation. *(Procedencia: hablada — «spec sin congelar, brainstorming; congelado sin autorizar, groom; Puerta 2 autorizada, implementación».)*
- **D-14 · The classic view is deleted, not reshaped** — the drawer, flow nav, slice cards, gate sequence, plan adoption and restore, column resizer, today's task history and the mirrors only they used go, per the inventory of #583. *(Procedencia: historia mercadona/control-tower#583.)*
- **D-15 · Backend cleanup** — `/work-progress`, `/implement-history`, `GET /sessions`, `POST /start-plan`, `GET /slices/:issue/escalation` and the page-only fields of `/active-plans` go with their tests and docs, per the inventory of #584. *(Procedencia: historia mercadona/control-tower#584.)*
- **D-16 · Three slices in order** — the backend read and reopen, then the focused implementation view, then the backend cleanup; once groomed, #582, #583 and #584 are closed as superseded, pointing to the new issues. *(Procedencia: historia mercadona/control-tower#585.)*
- **D-17 · No feature flag** — the change is implemented directly. *(Procedencia: deducida de CLAUDE.md, «Feature flags are opt-in in this repository».)*

## Enfoque técnico

The first slice is the heart: `ReadMilestoneProgress` joins what already exists
(epic issues extended with closed state and delivered pull request, harvest
receipts, run-file progress, implement history, the judge's findings) with two
new readers — the current implementation call, picked from
`history(conversation)` by `startedAt` because the step role is not stored, and
the `baseline:` field of each slice's state file. It adds nothing to remove, so
the page keeps working on the old reads while it lands. The second slice
switches the page to `/milestone-progress` and deletes the classic view in the
same change, because reshaping it breaks some forty `Home.*` tests that count
`/active-plans` reads. The third slice removes the backend routes and fields
the second one left without a caller. The slices serialize: each one's input is
the previous one's output.

## Contexto del milestone

- **Alcance:** `backend/src/**`, `backend/__tests__/**`, `backend/API.md`, `frontend/src/**`, `frontend/README.md`, `frontend/vite.config.ts`, `README.md`, `plugin/scripts/cmux.js`
- Convention sources: `.agent/conventions.md`.
- Mockups: https://claude.ai/artifact/Jy7zBnpjrxmpczxfsq3QAc, boards I1 list, I2 expanded, I3 attention, I4 session panel, I5 session ended, I6 completed. Their Spanish copy is the product copy; everything else is English.
- The facts, file-by-file inventories and traps of this milestone are in mercadona/control-tower#582, #583 and #584: read the one matching your slice before planning.
- Backend checks: `npx tsc -p tsconfig.json` and `npx vitest run --maxWorkers=4` in `backend/`. Frontend checks: `npx vitest run --maxWorkers=4` and `npm run build` in `frontend/`. There is no linter; never run `npx eslint`.
- Tests that start real processes fail with "CT_STATE_DIR disagreement" while a Control Tower backend runs on the machine; that is the environment, not the diff.
- New modules are classes with static methods, English, no comments; test doubles answer by what they are asked, not by call order; shared Object Mothers live in `backend/__tests__/` and `frontend/src/**/__scenarios__/`.
- In jsdom `ResizeObserver` never fires: a test that measures an element mocks `getBoundingClientRect` and dispatches `resize` on `window`.
- No feature flag.

## Tabla de slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal | Repo |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|------|
| 1 | Milestone progress read | backend | GET /milestone-progress answers one line per issue of the held session's milestone, and POST /coordinating-session/reopen resumes an ended coordinating session | – | the endpoint answers state\, step\, task X of Y\, current step start\, last tool and last text\, pull request\, attention\, baseline red and tasks with judge findings for pending\, running\, vetoed\, uncertain and delivered issues from test doubles, the current implementation call is picked by startedAt among implementation calls, reopen resumes by identifier when the transcript exists and otherwise opens a new conversation with the current step's prompt\, a new implementation prompt for step 4, the backend deduces that step itself: spec not frozen is brainstorming\, frozen but not authorized is groom\, gate 2 authorized is implementation, domain and application import neither GitHub nor the disk, backend/API.md documents both routes | frontend/; nothing is removed in this slice — /work-progress\, /implement-history and /active-plans keep answering as today | api | – | – | N/A — a read and a session action behind the page; the page itself is where they are observed | – |
| 2 | Focused implementation view | ui | With a session held the page is the focused view through the four steps showing only the milestone in flight, and the classic implementation view is removed with everything only it used | #1 | page tests pin the states of boards I1 to I6 and no session held shows only the start form, a running line shows step\, Tarea X de Y and a ticking time in step, a line expands into its tasks\, the judge's finding and the agent's last tool and last message, a slice that needs the person shows what happened and exactly one action, the red-baseline notice appears only when some baseline was red, Hablar con la sesión opens the terminal in a panel over the list, an ended session shows Reabrir la sesión in every step\, with Los slices siguen en marcha. Reábrela para volver a hablar con ellos; conserva lo que ya se habló. in step 4 and Reábrela para seguir; conserva lo que ya se habló. in steps 1 to 3, every issue delivered shows Milestone completado and Cerrar la sesión y volver al inicio, no module\, style\, mirror\, fixture or README section is left that only removed code used | backend/; frontend/src/app/work-progress/contract.ts stays for the backend contract test; Cancelar la sesión keeps its current behaviour; steps 1 to 3 change only by the ended-session notice | – | frontend | – | N/A — frontend only; this repository instruments no product telemetry in the page | – |
| 3 | Backend cleanup | backend | The backend routes and fields left without a caller are removed with their tests and docs | #2 | GET /work-progress\, GET /implement-history\, GET /sessions\, POST /start-plan and GET /slices/:issue/escalation no longer exist, frontend/src/app/work-progress/contract.ts and its backend contract test are gone, GET /active-plans no longer projects request.{id\,repo\,path} nor plan.{id\,branch\,worktree} and the coordinating prompt still reads what it needs, the /slices entry of the frontend dev proxy is gone, backend/API.md and README.md no longer describe what was removed, a final sweep finds no code\, type\, field\, fixture or doc whose only reader was removed | plugin telemetry fields summary and duration_ms; PlanRequest\, PlanRefusal\, PlanCollapse and ReadSliceEscalation stay; stream\, input and resize of sessions stay | api | frontend, docs | – | N/A — removal only; nothing new is emitted | – |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|
| A-1 | – | Showing the running slices after "Cancelar la sesión" | Left to another story by D-10 | Future story |
| A-2 | – | Reopening a coordinating session after an explicit close | Out of scope: after a close nothing is held | Discarded here |

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
