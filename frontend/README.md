# frontend/ — the control tower's front end

The web interface that consumes `backend/`'s API. It is born in this repo — one
single repo, no subtree: the 2026-09-01 decision recorded in the divergence note
in `docs/superpowers/specs/2026-08-31-fusion-con-app-companion-design.md`.
The front end's design, endpoint by endpoint, is in
`docs/superpowers/specs/2026-09-02-frontend-primer-endpoint-design.md` (the
start-up), `docs/superpowers/specs/2026-09-02-frontend-plan-events-design.md`
(the progress) and `docs/superpowers/specs/2026-09-03-frontend-implement-plan-design.md`
(the implementation).

Vite + React 19 + TypeScript. Today one screen over three endpoints: the ticket
key and the repository, a button that calls `POST /start-plan`, the plan's
progress arriving over `GET /plan-events/:issue` (Server-Sent Events) and, once
the plan is ready, a button that calls `POST /implement-plan`.

`ToolsStatus` surveys `GET /external-tools` and renders it as the design
system's **Drawer**: a persistent column at the right of the work area, 390 px
open and a 48 px rail folded, that starts folded. It is not a modal — it neither
dims the page nor traps the focus — and it is a column of the layout rather than
a layer over it, so opening it compresses the main content instead of covering
it. The status dot and its summary live in the drawer header, and the summary
also travels in the toggle's accessible name so the folded rail is not mute.

**The page owes it a height.** The drawer declares `height: 100%`, so `Home` is
an application shell exactly one viewport tall (`height: 100dvh`,
`overflow: hidden`) with the top bar across the top and a bounded work-area row
below it; `main` and the drawer body each scroll on their own inside it. A shell
with only `min-height` is not a height a percentage can resolve against: the
drawer then falls back to its content height, its body contributes nothing
(`flex: 1 1 0`, `min-height: 0`) and the panel ends at its header, clipping the
rest. That shipped once and `Home.shell.test.ts` now pins every declaration that
prevents it.

Under 768 px the row stacks and the shell hands the scrolling back to the page
(`height: auto`): the drawer becomes a full-width band below the content, and its
body switches to `flex: 0 0 auto` so it sizes the column instead of collapsing
into it. It stays a column of the layout there too — no `position: fixed`, no
`z-index`, no overlay.

