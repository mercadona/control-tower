# #161 — el plan de una tarea se enmienda dentro de su propio commit, y lo juzga su juez

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body wins.

## 1. Context and goal

`ct-step.mjs` reads the plan from the WORKING TREE once, at start-up (`planText =
readFileSync(planPath, 'utf8')`), and everything downstream — the task's declared scope, the
implementer's brief and the judge's review package — comes from that read. Nobody ever reads
`git show HEAD:<plan>`. So an implementer who edits the plan in the tree already widens its own
scope and both judges already measure against the widened plan, while the pull request carries
the plan as it was committed. The amendment is real, in use, and invisible.

Two things break because of it. A task whose `**Files:**` line is wrong cannot be fixed from the
code, so `controlRetries` sends the run back to `implement` and the second failure closes it in
`BLOCKED_CONTROLS`, a state only a person leaves. And the only working way out today — leaving
the plan modified in the tree and committing it by hand after "run delivered" — is a commit made
outside the program; if it is forgotten, the pull request shows a plan that contradicts its code.

This slice makes the amendment visible and judgeable, in four pieces and by subtraction where it
can: `architecture.md` stops being filtered by the `(create)` mark, `ct-step report` stages the
plan when the tree brings it modified, the index-based controls stop counting machinery paths,
and one new check refuses an amendment that REMOVES a declared route.

### Desired end state

- The brief of a task that creates no file includes `architecture.md`, and so does that same
  task's review package.
- `creaModulo` no longer exists in `plugin/scripts/ct-step.mjs`; `forTask`, `appliesToTask`,
  `NEW_MODULES` and `scopeOf` no longer exist in `plugin/scripts/plugin-yardstick.js`.
- The kickoff text no longer splits architecture between `(create)` and `(modify)`.
- A plan amended in the tree mid-task ends up INSIDE that task's commit, with no new commit.
- `ct-step controls` exits 0 with the plan staged and its output never names the plan's path.
- The task's review package contains the diff of the plan file.
- After a task with an amendment, no later verb (`reconcile`, `global`, `slice-verdict`) exits
  with `PRECONDITION`.
- A vetoed attempt returns the tree, and the plan at HEAD does not declare the route the
  amendment had added.
- An amendment that REMOVES a declared route is refused, the step goes red saying why, and the
  plan at HEAD still declares it.
- The state file and `.agent/run-<n>/` stay out of the task's commit.
- The `plugin/` suite is green.

### Out of scope

Straight from the issue, and none of it is touched: the ledger crossing (`ct-step.mjs:332`) and
the one-commit-per-task invariant; the state file and `.agent/run-<n>/` in their `esDelRun`
exclusion; the verbs of `ct-step` (none added); the transitions of `run-machine.js` (none added);
the run's state file (no new field, no new counter); the schema of the task judge's verdict; the
human `plan` gate and its nonce; `composeSection`, `composePathSection`, the slice package and
`judge-bench.mjs`, which keep receiving the document list as they do today; the other direction
of the scope control (declared and not touched) and the `(create)` mark check against git, both
still fatal. The code does NOT write plan prose: the line is the implementer's, as today.

Also out: the other class of impossible plan (a `**Verification:**` predicate that goes red
whatever the code does), and tying the committed `.md` plan to the plan published as an issue
comment.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 | The implementation of a slice must not require human intervention. A block like the one measured on 2026-09-08 breaks that principle and is what has to be closed. |
| D-2 | The arbiter is the task judge, and the amendment enters the commit of its task. The implementer writes the line; who rules whether it was justified is the judge, with the amendment inside the diff it already judges. |
| D-3 | `architecture.md` applies always. The `(create)` filter is deleted whole. |
| D-4 | The simplest possible solution, and by subtraction. Rejected by this criterion: a separate amendments file, an `amend-plan` verb with a route guard, a `planAmendments` counter in the state, and a trigger on the second control retry. |
| D-5 | An amendment only ADDS. Deduced from D-2 and D-4. |
| D-6 | The order: the subtraction goes first. Deduced from D-3. |

## 3. Reference patterns

