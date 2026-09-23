# frontend/ — the control tower's front end

The web interface that consumes `backend/`'s API. It is born in this repo — one
single repo, no subtree: the 2026-09-01 decision recorded in the divergence note
in `docs/superpowers/specs/2026-08-31-fusion-con-app-companion-design.md`.
The front end's design, endpoint by endpoint, is in
`docs/superpowers/specs/2026-09-02-frontend-primer-endpoint-design.md` (the
start-up), `docs/superpowers/specs/2026-09-02-frontend-plan-events-design.md`
(the progress) and `docs/superpowers/specs/2026-09-03-frontend-implement-plan-design.md`
(the implementation).

Vite + React 19 + TypeScript. One screen — `pages/home` — over most of the API:
the required ticket, repository and local path open a coordinating session,
plan progress arrives over `GET /plan-events/:issue` (Server-Sent Events), and
what the plan agent is doing meanwhile arrives over `GET
/planning-progress/:issue`, polled. The page shows implementation progress, the
panels of gates 1 and 2, and the live terminals of the sessions the backend
owns. `POST /start-plan` accepts the
retained loose request or a milestone-only command. The milestone path selects
and starts the next eligible slice; after the committed plan is published, the
backend resumes the same headless conversation automatically. `POST
/implement-plan` is not routed, so the page offers no implementation button.
Each area has its own directory under `src/app/`, and the endpoint it consumes
is named in the sections below. Additional context and feedback are entered
directly in the coordinating conversation.

`app/external-tools` (`ToolsNavbar`) surveys `GET /external-tools` and renders it
as the design system's **Navbar**: the shell's left rail, 280 px open and 72 px
collapsed, held by `system-ui/navigation` (`Navigation`) together with the
`TopBar` above the work area. It is not an overlay — it is a flex child of the
shell, so collapsing it widens the work area instead of uncovering it. The
collapsed state is this browser's alone: `ToolsNavbar` reads and writes
`localStorage` under `control-tower.navbar-collapsed`, inside a `try`, and falls
back to expanded when the accessor throws.

**The page owes the rail a height.** `Navigation` declares `height: 100%`, so
`Home` is an application shell exactly one viewport tall (`height: 100dvh`,
`overflow: hidden`), with the top bar across the top and a bounded work-area row
below it; `main` and the right column each scroll on their own inside it. A shell
with only `min-height` is not a height a percentage can resolve against.
`Home.shell.test.ts` pins every declaration that keeps the shell bounded.

The rail carries two `MenuSection`s. **Herramientas** holds one `MenuItem` per
tool, with the row's state as a `Tag` — `falta` when the binary is absent,
`sin confirmar` when its credential cannot be observed from the backend process,
and no tag at all when it is ready. **Métricas** holds one read-only row,
**Entrega a BigQuery**: `on` with the table it uploads a merged slice to, `off`
with the name of the variable that would turn it on. The rail never offers to
change it — the value is an option of the backend's start-up, so no endpoint
writes it. The footer is one button, **Reintentar comprobación**, which asks
`GET /external-tools` again and is disabled while a check is in flight.