Its body holds the tool rows and **Entrega de métricas**, read-only: whether the
backend was started with `CT_HARVEST_BQ_TABLE`, which table it uploads a merged
slice to, and — when the variable is unset — that no merged pull request will
reach the harvest ledger nor any comparison of coding tools until the backend is
restarted with it. The drawer never offers to change it: the value is an option
of the backend's start-up, so there is no endpoint that writes it.

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
beside `SessionsPanel`) polls `GET /coordinating-session` every two seconds
(`useCoordinatingSession.ts`, `POLL_INTERVAL_MS`) and renders the backend's
`timeline` as a compact vertical `system-ui/timeline` — the session's
chronological history (opened, resumed, working, waiting for a permission
prompt, completed, ended), each with a timestamp, and only the last event
marked current. It never renders the raw Markdown of an assistant message: a
permission prompt's own short question is the only free text a timeline item
carries, and a completed turn shows a fixed label instead of the session's
`last_assistant_message`. The whole timeline is what the backend answers on
every poll, so a page reload rebuilds it from that field rather than from
anything kept only in React state, and it survives a backend restart the same
way the conversation itself does. An `unresumable` or `ended` conversation
still shows its banner, with the timeline it had kept underneath it.
`StartPlanForm`'s one button opens the conversation with `POST
/coordinating-session`.

The visible timeline carries no `aria-live` of its own — every poll can
rewrite the whole list, and a live region over all of it would have assistive
technology repeat the entire history on each update. A single visually
hidden `role="status"` element (`.coordinating-session-status__visually-hidden`,
the same clip-rect technique `Banner` already uses for its type label)
announces only the current event's own text, the same pattern
`ImplementProgress` already uses for its stage announcement.

`system-ui/timeline` (`Timeline`) is this repository's mirror of
`logistics-ui`'s Timeline component, alongside the other `system-ui/*`
mirrors under [The look](#the-look-the-logistics-design-system): a vertical
list of items, each a marker on a connecting line, a label, an optional
timestamp and an optional detail line, with the current item's marker and
label in the brand colour and every earlier one muted. It declares no
`min-width`, so it renders correctly at the panel's narrowest width.

`Home` lays out a right column (`home__side`), a sibling of `main` rather than
an overlay, that always holds a `Panel` heading **Sesión coordinadora** with
`CoordinatingSessionStatus` and `SessionsPanel` inside it — on the page in
every phase, never hidden and never disabled by which stage is showing. Once
an implementation is running, `ImplementHistory` stacks under that panel in
the same column. Above 1280 px the column sits beside `main` at
`clamp(480px, 40vw, 680px)` (`--home-sessions-width`) rather than a fixed
680px, because the 280 px navigation rail already takes its own share of a
1440 px viewport and a fixed column left the work area too narrow for its own
flow bar; below 1280 px the column stacks under the work area with no
overlay.

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
the handle is hidden below 1280 px, where the column is already full width.

`app/spec-freeze` (`SpecFreezePanel`, rendered by `Home` in `main`, right after
the workspace, outside every `currentStage` branch) is gate 1's panel.
`GET /spec-freeze` polls the checkout's execution spec (`useSpecFreeze.ts`) and
answers `none`, `no-spec`, `draft` — with the yardstick's findings and the
one-time gate key — or `frozen`, with the freeze date and the pull request.
The **Congelar el spec** button stays disabled while any finding remains, and
`POST /spec-freeze` carries the gate key in `x-gate-key` to freeze it. Under
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
each carrying the same gate key `x-gate-key` that gate 1 uses; the same vite
proxy that strips `Origin` for `/spec-freeze` does it for all four, so no
button can be pressed from anywhere but the page the backend itself serves,
and a press without the key is refused with `gate-not-from-the-page`.
`useGatePresses.ts` holds those four presses and which one is in flight, so a
button never borrows another's label while it waits.

The conversation **Revisar el slicing con la sesión** opens travels the same way
the brainstorming's does: `POST /groom-session` answers the session it created,
`CoordinatingSessionClient.openedIn` reads that payload — one reader for the two
doors that answer it — and the panel hands it up through `GateSequence` to
`Home`'s own `sessionOpened`, the very callback `StartPlanForm` reports an
opening to. `SessionsPanel` therefore refreshes its listing and selects the new
terminal, instead of showing «habla con ella en el panel de sesiones» beside a
listing that never changed.

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
  `src/app/implement-plan/client.ts`) and native `EventSource` for the event
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
- `src/system-ui/{button,input,form-field,banner,top-bar,panel,drawer}` are
  **mirrors** of `logistics-ui`'s components, with the same tokens and a subset
  of their props. The day the package arrives, the import changes. The `drawer`
  one traces `packages/logistics-ui/src/components/Drawer` at
  `4300308`: same 390/48 px column, 72 px header, the `sidebar-right` glyph in a
  tertiary 40 px `Button`, `aria-expanded` + `aria-controls`, a body that is
  `hidden` when folded, and the width transition switched off under
  `prefers-reduced-motion`. The `tabs` one traces
  `packages/logistics-ui/src/components/Tabs` at `4d946b4`: the ARIA tabs
  pattern (`tablist` / `tab`, one tab stop for the whole bar, `ArrowLeft` /
  `ArrowRight` / `Home` / `End` walking it with disabled tabs skipped), the
  underlined active tab in `--foreground-primary` against
  `--foreground-secondary`, and the label-ghost technique that reserves the
  active tab's width so the bar does not shift when the selection moves.
  Upstream's `focus-visible` outline reaches for `--border-brand`, which the
  vendored theme does not carry; the mirror uses `--border-brand-primary`
  instead, the closest token that exists.
- The tokens live under `[data-ds='logistics']`; the `<html>` carries that
  attribute and `data-theme`, which `Theme.followSystemPreference()` sets from
  the system preference (light or dark) and keeps following if it changes.

## Development

```bash
make run-frontend        # from the root: installs, builds dist/ and starts the backend serving it
make dev-frontend        # vite on 5173 proxying to the API (run `make run-backend` first)
make test-frontend
```

Or inside `frontend/`: `npm ci`, `npm test`, `npm run build`, `npm run dev`.

`vite.config.ts`'s proxy forwards `/start-plan`, `/plan-events` and
`/implement-plan` and strips
the `Origin` header from what it forwards: without it the backend treats the
request as a non-browser client. It is a
development exception; in production the page comes out of the backend itself.

## Conventions

Those of the `frontend-engineering` skill (no semicolons, named exports,
absolute imports from `src/`, one component per file, BEM) plus the yardstick
that `__tests__/yardstick.test.ts` measures on every file: names in English,
zero prose in comments, no `export default` other than the one Vite demands in
its config, and no import that climbs with `../`. The interface's labels are in
Spanish; everything else, in English.
