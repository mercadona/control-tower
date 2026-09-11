# Conventions of this repository already decided

claim: 2026-09-11 — decision (c): the backend decides WHEN, the plugin's `dispatch-check.mjs` performs the act, and this repository keeps no claim script of its own.

The scanner (`plugin/scripts/conventions.js`) cites `README.md:8` and lines 59 and 66 of
`backend/conventions/this-repository.md`, where `dispatch-check` is named with an argument
stuck behind it (`--collect`, `--reopen`) — the shape of an invocation, which is one of the
three routes it detects one by. What those lines describe
is the single protocol of the line above: the backend decides when a slice is claimed,
released, harvested or reopened, and the plugin performs it. There is no second protocol to
arbitrate with, so that documentation stays exactly as it is.

Format: one line per signal, `<signal>: YYYY-MM-DD — <reason>`; the valid signals are `claim`, `worktrees`, `estado` and `residuo-status`. Everything else here is read as prose.