Files to imitate: `plugin/scripts/scope.js` — the literal precedent for this slice, the block
that explains why the judge's verdict is staged and left INSIDE the task's commit "porque el
veredicto tiene que viajar en la pull request"; `plugin/__tests__/ct-step-indice.test.js` — the
shape of a ct-step test file that drives the real script against a real git repo;
`plugin/__tests__/fixtures/ct-step-harness.js` — the fixture every such file mounts.

Rules to obey: N/A — this repository declares no convention file of its own: there is no
AGENTS.md, no CLAUDE.md, no .agent/conventions.md and no docs/conventions/ directory. The
yardstick that binds here is ct's own, which the program pastes into every task brief and hands
the judge by path; this slice is the one that makes all eight of its documents reach every task.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `plugin/scripts/plugin-yardstick.js` | modify | ct-step, judge-bench | Current state |
| `plugin/scripts/ct-step.mjs` | modify | the loop | Current state / Contract |
| `plugin/conventions/architecture.md` | modify | implementer, judge | Current state / Final text |
| `plugin/scripts/kickoff.js` | modify | the planner | prose |
| `plugin/prompts/task-implementer.md` | modify | implementer | prose |
| `plugin/agents/ct-judge.md` | modify | task judge | prose |
| `plugin/__tests__/ct-step-enmienda.test.js` | create | the suite | none (body by TDD) |
| `plugin/__tests__/plugin-yardstick.test.js` | modify | the suite | none (body by TDD) |
| `plugin/__tests__/ct-step-vara-y-telemetria.test.js` | modify | the suite | none (body by TDD) |
| `plugin/__tests__/ct-step-paquete.test.js` | modify | the suite | none (body by TDD) |
| `plugin/__tests__/run-metrics.test.js` | modify | the suite | none (body by TDD) |
| `plugin/__tests__/conventions-vara.test.js` | modify | the suite | none (body by TDD) |
| `plugin/__tests__/kickoff.test.js` | modify | the suite | none (body by TDD) |
| `plugin/__tests__/step-contracts.test.js` | modify | the suite | none (body by TDD) |

## 5. Interfaces

Consumes: N/A — the issue declares no dependency on another slice.

Produces: nothing exported outside `plugin/scripts/`. Inside `ct-step.mjs` this slice adds
`rutaDelPlan()`, `rutasDeTrabajoEnElIndice()` and `enmiendaSoloAnade(t)`, all module-private, and
`PluginYardstick` loses `scopeOf`, `appliesToTask` and `forTask` from its public surface.

## 6. Test strategy

Everything runs with vitest from `plugin/`. The behaviour of the loop is driven end to end
through `plugin/__tests__/fixtures/ct-step-harness.js`: a temporary repo with real git, a real
`origin`, and a two-task plan committed at `plan.md`. That is where an amendment can be written
into the tree mid-task exactly as an implementer would write it. The yardstick composition is
unit-tested in `plugin/__tests__/plugin-yardstick.test.js` and, against the documents really on
disk, in `plugin/__tests__/conventions-vara.test.js`.

## 7. Tasks

### Task 1 — the `(create)` filter goes

**Objective:** every document of `conventions/` reaches the brief and the judge's package of
every task.

**Files:** `plugin/scripts/plugin-yardstick.js` (modify), `plugin/scripts/ct-step.mjs` (modify),
`plugin/__tests__/plugin-yardstick.test.js` (modify),
`plugin/__tests__/ct-step-vara-y-telemetria.test.js` (modify),
`plugin/__tests__/ct-step-paquete.test.js` (modify), `plugin/__tests__/run-metrics.test.js` (modify)

Current state (plugin/scripts/plugin-yardstick.js, lines 11-15):

```
    '> quitarla. Cada documento declara su alcance en su propia cabecera',
    '> (`Applies to:`) y el programa te da SÓLO los que alcanzan a esta tarea:',
    '> `architecture.md` rige los MÓDULOS NUEVOS, así que viaja cuando la tarea',
    '> declara alguna ruta `(create)` y no cuando sólo modifica lo que ya estaba;',
    '> los demás alcanzan a todo diff.',
```

Those five become two: the program hands over the eight documents, they reach every diff, nothing
is filtered by `**Files:**`. The precedence rule below them is untouched.

