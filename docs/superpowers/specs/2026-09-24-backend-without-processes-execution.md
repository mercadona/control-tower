# The backend suite launches no process — Execution spec

**Handoff origen:** `docs/superpowers/specs/2026-09-24-backend-without-processes-design.md`
**Fecha de congelación:** 2026-09-24
**Estado:** CONGELADA

## Hipótesis del experimento

**The bet:** once no backend test launches a process, the backend job stops
producing false reds from them — from the 17 of 2026-09-08…24 to none — with no
file of `backend/src` losing line or branch coverage outside the declared
border.

**How we will know it failed:** in the sixteen days after the last slice merges,
a false red of the backend job lands on a test this milestone migrated, or the
coverage measured with `c8` shows a file of `backend/src` below its baseline.

**Anti-scope — what this milestone does NOT do:** the plugin and the frontend;
the false reds of suites that launch nothing (`claude-calls.test.ts`, the
frontend EventSource flake); a permanent coverage gate in CI; any change to
`plugin/conventions/testing.md`.

## Decisiones congeladas

- **D-1 · Motive** — the milestone exists to remove false reds, not to save time. *(Procedencia: hablada — «Falsos rojos».)*
- **D-2 · Scope** — the backend only; the plugin is a separate milestone, because it produced no false red in the measured window. *(Procedencia: hablada — «Milestone aparte».)*
- **D-3 · No exception** — no backend test launches any process, the git arrange included. *(Procedencia: hablada — «Sí, todos».)*
- **D-4 · Proof of coverage** — a per-file line and branch baseline of `backend/src` measured with `c8` over `vitest run` (children counted), which no file may drop below, plus a case-by-case ledger. *(Procedencia: hablada — «Línea base + libro».)*
- **D-5 · The comparison is a slice verification** — each slice re-measures with the same instrument; no permanent CI job. *(Procedencia: hablada — «dale», approving design section 3.)*
- **D-6 · One declared border** — every real `spawn`, `execFile`, `node-pty.spawn`, `process.kill` and `/bin/ps` read lives in one logic-free module, excluded from coverage with its reason, together with the `main` lines of `ct-api.ts` and of the headless worker. *(Procedencia: hablada — «Un solo borde, declarado».)*
- **D-7 · Two ports** — `ProcessRunner` (run, launch detached, read output) and `ProcessTable` (group liveness, kill, list, PTY); the rules of `this-repository.md:119-141` are tested with them doubled, and a restart is a new instance over the same state directory. *(Procedencia: hablada — «Puerto ProcessTable».)*
- **D-8 · Git, gh and claude** — answered by a scripted conversation that answers by request and raises on an unscripted one, fed by real captures under `backend/__tests__/captures/<tool>/` headed by command, tool version and date. *(Procedencia: hablada — «Conversación guionizada».)*
- **D-9 · The plugin scripts** — their answers are produced by the plugin's pure renderers the backend already imports, never by a captured file. *(Procedencia: hablada — «si», approving design section 2.)*
- **D-10 · The Makefile tests** — `makefile-local-env.test.ts` and `state-directory-real-process.test.ts` are deleted with no substitute and recorded as such in the ledger. *(Procedencia: hablada — «Borrarlos».)*
- **D-11 · Ratchet from day one** — the first slice lands a test that fails on an unlisted spawning file and on a listed file that no longer spawns; the last slice empties the list and the test stays as a prohibition. *(Procedencia: hablada — «Trinquete desde el día 1».)*
- **D-12 · Order** — slices are ordered by the false reds measured in CI, the most first. *(Procedencia: hablada — «C: por falsos rojos medidos».)*
- **D-13 · Conventions** — only `backend/conventions/this-repository.md` is amended; the amendment of `plugin/conventions/testing.md` waits for the plugin milestone. *(Procedencia: hablada — «dale», approving design section 3 after the correction.)*
- **D-14 · Timeouts** — `testTimeout` and `hookTimeout` in `backend/vitest.config.ts` return to vitest's defaults at the close, since nothing left can wait on a child. *(Procedencia: deducida de D-3.)*

## Enfoque técnico