`app/sessions` (`SessionsPanel`, rendered by `Home`) consumes four session
endpoints: `GET /sessions` lists what the backend owns, `GET /sessions/:id/stream`
streams the chosen one's bytes over Server-Sent Events, `POST
/sessions/:id/input` carries every keystroke back, and `POST /sessions/:id/resize`
carries the terminal's fitted size so the pty agrees with what the page shows.
`SessionTerminal` renders that stream with `@xterm/xterm`, a real terminal
emulator, rather than a scrolling log, and fits it to its container with
`@xterm/addon-fit`: a `ResizeObserver` on the screen element schedules a fit
after a 100 ms debounce, and `SessionsClient.resize` is only called when the
fitted size changes and neither dimension is zero or non-finite. `resize`
chains through the same per-session promise queue as `type`, so two quick
resizes — or a resize racing a keystroke — reach the backend in the order
they were sent rather than in whichever order their requests happen to
settle. A resize failure is swallowed — it is not user-actionable and never
shows a banner. **The backend owns the session, not the page**: it is opened
once at the backend's start-up, so the page is a window onto it and never its
owner — closing the tab ends only the subscription and disposes the on-screen
terminal, while the process, its scrollback and its row in `GET /sessions`
survive; reopening it replays the scrollback the backend kept, as if nothing
had been watching in between. That process does not outlive whatever ends
the shell itself, though: an `exit` or a `Ctrl-D` typed into it — the same
keystrokes `POST /sessions/:id/input` carries there — closes it for good, and
nothing reopens one, so `GET /sessions` answers empty for the rest of the
backend's run and the other two endpoints refuse that id with
`session-not-live`.

`app/coordinating-session` (`CoordinatingSessionStatus`, rendered by `Home`
beside `SessionsPanel`) is the page's single owner of coordinating-session
opening, polling and closure. It polls `GET /coordinating-session` every two
seconds (`useCoordinatingSession.ts`, `POLL_INTERVAL_MS`). The backend's
`timeline` field carries the session's chronological history (opened,
resumed, working, waiting for a permission prompt, completed, ended); the
page does not render it — `askStateOf` reads only `timeline.at(-1).kind` to
derive `liveAsk`, which feeds `GateSequence`. `CoordinatingSessionStatus`
itself renders nothing for a live session: it shows a banner only for
`unresumable` or `ended`, the only two states the UI needs to say the
conversation could not be recovered or has ended. Both the request form and
gate 2 delegate their opening to that owner. Its synchronous mutation guard
blocks both entrances before either request settles; an uncertain response
stays occupied until a later authoritative read confirms the slot idle. Every
held response carries an opaque target, and mutation generations prevent
reads started before an open or close from repainting an older target.

The session header offers **Cancelar la sesión** for a live target and **Cerrar
sesión** for ended or unresumable state. Closure sends the exact conversation
and target to `POST /coordinating-session/close`; **Cancelando…** remains visible
until a matching durable acknowledgement arrives. A refusal or unreadable
answer retains the target and an actionable retry. Confirmed closure removes
only that target's terminal presentation and gates.

`Home` lays out a right column (`home__side`), a sibling of `main` rather than
an overlay, that holds a `Drawer` titled **Sesión coordinadora** with
`CoordinatingSessionStatus`, `SessionsPanel` and, while implementation runs,
`ImplementHistory` inside it. The drawer starts collapsed to a 48 px rail and
persists the person's choice under `ct.sessions-column-collapsed`; a newly
discovered coordinating target expands it once and selects that target's
terminal, including after reload. A later manual selection or collapse is not
undone by another poll for the same target. Its toggle is available in every
phase. Collapsing applies the native `hidden` attribute to
the content instead of unmounting it, so the terminal keeps its xterm scrollback
and SSE subscription. `useLiveSessions` polls `GET /sessions` every three
seconds, so the list discovers a session opened outside the page without
requiring the drawer to be open. Above 1280 px the open column sits beside
`main` at `clamp(480px, 40vw, 680px)` (`--home-sessions-width`) rather than a
fixed 680px, because the 280 px navigation rail already takes its own share of
a 1440 px viewport and a fixed column left the work area too narrow for its own
flow bar; below 1280 px the column stacks under the work area with no overlay.

The coordinating session remains available and recoverable while a headless
plan conversation plans and implements. They have different roles: expanding
the drawer exposes the coordinating session as the interactive entrance in its
PTY, while durable headless call records drive the selected slice without
replacing that entrance.

`app/active-plans` reads `GET /active-plans` on load and while following work.
An uncertain entry carries a diagnostic, its original repo/issue/agent identity
and one recovery action. `observe` and `continue` render **Recuperar trabajo**;
`cleanup` renders **Limpiar arranque fallido**. A press sends the exact identity
to `POST /recover-plan` or `POST /cleanup-plan` and then reads active plans
again; it never calls `/start-plan`. The button is disabled while that request
is pending, and late replies cannot replace a newer workflow or coordinating
conversation. `inspect` stays read-only and offers **Reintentar recuperación**,
which only repeats the GET. **Descartar estado** clears this page's local state
and does not mutate backend work. The coordinating drawer and its live session
remain mounted throughout recovery.

Slice cards offer **Ver detalle** to select the slice shown by the main panel,
breadcrumbs and task history, with the choice persisted across reloads.
When the selected slice transitions to **En revisión** (`IN_REVIEW`), the page
automatically selects the sole confirmed running slice in the same repository and checkout.
`DELIVERED` alone does not trigger a handoff: execution ending does not confirm
that the work is available for review. The handoff waits if that slice appears
later, including after the slice in review leaves active plans. Ambiguous or
unreadable candidates prevent a jump.
Manual selection cancels the pending handoff; restoring or opening an already
in-review slice does not trigger one. Returning to fixes cancels the pending handoff.
`useAutomaticSliceSelection.ts` consumes the cards' existing progress reads
rather than starting another polling loop.

The mutation owns the active-plan read barrier from the click until its fresh
GET completes. It first drains a GET that predates the click; timer and manual
polls that wake while POST is pending start no read. After an accepted or
refused answer, the mutation alone bypasses its barrier for exactly one new GET,
so pre-operation state cannot stand in for post-operation reconciliation.

A `ColumnResizer` (`pages/home/components/column-resizer`) sits between
`main` and the column as its own 8 px grid track, draggable and keyboard-
operable (`role="separator"`, arrow keys, Home/End, Enter or a double-click
to reset), clamped to `[360px, columnsWidth - 600px]` so the work area always
keeps at least 600 px — the flow bar's three steps clipped a long label at a
narrower width, so this is the safe minimum, not a rounder guess. Its focus
ring is the design system's, not the browser default:
`.column-resizer:focus-visible` matches `Button`'s
`outline: var(--borderwidth-md) solid var(--border-brand-primary)`. The flow
step labels hyphenate at a word boundary (`hyphens: auto`, `overflow-wrap:
normal`, and `<html lang="es">` in `index.html` so the browser hyphenates
Spanish) instead of breaking mid-word.
`useSessionsColumnWidth` (`pages/home/`) owns the
clamp and persists the chosen width per browser in `localStorage` under
`ct.sessions-column-width` — a convenience for that browser alone, restored
on mount and re-clamped to the viewport; it is never sent to the backend and
the handle is disabled while the drawer is collapsed and hidden below 1280 px,
where the column is already full width.

`app/spec-freeze` (`SpecFreezePanel`, rendered by `Home` in `main`, right after
the workspace, outside every `currentStage` branch) is gate 1's panel.
`GET /spec-freeze` polls the checkout's execution spec (`useSpecFreeze.ts`) and
answers `none`, `no-spec`, `draft` — with the yardstick's findings and the
one-time gate key — or `frozen`, with the freeze date and the pull request.
The **Congelar el spec** button stays disabled while any finding remains, and
`POST /spec-freeze` carries the gate key in `x-gate-key` and the read's target
in `x-coordinating-target` to freeze it. Under
`make dev-frontend` the vite proxy strips `Origin` before the request reaches
the backend, so no gate key is ever minted for it: the button can only be
pressed from the page the backend itself serves.

`app/epic-groom` (`EpicGroomPanel`, rendered by `Home` right after
`SpecFreezePanel`, outside every `currentStage` branch too) is gate 2's panel:
the groom and the authorisation. `GET /epic-groom` polls the same checkout
(`useEpicGroom.ts`) every ten seconds, stopping once it reaches `groomable`,
`groomed` or `authorised` — **unless the slicing is being reviewed**, and then it
keeps asking at `groomable` and `partially-groomed`, the two resting rungs a
conversation can still change. The panel says so while the groom conversation it
opened is on screen or while a press it could not confirm is outstanding, and
passing that flag re-arms the read at once, so the §9 table the session edits
reaches the page without a reload. At `groomed` and `authorised` it rests
whatever the review is doing: there is nothing left for a conversation to
change there. It answers one of the ten states `EpicGroom.types.ts`
declares: `none`, `no-spec` and `draft` render nothing, because gate 1's panel
already says what is missing; `resliced` says the coordinating session changed
the slicing and offers **Publicar el nuevo slicing**, which calls
`POST /spec-reslicing` and then links the pull request the correction travels in;
`awaiting-publication` says the frozen spec is
waiting in a pull request the person has to merge and links it, or — when the
read found no open pull request for the branch — that the spec is still
unpublished and none was found, which is a wait to watch rather than a merge to
press; `groomable` shows the milestone and the dry run's product — the issues the
groom would create, ordered and labelled, before anything is created, and
offers **Revisar el slicing con la sesión**, which calls `POST /groom-session`
so a person can walk that table with a coordinating session in the groom phase
instead of only saying yes or no to it. When that read carries a `reslicing` —
the merged pull request whose body marks it as a correction of the slicing —
`useMergedReslicing.ts` presses the groom once by itself and the panel names the
pull request that authorised it: a person merging is the authorisation, so
nothing is left to click. That press belongs to the page, which is the only
thing here that watches GitHub, so while nobody has the cabin open nothing
happens and the issues appear the next time it is opened; `groomed`
shows the issues the milestone already holds and offers the authorisation;
`authorised` shows them all promoted, with nothing left to press.
**Ejecutar el groom** calls
`POST /epic-groom`, **Autorizar el trabajo** calls `POST /epic-promotion`,
**Revisar el slicing con la sesión** calls `POST /groom-session` and
**Publicar el nuevo slicing** calls `POST /spec-reslicing`,
each carrying the same gate key `x-gate-key` that gate 1 uses and the read's
target in `x-coordinating-target`; the same vite
proxy that strips `Origin` for `/spec-freeze` does it for all four, so no
button can be pressed from anywhere but the page the backend itself serves,
and a press without the key is refused with `gate-not-from-the-page`.
`useGatePresses.ts` holds those four presses and which one is in flight, so a
button never borrows another's label while it waits.

The conversation **Revisar el slicing con la sesión** opens through the same
lifecycle owner as the request form. `POST /groom-session` answers the session
it created, `CoordinatingSessionClient.openedIn` reads that payload — one reader
for the two doors that answer it — and the adopted session appears and is
selected without waiting for the next `GET /sessions`. A delayed old listing
cannot remove that adoption or resurrect a terminal after confirmed closure.
`GateSequence` is keyed by the current target, so old gate reads, confirmation
fallbacks and automatic reslicing presses cannot repaint a replacement target.

A press whose answer the page cannot read is **not** reported as a failure:
`client.ts` reads `GET /epic-groom` once and answers what that read says, so a
slow groom that did create the issues shows them, and where the read cannot tell
either the panel says «No se ha podido confirmar el groom» as a warning and asks
the person not to press again. Measured on a real repository: the panel said the
backend could not be reached while the backend's own log read
`gate 2 groom: "…" planned 4 issue(s), holds 2 now`, and pressing again is the
worst move available when nobody can tell what was created.

## What is already decided

- **It is never shipped with the plugin.** The marketplace's `source` is
  `./plugin` and this directory falls outside every installation; npm
  dependencies are legitimate here.
- **`backend/` serves it, from the same origin.** `ct-api.ts` serves `dist/` at
  `/` when it exists, so page and API share `http://127.0.0.1:<port>`.
  The API rejects with `403` any `Origin` that is not its own, with a loopback
  `Host`: a foreign page cannot call `POST /start-plan`, and ours can, with no
  CORS and no preflight.