Current state (plugin/scripts/ct-step.mjs, line 695):

```
const creaModulo = (t) => (t?.files ?? []).some((f) => f.action === 'create')
```

That line and its ten-line comment go — the comment claims `--check-plan` checks those marks
against the previous commit, which is false. Its two call sites become
`composeSection(deCt)` and `composePathSection(cargarVaraDeCt())`.

**TDD:** red first, in `ct-step-vara-y-telemetria.test.js`, reusing its `conLaUnoModificando()`
helper: `it('una tarea que no estrena módulo se lleva la vara entera, architecture.md incluido')`
— the brief carries `## Vara de ct: conventions/<name>` for each of the eight
`PluginYardstick.FILES`. Today it fails on `architecture.md`, and only on that one.

**Tests:** added: `una tarea que no estrena módulo se lleva la vara entera, architecture.md
incluido`. Removed: `una tarea que no estrena módulo no se lleva architecture.md, y sí el resto
de la vara`, `una tarea que estrena módulo sí se lleva architecture.md`, `la cabecera dice por
qué architecture.md puede no estar, para que su ausencia no se lea como un olvido`, `la tarea que
no estrena módulo tampoco recibe la ruta de architecture.md`,
`reads_the_scope_line_of_the_document`, `a_document_that_declares_no_scope_has_none`,
`a_task_that_creates_no_module_does_not_carry_the_new_modules_document`,
`a_task_that_creates_a_module_carries_the_new_modules_document`,
`the_three_new_documents_reach_a_task_that_creates_no_path_and_architecture_does_not`,
`a_document_that_declares_no_scope_travels_with_every_task`,
`on_the_documents_that_are_really_on_disk_only_architecture_is_left_out_of_a_task_that_creates_nothing`,
`on_the_documents_that_are_really_on_disk_a_task_that_creates_carries_all_eight`,
`composes_the_documents_of_a_task_that_creates_no_module`. Kept by name: `si el brief llegó a disco,
la fila cuenta sus documentos de vara de ct y su peso`, now expecting `FILES.length`.

**Verification:** the five symbols are gone; the suites that measured the filter pass.

```bash
test "$(grep -c 'creaModulo' plugin/scripts/ct-step.mjs)" -eq 0   # expected: exit 0
test "$(grep -cE 'forTask|appliesToTask|NEW_MODULES|scopeOf' plugin/scripts/plugin-yardstick.js)" -eq 0   # expected: exit 0
cd plugin && npx vitest run __tests__/plugin-yardstick.test.js __tests__/ct-step-vara-y-telemetria.test.js __tests__/ct-step-paquete.test.js __tests__/run-metrics.test.js   # expected: exit 0
```

### Task 2 — the prose that stopped being true

**Objective:** no text handed to an agent still says that `architecture.md` is filtered by the
`(create)` mark.

**Files:** `plugin/conventions/architecture.md` (modify), `plugin/scripts/kickoff.js` (modify),
`plugin/prompts/task-implementer.md` (modify), `plugin/agents/ct-judge.md` (modify),
`plugin/__tests__/conventions-vara.test.js` (modify), `plugin/__tests__/kickoff.test.js` (modify)

Current state (plugin/conventions/architecture.md, line 3):

```
Applies to: **new modules**.
```

Final text (plugin/conventions/architecture.md):

```
Applies to: **every diff**.
```

The document keeps every other line: the declared-debt exemption for a module that was already
there, and the hole it closes in the same breath, are its own prose and stay true. What changes
is only its declared scope.

In prose, three retirements of the same false claim. `plugin/scripts/kickoff.js`: the sentence
that tells the planner `architecture.md` rules NEW MODULES and that "de qué lado cae cada cosa lo
decides tú al repartir `**Files:**` entre `(create)` y `(modify)`" is deleted whole — the
entry before it, which points at the conventions directory and at the precedence header, stays.
`plugin/prompts/task-implementer.md`: "`architecture.md` applies to **new modules**" becomes
"applies to **every diff**, with one bend for a module that was already there"; the sentence that
says which of the two kinds of code you are writing is settled by the `(create)` and `(modify)`
marks stays, because it is still true. `plugin/agents/ct-judge.md`, item two of its scope
section: "each one says so in its own scope line, and the block above the list says which
documents that leaves reaching this task" becomes a statement that both documents reach every
task and say the exemption in their own text. In `plugin/__tests__/conventions-vara.test.js` the
`ALCANCES` entry for `architecture.md` becomes `every diff`.