The first slice is the heart: the border, the two ports, the scripted
conversation, the coverage baseline, the ledger and the ratchet. Every later
slice only moves a family of test files off the ratchet list onto those pieces,
proves with `c8` that no file of `backend/src` dropped, and appends its ledger
rows. The slices serialize because each one edits the ratchet list and the
ledger, and the order is D-12's: the run driver family (8 reds), restart
recovery (3), the run machine and checked delivery (3), the API entrypoint (3),
the tool runner and Claude calls (1), the PTY and sessions (0), and a closing
slice that empties the list, restores the timeouts and amends the convention.

## Contexto del milestone

- **Alcance:** `backend/src/**`, `backend/__tests__/**`, `backend/vitest.config.ts`, `backend/package.json`, `backend/package-lock.json`, `backend/conventions/this-repository.md`, `docs/superpowers/ledgers/**`
- Convention sources: `.agent/conventions.md`.
- The ledger is `docs/superpowers/ledgers/2026-09-24-backend-without-processes.md`: one row per deleted test case, `file > test name` → substitute, or `deleted without substitute — decided`.
- The coverage baseline is `backend/coverage-baseline.json`, written by the first slice and never rewritten upward to hide a drop; only the declared border is absent from it.
- A slice leaves every file it migrated off the ratchet list; a migrated file that still spawns is not delivered.
- Nothing under `plugin/` or `frontend/` is edited.

## Tabla de slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Repo |
|---|-------|------|---------|-----|--------|-----------|------|------|------|------|
| 1 | Foundations | backend | The declared border, ProcessRunner and ProcessTable, the scripted conversation, the c8 baseline, the ledger and the ratchet | – | the border is the only src module importing child_process or node-pty, the ratchet test fails on an unlisted spawning file and on a listed file that no longer spawns, backend/coverage-baseline.json holds lines and branches per src file with children counted, the ledger file exists with its format | plugin/, frontend/ | backend-tests | – | – | – |
| 2 | Run driver family | backend | run-driver, run-recovery, run-driver-runtime and run-dispatch tested in process | #1 | the four files are off the ratchet list, no src file drops below its baseline, every deleted case has a ledger row | plugin/, frontend/ | backend-tests | – | – | – |
| 3 | Restart recovery | backend | restart-recovery tested with ProcessTable doubled and a restart as a new instance over the same state directory | #2 | the file is off the ratchet list, the rules of this-repository.md:119-141 each have an in-process test, no src file drops below its baseline, every deleted case has a ledger row | plugin/, frontend/ | backend-tests | – | – | – |
| 4 | Run machine and checked delivery | backend | ct-run-machine and checked-run-delivery tested in process | #3 | both files are off the ratchet list, no src file drops below its baseline, every deleted case has a ledger row | plugin/, frontend/ | backend-tests | – | – | – |
| 5 | API entrypoint | backend | ct-api-real-process replaced by in-process tests of the composition | #4 | the file is off the ratchet list, no src file drops below its baseline, every deleted case has a ledger row | plugin/, frontend/ | backend-tests | – | – | – |
| 6 | Tool runner and Claude calls | backend | tool-runner, tool-runner-whole-output, claude-calls-real-process and claude-conversations tested through the scripted conversation | #5 | the four files are off the ratchet list, each adapter tells refusal from unreadable output, no src file drops below its baseline, every deleted case has a ledger row | plugin/, frontend/ | backend-tests | – | – | – |
| 7 | PTY and sessions | backend | pty-live-sessions and session-channel tested with the PTY behind ProcessTable | #6 | both files are off the ratchet list, no src file drops below its baseline, every deleted case has a ledger row | plugin/, frontend/ | backend-tests | – | – | – |
| 8 | The close | backend | The remaining files migrated or deleted, the ratchet a prohibition, default timeouts and the convention amended | #7 | the ratchet list is empty and gone, the Makefile tests are deleted with their ledger rows, backend/vitest.config.ts has no testTimeout or hookTimeout, this-repository.md no longer says the suite launches real processes nor names a fast subset | plugin/, frontend/ | backend-tests | – | – | – |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|
| A-1 | – | The plugin milestone: port `ct-init.sh` to node, decompose the command-line entrypoints per `architecture.md`, amend `testing.md`, retire `test:fast` | Decided in the brainstorming of 2026-09-24 for that milestone; see the design's *Parked for the plugin milestone* | Future milestone |
| A-2 | – | The false reds of suites that launch nothing: `claude-calls.test.ts` and the frontend EventSource flake | Out of this milestone by D-1's reading: they are not processes | Discarded here |

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
