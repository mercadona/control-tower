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
the required ticket and local path open a coordinating session — the repository
is the one the clone's `origin` names, read by the backend. The backend
dispatches authorised slices by itself; after the committed plan is published,
it resumes the same headless conversation automatically. Each area has its own
directory under `src/app/`, and the endpoint it consumes is named in the
sections below. Additional context and feedback are entered directly in the
coordinating conversation.

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
below it; `main` scrolls on its own inside it. A shell
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

`app/sessions` consumes three session endpoints: `GET /sessions/:id/stream`
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
terminal, while the process and its scrollback survive; reopening the panel
replays the scrollback the backend kept. An `exit` or a `Ctrl-D` typed into it
ends that terminal, and input and resize requests then refuse its identifier
with `session-not-live`. The held coordinating conversation remains visible and
offers **Reabrir la sesión** through its dedicated lifecycle endpoint. The page
gets the terminal identifier from the coordinating session, not `GET /sessions`.

`app/coordinating-session` is the page's single owner of coordinating-session
opening, polling and closure. It polls `GET /coordinating-session` every two
seconds (`useCoordinatingSession.ts`, `POLL_INTERVAL_MS`). The backend's
`timeline` field carries the session's chronological history (opened,
resumed, working, waiting for a permission prompt, completed, ended); the
page does not render it — `askStateOf` reads only `timeline.at(-1).kind` to
derive `liveAsk`, which feeds the gate band. An `ended` or `unresumable`
session shows `SessionEndedNotice` (`app/focused-session`) with **Reabrir la
sesión** instead. Both the request form and gate 2 delegate their opening to
that owner. Its synchronous mutation guard blocks both entrances before
either request settles; an uncertain response stays occupied until a later
authoritative read confirms the slot idle. Every held response carries an
opaque target, and mutation generations prevent reads started before an open
or close from repainting an older target.

The header offers **Cancelar la sesión** as a secondary action, live or not.
Closure sends the exact conversation and target to `POST
/coordinating-session/close`; **Cancelando…** remains visible until a matching
durable acknowledgement arrives. A refusal or unreadable answer retains the
target and an actionable retry. Confirmed closure returns the page to the
start form.

**The focused view.** While a coordinating session is held — live, ended or
unresumable — `Home` renders `FocusedSession` (`app/focused-session`); with no
session held it renders only the start form. The view holds a header with the
step, the story and repository, **Cancelar la sesión**, and the four steps; the
band of the gate that asks for something; and the centre. In steps 1 to 3 the
centre is the session. In step 4 it is `MilestoneBoard` (`app/milestone-progress`),
one line per issue from `GET /milestone-progress`, polled every 3 s, or 15 s
while an issue is in review or being fixed. The list retains its last successful
read through an outage for the same target and discards it when the held session
target changes; the session owner supplies the single connection notice.
If only the milestone read fails, its own warning explains that the displayed
information is the last available reading. A successful read clears that warning.
**Hablar con la sesión** opens the terminal in a panel over the list, keeping the
header and steps visible. A session that ended shows **Reabrir la sesión**, which
calls `POST /coordinating-session/reopen`. Its step-4 list remains visible.
When every issue is delivered, **Milestone completado** offers **Cerrar la sesión
y volver al inicio**.

Recovery first reads the current plan and checks that its permitted action still
matches the button pressed. A changed action requires a new decision; `inspect`
only refreshes the milestone. A lost recovery or cleanup response is reported as
unconfirmed while a fresh milestone read reconciles the display. Initial session
read failures also show a connection notice, with the start form explaining that
the session state is unknown rather than claiming that another session exists.

`app/spec-freeze` (`SpecFreezePanel`, rendered inside `GateBand`,
`app/focused-session`, while step 2 asks for it) is gate 1's panel.
`GET /spec-freeze` polls the checkout's execution spec (`useSpecFreeze.ts`) and
answers `none`, `no-spec`, `draft` — with the yardstick's findings and the
one-time gate key — or `frozen`, with the freeze date and the pull request.
The **Congelar el spec** button stays disabled while any finding remains, and
`POST /spec-freeze` carries the gate key in `x-gate-key` and the read's target
in `x-coordinating-target` to freeze it. Under
`make dev-frontend` the vite proxy strips `Origin` before the request reaches
the backend, so no gate key is ever minted for it: the button can only be
pressed from the page the backend itself serves.

`app/epic-groom` (`EpicGroomPanel`, rendered inside the same `GateBand` while
step 3 or step 4 asks for it) is gate 2's panel: the groom and the authorisation. `GET /epic-groom` polls the same checkout
(`useEpicGroom.ts`) every ten seconds, stopping once it reaches `groomable`,
`groomed` or `authorised` — **unless the slicing is being reviewed**, and then it
keeps asking at `groomable` and `partially-groomed`, the two resting rungs a
conversation can still change. The panel says so while the groom conversation it
opened is on screen or while a press it could not confirm is outstanding, and
passing that flag re-arms the read at once, so the §9 table the session edits
reaches the page without a reload. `Home` reads the same checkout once more for
the focused view and keeps asking at those two rungs, and at `groomed` and
`authorised` too, while a session is held, including ended and unresumable
sessions: that read determines the step and band, so authorisation advances to
implementation even when the coordinating terminal has ended. A
read that fails keeps the last answer for the same target instead of blanking
the view. The panel also watches preparation at `groomed` and `authorised`.
It answers one of the ten states `EpicGroom.types.ts`
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
selected directly from that answer, with no further round trip. Both gate
reads answer `connecting` in the very render a new target appears, because
`useSpecFreeze.ts` and `useEpicGroom.ts` each hold their own `{ target, read }`
pair and return `connecting` until an answer for the new target settles it, so
old gate reads, confirmation fallbacks and automatic reslicing presses cannot
repaint a replacement target.

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
  `Host`: a foreign page cannot call `POST /coordinating-session`, and ours can, with no
  CORS and no preflight.
- **The client is `fetch`** (`src/app/coordinating-session/client.ts`,
  `src/app/active-plans/client.ts`, `src/app/milestone-progress/client.ts`). Native
  `EventSource` remains for the coordinating terminal stream.
  The in-house libraries are waiting for CI to have access to the private
  registry.

## The look: the logistics design system

The screen follows the logistics design system (`mercadona/mo.staff-design`).
The real package lives in the private Verdaccio and CI cannot reach it, so until
the repo moves to the organisation:

- `src/system-ui/theme/` is a **literal copy** of the package's theme (tokens,
  Open Sans, `lg-*` classes). It is not edited; `VENDORED.md` says how to
  refresh it.
- the other directories under `src/system-ui/` — `banner`,
  `button`, `form-field`, `icons`, `input`,
  `loading`, `menu-item`, `menu-section`, `nav-header`, `navbar`, `navigation`,
  `tag` and `top-bar`
  — are **mirrors** of `logistics-ui`'s components, with the same tokens and a
  subset of their props. The day the package arrives, the import changes.
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
`API_PATHS` in that file, thirteen of them today, including `/recover-plan` and
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

A backend refusal reaches the screen through `src/app/product-error.ts`, which
turns its `code` into Spanish copy. The protocol codes every endpoint can answer
(`not-found`, `foreign-origin`, `unsupported-media-type`, `unknown-field` and
the like) are left out on purpose: only a defect of this page can cause them,
so they show the backend's own `detail`, which is what makes the defect
traceable. So does `repository-preparation-required`, whose `detail` is the
list of what the repository lacks and is shown under a Spanish title.
