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
  `prefers-reduced-motion`.
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