**TDD:** red first, in `plugin/__tests__/kickoff.test.js`: `it('no reparte la arquitectura entre
las dos marcas: architecture.md alcanza a toda tarea')` — the kickoff rendered by
`renderKickoff(SLICE, OPTS_CON_VARA)` contains neither the string `MÓDULOS NUEVOS` nor the phrase
that splits the work between the two marks. Today it contains both.

**Tests:** added: 'no reparte la arquitectura entre las dos marcas: architecture.md alcanza a
toda tarea'. Removed on purpose: none — the scope tests of `conventions-vara.test.js` are
generated from the `ALCANCES` map and keep their names.

**Verification:** the new scope is declared, the three false claims are gone, and the suites that
read those texts pass.

```bash
test "$(grep -c 'Applies to: \*\*every diff\*\*' plugin/conventions/architecture.md)" -eq 1   # expected: exit 0
test "$(grep -c 'MÓDULOS NUEVOS' plugin/scripts/kickoff.js)" -eq 0   # expected: exit 0 — the sentence is retired
test "$(grep -c 'applies to \*\*new modules\*\*' plugin/prompts/task-implementer.md)" -eq 0   # expected: exit 0
cd plugin && npx vitest run __tests__/conventions-vara.test.js __tests__/kickoff.test.js __tests__/precedencia-una-sola-fuente.test.js __tests__/prompts-en-positivo.test.js   # expected: exit 0
```

### Task 3 — the amended plan travels inside the commit of its task

**Objective:** when the tree brings the plan modified, `ct-step report` stages it and the
index-based controls leave the machinery out of their count, so no new commit appears.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/ct-step-enmienda.test.js` (create)

Current state (plugin/scripts/ct-step.mjs, lines 1081-1086):

```
const esDelRun = (p) => {
  const suyo = `${relative(repoRoot, workDir)}/`
  return p === relative(repoRoot, stateFile) ||
    p === relative(repoRoot, resolve(planPath)) ||
    p.startsWith(suyo)
}
```

Contract (plugin/scripts/ct-step.mjs):

```
const rutaDelPlan = () => relative(repoRoot, resolve(planPath))
// esDelRun loses its plan clause: state file and run directory only.
// entradasDelArbol keeps its filter and lets the plan through both guards:
//   rutaSegura(ruta) && !esDelRun(ruta) &&
//     (ruta === rutaDelPlan() || !esRutaDeLaMaquinaria(ruta))
const rutasDeTrabajoEnElIndice = () =>
  stagedPaths().filter((p) => p !== rutaDelPlan() && !esRutaDeLaMaquinaria(p))