- **The client is `fetch` with no wrapper** (`src/app/start-plan/client.ts`,
  `src/app/active-plans/client.ts`) and native `EventSource` for the event
  stream (`src/app/plan-events/client.ts`).
  The in-house libraries are waiting for CI to have access to the private
  registry.

## The look: the logistics design system

The screen follows the logistics design system (`mercadona/mo.staff-design`).
The real package lives in the private Verdaccio and CI cannot reach it, so until
the repo moves to the organisation:

- `src/system-ui/theme/` is a **literal copy** of the package's theme (tokens,
  Open Sans, `lg-*` classes). It is not edited; `VENDORED.md` says how to
  refresh it.
- the other directories under `src/system-ui/` — `banner`, `breadcrumbs`,
  `button`, `collapsable-card`, `drawer`, `form-field`, `icons`, `input`,
  `loading`, `menu-item`, `menu-section`, `nav-header`, `navbar`, `navigation`,
  `panel`, `tabs`, `tag`, `text-area`, `top-bar` and `workflow-step`
  — are **mirrors** of `logistics-ui`'s components, with the same tokens and a
  subset of their props. The day the package arrives, the import changes. The `tabs` one traces
  `packages/logistics-ui/src/components/Tabs` at `4d946b4`: the ARIA tabs
  pattern (`tablist` / `tab`, one tab stop for the whole bar, `ArrowLeft` /
  `ArrowRight` / `Home` / `End` walking it with disabled tabs skipped), the
  underlined active tab in `--foreground-primary` against
  `--foreground-secondary`, and the label-ghost technique that reserves the
  active tab's width so the bar does not shift when the selection moves.
  Upstream's `focus-visible` outline reaches for `--border-brand`, which the
  vendored theme does not carry; the mirror uses `--border-brand-primary`
  instead, the closest token that exists.
