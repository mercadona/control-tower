# control-tower — the single repo

Three pieces, one repo, and only one of them ships:

| Directory | What it is | Does it ship? |
|---|---|---|
| [`plugin/`](plugin/) | The **control-tower-loop** plugin for Claude Code: the whole loop (hydration, gates, dispatch, judges) and its suite | **Yes** — it is the marketplace's `source` |
| [`backend/`](backend/) | The local HTTP API the interface consumes — six endpoints, documented in [`backend/API.md`](backend/API.md); it also sweeps every minute the clones it has served and harvests with `dispatch-check --collect` whatever each slice whose PR already merged left behind | No |
| [`frontend/`](frontend/) | The front end that consumes that API | No |

A plugin's unit of distribution is the `source` directory of
`.claude-plugin/marketplace.json`, whole and with no exclusion mechanism. That is
why the plugin lives in a subdirectory: whatever falls outside `plugin/` never
reaches an installation, and `backend/` and `frontend/` can have npm
dependencies without imposing them on any governed repo. A test watches this
(`plugin/__tests__/manifest.test.js`): if `source` goes back to `"./"`, it fails.

The plugin's documentation is in [`plugin/README.md`](plugin/README.md).
The contract of the API the front end consumes, in [`backend/API.md`](backend/API.md).
The design of the merge with the companion app, with its divergence note, in
[`docs/superpowers/specs/`](docs/superpowers/specs/).

## Installing the plugin

```
/plugin marketplace add mercadona/control-tower
/plugin install control-tower-loop@control-tower
```

## Developing

Each piece is an independent npm package, with its own lockfile and its own suite:

```
cd plugin  && npm ci && npm test    # hook build + ~3,000 tests
cd backend && npm ci && npm test    # the API and its yardstick
```

CI runs the two separately (`.github/workflows/continuous-integration.yml`).

And a `Makefile` at the root joins them without replacing them. Every target
names its package: `make test-backend`, `make build-frontend`, `make run-backend`…
and `make run-frontend` builds the front end and starts the backend serving it at
`http://127.0.0.1:8787/`. `CT_HARVEST_BQ_TABLE=project:dataset.table make run-backend`
additionally makes every collected slice leave its row in that BigQuery table;
without the variable, the harvest loads nothing. `make help` lists the targets.
