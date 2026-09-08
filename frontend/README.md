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

## What is already decided

- **It is never shipped with the plugin.** The marketplace's `source` is
  `./plugin` and this directory falls outside every installation; npm
  dependencies are legitimate here.
- **`backend/` serves it, from the same origin.** `ct-api.mjs` serves `dist/` at
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
- `src/system-ui/{button,input,form-field,banner,top-bar,panel}` are **mirrors**
  of `logistics-ui`'s components, with the same tokens and a subset of their
  props. The day the package arrives, the import changes.
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