// alcanceDeclarado, bloquesDeclarados and enElIndice read that instead of
// stagedPaths(). ajenoEnElIndice keeps reading the raw index.
```

Why `enElIndice` too: it is a `git grep --cached` scoped to the staged paths, and the comment
above it already records the false positive a committed plan produces — a plan quotes test names
verbatim, so a staged plan would answer "sigue estando" for every test the task said it removed.

**TDD:** red first, in the new `plugin/__tests__/ct-step-enmienda.test.js`, on the harness repo:
the implementer of task 1 writes `uno.txt` and `extra.txt` and amends `plan.md` so task 1's
`**Files:**` declares both. `it('el plan enmendado a media tarea entra en el commit de esa tarea,
y el estado y el directorio del run no')` — after `report`, `controls`, `verdict` and `commit`,
`git show --name-only HEAD` names `plan.md` and does NOT name `.agent/SLICE.md`, and the commit
count from the base is still one.

**Tests:** added, all in `plugin/__tests__/ct-step-enmienda.test.js`: 'el plan enmendado a media
tarea entra en el commit de esa tarea, y el estado y el directorio del run no'; 'el control de
alcance sale 0 y su salida no nombra la ruta del plan'; 'el paquete de revisión de la tarea trae
el diff del plan'; 'tras una tarea con enmienda, reconcile, global y slice-verdict no salen con
PRECONDITION'; 'un veredicto vetado devuelve el árbol y el plan de HEAD no declara la ruta que la
enmienda añadió'.

**Verification:** the new file passes, and the suites that drive the index and the controls
through the same harness stay green.

```bash
test "$(grep -c 'rutasDeTrabajoEnElIndice' plugin/scripts/ct-step.mjs)" -ge 4   # expected: exit 0 — the helper and its three readers
cd plugin && npx vitest run __tests__/ct-step-enmienda.test.js __tests__/ct-step-indice.test.js __tests__/ct-step-plan-y-controles.test.js __tests__/ct-step-paquete.test.js   # expected: exit 0
```

### Task 4 — an amendment may only ADD routes

**Objective:** an amendment that removes a route from the current task's `**Files:**` is refused
by `ct-step controls`, so the other direction of the scope control cannot be switched off from
inside the plan.

**Files:** `plugin/scripts/ct-step.mjs` (modify), `plugin/__tests__/ct-step-enmienda.test.js` (modify)

Contract (plugin/scripts/ct-step.mjs):

```
// Called from verboControls right after alcanceDeclarado, same fatal weight,
// its own section header in the log: '# enmienda del plan'.
function enmiendaSoloAnade(t) // => string[] of failures
// [] when the plan is not among stagedPaths(), when `git show HEAD:<rutaDelPlan()>`
// cannot be read, or when that text declares no task t.n: there is nothing to
// compare against, and this check never invents a comparison.
// Otherwise one failure per path declared in **Files:** of task t.n at HEAD and
// absent from t.files, worded:
//   `la tarea ${t.n} enmendó el plan quitando '${ruta}' de sus **Files:** — una
//    enmienda sólo puede AÑADIR rutas: quitar una desactiva desde dentro el
//    control de alcance. Devuelve la ruta al PLAN, o escribe el CÓDIGO que
//    prometía.`
```

The HEAD text is parsed with the same `extractTasks` the program already imports from
`plan-tasks.js`; comparison is on `path` only, and the `action` mark is not compared — that is
already the job of `alcanceDeclarado`, which stays exact and stays fatal.

**TDD:** red first: `it('una enmienda que quita una ruta declarada se rechaza y el paso sale en
rojo')` — the implementer of task 1 writes `uno.txt`, then amends `plan.md` so task 1 declares
only `dos.txt`; `ct-step controls` exits non-zero and its log carries the phrase `sólo puede
AÑADIR rutas` together with the removed path `uno.txt`.

**Tests:** added: 'una enmienda que quita una ruta declarada se rechaza y el paso sale en rojo';
'una enmienda que sólo añade rutas pasa el control'; 'tras el rechazo, el plan de HEAD sigue
declarando la ruta que la enmienda quitó'.

**Verification:** the guard exists, its tests pass, and the pre-existing control suite is
unchanged by it.

```bash
test "$(grep -c 'enmiendaSoloAnade' plugin/scripts/ct-step.mjs)" -ge 2   # expected: exit 0 — definition and call site
cd plugin && npx vitest run __tests__/ct-step-enmienda.test.js __tests__/ct-step-plan-y-controles.test.js   # expected: exit 0
```

### Task 5 — the task judge is told that a diff of the plan is an amendment

**Objective:** the task judge rules on whether the amendment was justified instead of vetoing the
plan file by reflex as an out-of-scope path, or ignoring it.

**Files:** `plugin/agents/ct-judge.md` (modify), `plugin/__tests__/step-contracts.test.js` (modify)

No code — the deliverable is the judge's own brief, and the change is prose inside an existing
rubric item.

In `plugin/agents/ct-judge.md`, item 8 of the rubric (`alcance`) gains a paragraph, after the
"Already mechanical" note that already tells the judge the paths are settled: a diff of the plan
file inside a task is an AMENDMENT written by the implementer, not a path out of scope; ruling
whether it was justified belongs to this item; the program already refused any amendment that
removes a declared route, so what reaches the judge only ADDS; and the question to answer is
whether the sentence of the task justifies the route the implementer added. The plan was
committed before the run started, so what shows in the diff is the amended lines, not the whole
plan.

**TDD:** red first, in `plugin/__tests__/step-contracts.test.js`, where the rubric of
`agents/ct-judge.md` is already read from disk: `it('el ítem alcance le dice al juez que un diff
del plan es una enmienda que tiene que dictaminar')` — the text of item 8 contains the word
`amendment` and names the plan file as the subject of that item.

**Tests:** added: 'el ítem alcance le dice al juez que un diff del plan es una enmienda que tiene
que dictaminar'. Removed on purpose: none.

**Verification:** the paragraph is there and the suites that read the judge's definition pass.

```bash
test "$(grep -c 'amendment' plugin/agents/ct-judge.md)" -ge 1   # expected: exit 0
cd plugin && npx vitest run __tests__/step-contracts.test.js __tests__/prompts-en-positivo.test.js __tests__/role-bytes.test.js __tests__/judge-bench.test.js   # expected: exit 0
```

## 8. Global verification

The whole `plugin/` suite, plus the four claims of the acceptance criteria that are statements
about the source and not about behaviour. `npm test --prefix plugin` rebuilds `dist/` and then
runs vitest; nothing this slice touches is bundled into `dist/`, so the bundle stays coherent.

```bash
test "$(grep -c 'creaModulo' plugin/scripts/ct-step.mjs)" -eq 0   # expected: exit 0
test "$(grep -cE 'forTask|appliesToTask|NEW_MODULES|scopeOf' plugin/scripts/plugin-yardstick.js)" -eq 0   # expected: exit 0
test "$(grep -c 'MÓDULOS NUEVOS' plugin/scripts/kickoff.js)" -eq 0   # expected: exit 0
npm test --prefix plugin   # expected: exit 0 — the whole plugin suite green
```

## 9. Assumptions

1. **`architecture.md` declares its own scope as `every diff`.** The issue closes D-3 ("applies
   always") and orders the filter deleted, but does not name the document's own `Applies to:`
   line. Left as `new modules` it would contradict, inside the very text pasted into a
   modify-only task, the header that carried it there — and `conventions-vara.test.js` asserts
   each document's declared scope. Provenance: own call, deduced from D-3.
2. **`plugin/prompts/task-implementer.md` and `plugin/agents/ct-judge.md` lose the same false
   claim as `kickoff.js`.** The issue only names the kickoff text, but the other two state the
   filter as a fact about which documents reach the task, and after Task 1 that is false.
   Provenance: own call, same defect as the one the issue names.
3. **`enElIndice` reads the filtered index too.** The issue's piece 3 names `alcanceDeclarado`
   only. `enElIndice` shares `stagedPaths()` and its own comment records the measured false
   positive a plan in scope produces, so leaving it raw would reintroduce that defect the moment
   the plan is staged. Provenance: own call, from the code.
4. **The additive-only guard lives in `ct-step controls`.** The issue says the amendment "se
   rechaza, el paso sale en rojo diciendo por qué" without naming a step; `controls` is where
   scope is already verified, is already fatal, and adds no verb — which "Out of scope" requires.
   Provenance: own call, from the issue's wording plus its protected list.
5. **The guard says nothing when it cannot compare.** No plan at HEAD, unreadable text, or no
   task `n` in it: the check returns no failure rather than inventing one. The plan being
   committed before implementing is already the `plan` gate's job, and `--release` revalidates
   the amended plan. Provenance: own call.
6. **The new tests get their own file, `ct-step-enmienda.test.js`, with Spanish describes.** The
   harness records that the ct-step tests were split across nine files for vitest parallelism,
   and the eight siblings all write their prose in Spanish; a ninth written in English would read
   as a different suite. Identifiers stay English. Provenance: repo convention, from
   `plugin/__tests__/fixtures/ct-step-harness.js`.
7. **The acceptance criteria are the issue's own list.** The issue's "Acceptance criteria (EARS)"
   section says "(rellenar desde el spec)" and its "Out of scope / Protected" section says
   "(ninguno declarado)", but the epic context carries both lists in full. Those are what
   `### Desired end state` and `### Out of scope` mirror. Provenance: issue.
