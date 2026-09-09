# The migration glossary

Every Spanish term this repository still carries, and the one English term it
becomes. `AGENTS.md` states the rule; this file removes the room for
improvisation while the rule is being applied.

**This is extraction, not invention.** The English vocabulary is already
established here — in the *Ubiquitous language* table of
`backend/conventions/this-repository.md`, in the eight English documents of
`plugin/conventions/`, and in the twenty-two script filenames that already carry
it: `plugin-yardstick.js`, `yardstick-citation.js`, `harvest.js`,
`harvest-ledger.js`, `dispatch.js`, `dispatch-gate.js`, `reconcile.js`,
`reconcile-outcome.js`, `scope.js`, `claim.js`, `gates.js`, `state.js`,
`state-paths.js`, `step-contracts.js`.

The migration is visibly half-done: `vara.js` and `plugin-yardstick.js` sit in
the same directory today. A term translated two ways is worse than a term left
in Spanish — the second is visibly debt, the first looks finished.

**This file is temporary.** It exists to be deleted, on the day no Spanish term
in the left column appears anywhere in the tree.

## The domain

These carry the weight. The count is occurrences of the word inside identifiers
and test names, measured on `b77c76e`.

| Spanish | English | Count | Note |
|---|---|---|---|
| vara | yardstick | 644 | The travelling conventions a diff is judged against |
| tarea | task | 703 | One committed-ready unit of a slice's plan |
| veredicto | verdict | 512 | What the judge returns |
| juez | judge | 495 | `ct-judge`; **jueces** → judges |
| señal / senal | signal | 677 | The observability a slice declares |
| aviso | warning | 566 | What a program tells a person without failing |
| estado | state · status | 655 | See the split below |
| orden | order | 423 | The §9 sequence of slices; **not** `command` |
| paso | step | 322 | `ct-step`; **pasos** → steps |
| control / controles | check · checks | 303 | A gate the program runs, not a "control" |
| corrida | run | 273 | One execution of the bench or the loop |
| prosa | prose | 264 | As in the yardstick's "no prose in the code" |
| marcador | marker | 211 | A literal delimiter in a file |
| intento | attempt | 211 | One try of a task before discard |
| salida | output | 209 | **entrada** → input |
| alcance | scope | 199 | What a slice is allowed to touch |
| hallazgo | finding | 191 | One thing a judge or review reports |
| despacho | dispatch | 176 | **despachador** → dispatcher |
| cierre | closure | 172 | Closing an issue, ending a turn |
| celda | cell | 178 | **celdas** → cells |
| vigilante | watcher | 162 | `ct-watch-*`; the merge and GO watchers |
| tanda | batch | 146 | A group of issues groomed together |
| cosecha | harvest | 104 | Collecting what a merged slice left behind |
| arranque | start-up | 80 | Session start, not "boot" |
| rúbrica | rubric | 180 | The judge's scoring document |
| banco | bench | 24 | `judge-bench` |
| barandilla | guardrail | 19 | **barandillas** → guardrails |
| hueco | gap | 113 | A hole in a plan or a contract |
| pegado | pasted | 81 | Yardstick text pasted into a brief |
| apunte | entry | 20 | One line in a ledger |
| papel | role | 55 | Coordinator or slice-agent; **not** `paper` |
| pieza | piece | 25 | **piezas** → pieces |
| red | net | 109 | As in "the safety net"; **not** `network` |
| medida | measure | 104 | **medición** → measurement |
| tope | cap | 71 | A budget or a limit |
| frontera | boundary | — | Matches `plugin/conventions/boundaries.md` |
| reconciliación | reconciliation | — | Already in `reconcile.js` |
| coherente | coherent | 25 | As in "dist matches its sources" |
| deuda | debt | — | "declared debt", already in the yardstick |
| conductor | conductor | — | The program that drives the sequence |
| junta | seam | — | Where two pieces meet |
| guardián | guard | — | What refuses a bad write |
| resumen | summary | 39 | |
| resto | rest · remainder | 174 | |
| motivo | reason | 407 | Why something failed or was refused |
| ausente | absent | 163 | **presente** → present |
| contrato | contract | 410 | |
| fuente | source | 94 | **fuentes** → sources |

## `estado` splits, and one half does not move

- **state** where it is the loop's own record: `.agent/STATE.md`, `state.js`,
  `state-paths.js`, a machine's current state.
- **status** where it is the issue's rung on the ladder: `status:backlog`,
  `status:ready`, `status:in-progress`, `status:in-review`. These are **GitHub
  labels and already English** — they are contract and no rename touches them.

`loop-estado.js` is the loop's own record, so it becomes `loop-state.js`.

## The ordinary words

Not domain terms, but they appear inside identifiers and test names.

| Spanish | English | | Spanish | English |
|---|---|---|---|---|
| fichero / ficheros | file / files | | ruta / rutas | path / paths |
| directorio | directory | | carpeta | folder |
| texto | text | | cuerpo | body |
| mensaje / mensajes | message / messages | | comando / comandos | command / commands |
| nombre | name | | clave / claves | key / keys |
| línea / líneas | line / lines | | número | number |
| dato / datos | datum / data | | caso / casos | case / cases |
| prueba / pruebas | test / tests | | cuenta | account · count |
| título | title | | rama / ramas | branch / branches |

`cuenta` is genuinely ambiguous — **account** in `resolución de cuenta`
(resolving a GitHub account), **count** where something is being counted. Read
the call site; do not guess.

## What never gets translated

- **GitHub labels** of the ladder and the gate: `status:*`, `gate:none`.
- **Block markers** seeded into governed repositories:
  `<!-- ct-init:slices-contract -->`, `<!-- ct-order:N -->`.
- **YAML keys** of `.agent/STATE.md` and `.agent/SLICE.md`.
- **Contract paths**: `docs/superpowers/plans` is validated by
  `plan-contract-progress.js` and read by `task-brief.test.js`.
- **Frontend product copy** — `AGENTS.md` states the exemption.
- **Filenames of the dated record**: the plans, specs and session prompts under
  `docs/` keep their Spanish names, because they are minutes of what happened.