- The `drawer` one traces `packages/logistics-ui/src/components/Drawer` at
  `4d946b4`: the persistent side panel that compresses the work area when open
  and gives the space back when collapsed, never a layer over the content —
  the `aside` region named by its own title, the 48px-wide collapsed rail with
  only the toggle, the visually-hidden title that survives collapsing because
  it is the region's accessible name, and the `Button` `tertiary` toggle
  (`aria-expanded`, `aria-controls`) instead of a hand-rolled one. The mirror's
  CSS module became plain BEM; every comment was stripped, matching every
  other mirror in this tree; the scroll-ramp mask, its `@property` registrations
  and the `animation-timeline` keyframes were left out, since no other mirror
  here carries them and they are not what this component's use in Control Tower
  is about. Upstream hardcodes a 390px open width; this repository's Home page
  drives that width itself through `--home-sessions-width` (the same variable
  `ColumnResizer` already wrote), so the mirror declares no width at all except
  the 48px collapsed rail.
- The tokens live under `[data-ds='logistics']`; the `<html>` carries that
  attribute and `data-theme`, which `Theme.followSystemPreference()` sets from
  the system preference (light or dark) and keeps following if it changes.

## Development

```bash
make start               # from the root: builds dist/ and serves it with the API — the whole app
make dev-frontend        # vite on 5173 proxying to the API (run `make run-backend` first)
make test-frontend
```

Or inside `frontend/`: `npm ci`, `npm test`, `npm run build`, `npm run dev`.

`vite.config.ts`'s proxy forwards every API path the page calls — the list is
`API_PATHS` in that file, sixteen of them today, including `/recover-plan` and
`/cleanup-plan` — and strips the `Origin` header
from what it forwards: without it the backend refuses the call as a foreign
origin. **A new endpoint has to be added to `API_PATHS`**, or the dev server
answers the page's own HTML instead of the API. Stripping `Origin` is a
development exception with one cost worth knowing: no gate key is ever minted
for a request that arrives without an origin, so the gate buttons cannot be
pressed under `make dev-frontend`. In production the page comes out of the
backend itself.

The backend wire contract, refusal codes and recovery limits are documented in
[`backend/API.md`](../backend/API.md). This repair made no live Claude call, so
the real permission smoke remains explicitly unverified.

## Conventions

Those of the `frontend-engineering` skill (no semicolons, named exports,
absolute imports from `src/`, one component per file, BEM) plus the yardstick
that `__tests__/yardstick.test.ts` measures on every file: names in English,
zero prose in comments, no `export default` other than the one Vite demands in
its config, and no import that climbs with `../`. The interface's labels are in
Spanish; everything else, in English.
