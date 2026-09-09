#!/usr/bin/env node
// ============================================================================
// ct-step.mjs — THE STATE MACHINE AS AN ORACLE, NOT AS A CONDUCTOR.
//
// The orchestrator is still a chat session (D-4's literal question —"does it
// stop being one?"— still answers NO): the session dispatched by /ct-next is
// still driving, still dispatching subagents and still opening the pull
// request. What changes is that IT NO LONGER DECIDES THE SEQUENCE: it asks.
//
// What this fork DID take (commit 3071d8a; upstream reserved it for José with
// the test d4-sigue-siendo-de-jose, deleted in that same commit) is the default
// path: the kickoff of /ct-next orders it to drive by consulting this file, and
// `dispatch-check --release` demands the run delivered (exit 7 if not).
//
//   ct-step next                    → "toca implementar la tarea 3; el brief está en X"
//   ct-step report informe.json     → validates the paths, stages them, transitions
//   ct-step controls                → runs the plan's commands and MEASURES
//   ct-step verdict veredicto.json  → validates against the schema, transitions
//   ct-step commit                  → validates the message and commits
//
// There is no loop here and there is not one single call to the model. This
// program conducts nothing: it answers questions and applies a table
// (`run-machine.js`).
//
// ---------------------------------------------------------------------------
// WHAT IS GAINED ALL THE SAME, WITH NO CONDUCTOR PROGRAM
//
// 1. The sequence stops being prose. The table decides it, and **every verb
//    refuses whatever is not the step that is due** (code 9). The session
//    cannot ask for `commit` while at `controls`, nor skip the judge, nor go
//    back and implement a task that is already committed. Obedience of the
//    SEQUENCE becomes structural even though the conductor is an agent.
// 2. Where it has got to stops living in the conversation. It is in
//    `.agent/run-<issue>.json`, so a compaction does not erase it and the
//    ledger of `subagent-driven-development` is no longer needed.
// 3. The task is measured by the program, not by the implementer: `ct-step
//    controls` runs the commands the plan declares and checks that the tests
//    the task promised really do exist.
// 4. The program commits, not the implementer: a veto leaves no trace to
//    undo. And the message is validated with `closing-keywords.js`, because the
//    hook `commit-keyword-guard` is a PreToolUse over the Bash of a SESSION and
//    a `git commit` launched by a script does not go through that gate.
//
// WHAT IS LOST, AND IT HAS TO BE SAID
//
// - **The verdict's schema is no longer imposed by the binary.**
//   `--json-schema` only exists in `--print` mode (measured, §2.1 of the spec),
//   and there are no headless calls here. Almost all of it is recovered by
//   asking the judge to write its verdict to a JSON and validating it here: if
//   it does not comply, it is a discard all the same. But it is a later
//   validation that imposes it, not the tool.
// - **There is no budget in money.** The cost of a call is returned by
//   `claude -p` in `total_cost_usd`; a subagent of the session does not report
//   it. As a knock-on, this stops touching the scope of F38, which is José's.
// - The judge cannot execute because it is dispatched as `ct-judge`
//   (`agents/ct-judge.md`, declared without `Bash`), not because a flag takes it
//   away.
// ============================================================================

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, unlinkSync, writeSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, resolve } from 'node:path'
import { after, newRun, STEPS, OUTCOMES, RUN_STATES, DEFAULT_BUDGETS, outcomeOfReconcile, reconcileBudgetSpent } from './run-machine.js'
import { extractTasks } from './plan-tasks.js'
import { BranchReconciliation } from './branch-reconciliation.js'
import { ReconcileOutcome, DiscardReason } from './reconcile-outcome.js'
import { LOOP_ARTIFACT_PATTERNS, matchesPattern } from './scope.js'
import { CONVENTIONS_FILE, seccionDeVara } from './vara.js'
import { PluginYardstick } from './plugin-yardstick.js'
import { PluginManifest } from './plugin-manifest.js'
import {
  readVerdict, readReport, outcomeOfVerdict, commitMessage, findingLocation,
  readE2eReport, E2E_SCHEMA,
  IMPLEMENTER_TOOLS, IMPLEMENTER_MODEL, JUDGE_TOOLS, PACKAGE_SECTIONS,
  readSliceVerdict, outcomeOfSliceVerdict, sliceVerdictCommitMessage,
  SLICE_JUDGE_TOOLS, SLICE_PACKAGE_SECTIONS, RECONCILER_TOOLS,
  REVIEW_TOKEN_LABEL, reviewToken, reviewTokenLine, reviewTokenOf,
  readAdvice, ADVISOR_TOOLS, ADVICE_PACKAGE_SECTIONS,
} from './step-contracts.js'
import { metricRow, metricLine, metricsPath, planSha256, verdictMeasures, metricsRepoRelPath, briefVaraCtMeasures } from './run-metrics.js'
import { RoleBytes } from './role-bytes.js'
// Slice 10: parseStateSafe reads the `senal:` field of the SLICE.md (see
// senalDelSlice, below, for why the `epic:` regex will not do), and
// SENAL_AUSENTE is the ONE constant with which the two writers of the channel
// (buildStateSeed when seeding, this module when packaging the fallback)
// declare that there is no signal — imported, not copied, so that they cannot
// diverge.
import { parseStateSafe } from './state.js'
import { SENAL_AUSENTE } from './kickoff.js'
import { SLICE_REL_PATH } from './state-paths.js'
import { findClosingKeywords } from './closing-keywords.js'
import { CtStepCommit } from './ct-step-commit.js'
import { BaseBranch } from './slice-base.js'
import { StepSeal } from './dispatch-gate.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

// One per DECISION, not one per exception: every row says what to do next.
const EXIT = {
  OK: 0,                  // the step was applied; `next` says which one is due now
  VETOED: 1,              // the judge vetoes and the retries ran out
  USAGE: 2,               // a usage error
  NO_VERDICT: 3,          // no verdict to trust after the discards
  CONTROLS_RED: 4,        // the checks are still red after the retries
  CONTROLS_UNMEASURED: 5, // they could not be MEASURED
  PLAN_NOT_EXECUTABLE: 6, // the plan declares no executable commands
  E2E_RED: 7,             // some e2e journey does not complete
  PRECONDITION: 8,        // environment: not a slice worktree, the plan is missing
  WRONG_STEP: 9,          // a step was asked for that is not the one due
  UNNAMED: 10,            // an exception the program does not know how to name
  // §3.7-A: a Global verification that is red or unmeasurable closes the run ON
  // THE FIRST GO (with no retries — everything is committed). Codes of their
  // own and not those of controls (4/5): the next action is not that of a task
  // with staged work to correct, it is "do not open the pull request".
  GLOBAL_RED: 11,
  GLOBAL_UNMEASURED: 12,
  // Phase B: the reconciler and, after it, the slice's own agent ran out of
  // their rounds against the base — the same shape as GLOBAL_RED, a code of its
  // own because what follows is not "correct the task", it is "resolve the
  // conflict".
  RECONCILE_BLOCKED: 13,
}

const MAX_DISCARDS = 6

function safeWrite(fd, text) {
  try { writeSync(fd, text) } catch { /* the pipe is closed: the line is lost, the exit code does not change */ }
}
const out = (msg) => safeWrite(1, msg + '\n')
const err = (msg) => safeWrite(2, msg + '\n')
const die = (msg, code) => { err(msg); process.exit(code) }

const arg = (f, d) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return d
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const USAGE = `uso: ct-step <verbo> [args] --plan <fichero> --issue <n>

  next                      dice qué paso toca y prepara lo que ese paso necesita
  report <fichero.json>     el informe del implementador: rutas tocadas + resumen
  controls                  ejecuta los comandos de **Verification:** de la tarea
  verdict <fichero.json>    el veredicto del juez: ruling + recorrido de la rúbrica + findings
  advice <fichero.json>     el consejo del consejero, tras el segundo veto: enfoque + rutas a reconsiderar
  commit                    comitea la tarea con el mensaje que compone el plugin
  reconcile                 fusiona la base o concluye una fusión a medias, tras la última tarea
  global                    ejecuta los comandos de ## 8. Global verification, tras la última tarea
  slice-verdict <fichero.json>  el veredicto del juez de SLICE: ruling + recorrido + findings
  e2e <fichero.json>        el informe de la travesía de punta a punta de la slice

La secuencia la decide run-machine.js: un verbo que no sea el paso que toca sale
por 9 y dice cuál es. El estado vive en .agent/run-<issue>.json.`

const verbo = process.argv[2]
if (!verbo || verbo.startsWith('--')) die(USAGE, EXIT.USAGE)
if (!['next', 'report', 'controls', 'verdict', 'advice', 'commit', 'reconcile', 'global', 'slice-verdict', 'e2e'].includes(verbo)) {
  die(`verbo desconocido: ${verbo}\n\n${USAGE}`, EXIT.USAGE)
}

const planPath = arg('--plan')
const issueRaw = arg('--issue')
if (typeof planPath !== 'string' || !planPath) die(USAGE, EXIT.USAGE)
if (typeof issueRaw !== 'string' || !/^\d+$/.test(issueRaw)) {
  die(`--issue debe ser un número entero: recibí ${JSON.stringify(issueRaw)}`, EXIT.USAGE)
}
const issue = Number(issueRaw)

const GIT_MAX_BUFFER = 64 * 1024 * 1024
const git = (argv, { allowFail = false } = {}) => {
  try {
    return execFileSync('git', argv, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 120_000, killSignal: 'SIGKILL',
    })
  } catch (e) {
    if (allowFail) return null
    throw new Error(`git ${argv.join(' ')} falló: ${String(e.stderr || e.message).trim()}`)
  }
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------
const repoRoot = (git(['rev-parse', '--show-toplevel'], { allowFail: true }) || '').trim()
if (!repoRoot) die('no estamos dentro de un repositorio git', EXIT.PRECONDITION)
if (!existsSync(join(repoRoot, '.agent', 'SLICE.md'))) {
  die('esto no es el worktree de un slice (falta .agent/SLICE.md). ct-step conduce el tramo interno de una slice.', EXIT.PRECONDITION)
}

let planText
try {
  planText = readFileSync(planPath, 'utf8')
} catch (e) {
  die(`no se puede leer el plan ${planPath}: ${e.message}`, EXIT.PRECONDITION)
}
const { tasks, problems, global: globalVerification } = extractTasks(planText)
if (problems.length) {
  for (const p of problems) err(`plan no ejecutable: ${p.detail}`)
  process.exit(EXIT.PLAN_NOT_EXECUTABLE)
}

// The steps that belong to the SLICE and to no task. One single list and not
// two: it is used by the cross-check of commits (below) and by the telemetry
// (`medir`), and when the same concept was written twice the second copy fell
// behind when `e2e` arrived — with the result that every e2e row was attributed
// to the last task of the plan.
const PASOS_DE_SLICE = [STEPS.RECONCILE, STEPS.GLOBAL, STEPS.SLICE_JUDGE, STEPS.E2E]

// ---------------------------------------------------------------------------
// The state of the run
// ---------------------------------------------------------------------------
const stateFile = join(repoRoot, '.agent', `run-${issue}.json`)
const workDir = join(repoRoot, '.agent', `run-${issue}`)
mkdirSync(workDir, { recursive: true })

const headSha = () => (git(['rev-parse', 'HEAD']) || '').trim()

// Branch reconciliation, task 3 — the ORIGIN of the range is still
// `run.baseSha`; what gets taken away is what the base contributed.
//
// `ct-step` does not ask the same question as the gates of `dispatch-check`.
// Those ask "which files does this branch contribute?" and their answer is the
// merge-base. This one asks "how many commits has THIS run made?", and there
// the merge-base is the wrong answer: `run.baseSha` is NOT where the branch was
// cut, it is `headSha()` at the moment the run's file is created (further
// down), and by then the kickoff has already ordered the plan to be committed
// (`kickoff.js`: «commitéalo: viaja en el PR» … «Con el plan commiteado…
// Pregunta el paso con ct-step next»). The real history in production is
// `B (the cut) → P (the plan's commit) → the run is born`, with
// `run.baseSha = P` while the merge-base is `B`. Measuring from `B` puts the
// plan's commit inside the count, `hechos` comes out permanently one too many,
// and every run dies at PRECONDITION on its second verb without any merge being
// involved at all.
//
// Hence the shape:
//
//   git rev-list --count --no-merges run.baseSha..HEAD ^origin/<rama-base>
//
// `run.baseSha..HEAD` leaves out everything before the run —the plan's commit
// included—, `^origin/<rama-base>` leaves out what an advanced base brought in
// through a merge (every foreign commit counted as if it belonged to a task),
// and `--no-merges` leaves out the merge commit itself.
//
// The branch name comes out of `.agent/SLICE.md` with `parseStateSafe` — the
// same parser this file already uses for `epic:` and `senal:` (see below) — and
// NOT with a regex of its own: `dispatch-check.mjs` does have its own for this
// same field (`campoBaseDeLaSemilla`), debt older than this task and outside
// its scope. Which remote branch it is when the seed does not name it is
// decided by `BaseBranch` (scripts/slice-base.js), the same resolver
// `dispatch-check.mjs` consumes: that fallback chain used to be written twice
// and already answered differently in each file.
//
// With no resolvable base branch, or with an `origin/<rama>` that does not
// exist in this worktree, the measurement is made without the exclusion: the
// worst case is counting the way it was counted until today, never "not
// counting".
const refRemotaResuelve = (nombre) =>
  git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${nombre}`], { allowFail: true }) !== null

// The resolution itself —which branch is "the base"— lives in one single
// function, and not one per consumer: `reconcile` (Task 8) needs the NAME to
// pass it to `BranchReconciliation.merge({ baseBranch })`, and this exclusion
// needs the name to build the `git rev-list` filter. It is the same question
// asked twice for two different reasons, and the reviewer of the previous phase
// warned in writing that a second copy here would be "the third divergent copy"
// of this same decision.
function resolverRamaBase() {
  const { meta } = parseStateSafe(readFileSync(join(repoRoot, SLICE_REL_PATH), 'utf8'))
  return new BaseBranch({ remoteRefExists: refRemotaResuelve }).resolve({ declared: meta.base })
}

function exclusionDeLaBase() {
  const rama = resolverRamaBase()
  if (!rama || !refRemotaResuelve(rama)) return null
  return `^origin/${rama}`
}

const commitsDelRun = (desde, exclusion) => {
  const argv = ['rev-list', '--count', '--no-merges', `${desde}..HEAD`]
  if (exclusion) argv.push(exclusion)
  const salida = git(argv, { allowFail: true })
  return salida === null ? null : Number(salida.trim())
}

let run
if (existsSync(stateFile)) {
  run = JSON.parse(readFileSync(stateFile, 'utf8'))
  // Phase B: a run OPENED before `reconcileRetries` existed does not carry the
  // field, and `undefined < 2` is `false` — the budget would be read as spent
  // and the first conflict would close at BLOCKED_RECONCILE without having
  // dispatched the reconciler even once. Precisely the oldest runs, which are
  // the ones whose base has moved the most. The same remedy and the same reason
  // as the `sliceCommits || 0` a few lines further down: no persisted state ever
  // gains a mandatory field.
  run = { ...run, reconcileRetries: run.reconcileRetries || 0 }
  // A delivered run has no next step, and that is known WITHOUT rebuilding the
  // table: the good closure is persisted as `closed` (it is what the gate of
  // `dispatch-check --release` reads). `next` answers "it is done" and exits
  // well; any verb that transitions is the usual sequence error.
  if (run.closed === RUN_STATES.DELIVERED) {
    if (verbo === 'next') {
      out(`run delivered: las ${run.tasksTotal} tareas del issue ${issue} están comiteadas con veredicto, la Global verification en verde y el slice juzgado. No queda paso — abre la pull request y libera con dispatch-check --release.`)
      process.exit(EXIT.OK)
    }
    die(`el run del issue ${issue} ya está entregado: no queda paso que dar`, EXIT.WRONG_STEP)
  }
  // The file is not believed on its own: it cross-checks the task the state
  // names against the commits there are since the measuring reference. Guessing
  // here means reimplementing on top of a task that is already committed.
  const exclusion = exclusionDeLaBase()
  const rango = [`${run.baseSha}..HEAD`, exclusion].filter(Boolean).join(' ')
  const rangoCorto = [`${run.baseSha.slice(0, 7)}..HEAD`, exclusion].filter(Boolean).join(' ')
  const hechos = commitsDelRun(run.baseSha, exclusion)
  if (hechos === null) {
    die(`git no pudo contar los commits del run: no resuelve \`${rango}\` en este worktree. Borra ${stateFile} si el run es de otra rama.`, EXIT.PRECONDITION)
  }
  // At `global`/`slice-judge`/`e2e` the `tasksTotal` tasks are ALREADY
  // committed — `run.task` stays on the last one and not on `tasksTotal + 1`,
  // so the count that applies is not `run.task - 1` but `tasksTotal` whole
  // commits. They are steps of the SLICE, not of a task. Without this branch,
  // every verb of those phases (a new process, with no state in memory) dies
  // here at PRECONDITION before it gets to run anything.
  //
  // And `tasksTotal` on its own is NOT enough: the slice steps commit too. The
  // slice verdict opens a commit of its own on approval (`verboSliceVerdict`),
  // so on reaching `e2e` —a new process, the file read again— there are
  // `tasksTotal + 1` commits since `baseSha` and the fixed count brought down
  // EVERY verb with PRECONDITION: no slice with journeys could close, the run
  // never reached DELIVERED and `dispatch-check --release` rejected it with the
  // 7 for ever. This file already had that very reasoning written down for the
  // NEXT commit (see `comprometerInformeE2e`, which is why it only commits at
  // DELIVERED); nobody applied it to the one placed in front of it. That is why
  // the slice commits are COUNTED in the state (`sliceCommits`) instead of being
  // taken for zero: `|| 0` covers the runs written before the field existed.
  const esperados = PASOS_DE_SLICE.includes(run.step)
    ? run.tasksTotal + (run.sliceCommits || 0)
    : run.task - 1
  if (hechos !== esperados) {
    die(`el estado y git no cuentan lo mismo: el fichero espera ${esperados} commit(s) (tarea ${run.task}, paso ${run.step}) y en \`${rangoCorto}\` (sin fusiones) hay ${hechos}. No se sigue a ciegas.`, EXIT.PRECONDITION)
  }
} else {
  if ((git(['diff', '--cached', '--name-only']) || '').trim()) {
    die('el índice tiene cambios stageados y este run es nuevo. ct-step comitea el índice tarea a tarea: vacíalo (git reset) o comitéalo tú.', EXIT.PRECONDITION)
  }
  // e2eRuns — ct-step does not talk to GitHub (see run-machine.js#newRun), so
  // the journeys the spec's E2E column declared for this slice can only arrive
  // through the file /ct-next seeded: .agent/SLICE.md. It is read with the
  // parser that already exists for that file (scripts/state.js) instead of
  // typing another YAML one by hand — two parsers of the same frontmatter
  // diverge just as JUDGE_TOOLS and VERDICT_RULES already diverged before being
  // unified. Absent or not-a-list: `newRun` already normalises that to `[]` ("no
  // e2e"), and does not confuse it with `undefined` ("an old version that did
  // not write the field").
  const { meta: sliceMeta } = parseStateSafe(readFileSync(join(repoRoot, SLICE_REL_PATH), 'utf8'))
  run = newRun({ plan: planPath, issue, baseSha: headSha(), tasksTotal: tasks.length, e2eRuns: sliceMeta.e2e })
  writeFileSync(stateFile, JSON.stringify(run, null, 2) + '\n')
}

const guardar = () => writeFileSync(stateFile, JSON.stringify(run, null, 2) + '\n')
const tarea = () => tasks.find((t) => t.n === run.task)

// ---------------------------------------------------------------------------
// The telemetry: append-only, TWO destinations, and a failure of its own brings
// NOTHING down.
//
// The design put it only outside the repo, with the reason copied verbatim from
// `agentic-skills`: "so that no `git add` of the slice takes the telemetry
// inside the pull request". The first run in a foreign repo
// (jjponz/rust-monitoring#10) refuted the conclusion without touching the
// reason: the twelve rows of that run exist in
// `~/.claude/control-tower/log/ct-step.jsonl` ON THE MACHINE OF WHOEVER
// DISPATCHED, and nowhere else. The judge's verdict travelled and can be read;
// the metrics of the same run cannot. For a loop that is evaluated between two
// people and two repositories, metrics that only exist on the laptop of the one
// who implemented are metrics that do not exist.
//
// The original reason was to keep the telemetry out of the diff BY ACCIDENT,
// dragged in by a `git add` of the implementer's. That already has an answer,
// the same one given to the verdict: it is written and staged by the PROGRAM,
// at a path the program decides, and it is staged at `commit` — after the
// checks and after the judge. If it were in the index while the checks run,
// `alcanceDeclarado` would see it as a path the plan does not declare and would
// veto the task.
//
// The local file is still the machine's accumulated record (every repo, every
// epic); the one in the repo is this slice's, and it is the one that gets read
// in the pull request.
// ---------------------------------------------------------------------------
const PLAN_SHA = planSha256(planText)
const repoSlug = (() => {
  const url = (git(['remote', 'get-url', 'origin'], { allowFail: true }) || '').trim()
  const m = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)
  return m ? m[1] : null
})()
const epicDelSlice = (() => {
  const m = /^epic:\s*(.+)$/m.exec(readFileSync(join(repoRoot, '.agent', 'SLICE.md'), 'utf8'))
  return m ? m[1].trim() : null
})()
// Slice 10: the observability signal the dispatch seeded into the SLICE.md
// (the `senal:` field, buildStateSeed). It is parsed with `parseStateSafe` and
// NOT with the `epic:` regex because the YAML of `renderState` folds and quotes
// long values —and a signal is a sentence, not a token— so a single-line regex
// would truncate it: the yardstick of the `observabilidad` item would reach the
// slice judge half-finished without anybody seeing it. `parseStateSafe` already
// exists in state.js and never throws; a SLICE.md without the field (seeded by
// a plugin older than the column) comes out null and the package declares the
// absence with SENAL_AUSENTE.
const senalDelSlice = (() => {
  const { meta } = parseStateSafe(readFileSync(join(repoRoot, '.agent', 'SLICE.md'), 'utf8'))
  return typeof meta.senal === 'string' && meta.senal.trim() ? meta.senal.trim() : null
})()
const intento = () => StepSeal.attemptOf(run)
// The two identity fields the row's module CANNOT go and look up (it is pure):
// whoever writes provides them. The version comes out of the plugin's manifest
// —a rewritten `ct-step` makes two runs incomparable, just as a rewritten plan
// does— and the actor out of the local git configuration, which is whose the
// cost is as soon as rows from two machines get mixed in the same pull request.
// Both degrade to their sentinel if they cannot be read: the row comes out all
// the same, with the absence declared.
const PLUGIN_VERSION = PluginManifest.installed().version
const ACTOR = (git(['config', 'user.email'], { allowFail: true }) || '').trim() || null

// The path is dictated by run-metrics.js, which is also what teaches it to
// /ct-harvest: the writer and the reader cannot diverge.
const METRICS_REL = metricsRepoRelPath(issue)

function medir(step, measures) {
  // `global`, `slice-judge` and `e2e` belong to no task: a `task: 3` on that row
  // would be a gap read as an assertion (the same doctrine that already forbids
  // filling in with `null` disguised as zero throughout the rest of this file).
  // In those steps `run.task` stays nailed to the last task, so attributing the
  // cost to it would be a false assertion, not one datum too many.
  const esDeSlice = PASOS_DE_SLICE.includes(step)
  const linea = metricLine(metricRow({
    repo: repoSlug, epic: epicDelSlice, issue, plan: planPath, plan_sha256: PLAN_SHA,
    task: esDeSlice ? null : run.task, task_name: esDeSlice ? null : (tarea()?.name ?? null), tasks_total: run.tasksTotal,
    step, attempt: intento(), plugin_version: PLUGIN_VERSION, actor: ACTOR,
  }, measures, { now: new Date().toISOString() }))
  // The two destinations are attempted separately: the account's disk being
  // full cannot cost the repo the row that travels, nor the other way round.
  for (const destino of [metricsPath('ct-step', { configDir: process.env.CLAUDE_CONFIG_DIR }), join(repoRoot, METRICS_REL)]) {
    try {
      mkdirSync(dirname(destino), { recursive: true })
      appendFileSync(destino, linea)
    } catch (e) {
      err(`aviso: no se pudo escribir la telemetría en ${destino} (${String(e.message).trim()}). Esto sigue: ninguna transición depende de la medida.`)
    }
  }
}

// ---------------------------------------------------------------------------
// THE GUARD OF THE STEP. It is what turns the sequence into a mechanism: asking
// for a step that is not due is not corrected with a warning, it is refused.
// ---------------------------------------------------------------------------
// The verb `slice-verdict` is not called the same as its step (`slice-judge`),
// unlike `global`/`global` and `e2e`/`e2e`: the step names WHO judges (the
// slice judge, like `judge`) and the verb names what the session DELIVERS (a
// verdict file, like `verdict`). Both families already existed under those
// names and renaming either of the two would break state in flight, so the
// asymmetry is left stated rather than fixed.
const VERBO_DE = {
  report: STEPS.IMPLEMENT, controls: STEPS.CONTROLS, verdict: STEPS.JUDGE, advice: STEPS.ADVISE, commit: STEPS.COMMIT,
  reconcile: STEPS.RECONCILE, global: STEPS.GLOBAL, 'slice-verdict': STEPS.SLICE_JUDGE, e2e: STEPS.E2E,
}
function exigirPaso(v) {
  if (run.step !== VERBO_DE[v]) {
    die(`"${v}" no es el paso que toca: el run está en "${run.step}" (tarea ${run.task}/${run.tasksTotal}). Pregunta con "ct-step next".`, EXIT.WRONG_STEP)
  }
}

// ---------------------------------------------------------------------------
// next — it does not transition: it reports, and prepares what the step needs.
// ---------------------------------------------------------------------------
function verboNext() {
  const t = tarea()
  // §3.7: `global` and `slice-judge` run AFTER the last task — there is no
  // "task N/M" to announce, but the whole slice with its tasks already
  // committed.
  if (run.step === STEPS.RECONCILE || run.step === STEPS.GLOBAL || run.step === STEPS.SLICE_JUDGE) {
    out(`slice del issue ${issue} — las ${run.tasksTotal} tareas comiteadas`)
  } else {
    out(`tarea ${run.task}/${run.tasksTotal} — ${t.name}`)
  }
  out(`paso: ${run.step} (intento ${intento()})`)
  out('')
  switch (run.step) {
    case STEPS.IMPLEMENT: {
      const brief = escribirBrief()
      const informe = join(workDir, `task-${run.task}-report.json`)
      // The list comes out of the constant and is not typed again: the hand copy
      // of the judge's already diverged once, and `ct-step next` ended up
      // announcing tools that were not those of the agent being dispatched.
      out(`DESPACHA UN IMPLEMENTADOR (subagente con modelo ${IMPLEMENTER_MODEL} — herramientas: ${IMPLEMENTER_TOOLS}) con:`)
      out(`  - la rúbrica de ${join(PLUGIN_ROOT, 'prompts', 'task-implementer.md')}`)
      out(`  - el brief de la tarea: ${brief}`)
      out(`  - que escriba su informe en: ${informe}`)
      if (run.lastFindings) {
        out('')
        out('El juez devolvió esta tarea. Lo que hay que arreglar:')
        out(run.lastFindings)
      }
      out('')
      out(`Cuando vuelva:  ct-step report ${informe} --plan ${planPath} --issue ${issue}`)
      out('NO comitees tú, y no le pidas al implementador que comitee: comitea ct-step.')
      break
    }
    case STEPS.CONTROLS:
      out('MIDE LA TAREA (no lo hace el implementador, y su palabra no cuenta):')
      for (const c of t.commands) out(`  $ ${c}`)
      if (t.testsAdded.length) out(`  y que existan los tests que la tarea prometió: ${t.testsAdded.map((n) => `'${n}'`).join(', ')}`)
      out('')
      out(`Ejecútalo con:  ct-step controls --plan ${planPath} --issue ${issue}`)
      break
    case STEPS.JUDGE: {
      const paquete = escribirPaquete()
      const veredicto = join(workDir, `task-${run.task}-verdict.json`)
      out(`DESPACHA EL JUEZ (subagente ct-judge — declarado SIN Bash: ${JUDGE_TOOLS}) con:`)
      out(`  - el paquete de revisión: ${paquete}`)
      out(`  - el brief de la tarea: ${join(workDir, `task-${run.task}-brief.md`)}`)
      out(`  - los logs de los controles, YA en verde, por si los quiere: ${run.lastControlsLog ?? '(ninguno)'}`)
      out(`  - que escriba su veredicto en: ${veredicto}`)
      // The `review_token` is NOT asked of it: this program writes it when it
      // reads the verdict, with the value it computed itself. Asking the judge
      // for it meant asking it to copy 64 hex characters from a line the program
      // had just written, and one copying slip cost a whole opus verdict.
      out('')
      out(`Cuando vuelva:  ct-step verdict ${veredicto} --plan ${planPath} --issue ${issue}`)
      out('No le pases la SALIDA de los controles: un lint sucio no debe ensuciarle el criterio.')
      break
    }
    // H9: the SECOND veto. Between it and the third attempt there does not go
    // another implementer reading the same verdict, there goes an adviser of a
    // higher tier that sees BOTH attempts and BOTH vetoes at once — which is the
    // one thing neither of the two implementers could see.
    case STEPS.ADVISE: {
      const paquete = escribirPaqueteDeConsejo()
      const consejo = join(workDir, `task-${run.task}-advice.json`)
      out(`DESPACHA EL CONSEJERO (subagente ct-advisor — declarado sólo con ${ADVISOR_TOOLS}) con:`)
      out(`  - el paquete del consejero: ${paquete}`)
      out(`  - que escriba su consejo en: ${consejo}`)
      out('')
      out('El juez ha vetado dos veces esta tarea. Al aceptar el consejo, el programa devuelve el árbol al último commit para las rutas de la tarea y el brief del tercer intento lleva dentro el enfoque que dicte el consejero: NO despaches un implementador ahora.')
      out(`Cuando vuelva:  ct-step advice ${consejo} --plan ${planPath} --issue ${issue}`)
      break
    }
    case STEPS.COMMIT:
      out('COMITEA LA TAREA:')
      out(`  ct-step commit --plan ${planPath} --issue ${issue}`)
      out('El mensaje lo compone el plugin y lo valida contra las closing keywords.')
      // It is repeated here and not only at `report` because this is the moment
      // the session writes the pull request: a warning given twenty minutes
      // earlier, two subagents ago, has already left its context.
      if (run.lastSummary) {
        out('')
        out(`Lo que dijo el implementador de esta tarea, por si va en la pull request: ${run.lastSummary}`)
      }
      break
    // Phase B: the branch up to date with its base, after the last commit and
    // BEFORE the end to end — verifying before reconciling would measure a tree
    // that is no longer the one being delivered (see the comment on
    // STEPS.RECONCILE in run-machine.js). Idempotent through MERGE_HEAD: the
    // verb itself decides whether what is due is to merge or to conclude a
    // half-finished merge, so there is nothing more to tell it here — and if
    // there is a conflict, it is the verb that says who to dispatch, not
    // `next`.
    case STEPS.RECONCILE:
      out('RECONCILIA LA RAMA CON SU BASE (idempotente: decide solo, según MERGE_HEAD, si toca fusionar o concluir una fusión a medias):')
      out(`  ct-step reconcile --plan ${planPath} --issue ${issue}`)
      out('Si hay conflicto, el propio verbo dice a quién despachar.')
      break
    // §3.7-A: the plan's end to end, after the last commit. It is run by the
    // PROGRAM — never by an agent evaluating itself.
    case STEPS.GLOBAL:
      out('EJECUTA LA GLOBAL VERIFICATION DEL PLAN (no la corre ningún agente, la corre el programa):')
      if (globalVerification.commands.length) {
        for (const c of globalVerification.commands) out(`  $ ${c}`)
      } else {
        out('  el plan declara N/A: ct-step global lo registra y avanza sin ejecutar nada.')
      }
      out('')
      out(`Ejecútalo con:  ct-step global --plan ${planPath} --issue ${issue}`)
      break
    // §3.7-B: the coherence between tasks, and whether together they deliver
    // the end of the slice — what no task judge ever looks at.
    case STEPS.SLICE_JUDGE: {
      const paquete = escribirPaqueteDeSlice()
      const veredicto = join(workDir, 'slice-verdict.json')
      out(`DESPACHA EL JUEZ DE SLICE (subagente ct-slice-judge — declarado SIN Bash: ${SLICE_JUDGE_TOOLS}) con:`)
      out(`  - el paquete de revisión del slice: ${paquete}`)
      out(`  - el plan: ${planPath}`)
      out(`  - el log de la Global verification, YA en verde, por si lo quiere: ${run.lastGlobalLog ?? '(N/A declarado)'}`)
      out(`  - los veredictos de cada tarea, ya comiteados: docs/superpowers/verdicts/issue-${issue}-task-*.json`)
      out(`  - que escriba su veredicto en: ${veredicto}`)
        out('')
      out(`Cuando vuelva:  ct-step slice-verdict ${veredicto} --plan ${planPath} --issue ${issue}`)
      break
    }
    case STEPS.E2E:
      // There is no brief and no package to write: no task subagent is
      // dispatched here, the whole slice is crossed with the environment already
      // brought up by whoever is driving. `AGENTS.md` is the place with the
      // "Levantar" and the "Listo cuando" of each journey — this verb does not
      // repeat them.
      out('ATRAVIESA LA SLICE DE PUNTA A PUNTA (todas las tareas están comiteadas):')
      for (const r of run.e2eRuns) out(`  - ${r}`)
      out('')
      // The section is NAMED, not alluded to. `GATES.e2e.kickoff` already names
      // it, and §3.3 of the design insists on naming it when it is missing too
      // ("con el nombre de la sección que falta. No se adivina"): this is
      // precisely the moment the agent needs it, and "it is in AGENTS.md" sends
      // it hunting among the build/test/lint ones.
      out('El entorno para levantarla está en la sección "## Cómo se atraviesa este repo (e2e)" de AGENTS.md ("Levantar" y "Listo cuando" de cada recorrido). Si esa sección no está rellenada, el veredicto es `no-verificado` con ese motivo: nunca rojo, y nunca inventarse cómo arrancarlo.')
      // The contract is stated WHOLE, and comes out of the same module that
      // validates it (E2E_SCHEMA/E2E_REQUIRED_BY_VERDICT, step-contracts.js).
      // Announcing only `run` and `verdict` —the unconditional part— meant
      // instructing the agent with a contract this same program rejects: it cost
      // at least one DISCARDED round per slice, and the discards come out of the
      // budget of the whole slice.
      out(`Escribe el informe cumpliendo E2E_SCHEMA (scripts/step-contracts.js): cada recorrido lleva ${E2E_SCHEMA.properties.runs.items.required.join(' y ')}, y además, según su veredicto:`)
      for (const [veredicto, campos] of Object.entries(E2E_SCHEMA.properties.runs.items.requiredByVerdict)) {
        out(`  - ${veredicto}: ${campos.join(', ')}`)
      }
      out('Ciérralo con:')
      out(`  ct-step e2e <fichero.json> --plan ${planPath} --issue ${issue}`)
      break
    default:
      die(`el estado tiene un paso que esta versión no conoce: ${run.step}`, EXIT.UNNAMED)
  }
  // THE SEAL OF THE STEP. `next` has just written the input the subagent of
  // this step is going to read —the brief, or the judge's package—, and that is
  // exactly what a dispatch that skips this verb leaves unwritten: measured
  // twice in the field, with the implementer and with the judge. The seal is
  // read by the hook of the `Task` tool (hooks/dispatch-guard.js), which without
  // it DENIES the dispatch.
  //
  // The condition comes out of the same constant that names the input of each
  // step, so a step `next` writes nothing for is not sealed: sealing it would
  // assert that there is a protected dispatch there.
  //
  // The seal does NOT count the discards, and that is why it survives one: on a
  // discard, `consumirPaquete` does not run and that attempt's artefact is still
  // on disk, so forcing another pass through here would be asking for what is
  // already there to be regenerated. The three self-loops of `discarded` are
  // those of run-machine.js.
  if (StepSeal.inputWrittenFor(run.step) !== null) {
    run = { ...run, nextSeal: StepSeal.of(run) }
    guardar()
  }
  process.exit(EXIT.OK)
}

// The CT yardstick, checked BEFORE anything is built: its absence is NOT a
// state of the repo but a broken installation of the plugin, hence the abort
// instead of a warning — the opposite of what is done with the repo's one
// further down. A brief or a package without it leaves whoever reads it
// measuring against nothing, and in silence that does not differ from a
// conforming item.
//
// Branch reconciliation, Task 9: it is shared by `escribirBrief` (the brief of
// the implementer and of the judge) and `escribirPaqueteDeReconciliacion` (the
// reconciler's package) — one single read and one single abort message, instead
// of two copies which it already warned diverge (see JUDGE_TOOLS in
// step-contracts.js).
function cargarVaraDeCt() {
  const deCt = PluginYardstick.FILES.map((nombre) => {
    const path = join(PLUGIN_ROOT, PluginYardstick.DIRECTORY, nombre)
    try {
      return { name: nombre, path, content: readFileSync(path, 'utf8') }
    } catch {
      return { name: nombre, path, content: null }
    }
  })
  const faltas = PluginYardstick.missingDocuments(deCt)
  if (faltas.length) {
    die(`la vara de ct no se puede leer: falta o está vacío ${faltas.join(', ')} en ${join(PLUGIN_ROOT, PluginYardstick.DIRECTORY)}. Es una instalación del plugin incompleta, no una propiedad de este repo: sin esos documentos quien implementa, juzga o reconcilia mide contra nada, y eso no se distingue en silencio de un diff conforme. Reinstala el plugin.`, EXIT.PRECONDITION)
  }
  return deCt
}

// §3.3: the repo's yardstick crosses the funnel HERE, read straight off disk
// and with no agent in between. Its absence does not warn: it is the normal
// state of almost every repo today, and the judge measures it as `sin-vara`,
// not as an error. `nombreDelArtefacto` only enters the read-failure warning,
// so that the same message serves the brief and the reconciliation package
// without lying about which of the two came up short.
function seccionVaraDelRepo(nombreDelArtefacto) {
  try {
    const ruta = join(repoRoot, CONVENTIONS_FILE)
    if (!existsSync(ruta)) return ''
    return seccionDeVara(readFileSync(ruta, 'utf8'))
  } catch (e) {
    err(`aviso: ${CONVENTIONS_FILE} existe y no se ha podido leer (${String(e.message).trim()}): ${nombreDelArtefacto} sale sin la vara del repo.`)
    return ''
  }
}

function escribirBrief() {
  const brief = join(workDir, `task-${run.task}-brief.md`)
  // It is checked before calling `task-brief` so as not to leave a brief on
  // disk that nobody is going to use.
  const deCt = cargarVaraDeCt()
  try {
    execFileSync(join(PLUGIN_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief'),
      ['--with-plan-context', planPath, String(run.task), brief], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    die(`no se pudo extraer el brief de la tarea ${run.task}: ${String(e.stderr || e.message).trim()}`, EXIT.PRECONDITION)
  }
  appendFileSync(brief, PluginYardstick.composeSection(deCt))
  appendFileSync(brief, seccionVaraDelRepo('el brief'))
  // H9: the advice for the third attempt, inside the brief and not on a loose
  // line of `next`. The brief is what the subagent receives —the dispatch
  // message says so itself—, so an approach announced outside it is an approach
  // that depends on the session copying it. It goes AT THE END, after the
  // yardstick: it is the last thing decided about this task.
  if (run.lastAdvice) appendFileSync(brief, seccionDeConsejo(run.lastAdvice))
  return brief
}

// The advice, in the language of the brief (the rest is written by `task-brief`
// out of a plan in English). The paths are listed even when the approach
// already names them: it is what makes the paragraph actionable without
// re-reading it.
function seccionDeConsejo(advice) {
  const rutas = advice.files_to_reconsider.length
    ? advice.files_to_reconsider.map((p) => `- \`${p}\``).join('\n')
    : '(none in particular)'
  return [
    '',
    '## Advice for this attempt',
    '',
    'The judge vetoed the two previous attempts at this task. An adviser read both attempts and both verdicts and answered with the approach this one should take instead. The tree was reset to the last commit before you were dispatched, so nothing either of them wrote is still there: you are not continuing them.',
    '',
    advice.approach,
    '',
    '**Files to reconsider before editing:**',
    '',
    rutas,
    '',
    'This does not widen the task: `**Files:**` above is still its scope.',
    '',
  ].join('\n')
}

// THE TWO DIFFS, each one in a single expression and not in two. They are
// called by the writer of the package and by the verb that checks the token,
// and if they diverged on a flag (`-U10`, the `|| ''` of an empty diff) the
// symptom would be a token that never matches: every verdict discarded, six
// discards, a dead run — and no clue at all as to why. It is the same reason
// PACKAGE_SECTIONS is a constant and not a string typed twice.
//
// The task's one comes out of the INDEX, which is the exact surface the judge
// sees and the one `commit` takes away: an unstaged edit does not reach the
// commit, so it has no reason to invalidate the judgement. The slice's one
// comes out of the RANGE, because by then everything is committed (see
// `escribirPaqueteDeSlice`).
const diffDeTarea = () => git(['diff', '--cached', '-U10']) || ''
const diffDeSlice = () => git(['diff', '-U10', run.baseSha, 'HEAD']) || ''

// THE TREE OF THE INDEX — the identity of what is about to be committed, and
// git already has it: `write-tree` writes the index's tree and returns its sha.
// Two indexes with the same content give the same tree, so comparing two shas
// is comparing the two indexes whole against whole —paths, contents and modes—
// without depending on HEAD nor on how a diff happens to be formatted.
//
// And NOT a sha256 of the diff like the package's token, even though for
// comparison it would do just as well: the tree can also be GIVEN BACK. `git
// read-tree <sha>` puts that index back without touching the worktree, so the
// failure message can carry the exact command that repairs the state — and here
// that is no luxury: the typical attack OVERWRITES a path that was already in
// scope (`git add uno.txt`), and then the content the judge approved is nowhere
// the conductor could get it out of by hand. A hash of a diff repairs nothing.
//
// The object it writes stays unreferenced until the commit uses it; a
// `git gc --prune=now` INSIDE the window would take it away and the message's
// `read-tree` would fail (the check would not: that one only compares two
// shas). It is deliberately not referenced: a ref per task would show up in
// `git for-each-ref` and could end up pushed.
const arbolDelIndice = () => git(['write-tree']).trim()

// The package comes out of the INDEX and not out of a range of commits: the
// implementer does not commit, so what has to be judged is not a commit yet.
function escribirPaquete() {
  const paquete = join(workDir, `task-${run.task}-review.diff`)
  // This section used to carry, alongside each path, whether it was production
  // or test code (the `kind` the implementer's report declared). It was removed:
  // the judge has the diff in front of it and tells a test from a production
  // file apart without anyone saying so, so the label brought it nothing it
  // could not see for itself. On top of that it was produced by the very agent
  // being judged, nobody verified it, and when it came out wrong it did not
  // degrade the judgement: it disabled it. Do not add it back.
  const rutas = (run.lastPaths || []).map((p) => `- ${p}`).join('\n') || '(ninguna)'
  // The first heading of PACKAGE_SECTIONS is written by `composePathSection`
  // (it is `PluginYardstick.PATH_SECTION`), so it is not typed here: what gets
  // destructured are the three this verb writes.
  const [, SECCION_FILES, SECCION_RUTAS, SECCION_DIFF] = PACKAGE_SECTIONS
  const diff = diffDeTarea()
  // THE CT YARDSTICK, BY PATH and with the same scope as the brief: the judge
  // has `Read` (JUDGE_TOOLS), and what it needs in order to cite a rule is to
  // know which documents reach this task and where they are. The section goes
  // AHEAD of the diff for the same reason as `Señal` in the slice package:
  // behind a `-U10` it would be buried.
  const varaDeCt = PluginYardstick.composePathSection(cargarVaraDeCt())
  writeFileSync(paquete, [
    `# Review package: task ${run.task}/${run.tasksTotal} of issue #${issue} (staged, not yet committed)`,
    // The HEADER carries the token: the sha256 of exactly the diff that goes
    // below. A second line and not a `##` section, so as not to touch
    // PACKAGE_SECTIONS (which the rubric cites heading by heading) nor the order
    // slice 10 decided on for the slice package.
    reviewTokenLine(reviewToken(diff)),
    varaDeCt,
    '', `## ${SECCION_FILES}`, git(['diff', '--cached', '--stat']) || '',
    '', `## ${SECCION_RUTAS}`, rutas,
    '', `## ${SECCION_DIFF}`, diff,
  ].join('\n'))
  return paquete
}

// The package of the WHOLE SLICE comes out of a RANGE OF COMMITS and not out of
// the index: unlike a task, here everything is already committed — there is
// nothing staged to judge, and the "index" of the last committed task is empty.
// `## Commits` is the piece the per-task package neither has nor needs (a task
// is ONE commit with no history of its own to show): the sequence matters for
// judging `coherencia` — a later task undoing the earlier one is only visible in
// the order of the commits, not in the accumulated diff on its own.
function escribirPaqueteDeSlice() {
  const paquete = join(workDir, 'slice-review.diff')
  const [SECCION_VARA, SECCION_SENAL, SECCION_COMMITS, SECCION_FILES, SECCION_DIFF] = SLICE_PACKAGE_SECTIONS
  const diff = diffDeSlice()
  // Task 8: the slice judge measures end state, coherence and signal — not code
  // rule by rule —, so the whole yardstick is not pasted onto it: it is given
  // ONE single path, that of `simplicity.md`, which is exactly the rule its
  // `observabilidad` item measures (a trace names its reader). The FIRST
  // section, ahead even of `Señal`, for the same reason `Señal` goes ahead of
  // the diff: behind a `-U10` it would be buried.
  const rutaSimplicity = join(PLUGIN_ROOT, PluginYardstick.DIRECTORY, 'simplicity.md')
  // Slice 10: the signal crosses the funnel HERE, read off disk (the `senal:`
  // field the dispatch seeded into the SLICE.md) and with no agent in between —
  // the same doctrine of §3.3 by which the repo's yardstick travels in the
  // brief. The SENAL_AUSENTE fallback covers a SLICE.md seeded by a plugin older
  // than the column: the absence is declared, not omitted, and its text is
  // exactly what the rubric reads as sin-vara.
  writeFileSync(paquete, [
    `# Slice review package: issue #${issue} — ${run.tasksTotal} tasks committed since ${run.baseSha.slice(0, 7)}`,
    reviewTokenLine(reviewToken(diff)),
    '', `## ${SECCION_VARA}`, `Ábrela con \`Read\`: \`${rutaSimplicity}\``,
    '', `## ${SECCION_SENAL}`, senalDelSlice ?? SENAL_AUSENTE,
    '', `## ${SECCION_COMMITS}`, git(['log', '--reverse', '--format=%h %s', `${run.baseSha}..HEAD`]) || '',
    '', `## ${SECCION_FILES}`, git(['diff', '--stat', run.baseSha, 'HEAD']) || '',
    '', `## ${SECCION_DIFF}`, diff,
  ].join('\n'))
  return paquete
}

// THE ADVISER'S PACKAGE (H9). What neither of the two vetoed implementers could
// see: what was ASKED FOR (the brief), what was DONE on both occasions (the
// archived reports of each attempt) and WHY neither of them did (the two
// verdicts). With no diff: the adviser has `Read` and the brief names the files,
// and pasting it the diff of a tree this very step is going to throw away would
// be giving it exactly what it must not continue to read.
//
// AN ABSENCE IS DECLARED, NEVER OMITTED: an attempt whose artefact is not on
// disk comes out named and with the reason, because a section missing in silence
// reads as "there was no such attempt".
function escribirPaqueteDeConsejo() {
  const paquete = join(workDir, `task-${run.task}-advice.md`)
  const [SECCION_BRIEF, SECCION_INTENTOS, SECCION_VEREDICTOS] = ADVICE_PACKAGE_SECTIONS
  writeFileSync(paquete, [
    `# Advice package: task ${run.task}/${run.tasksTotal} of issue #${issue} — vetoed twice, one attempt left`,
    '', `## ${SECCION_BRIEF}`, leerOAusente(rutaDelBrief(), 'el brief de la tarea'),
    '', `## ${SECCION_INTENTOS}`, apartadosPorIntento('report', 'el informe del implementador'),
    '', `## ${SECCION_VEREDICTOS}`, apartadosPorIntento('verdict', 'el veredicto del juez'),
  ].join('\n'))
  return paquete
}

const leerOAusente = (ruta, que) => {
  try {
    return readFileSync(ruta, 'utf8')
  } catch (e) {
    return `(no se pudo leer ${que} en ${ruta}: ${String(e.message).trim()})`
  }
}

// The artefacts this run archived per attempt, from the first to the last. The
// numbering comes out of the name itself and not out of `intento()`: the vetoed
// attempts are not necessarily 1 and 2 —a red from the checks or a correction
// shifts them— so what is there gets read, in the order it was written. The same
// criterion as `paquetesDeReconciliacion`, and for the same reason: one list and
// not two walks of the directory with the same expression.
const RE_INTENTO_ARCHIVADO = /-(\d+)\.json$/
function archivadosDeLaTarea(clase) {
  const prefijo = `task-${run.task}-${clase}-`
  try {
    return readdirSync(workDir)
      .filter((f) => f.startsWith(prefijo) && RE_INTENTO_ARCHIVADO.test(f))
      .sort((a, b) => Number(RE_INTENTO_ARCHIVADO.exec(a)[1]) - Number(RE_INTENTO_ARCHIVADO.exec(b)[1]))
  } catch {
    return []
  }
}

function apartadosPorIntento(clase, que) {
  const ficheros = archivadosDeLaTarea(clase)
  if (!ficheros.length) return `(este run no archivó ningún ${que} de esta tarea)`
  return ficheros.map((f) => [
    `### Intento ${RE_INTENTO_ARCHIVADO.exec(f)[1]}`,
    '',
    leerOAusente(join(workDir, f), que),
  ].join('\n')).join('\n\n')
}

// WHAT EACH ATTEMPT LEFT WRITTEN, archived by the program and not by whoever
// dispatches. The paths `next` dictates to the implementer and to the judge are
// the SAME on every attempt (`task-<N>-report.json`), so attempt 2 overwrites 1
// and by the time the adviser is needed there is no trace left of the first. What
// gets archived is what the verb ACCEPTED —not the file that arrived through
// argv— because it is the only thing this program answers for.
function archivar(clase, contenido) {
  try {
    writeFileSync(join(workDir, `task-${run.task}-${clase}-${intento()}.json`), JSON.stringify(contenido, null, 2) + '\n')
  } catch (e) {
    err(`aviso: no se pudo archivar ${clase} del intento ${intento()} (${String(e.message).trim()}): si esta tarea llega al consejero, su paquete lo dirá.`)
  }
}

// ---------------------------------------------------------------------------
// THE PACKAGE STILL DESCRIBES THE CUT IT CAPTURED, and the verdict is OF THAT
// package. The two checks that tie the product to its input (slice 11); see
// step-contracts.js#REVIEW_TOKEN_LABEL for the two routes they close.
//
// One function and not two copies in the two verbs: the only thing that changes
// between the task and the slice is WHICH diff gets recomputed, and that comes
// in as a parameter. The alternative —the same reasoning written twice— is the
// decoupling this file already paid for with the PASOS_DE_SLICE list.
// ---------------------------------------------------------------------------
function tokenVigente(paquete, diffAhora) {
  let texto
  try {
    texto = readFileSync(paquete, 'utf8')
  } catch (e) {
    return { why: `el paquete de revisión existe y no se puede leer (${paquete}): ${String(e.message).trim()} — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al juez` }
  }
  const declarado = reviewTokenOf(texto)
  if (declarado === null) {
    // A package without the line: it was written by a version of the plugin
    // older than this field (a run in flight when the plugin was updated), or
    // somebody edited it. A discard cures it in one round —`next` regenerates it
    // with its token— and there is no way back to the package with no token:
    // tolerating it would be a «no guardrail» mode that is switched on by
    // DELETING a line, which is exactly what this fix takes out of the
    // repertoire.
    return { why: `el paquete de revisión (${paquete}) no declara su "${REVIEW_TOKEN_LABEL}": lo escribió una versión anterior del plugin, o se editó a mano. Vuelve a "ct-step next", que lo regenera con su token, y REDESPACHA al juez` }
  }
  const ahora = reviewToken(diffAhora)
  if (declarado !== ahora) {
    return { why: `el paquete de revisión ya no describe el código de ahora: declara el token ${declarado.slice(0, 12)}… y el del corte recién medido es ${ahora.slice(0, 12)}… — el código cambió DESPUÉS de generarse el paquete, así que el juez juzgó otro diff. Vuelve a "ct-step next" y REDESPACHA al juez: repreguntarle con este paquete no arregla nada` }
  }
  return { token: declarado }
}

// The verdict carries the token OF THIS package. `verdict.review_token` already
// arrives validated in shape and in lower case by `readVerdict`, so all that
// happens here is the comparison.
function whyTokenAjeno(delVeredicto, delPaquete) {
  return `el veredicto no es de este paquete: copia el token ${String(delVeredicto).slice(0, 12)}… y el paquete declara ${delPaquete.slice(0, 12)}… — es el veredicto de OTRO juicio, sobre un diff que ya no es el que hay delante. No hace falta volver a "ct-step next" (el paquete de disco es el bueno): REDESPACHA al juez con él`
}

// THE PACKAGE IS SINGLE USE: the verdict that reads it spends it.
//
// A HIGH finding of the review of PR #36, reproduced with a real attack. The
// slice 3 guard (the `existsSync` of the two verdict verbs) covered attempt 1
// and left 2 open: attempt 1 through the real flow → FAIL from the judge;
// attempt 2, the implementer changes the file and the conductor chains
// report→controls→verdict WITHOUT going back to `next`. The guard passed —the
// `.diff` of attempt 1 was still on disk—, the PASS went in, and code no judge
// had ever seen got committed, with the telemetry row pointing at a package that
// exists and is THE WRONG ONE. Worse than the failure slice 3 fixed: that one
// was noisy (a row naming a file that does not exist, detectable with `test -f`)
// and this one is MUTE — indistinguishable from a legitimate judgement in the
// JSONL. And the confession that saved the field run (the judge declaring it
// could not find the package) is disarmed: in the stale case the judge DOES find
// a package, has no Bash and cannot know that it is old.
//
// The input is CONSUMED, and with a rule that comes out of run-machine.js and
// not out of a list of cases: the package holds exactly as long as the step is
// still the judge's. Every ACCEPTED verdict (PASS, FAIL and the PASS that orders
// corrections) takes the run out of `judge`, so its package is of no use to
// anybody any more: it gets spent. A DISCARD leaves the step where it was —the
// judge gets asked again— so this is NOT called there: the retry over an
// unreadable JSON has to be able to ask again with the same input, without
// forcing it to be regenerated. And attempt 2 of the attack runs into the
// absence and is discarded, which is what the slice 3 guard meant to do and did
// not manage to do.
//
// What must NOT happen is that this brings the run down: the verdict is already
// measured and, if it approved, written and staged. A failure here is warned
// about and carries on — this file's criterion for every auxiliary operation
// (the `git add` of the verdict and of the telemetry, the `git commit` of the
// slice verdict and of the e2e report, all with `allowFail` and their warning).
// The warning is NOISY on purpose: a package that survives its verdict reopens
// exactly the window this closes.
//
// SLICE 11 — AND THE DISCARD STILL DOES NOT CONSUME, now because of a property
// and not because of an assumption. The justification above («the retry judges
// the same diff») was an assertion about the agent's conduct; from the package's
// token it is checkable at the moment of use: if the cut changed, `tokenVigente`
// discards it before reading the verdict. Keeping the package after a discard
// stops being a gap —what survives is an input that VERIFIES ITSELF— and it
// still buys what it bought: asking the judge again over an unreadable JSON
// without forcing anything to be regenerated.
function consumirPaquete(paquete) {
  try {
    unlinkSync(paquete)
  } catch (e) {
    err(`aviso: el veredicto se midió pero NO se pudo consumir el paquete de revisión (${paquete}): ${String(e.message).trim()}. El paso sigue, pero ese fichero ya no corresponde a ningún juicio pendiente: vuelve a "ct-step next" antes de despachar al juez otra vez, porque un paquete que sobrevive a su veredicto es el que deja pasar un juicio rancio.`)
  }
}

// ---------------------------------------------------------------------------
// The verbs that transition
// ---------------------------------------------------------------------------
function leerJson(ruta, quien) {
  if (typeof ruta !== 'string' || !ruta || ruta.startsWith('--')) {
    die(`falta la ruta del JSON ${quien}\n\n${USAGE}`, EXIT.USAGE)
  }
  try {
    return { valor: JSON.parse(readFileSync(ruta, 'utf8')) }
  } catch (e) {
    // A JSON that cannot be read is a DISCARD, not a usage error: the subagent
    // answered, and what it answered is no good.
    return { why: `no se pudo leer el ${quien} en ${ruta}: ${e.message}` }
  }
}

// Whether the ct yardstick reached the brief, and how much it weighed —
// measured on the BRIEF THAT IS ON DISK, not on what `escribirBrief` meant to
// write: that function ran in an EARLIER invocation of the process (the one of
// `ct-step next`), so there is nothing in memory here to drag along, and
// measuring the artefact that really exists is better instrumentation than
// measuring a code path. The path is derived JUST AS in `escribirBrief`.
//
// If the brief cannot be read, the two fields go to `null`, never to `0`: a zero
// would assert a brief with no yardstick, and what has happened is that it could
// not be looked at.
function rutaDelBrief() {
  return join(workDir, `task-${run.task}-brief.md`)
}

function medidaDeBrief() {
  try {
    return briefVaraCtMeasures(readFileSync(rutaDelBrief(), 'utf8'))
  } catch {
    return { brief_vara_ct_docs: null, brief_bytes: null }
  }
}

// LO QUE LA TAREA TOCÓ, MEDIDO CONTRA EL ÁRBOL PREVIO. `git status` compara el
// worktree con HEAD, y HEAD es el commit de la tarea anterior: cada tarea
// comitea el suyo, así que "lo que cambió desde HEAD" es exactamente "lo que
// hizo esta tarea".
//
// `-z` y no la salida por defecto: la porcelana normal ENTRECOMILLA una ruta
// con espacios o acentos (`"src/a\303\261o.js"`) y quien la parsee a mano
// stagearía una ruta que no existe. Con `-z` cada entrada es literal y va
// separada por NUL. Un renombrado trae DOS entradas —destino y origen— y las
// dos hacen falta: sin el origen, el borrado no entra en el commit.
//
// SE FILTRA LO DEL PROPIO LOOP. El run escribe bajo `.agent/run-<n>` y la
// maquinaria bajo `docs/superpowers/**` (`LOOP_ARTIFACT_PATTERNS`, la misma
// lista que ya usa la reconciliación), y nada de eso lo tocó el implementador:
// stagearlo metería el estado del run dentro del commit de la tarea. El
// veredicto y la telemetría los stagea este programa por su cuenta, cada uno
// en su momento.
//
// Y SE MANTIENE EL FILTRO DE SEGURIDAD de rutas absolutas o con `..`: git no
// las produce, pero lo que se pasa a `git add` no se deja de comprobar por
// venir de donde se espera.
const rutaSegura = (p) => p !== '' && !p.startsWith('/') && !p.split('/').includes('..')

const esDelRun = (p) => {
  const suyo = `${relative(repoRoot, workDir)}/`
  return p === relative(repoRoot, stateFile) || p.startsWith(suyo)
}

// EL PLAN SÍ ES TRABAJO DE LA TAREA, DESDE LA ENMIENDA (issue 161). Un plan
// amendado a media tarea es el implementador diciendo "esto que declaré
// también cambia", y ese cambio tiene que viajar en el commit de SU tarea, no
// quedar huérfano hasta que alguien lo comitee aparte. `esDelRun` ya no lo
// excluye: la ruta la elige quien despacha y puede estar en cualquier sitio,
// así que se nombra aquí desde `planPath`, el único sitio donde este programa
// la sabe.
// Normalizada a `/` en el ORIGEN, no en cada consumidor: las tres
// comparaciones de esta ruta son contra salida de git, que siempre usa `/`,
// mientras `relative` daría `\` en Windows. Es el mismo cuidado que
// `ajenoEnElIndice` documenta, aplicado donde la ruta se construye.
const rutaDelPlan = () => relative(repoRoot, resolve(planPath)).replace(/\\/g, '/')

//
// LO QUE MIDE ESTA FUNCIÓN LO CONSUMEN DOS: `report`, que stagea lo medido, y
// `advice`, que devuelve lo medido al último commit. Por eso devuelve la
// ENTRADA entera y no sólo la ruta: quién limpia necesita saber si git conoce
// ese fichero (`git checkout --`) o si no lo ha visto nunca (`git clean`), y
// derivarlo por segunda vez con otro `git status` sería la segunda lectura que
// contesta distinto el día que una de las dos cambie de flags.
const entradasDelArbol = () => {
  const trozos = (git(['status', '--porcelain', '-z', '--untracked-files=all']) || '').split('\0')
  const entradas = []
  for (let i = 0; i < trozos.length; i++) {
    const entrada = trozos[i]
    if (!entrada) continue
    const estado = entrada.slice(0, 2)
    const ruta = entrada.slice(3)
    if (estado.startsWith('R') || estado.startsWith('C')) {
      const origen = trozos[++i]
      if (origen) entradas.push({ estado, ruta: origen })
    }
    if (ruta) entradas.push({ estado, ruta })
  }
  const vistas = new Set()
  // EL PLAN PASA LAS DOS GUARDAS. `esRutaDeLaMaquinaria` lo cubre en un run de
  // verdad (vive bajo `docs/superpowers/plans/**`), y esa guarda sigue en pie
  // para todo lo demás; sólo la ruta del plan la atraviesa, porque es la única
  // pieza de la maquinaria que el implementador legítimamente cambia.
  return entradas.filter(({ ruta }) => {
    if (vistas.has(ruta)) return false
    vistas.add(ruta)
    return rutaSegura(ruta) && !esDelRun(ruta) &&
      (ruta === rutaDelPlan() || !esRutaDeLaMaquinaria(ruta))
  })
}

const rutasTocadas = () => entradasDelArbol().map(({ ruta }) => ruta)

// LO QUE LE COSTÓ AL PAPEL LEER LO QUE SE LE MANDÓ (#92). `brief_bytes` medía
// una sola de las cuatro llamadas al modelo, así que la mitad fija del contexto
// —el fichero del agente y las skills que su prompt le ordena cargar— no estaba
// en ninguna columna: el ahorro por slice se afirmaba sin medida.
//
// Misma doctrina que `medidaDeBrief`: se mide el fichero que EXISTE en disco,
// nunca lo que el programa pretendía escribir, y un fichero que no se puede
// medir vale `null` y jamás `0` — un cero afirmaría un papel despachado sin
// material. Por eso el puerto que RoleBytes recibe devuelve `null` en vez de
// lanzar: quien decide qué significa la ausencia es la medida, no `statSync`.
const tamanoEnDisco = (ruta) => {
  try {
    return statSync(ruta).size
  } catch {
    return null
  }
}

const roleBytes = new RoleBytes({ pluginRoot: PLUGIN_ROOT, sizeOf: tamanoEnDisco })

function medidaDePapel(step, paquete) {
  return { ...roleBytes.measuresOf({ step, packagePath: paquete }) }
}

// Los paquetes de reconciliación que este run ya escribió, del primero al
// último. Los lee `proximoIntentoDeReconciliacion` para numerar el siguiente y
// la medida del paso para saber CUÁL leyó el reconciliador de esta ronda: el
// último escrito. Una sola lista y no dos recorridos del directorio con la
// misma expresión, que es la copia que acabaría numerando por un criterio y
// midiendo por otro.
function paquetesDeReconciliacion() {
  try {
    return readdirSync(workDir).filter((f) => /^reconcile-package-\d+\.md$/.test(f))
      .sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]))
  } catch {
    return []
  }
}

// Una ronda de reconcile en la que todavía no hay paquete es una ronda en la
// que NADIE despachó a `ct-reconciler`: la fila no lleva los tres campos, y no
// los lleva a `null` sino AUSENTES, porque un null aquí diría "se intentó medir
// el material de un papel que corrió" y lo que pasó es que el papel no corrió.
function medidaDePapelDeReconcile() {
  const previos = paquetesDeReconciliacion()
  if (previos.length === 0) return {}
  return medidaDePapel(STEPS.RECONCILE, join(workDir, previos.at(-1)))
}

function verboReport() {
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del informe')
  const { report, why } = porLeer ? { why: porLeer } : readReport(valor)
  // El resumen entra en la telemetría sólo cuando hay informe válido: un
  // informe descartado no tiene resumen que contar, igual que `why` sólo
  // lleva valor cuando se descarta.
  medir('implement', {
    outcome: report ? 'done' : 'discarded',
    paths: report ? report.paths.length : 0,
    why: report ? null : why,
    summary: report ? report.summary : null,
    ...medidaDeBrief(),
    // También cuando el informe se descarta: el implementador SE DESPACHÓ y
    // leyó su material igual, así que ese coste existió y la fila lo dice.
    ...medidaDePapel(STEPS.IMPLEMENT, rutaDelBrief()),
  })
  if (!report) {
    out(`informe descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // LAS RUTAS LAS MIDE EL PROGRAMA, y la declaración del implementador es una
  // comprobación cruzada. Antes se stageaba lo que el informe declaraba: una
  // ruta olvidada no llegaba al commit, una ruta declarada y no tocada era una
  // mentira que nada detectaba, y una repetida descartaba el informe entero.
  // `git status` contra el árbol previo a la tarea —el commit anterior, porque
  // cada tarea comitea el suyo— sabe exactamente qué cambió.
  //
  // LA DECLARACIÓN NO SE TIRA: si difiere, se AVISA. Que el implementador crea
  // haber tocado otra cosa de lo que tocó es información sobre el intento, y
  // callarla sería perder la única lectura que este paso tenía de él. Lo que ya
  // no hace es decidir.
  // EL ÍNDICE SE VACÍA PRIMERO, y ahora eso además ordena la medida. El reset
  // (mixto: el worktree no se toca) estaba aquí porque entre intentos el
  // índice acumula — el intento 1 pudo stagear una ruta fuera de alcance que
  // el veto devolvió, y sin él esa versión viajaría dentro del commit del
  // intento 2 sin que ningún control volviera a verla.
  //
  // Y va ANTES de medir porque `git status` mira el índice tanto como el
  // worktree: con el índice del intento anterior todavía puesto, un fichero
  // stageado entonces y BORRADO después se lee como "añadido y borrado" y
  // entraría en la lista aunque ya no exista. Medido: `git add` de esa ruta
  // falla con `pathspec did not match` y el paso muere por excepción.
  git(['reset', '-q'])
  const rutas = rutasTocadas()
  const soloDeclaradas = report.paths.filter((p) => !rutas.includes(p))
  // El plan no entra en la discrepancia: enmendarlo es una capacidad que el
  // implementador tiene y que su informe no declara —el informe lista el
  // TRABAJO—, así que sin esta exención cada enmienda legítima salía avisada
  // como "tocado y no declarado", etiquetando de defecto lo que se buscaba.
  const soloMedidas = rutas.filter((p) => !report.paths.includes(p) && p !== rutaDelPlan())
  if (soloDeclaradas.length || soloMedidas.length) {
    err(`aviso: lo que el implementador declara y lo que el árbol dice no coinciden. Se stagea lo MEDIDO.${soloMedidas.length ? ` Tocado y no declarado: ${soloMedidas.join(', ')}.` : ''}${soloDeclaradas.length ? ` Declarado y no tocado: ${soloDeclaradas.join(', ')}.` : ''}`)
  }
  // Se stagea ANTES de medir los controles: uno que lee el índice no ve un
  // fichero nuevo sin stagear. Tras reset+add, el índice es EXACTAMENTE lo que
  // el árbol dice que cambió — que es lo que se comitea.
  //
  // Sin rutas no se llama a `git add`: `git add --` sin ruta detrás no añade
  // nada y avisa por su cuenta, y el índice vacío ya es la respuesta correcta
  // a una tarea que no tocó nada — los controles la miden igual.
  if (rutas.length) git(['add', '--', ...rutas])
  // `lastPaths` alimenta el `--` de un `git grep` en `testsDeclarados`, que
  // acota el ámbito de esa comprobación a lo que la tarea stageó — la
  // propiedad más frágil de todo esto (ver el commit que la arregló, e4cc3dc).
  archivar('report', { paths: rutas, summary: report.summary })
  run = {
    ...run,
    lastPaths: rutas,
    lastSummary: report.summary,
  }
  out(`stageados ${report.paths.length} fichero(s): ${rutas.join(', ')}`)
  // El resumen se IMPRIME. Es el canal por el que el implementador avisa de una
  // skill que no cargó, de una decisión cerrada que obedeció a disgusto o de un
  // problema que vio y no tocó — y hasta aquí no lo leía nadie: no lo imprimía
  // ningún verbo, el juez tiene orden de ignorarlo, y `run.lastSummary` no lo
  // consultaba nadie. Medido en campo (jjponz/rust-monitoring#10): el aviso de
  // que el lockfile commiteado "para CI reproducible" no se hace valer en la
  // integración continua llegó a la pull request solo porque aquella sesión
  // abrió el fichero del informe por iniciativa propia.
  if (report.summary) out(`el implementador dice: ${report.summary}`)
  return OUTCOMES.DONE
}

function verboControls() {
  const t = tarea()
  // El único tiempo que este programa puede medir de verdad: las dos llamadas
  // al modelo las hace la sesión, así que de ellas no hay ni coste ni turnos ni
  // duración. Y es el único que no se puede reconstruir restando `written_at`
  // consecutivos, porque entre dos filas hay latencia de sesión mezclada con
  // trabajo.
  const arranque = Date.now()
  const log = join(workDir, `task-${run.task}-controls-${intento()}.log`)
  const lineas = []
  let resultado = OUTCOMES.DONE

  // Delante de todo el alcance, que es lo más gratis: comparar dos listas de
  // rutas y mirar el árbol del commit anterior no cuesta nada, así que corre
  // incluso antes que los nombres de test.
  const fueraDeAlcance = alcanceDeclarado(t)
  if (fueraDeAlcance.length) {
    lineas.push('# alcance declarado por la tarea', ...fueraDeAlcance.map((f) => `- ${f}`), '')
    resultado = OUTCOMES.FAILED
  }

  // La otra dirección del control de alcance: una enmienda sólo puede AÑADIR
  // rutas a **Files:**, nunca quitarlas — quitar una desactivaría el control
  // de arriba desde dentro del propio plan.
  const enmienda = enmiendaSoloAnade(t)
  if (enmienda.length) {
    lineas.push('# enmienda del plan', ...enmienda.map((f) => `- ${f}`), '')
    resultado = OUTCOMES.FAILED
  }

  // Después los nombres, que también son gratis. La vara de un plan mide que
  // nada se rompió, no que se haya añadido lo prometido — medido en campo: una
  // tarea pidió una función y su test, llegó la función sin el test, y la
  // suite siguió verde porque la del commit anterior pasaba.
  const fallos = testsDeclarados(t)
  if (fallos.length) {
    lineas.push('# tests declarados por la tarea', ...fallos.map((f) => `- ${f}`), '')
    resultado = OUTCOMES.FAILED
  }

  // Y por último lo que los BLOQUES del plan prometen, que sigue siendo
  // gratis: nada de esto ejecuta un comando.
  const bloques = bloquesDeclarados(t)
  if (bloques.length) {
    lineas.push('# bloques declarados por la tarea', ...bloques.map((f) => `- ${f}`), '')
    resultado = OUTCOMES.FAILED
  }

  for (const comando of resultado === OUTCOMES.FAILED ? [] : t.commands) {
    const medido = ejecutarControl(comando)
    lineas.push(`$ ${comando}`, medido.output ?? '', `-> exit ${medido.code}`, '')
    if (medido.code === 'unmeasured') { resultado = OUTCOMES.INDETERMINATE; break }
    if (medido.code !== 0) { resultado = OUTCOMES.FAILED; break }
  }

  writeFileSync(log, lineas.join('\n'))
  medir('controls', { outcome: resultado, controls_log: log, commands: t.commands.length, duration_ms: Date.now() - arranque })
  run = { ...run, lastControlsLog: log }
  out(`controles: ${resultado} (log en ${log})`)
  return resultado
}

// Lo que de verdad se comitea es el ÍNDICE, no la lista que declaró el
// informe: las comprobaciones de alcance miden `git diff --cached` en vez de
// `run.lastPaths`, para que nada stageado —lo declare el informe o no— escape
// al control. Es la segunda mitad del reset de `report`: aquel garantiza que
// el índice sea lo declarado, y esto lo VERIFICA en vez de suponerlo.
const stagedPaths = () => (git(['diff', '--cached', '--name-only']) || '').split('\n').map((l) => l.trim()).filter(Boolean)

// LO STAGEADO QUE ES TRABAJO, SIN LA MAQUINARIA. `stagedPaths` responde "qué
// hay en el índice" y eso es exactamente lo que `ajenoEnElIndice` necesita
// (pertenencia, no contenido). Pero un plan amendado vive en el índice desde
// que `report` lo deja pasar, y un control que lo mirara como si fuera código
// de la tarea contestaría mal: el plan CITA verbatim los nombres de test que
// la tarea retira, así que un control de nombres vería "sigue estando" para
// un test que sí se borró (el falso positivo que motiva esta función). Los
// tres controles que leen contenido —`alcanceDeclarado`, `bloquesDeclarados`,
// `enElIndice`— filtran el plan y el resto de la maquinaria antes de mirar;
// `ajenoEnElIndice` sigue leyendo el índice crudo, porque a esa pregunta el
// plan sí pertenece.
const rutasDeTrabajoEnElIndice = () =>
  stagedPaths().filter((p) => p !== rutaDelPlan() && !esRutaDeLaMaquinaria(p))

// Y LA VERSIÓN PARA LOS CONTROLES QUE COMPARAN LISTAS DE RUTAS, que sólo saca
// el plan. El falso positivo de arriba es de CONTENIDO —el plan cita nombres
// de test verbatim—, y a una comparación de rutas no le pasa: exentar toda la
// maquinaria aquí dejaría fuera del control de alcance cualquier ruta de
// `docs/superpowers/**` que llegue al índice, que es justo el vector que
// `scope.js` documenta del despacho 1, y la haría viajar dentro del commit de
// la tarea sin que ningún control la viera.
const rutasDeObraEnElIndice = () => stagedPaths().filter((p) => p !== rutaDelPlan())

// LO AJENO EN EL ÍNDICE: lo stageado que NO lo puso este programa.
//
// Los tres `git commit` de la maquinaria —la tarea, el veredicto del slice y el
// informe de e2e— van SIN pathspec, así que se llevan el índice entero: lo que
// el conductor stagee antes de llamarlos viaja dentro sin que ningún juez lo
// haya visto. Reproducido en los dos últimos (`git add colado.txt` antes de
// `slice-verdict` y antes de `e2e`: en los dos casos `colado.txt` acabó
// comiteado, y el run entregó igual).
//
// Para esos dos basta la PERTENENCIA: en sus pasos el índice tiene que estar
// vacío salvo por las rutas que el programa acaba de stagear, y el programa
// REESCRIBE sus artefactos justo antes de stagearlos, así que una edición ajena
// del fichero no sobrevive. Del trabajo del implementador no se puede decir eso
// — por eso el commit de tarea lleva sello (`arbolDelIndice`) y no pertenencia:
// ahí el ataque sobreescribe una ruta que SÍ es del alcance.
const ajenoEnElIndice = (nuestras) => {
  // `stagedPaths` devuelve rutas de git (siempre con `/`) y las nuestras se
  // construyen con `join`, que en Windows daría `\`. Normalizar es una línea y
  // evita que la guarda salte SIEMPRE en la plataforma en la que nadie mira.
  const mias = nuestras.map((p) => p.replace(/\\/g, '/'))
  return stagedPaths().filter((p) => !mias.includes(p))
}

// El alcance de la tarea lo decide el PLAN, no el implementador: esta
// comprobación cruza el ÍNDICE (lo que de verdad se va a commitear)
// contra `t.files` (lo que la tarea declara en **Files:**). Una ruta a un lado y
// no al otro es un fallo, y también lo es una acción que no cuadra con el
// árbol del commit anterior — `git cat-file -e HEAD:<path>`, no el disco,
// porque el implementador ya creó el fichero cuando esto corre. Una ruta con
// `action: null` no se comprueba contra git: es una decisión del plan, no un
// olvido (tarea 1, `splitFiles`).
//
// El mensaje de cada fallo dice si se arregla el PLAN o el CÓDIGO, porque un
// plan que se dejó una ruta en **Files:** es tan probable como un
// implementador que tocó de más, y confundirlas cuesta un ciclo entero.
function alcanceDeclarado(t) {
  const fallos = []
  const tocadas = rutasDeObraEnElIndice()
  const declaradas = t.files

  for (const ruta of tocadas) {
    if (!declaradas.some((f) => f.path === ruta)) {
      fallos.push(`la tarea ${t.n} tocó '${ruta}' y el plan no la declara en sus **Files:** — dos explicaciones son igual de plausibles y este control no puede arbitrar entre ellas: sobra en el CÓDIGO, o hace falta añadirla al PLAN`)
    }
  }

  for (const f of declaradas) {
    if (!tocadas.includes(f.path)) {
      fallos.push(`el plan declara '${f.path}' en las **Files:** de la tarea ${t.n} y no está entre lo que tocó: escribe el CÓDIGO que la tarea prometió. Si de verdad sobra en el PLAN, QUITARLA NO ES TU SALIDA —una enmienda sólo puede añadir rutas, porque quitarlas desactiva este mismo control— así que dilo en tu informe y deja la ruta en el plan`)
      continue
    }
    if (f.action === null) continue
    const existiaAntes = git(['cat-file', '-e', `HEAD:${f.path}`], { allowFail: true }) !== null
    if (f.action === 'create' && existiaAntes) {
      fallos.push(`el plan declara '${f.path}' como (create) y ya existía en el commit anterior — revisa el PLAN, la acción debería ser (modify)`)
    }
    if (f.action === 'modify' && !existiaAntes) {
      fallos.push(`el plan declara '${f.path}' como (modify) y no existía en el commit anterior — revisa el PLAN, la acción debería ser (create)`)
    }
  }

  return fallos
}

// La otra dirección del control de alcance (issue 161): una enmienda puede
// AÑADIR rutas a las **Files:** de su propia tarea — eso es lo que
// `alcanceDeclarado` ya deja pasar, comparando contra el ÍNDICE de HOY — pero
// nunca puede QUITAR una que ya declaraba, porque eso desactivaría el control
// de arriba desde dentro del propio plan: bastaría con borrar del **Files:**
// la ruta que sobra para que `alcanceDeclarado` dejara de verla.
//
// NO SE CONDICIONA AL ÍNDICE, y ésa era la puerta abierta. `t` sale del plan
// del ÁRBOL, leído al arrancar el proceso; el índice es otra cosa. Con la
// guarda condicionada a que el plan estuviera stageado, bastaba editarlo
// DESPUÉS de `report`: la guarda no corría, `t.files` —ya reducido— gobernaba
// `alcanceDeclarado`, y el commit se llevaba el plan viejo, así que el juez
// tampoco veía enmienda. Entregar en verde con el plan comiteado
// contradiciendo al código es exactamente lo que este slice existe para
// impedir.
//
// De ahí el primer invariante, que cubre las dos direcciones de una vez: EL
// PLAN QUE GOBIERNA LOS CONTROLES TIENE QUE SER EL QUE SE VA A COMITEAR. Se
// compara el texto del árbol contra el del índice si el plan está stageado, y
// contra el de HEAD si no lo está.
//
// Y FALLA CERRADA, como `allWorkCommittedByCtStep` en state.js: si no se puede
// leer el plan de HEAD, o su texto no declara la tarea `t.n`, no hay contra
// qué comparar y eso NO es un permiso — es un control que no ha podido medir,
// y se dice.
function enmiendaSoloAnade(t) {
  const ruta = rutaDelPlan()
  const anterior = git(['show', `HEAD:${ruta}`], { allowFail: true })
  if (anterior === null) {
    return [`no se pudo leer '${ruta}' en HEAD: sin el plan comiteado no hay contra qué comparar el del árbol, y este control no puede medir si la tarea ${t.n} le quitó rutas a sus **Files:**. Comitea el plan —el gate \`plan\` ya lo pide antes de implementar— y vuelve a pedir el paso.`]
  }

  // Se le PREGUNTA A GIT si el árbol y el índice dicen lo mismo, en vez de
  // comparar los dos textos a mano: `git diff --quiet` respeta los filtros de
  // fin de línea (`core.autocrlf`, `.gitattributes`) y una comparación de
  // cadenas los ignoraría — en un repo que los use, el árbol y el blob
  // difieren siempre y ESTE control saldría rojo en todos los pasos.
  if (git(['diff', '--quiet', '--', ruta], { allowFail: true }) === null) {
    const stageado = stagedPaths().includes(ruta)
    return [`el plan del árbol no es el que se va a comitear: los controles y el juez miden '${ruta}' del ÁRBOL, y ${stageado ? 'el del ÍNDICE dice otra cosa' : 'no está entre lo stageado, así que el commit se llevaría el de HEAD'}. Vuelve a pasar por \`report\` para que lo medido y lo que se comitea sean el mismo texto.`]
  }

  const tareaAnterior = extractTasks(anterior).tasks.find((tt) => tt.n === t.n)
  if (!tareaAnterior) {
    return [`el plan de HEAD no declara ninguna tarea ${t.n}, así que este control no puede medir si la enmienda le quitó rutas a sus **Files:**. Una enmienda no añade ni quita TAREAS: eso descuadra la cuenta del run.`]
  }

  return tareaAnterior.files
    .filter((f) => !t.files.some((tf) => tf.path === f.path))
    .map((f) => `la tarea ${t.n} enmendó el plan quitando '${f.path}' de sus **Files:** — una enmienda sólo puede AÑADIR rutas: quitar una desactiva desde dentro el control de alcance. Devuelve la ruta al PLAN, o escribe el CÓDIGO que prometía.`)
}

// Comprueba si `nombre` aparece en el ÍNDICE, acotado a lo stageado (no al
// índice entero del repo). Un plan prescriptivo CITA el
// código verbatim y vive comiteado en docs/, así que buscar en todo el índice
// encuentra siempre el nombre: el retirado "sigue estando" (falso positivo,
// medido en la tarea 1 del slice #5 de repo-pulse) y el prometido "ya está"
// aunque nadie lo escribiera (falso negativo, que es justo el fallo que esta
// comprobación existe para cazar). Sin ficheros stageados no hay dónde mirar,
// y eso es un NO. Compartida por `testsDeclarados` y `bloquesDeclarados`:
// misma pregunta, mismo ámbito, mismo mecanismo.
function enElIndice(nombre) {
  const ambito = rutasDeTrabajoEnElIndice()
  if (!ambito.length) return false
  try {
    execFileSync('git', ['grep', '--cached', '--quiet', '-F', '-e', nombre, '--', ...ambito], { cwd: repoRoot, stdio: 'ignore', timeout: 60_000 })
    return true
  } catch { return false }
}

function testsDeclarados(t) {
  const fallos = []
  for (const n of t.testsAdded) if (!enElIndice(n)) fallos.push(`la tarea dijo que añadía el test '${n}' y no está en lo stageado`)
  for (const n of t.testsRemoved) if (enElIndice(n)) fallos.push(`la tarea dijo que retiraba el test '${n}' y sigue estando`)
  return fallos
}

// Lo que los BLOQUES del plan prometen tiene que estar, igual que
// `alcanceDeclarado` mide lo que **Files:** promete. Tres comprobaciones,
// todas acotadas a lo stageado por la misma razón que `testsDeclarados`:
// el plan vive comiteado dentro del repo, así que buscar en el repo es
// buscar en el plan.
//
//  - `blockPaths`: cada `{role, path}` exige que `path` esté entre las rutas
//    tocadas. Un Contract o un Call site que nadie tocó es andamiaje
//    declarado y nunca escrito.
//  - `tddName`: mismo `enElIndice` que `testsDeclarados`, y el mismo
//    mensaje — el test que la tarea prometió en su **TDD:** es tan exigible
//    como los de **Tests:**.
//  - `finalTexts`: el texto tiene que aparecer verbatim en el ÍNDICE de su
//    ruta. Se compara contra `git show :<path>` y no con `git grep`, porque
//    es un bloque MULTILÍNEA y `git grep` trabaja línea a línea; comparar el
//    contenido stageado entero es lo que permite decir QUÉ línea falta, que
//    es la mitad del valor de esta comprobación.
//
// El mensaje de cada fallo dice si se arregla el PLAN o el CÓDIGO, igual que
// en `alcanceDeclarado`: confundir las dos cuesta un ciclo entero.
function bloquesDeclarados(t) {
  const fallos = []
  const tocadas = rutasDeObraEnElIndice()

  for (const { role, path } of t.blockPaths) {
    if (!tocadas.includes(path)) {
      fallos.push(`la tarea ${t.n} declara un bloque ${role} (${path}) y no está entre lo que tocó — falta en el CÓDIGO, o el bloque sobra en el PLAN`)
    }
  }

  if (t.tddName && !enElIndice(t.tddName)) {
    fallos.push(`la tarea dijo que añadía el test '${t.tddName}' y no está en lo stageado`)
  }

  for (const { path, text } of t.finalTexts) {
    const indexado = git(['show', `:${path}`], { allowFail: true })
    if (indexado === null) {
      fallos.push(`la tarea ${t.n} declara un Final text (${path}) y ese fichero no está entre lo que tocó — falta en el CÓDIGO, o el bloque sobra en el PLAN`)
      continue
    }
    for (const linea of text.split('\n')) {
      if (linea.trim() !== '' && !indexado.includes(linea)) {
        fallos.push(`la tarea ${t.n} declara Final text (${path}) y la línea '${linea}' no está verbatim en lo stageado — falta en el CÓDIGO, o el PLAN cita mal el texto`)
      }
    }
  }

  return fallos
}

function ejecutarControl(comando) {
  try {
    return { code: 0, output: execFileSync('sh', ['-c', comando], {
      encoding: 'utf8', cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 20 * 60_000, killSignal: 'SIGKILL',
    }) }
  } catch (e) {
    // Un comando que corrió y dijo que no es ROJO y se reintenta; uno que no se
    // pudo ejecutar o se colgó no se pudo MEDIR, y reintentarlo a ciegas repite
    // el coste sin cambiar nada.
    const seColgo = e.killed || e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT'
    const noExiste = e.status === 127 || e.code === 'ENOENT'
    const code = (seColgo || noExiste) ? 'unmeasured' : (typeof e.status === 'number' ? e.status : 'unmeasured')
    return { code, output: String(e.stdout || '') + String(e.stderr || '') }
  }
}

// Fase B — RECONCILE. `BranchReconciliation` (Tareas 6-7) habla con git a
// través de un adaptador `(argv) => ({ code, stdout })` que NUNCA lanza: a
// diferencia del `git(...)` de arriba —pensado para comandos que sólo tienen
// sentido si funcionan—, aquí un `git merge` que devuelve 1 es la mitad
// esperada del camino (CONFLICTING), no un fallo del programa. Por eso este
// adaptador es propio y no el de arriba: envolver el de arriba en un
// try/catch habría sido reimplementar `execFileSync` con más pasos.
const gitParaReconciliar = (argv) => {
  try {
    return { code: 0, stdout: execFileSync('git', argv, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 120_000, killSignal: 'SIGKILL',
    }) }
  } catch (e) {
    // Sin `status` numérico el proceso no terminó por su cuenta: lo mató una
    // señal, y la que llega aquí es la del tope de tiempo (SIGKILL). Devolver
    // `code: 1` cierra en falso — un `git merge` matado se clasificaría como
    // una fusión que git rechazó (UNMERGEABLE_TREE), y el mensaje mandaría al
    // agente del slice a limpiar un árbol que está perfectamente. No se puede
    // interpretar lo que no se llegó a medir: se para aquí.
    if (typeof e.status !== 'number') {
      die(`git ${argv.join(' ')} no terminó por su cuenta (señal ${e.signal || 'desconocida'}): saltó el tope de tiempo o alguien lo mató. No se distingue de un fallo de git y no se va a interpretar como tal.`, EXIT.PRECONDITION)
    }
    return { code: e.status, stdout: String(e.stdout || '') }
  }
}

// La huella del propio loop —telemetría, veredictos, el plan, el informe de
// e2e— NO es una resolución tocando de más: es la MISMA lista que ya declara
// `scope.js` para el gate de alcance del PR, con el mismo motivo dicho allí
// ("al revés, el primer slice que la produzca sale rojo por un fichero del
// loop y quien lea el gate no podrá distinguir si el rojo lo puso el agente
// o la maquinaria"). Una sola fuente para la decisión de qué es "de la
// maquinaria": `LOOP_ARTIFACT_PATTERNS`, consumida aquí y en el workflow del
// repo destino, nunca una segunda lista tecleada a mano.
const esRutaDeLaMaquinaria = (path) => LOOP_ARTIFACT_PATTERNS.some((pat) => matchesPattern(path, pat))

// El extractor de una sección del plan por su encabezado literal, hasta el
// siguiente encabezado de igual o menor nivel — mismo criterio que
// `extract_section` de `skills/subagent-driven-development/scripts/task-brief`
// (bash/awk), reescrito aquí porque el paquete de reconciliación lo pega
// `verboReconcile` directamente, sin ese script de por medio.
//
// LA COPIA ESTÁ DECLARADA Y MEDIDA (`conventions/decisions.md`, "cuando la
// copia es inevitable"): la regla vive en dos idiomas porque el script es bash
// y esto es JavaScript, y `__tests__/seccion-del-plan-real-process.test.js` pasa los mismos
// planes por las dos implementaciones y compara la salida byte a byte — así
// reescribir las dos pasa y tocar una sola falla. Hasta que ese test existió,
// las dos ya habían divergido en las comillas del mensaje de sección ausente.
//
// Respeta los
// cercados de código para no confundir un comentario "### ..." de un bloque
// con un encabezado real. La ausencia se declara, nunca se calla — un hueco en
// blanco leído como "sección vacía" no es lo mismo que "el plan no la trae".
function seccionDelPlan(markdown, encabezado) {
  const nivel = /^#+/.exec(encabezado)[0].length
  let enCercado = false
  let dentro = false
  let visto = false
  const salida = []
  for (const linea of markdown.split('\n')) {
    if (/^```/.test(linea)) enCercado = !enCercado
    if (!enCercado && !visto && linea.startsWith(encabezado)) {
      visto = true
      dentro = true
      salida.push(linea)
      continue
    }
    if (dentro && !enCercado && /^#+[ \t]/.test(linea)) {
      if (/^#+/.exec(linea)[0].length <= nivel) dentro = false
    }
    if (dentro) salida.push(linea)
  }
  const contenido = salida.join('\n').trim()
  return contenido || `(sección '${encabezado}' no encontrada en el plan)`
}

// El log de los commits que la base trajo — lo primero que abriría un humano
// resolviendo el mismo conflicto, y lo que el brief de la Tarea 9 pide por
// nombre: sin él, `ct-reconciler` mira dos textos que chocan y no sabe qué
// pretendía el otro lado, y adivinarlo es justo la invención que el rol tiene
// prohibida. `allowFail` porque un merge-base no calculable no es un fallo del
// programa: es un dato menos en el paquete, declarado en vez de callado.
function logDeLaBase(rama) {
  const mergeBase = git(['merge-base', 'HEAD', `origin/${rama}`], { allowFail: true })
  if (!mergeBase) return '(no se pudo calcular el merge-base con la base: no hay log de commits que enseñar)'
  const log = git(['log', `${mergeBase.trim()}..origin/${rama}`, '--oneline'], { allowFail: true })
  return log || '(la base no trae ningún commit nuevo)'
}

// El intento de esta ronda: cuántos paquetes de reconciliación ya se
// escribieron para este run. Ni `run.reconcileRetries` (sólo cuenta la
// primera vez que un CONFLICTING se queda sin resolver, no cada descarte) ni
// `run.discards` (presupuesto GLOBAL del run, compartido con implement, judge
// y slice-judge, así que ya podría venir por encima de cero sin que este
// conflicto haya visto un solo paquete) cuentan lo que hace falta aquí: cada
// llamada que va a dispatchar a `ct-reconciler` escribe uno, y el siguiente
// número es simplemente cuántos hay ya en el directorio del run.
function proximoIntentoDeReconciliacion() {
  return paquetesDeReconciliacion().length + 1
}

// El texto de arreglo de cada `DiscardReason`, para el paquete y para el
// mensaje de stdout — UNA lista y no dos copias que puedan divergir en qué
// dice cada motivo. `verboReconcile`, más abajo, la usa para el mensaje.
const ARREGLO_DE_DESCARTE = {
  [DiscardReason.MARKERS_LEFT]: 'quedaron marcas de conflicto (<<<<<<< / ======= / >>>>>>>) sin quitar en alguno de los ficheros resueltos.',
  [DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT]: 'la resolución tocó ficheros que no estaban en la lista de conflicto: el índice sólo puede llevar los ficheros en disputa.',
  [DiscardReason.UNRESOLVED_FILES_REMAIN]: 'siguen quedando ficheros sin resolver tras intentar stagearlos: hay que resolverlos todos antes de concluir.',
}

// El paquete que consume `ct-reconciler` (Tarea 9) — mismo patrón que
// `escribirPaquete`/`escribirPaqueteDeSlice`: el programa pega en disco texto
// ya resuelto y el agente lo lee de un tirón. Sin token de revisión: a
// diferencia de un juez, el reconciliador no emite un veredicto que haya que
// atar a un corte del índice — edita ficheros, y es el PROGRAMA quien valida
// el árbol después (`BranchReconciliation.conclude()`), nunca un JSON que este
// paquete tenga que anclar.
function escribirPaqueteDeReconciliacion({ rama, ronda, intento }) {
  const paquete = join(workDir, `reconcile-package-${intento}.md`)
  const deCt = cargarVaraDeCt()
  const ficheros = ronda.files.map((f) => `- ${f}`).join('\n') || '(ninguno)'
  const cabecera = ronda.reason
    ? `# Reconcile package: issue #${issue}, round ${intento} (previous round discarded: ${ronda.reason})`
    : `# Reconcile package: issue #${issue}, round ${intento}`
  const lineas = [
    cabecera, '',
    '## Conflicted files', ficheros,
    '', '## Base commits', logDeLaBase(rama),
    '', seccionDelPlan(planText, '### Desired end state'),
  ]
  if (ronda.reason) {
    lineas.push('', '## Discard reason', ARREGLO_DE_DESCARTE[ronda.reason] ?? ronda.reason)
  }
  writeFileSync(paquete, lineas.join('\n'))
  // POR RUTA Y NO PEGADA: el reconciliador tiene `Read` (RECONCILER_TOOLS), y
  // los ocho documentos enteros delante de un conflicto son unos 41 KB de
  // material fijo que no dependen del conflicto. Sin tarea que acote el
  // alcance, van todos: una fusión puede tocar cualquier fichero, incluido
  // uno nuevo.
  appendFileSync(paquete, PluginYardstick.composePathSection(deCt))
  appendFileSync(paquete, seccionVaraDelRepo('el paquete de reconciliación'))
  return paquete
}

// La última bala de la escalera, y la promesa que `agents/ct-reconciler.md` le
// hace al reconciliador cuando le dice que declarar "no sé resolverlo" lleva a
// alguien con shell. Se dice IGUAL venga de un CONFLICTING que nadie tocó o de
// una ronda descartada: es el mismo relevo, y escribirlo dos veces es lo que
// dejaría una de las dos mitades sin escribir.
function relevoAlAgenteDelSlice() {
  out(`ct-reconciler agotó sus ${DEFAULT_BUDGETS.reconcileRetries} ronda(s) sin resolverlo: le toca al agente del propio slice, que sí tiene Bash. Que resuelva el conflicto a mano, deje los ficheros stageados y llame a:`)
  out(`  ct-step reconcile --plan ${planPath} --issue ${issue}`)
}

// Idempotente por MERGE_HEAD (Tarea 7): sin fusión en marcha, arranca la
// siguiente ronda contra la base; con una a medias, concluye la resolución
// que la sesión ya haya dejado en el índice. El estado de "en qué ronda
// estamos" lo lleva git, no este fichero — no hay contador que mantener
// sincronizado ni forma de invocarlo fuera de orden.
//
// El nombre de la rama base NO se resuelve aquí: `resolverRamaBase()` es la
// misma función que ya usa `exclusionDeLaBase()` (ver su comentario, arriba).
// Preguntarlo dos veces con dos caminos —uno para excluir commits, otro para
// fusionar— es la copia divergente que el reviewer de la fase anterior avisó
// por escrito que no debía volver a escribirse.
function verboReconcile() {
  const arranque = Date.now()
  const rama = resolverRamaBase()
  if (!rama) {
    die('reconcile no puede resolver la rama base del slice (ni "base:" en .agent/SLICE.md, ni main/master remotos en este worktree): no hay con qué fusionar.', EXIT.PRECONDITION)
  }
  const reconciliacion = new BranchReconciliation({ git: gitParaReconciliar, isMachineryPath: esRutaDeLaMaquinaria })
  const ronda = reconciliacion.isMergeInProgress()
    ? reconciliacion.conclude()
    : reconciliacion.merge({ baseBranch: rama })
  medir('reconcile', {
    outcome: ronda.outcome, files: ronda.files, reason: ronda.reason,
    duration_ms: Date.now() - arranque,
    ...medidaDePapelDeReconcile(),
  })
  // El presupuesto que decide el mensaje es el de ESTA ronda, ANTES de que
  // `after()` (más abajo, en el despacho final) lo consuma. La pregunta la
  // contesta `run-machine.js`, que es quien tiene la regla: aquí sólo se lee.
  // Rederivarla —`run.reconcileRetries < DEFAULT_BUDGETS.reconcileRetries`
  // escrito otra vez— era la misma decisión en dos ficheros, y con la ronda
  // descartada gastando reintento las dos copias habrían dejado de coincidir:
  // el verbo anunciaría otra ronda y la tabla cerraría el run.
  const quedaPresupuesto = !reconcileBudgetSpent(run)
  switch (ronda.outcome) {
    case ReconcileOutcome.UP_TO_DATE:
      out(`reconcile: up-to-date (la base "${rama}" no se ha movido)`)
      break
    case ReconcileOutcome.MERGED:
      out(`reconcile: merged (la base "${rama}" se fusionó sin conflictos)`)
      break
    case ReconcileOutcome.RESOLVED:
      out(`reconcile: resolved (la resolución de ${ronda.files.length} fichero(s) se comiteó)`)
      break
    // El conflicto de CONTENIDO: hay con qué trabajar (los ficheros en
    // disputa), así que mientras quede presupuesto lo resuelve el
    // reconciliador (Tarea 9, `ct-reconciler`) y no el agente del slice.
    case ReconcileOutcome.CONFLICTING:
      out(`reconcile: conflicting — ${ronda.files.length} fichero(s) en conflicto con "${rama}":`)
      for (const f of ronda.files) out(`  - ${f}`)
      out('')
      if (quedaPresupuesto) {
        const paquete = escribirPaqueteDeReconciliacion({ rama, ronda, intento: proximoIntentoDeReconciliacion() })
        out(`DESPACHA ct-reconciler (subagente — declarado SIN Bash y SIN Write: ${RECONCILER_TOOLS}) a resolver el conflicto: que deje los ficheros resueltos, sin marcas de conflicto, y sin tocar nada fuera de esa lista — no puede stagear, comitear ni abortar la fusión: eso lo hace este programa al concluir. Dale:`)
        out(`  - el paquete de reconciliación: ${paquete}`)
        out(`Cuando vuelva:  ct-step reconcile --plan ${planPath} --issue ${issue}  (concluye la fusión a medias — lo decide MERGE_HEAD, no hace falta indicar nada más).`)
      } else {
        relevoAlAgenteDelSlice()
      }
      break
    // La mitigación que el diseño prometió por escrito ("Límites declarados"):
    // el agente del slice tiene Bash, así que puede stagear y comitear la
    // fusión por su cuenta sin volver a pasar por aquí. Cuando eso ocurre, lo
    // único que queda por mirar es el commit de fusión ya hecho — y lo que se
    // mira es lo que la validación se saltó: que no lleve marcas dentro. No es
    // hermético; mueve el caso de la retina del humano al loop.
    case ReconcileOutcome.MARKERS_COMMITTED:
      out(`reconcile: markers-committed — HEAD ya es un commit de fusión, hecho fuera de este verbo, y ${ronda.files.length} fichero(s) suyos traen marcas de conflicto DENTRO del commit:`)
      for (const f of ronda.files) out(`  - ${f}`)
      out('No hay fusión viva que concluir ni ronda que descartar: la pull request llevaría los marcadores dentro, y si el conflicto cae en un fichero que los controles no compilan, sale verde.')
      out('DESPACHA AL AGENTE DEL SLICE (tiene Bash) a quitar las marcas y comitear el arreglo, y vuelve a preguntar con ct-step next.')
      break
    // El árbol sucio del propio slice: git ni siquiera pudo EMPEZAR la
    // fusión. No hay contenido en conflicto que enseñarle al reconciliador —
    // enseñárselo sería mandarlo a resolver algo que no existe— así que va
    // derecho al agente del slice, sin mencionar a ct-reconciler.
    case ReconcileOutcome.UNMERGEABLE_TREE:
      out(`reconcile: unmergeable-tree — git no pudo empezar la fusión con "${rama}": esto no es un conflicto de contenido, es el árbol del propio slice (cambios sin comitear, o algo a medias).`)
      out('DESPACHA AL AGENTE DEL SLICE (tiene Bash) a dejar el árbol limpio, y vuelve a preguntar con ct-step next.')
      break
    // La ronda que se descartó SIN tocar el árbol (`checkout --merge` la
    // deshace) — como implement y el juez, no gasta reintento, sólo el
    // presupuesto de descartes de la slice. El mensaje dice CUÁL de las tres
    // razones fue, porque cada una se arregla distinto.
    case ReconcileOutcome.ROUND_DISCARDED: {
      out(`reconcile: round-discarded (${ronda.reason}) — ${ARREGLO_DE_DESCARTE[ronda.reason]}`)
      out('La ronda se descartó sin comitear nada: el merge sigue vivo, con los ficheros en conflicto restaurados a como los dejó git.')
      // El merge SIGUE EN MARCHA (el descarte no lo aborta), así que mientras
      // quede presupuesto sigue siendo turno de ct-reconciler — el paquete
      // nuevo lleva el motivo del descarte para que el próximo intento no sea
      // ciego a por qué falló el anterior. Agotado el presupuesto, el relevo es
      // el MISMO que en CONFLICTING: es la misma escalera, y una ronda
      // descartada gasta reintento precisamente para que llegue hasta abajo.
      if (!quedaPresupuesto) {
        relevoAlAgenteDelSlice()
        break
      }
      const paquete = escribirPaqueteDeReconciliacion({ rama, ronda, intento: proximoIntentoDeReconciliacion() })
      out(`REDESPACHA ct-reconciler (subagente — declarado SIN Bash y SIN Write: ${RECONCILER_TOOLS}) con el paquete nuevo:`)
      out(`  - el paquete de reconciliación: ${paquete}`)
      out(`Cuando vuelva:  ct-step reconcile --plan ${planPath} --issue ${issue}`)
      break
    }
    default:
      throw new Error(`ronda de reconciliación con desenlace sin mensaje: "${ronda.outcome}"`)
  }
  return outcomeOfReconcile(ronda.outcome)
}

// §3.7-A: la punta a punta del plan, ejecutada POR EL PROGRAMA tras la última
// tarea comiteada. Misma maquinaria que los comandos de `controls`
// (`ejecutarControl`: exit code manda, `unmeasured` es una clase distinta de
// rojo), pero sin las comprobaciones de índice — aquí no hay nada stageado:
// el sujeto es el árbol comiteado entero. Un §8 declarado "N/A" llega aquí
// como lista vacía de comandos (plan-tasks.js acepta el N/A con la misma
// tolerancia que el de **Tests:** de una tarea — la razón se pide en la
// plantilla, no la valida ningún programa), se registra y se avanza:
// exigirle un comando sería el guard imposible de F14 aplicado a §8.
function verboGlobal() {
  const arranque = Date.now()
  if (!globalVerification.commands.length) {
    medir('global', { outcome: OUTCOMES.DONE, global_log: null, commands: 0, duration_ms: Date.now() - arranque })
    out('global: done (el plan declara N/A — no hay punta a punta que correr)')
    return OUTCOMES.DONE
  }
  const log = join(workDir, 'global-verification.log')
  const lineas = []
  let resultado = OUTCOMES.DONE
  for (const comando of globalVerification.commands) {
    const medido = ejecutarControl(comando)
    lineas.push(`$ ${comando}`, medido.output ?? '', `-> exit ${medido.code}`, '')
    if (medido.code === 'unmeasured') { resultado = OUTCOMES.INDETERMINATE; break }
    if (medido.code !== 0) { resultado = OUTCOMES.FAILED; break }
  }
  writeFileSync(log, lineas.join('\n'))
  medir('global', { outcome: resultado, global_log: log, commands: globalVerification.commands.length, duration_ms: Date.now() - arranque })
  // `lastGlobalLog` es lo que `next` le enseña al juez de slice: la prueba de
  // que la punta a punta ya corrió, para que no la re-derive del diff.
  run = { ...run, lastGlobalLog: log }
  out(`global: ${resultado} (log en ${log})`)
  return resultado
}

// §3.7-B: el veredicto del slice entero. A diferencia del de tarea, un PASS
// no espera a ningún `commit` — la última tarea ya está comiteada, así que el
// veredicto estrena su propio commit aquí mismo, con la telemetría de las dos
// fases nuevas dentro (las filas de `global` y `slice-judge` se escriben
// después del último commit de tarea, y sin este add no viajarían nunca).
// Un FAIL no deja veredicto trackeado, igual que en el juez de tarea: solo
// viaja el que aprueba — el FAIL cierra el run y lo lee el humano en la
// carpeta del run.
// EL TOKEN LO ESCRIBE EL PROGRAMA, no el juez. `next` ya dicta la ruta del
// veredicto y este verbo ya calculó el token del paquete y del corte de ahora:
// pedirle al modelo que copie 64 hex de una línea que el programa acaba de
// escribir era la cuarta cosa que sabía y aun así preguntaba, y un error de
// copia descartaba un veredicto entero de opus y gastaba uno de los seis
// descartes que matan el run.
//
// SE INYECTA SÓLO SI FALTA. Un veredicto que trae OTRO token se sigue
// rechazando aguas abajo (`verdict.review_token !== token`): es defensa en
// profundidad contra el fichero de un juicio anterior en la misma ruta, y
// sobreescribirlo aquí desarmaría justo esa comprobación.
const conTokenDelPrograma = (valor, token) =>
  (valor && typeof valor === 'object' && !Array.isArray(valor) && valor.review_token === undefined)
    ? { ...valor, review_token: token }
    : valor

function verboSliceVerdict() {
  // EL INSUMO ANTES QUE EL VEREDICTO, y por el mismo motivo que en
  // `verboVerdict` (ver el comentario largo de ahí, que es donde está el caso
  // de campo): `escribirPaqueteDeSlice` lo invoca SÓLO `next`, así que sin el
  // fichero en disco el juez de slice no tuvo diff acumulado que juzgar.
  const paquete = join(workDir, 'slice-review.diff')
  if (!existsSync(paquete)) {
    const why = `el paquete de revisión del slice no existe (${paquete}): el juez de slice juzgó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al juez de slice. El paquete es de UN SOLO USO: lo consume el veredicto que lo lee, así que tras un veredicto aceptado hay que volver a pasar por next antes de despachar al juez de slice otra vez`
    medir('slice-judge', { outcome: 'discarded', why })
    out(`veredicto de slice descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // Mismo par de comprobaciones que en `verboVerdict`, con el diff del RANGO
  // en vez del del índice (ver `diffDeSlice`). Aquí el token cubre lo que la
  // invariante de commits del estado NO cubre: un commit AÑADIDO en el hueco
  // ya muere en el cruce `hechos !== esperados` de la carga del estado, pero un
  // `--amend` deja la cuenta igual y el contenido distinto.
  const { token, why: porElPaquete } = tokenVigente(paquete, diffDeSlice())
  if (porElPaquete) {
    medir('slice-judge', { outcome: 'discarded', why: porElPaquete })
    out(`veredicto de slice descartado: ${porElPaquete}`)
    return OUTCOMES.DISCARDED
  }
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del veredicto de slice')
  const { verdict, why } = porLeer ? { why: porLeer } : readSliceVerdict(conTokenDelPrograma(valor, token))
  if (!verdict) {
    medir('slice-judge', { outcome: 'discarded', why })
    out(`veredicto de slice descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  if (verdict.review_token !== token) {
    const porAjeno = whyTokenAjeno(verdict.review_token, token)
    medir('slice-judge', { outcome: 'discarded', why: porAjeno })
    out(`veredicto de slice descartado: ${porAjeno}`)
    return OUTCOMES.DISCARDED
  }
  const outcome = outcomeOfSliceVerdict(verdict)
  medir('slice-judge', { outcome, review_package: paquete, review_token: token, ...verdictMeasures(verdict), ...medidaDePapel(STEPS.SLICE_JUDGE, paquete) })
  // Aquí y no más abajo: DESPUÉS de medir (la fila nombra el paquete que el juez
  // de slice leyó, y se escribe mientras eso sigue siendo cierto) y ANTES de la
  // rama del PASS, que escribe, stagea y COMITEA. Cualquiera de esos writes
  // puede lanzar —`mkdirSync`/`writeFileSync` sobre un árbol de sólo lectura— y
  // subir hasta el catch del despacho: dejar el consumo detrás de ellos abriría
  // una ventana en la que un veredicto ya emitido no gastó su insumo.
  consumirPaquete(paquete)
  if (verdict.ruling === 'PASS') {
    const ruta = join('docs', 'superpowers', 'verdicts', `issue-${issue}-slice.json`)
    mkdirSync(join(repoRoot, 'docs', 'superpowers', 'verdicts'), { recursive: true })
    writeFileSync(join(repoRoot, ruta), JSON.stringify({ issue, tasks_total: run.tasksTotal, verdict }, null, 2) + '\n')
    // Los dos `add` con `allowFail` por la misma doctrina que en `verdict` y
    // `commit`: la evidencia que no puede viajar se avisa, nunca bloquea una
    // entrega cuyo trabajo ya está comiteado entero.
    if (git(['add', '--', ruta], { allowFail: true }) === null) {
      err(`aviso: el veredicto del slice se escribió en ${ruta} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?). La entrega sigue.`)
    }
    if (existsSync(join(repoRoot, METRICS_REL)) && git(['add', '--', METRICS_REL], { allowFail: true }) === null) {
      err(`aviso: no se pudo stagear la telemetría (${METRICS_REL}) — el veredicto del slice viaja sin ella. ¿La ruta está gitignoreada en este repo?`)
    }
    // Y NO SE COMITEA EL ÍNDICE A CIEGAS. Este `git commit` va sin pathspec, así
    // que se lleva TODO lo stageado: si el conductor dejó código en el índice
    // antes de llamar a `slice-verdict`, entraba en el commit del veredicto del
    // slice sin que nadie lo hubiera juzgado — y no lo cazaba nada, porque el
    // paquete de slice mide `baseSha..HEAD` y el índice no sale en ese diff.
    // Medido: `git add colado.txt` antes de este verbo y `colado.txt` acabó
    // dentro de "Veredicto del slice entero (#7)", con el run entregando.
    //
    // Basta la PERTENENCIA (ver `ajenoEnElIndice`): aquí el índice tiene que
    // traer sólo las dos rutas que las líneas de arriba acaban de stagear.
    //
    // Y el trato es el de la evidencia que no puede viajar, no el de un veto: el
    // veredicto del slice es VÁLIDO —es de `baseSha..HEAD`, que esto no cambia— y
    // el trabajo del slice está comiteado entero. Devolver FAILED cerraría el run
    // en `blocked-slice-judge`, que sale por el código del VETO (1) y diría que el
    // juez rechazó el slice: sería mentir sobre el juicio para castigar un índice
    // sucio. Así que se avisa, no se comitea, y la entrega sigue — las dos rutas
    // se quedan STAGEADAS, así que sacar lo ajeno y comitearlas a mano es una
    // línea. Misma doctrina que el `else` de más abajo ("nada que commitear del
    // veredicto del slice ... la entrega sigue") y que los tres `allowFail`.
    const ajeno = ajenoEnElIndice([ruta, METRICS_REL])
    if (ajeno.length) {
      err(`aviso: el índice traía ${ajeno.length} ruta(s) ajenas a la maquinaria (${ajeno.join(', ')}) y este commit se las llevaría dentro sin que ningún juez las haya visto — NO se comitea el veredicto del slice. La entrega sigue: el trabajo del slice ya está comiteado entero. El veredicto está escrito y STAGEADO en ${ruta}: saca lo ajeno del índice ("git restore --staged ${ajeno[0]}", que no toca tu worktree) y comitéalo a mano antes de abrir la pull request.`)
    } else if ((git(['diff', '--cached', '--name-only']) || '').trim()) {
      let mensaje = null
      try {
        mensaje = sliceVerdictCommitMessage({ issue, tasksTotal: run.tasksTotal })
      } catch (e) {
        err(`aviso: ${String(e.message)} — el veredicto del slice se queda sin commitear. La entrega sigue.`)
      }
      if (mensaje !== null) {
        if (git(['commit', '-m', mensaje], { allowFail: true }) === null) {
          err('aviso: no se pudo commitear el veredicto del slice — la entrega no depende de la evidencia, pero revisa el índice antes de abrir la pull request.')
        } else {
          // Se cuenta el commit en el ESTADO, y sólo cuando de verdad ocurrió.
          // El paso siguiente (`e2e`) es otro proceso: relee el fichero y cruza
          // los commits contra `tasksTotal + sliceCommits` (ver la carga del
          // estado). Sin este incremento el cruce daba uno de menos y el run se
          // quedaba atascado en PRECONDITION para siempre. Y va DENTRO del
          // `else` porque si las dos rutas de evidencia están gitignoreadas no
          // hay commit: contarlo entonces desajustaría la cuenta en la otra
          // dirección. Mismo patrón in situ que `lastGlobalLog` en `verboGlobal`
          // — `guardar()` lo persiste al final del despacho.
          run = { ...run, sliceCommits: (run.sliceCommits || 0) + 1 }
          out(`veredicto del slice comiteado: ${headSha().slice(0, 7)}`)
        }
      }
    } else {
      err('aviso: nada que commitear del veredicto del slice (¿las dos rutas gitignoreadas?) — la entrega sigue.')
    }
  }
  out(`veredicto de slice ${verdict.ruling} con ${verdict.findings.length} hallazgo(s) → ${outcome}`)
  return outcome
}

function verboVerdict() {
  // EL INSUMO ANTES QUE EL VEREDICTO. `next` es el ÚNICO verbo que escribe el
  // paquete de revisión (`escribirPaquete`, arriba; se invoca sólo en el caso
  // JUDGE de `verboNext`), así que si no está en disco el juez no tuvo qué
  // juzgar: juzgó a ciegas. Medido en campo — un agente encadenó
  // report→controls→verdict sin volver a pasar por `next`, y aquel PASS sólo no
  // entró porque el propio juez confesó que no encontraba el paquete. Sin esa
  // confesión, el PASS entraba y la fila de telemetría quedaba nombrando un
  // fichero inexistente. Un paso que exige un insumo y no comprueba que llegó
  // delega su garantía en la honestidad del agente, que es justo lo que este
  // pipeline no hace en ningún otro sitio (los controles no se creen al
  // implementador; el commit no lo hace el implementador; el índice se verifica
  // en vez de suponerse).
  //
  // Y va ANTES de `leerJson` a propósito. Con las dos cosas mal —paquete
  // ausente y JSON ilegible— la fila que hay que escribir es la del paquete:
  // volver a preguntarle al juez arregla un JSON roto, pero no hace aparecer un
  // paquete que nadie generó, así que medir "no se pudo leer el veredicto"
  // mandaría al loop a gastarse los seis descartes contestando al problema que
  // no era, y la telemetría contaría un juez que escribe mal en vez de un
  // conductor que se saltó un paso. La causa manda sobre el síntoma.
  const paquete = join(workDir, `task-${run.task}-review.diff`)
  if (!existsSync(paquete)) {
    const why = `el paquete de revisión no existe (${paquete}): el juez juzgó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al juez con el paquete nuevo. El paquete es de UN SOLO USO: lo consume el veredicto que lo lee, así que tras un FAIL (o cualquier veredicto aceptado) hay que volver a pasar por next antes de despachar al juez otra vez — y volver a next SIN redespachar al juez deja un veredicto de otro diff, que este verbo también rechaza`
    // La fila lleva `outcome` y `why`, y ninguna medida más: exactamente la
    // forma de los otros descartes de este fichero. Sin `ruling` —para
    // `aggregateVerdictMeasures` una fila con `ruling` ES un veredicto, y esto
    // es su ausencia: contarla inflaría el denominador de `rubric_sin_vara`— y
    // sin `review_package`, porque nombrar en la telemetría el fichero que
    // falta es escribir precisamente la fila que apunta a un inexistente que
    // esta guarda existe para no dejar entrar.
    medir('judge', { outcome: 'discarded', why })
    out(`veredicto descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // EL INSUMO SIGUE SIENDO EL CORTE DE AHORA, y va ANTES de `leerJson` por el
  // mismo motivo que la guarda de existencia: con las dos cosas mal, la fila
  // que hay que escribir es la del paquete. Repreguntarle al juez arregla un
  // JSON roto y NO hace que el código vuelva a ser el que él juzgó, así que
  // medir "no se pudo leer el veredicto" mandaría al loop a gastar descartes
  // contestando al problema que no era. La causa manda sobre el síntoma.
  const { token, why: porElPaquete } = tokenVigente(paquete, diffDeTarea())
  if (porElPaquete) {
    // Misma forma que los otros descartes: `outcome` y `why`, ninguna medida
    // más. Sin `review_package` ni `review_token`, porque nombrar en la fila
    // el insumo de un juicio que no se acepta es escribir la afirmación que
    // esta guarda existe para no dejar entrar.
    medir('judge', { outcome: 'discarded', why: porElPaquete })
    out(`veredicto descartado: ${porElPaquete}`)
    return OUTCOMES.DISCARDED
  }
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del veredicto')
  const { verdict, why } = porLeer ? { why: porLeer } : readVerdict(conTokenDelPrograma(valor, token))
  if (!verdict) {
    medir('judge', { outcome: 'discarded', why })
    out(`veredicto descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // EL PRODUCTO ES DE ESTE INSUMO. Aquí muere el veredicto reciclado: el del
  // juicio anterior trae el token del paquete anterior.
  if (verdict.review_token !== token) {
    const porAjeno = whyTokenAjeno(verdict.review_token, token)
    medir('judge', { outcome: 'discarded', why: porAjeno })
    out(`veredicto descartado: ${porAjeno}`)
    return OUTCOMES.DISCARDED
  }
  const outcome = outcomeOfVerdict(verdict)
  const graves = verdict.findings.filter((f) => f.severity !== 'low')
  // `review_token` al lado de `review_package`: la ruta del insumo y su
  // IDENTIDAD. La ruta ya no vale para comprobar nada (el paquete se consume
  // dos líneas más abajo), y el token dice de qué código fue este juicio — que
  // es justo lo que en las dos vías era indistinguible en el JSONL. No se
  // deriva de `verdictMeasures` porque no es una medida del juicio: es la del
  // insumo, y va donde ya vive la del insumo.
  medir('judge', { outcome, review_package: paquete, review_token: token, ...verdictMeasures(verdict), ...medidaDePapel(STEPS.JUDGE, paquete) })
  // El consumo va AQUÍ por lo mismo que en el gemelo de slice: la fila que
  // nombra el paquete se escribe primero, y todo lo que viene después
  // —`mkdirSync`, `writeFileSync` y el `git add` del veredicto que viaja en el
  // commit de la tarea— puede fallar sin que eso convierta el veredicto en no
  // emitido. Ninguna de esas rutas toca el paquete (los `add` son por ruta,
  // nunca `-A`), así que consumirlo antes no puede colarse en ningún commit.
  consumirPaquete(paquete)
  archivar('verdict', verdict)
  run = {
    ...run,
    lastVerdict: verdict,
    lastFindings: graves.length ? graves.map((f) => `- [${f.severity}] ${findingLocation(f)}: ${f.what}`).join('\n') : null,
  }
  if (verdict.ruling === 'PASS') {
    // El veredicto VIAJA en la pull request (criterio de cierre de F37: "el
    // PR de un slice trae un veredicto emitido por un agente que no ejecutó
    // nada"): el que aprueba la tarea se escribe en una ruta trackeada y se
    // stagea, así `commit` lo lleva dentro del commit de su tarea. Lo que
    // llega al PR es el JSON del juez, no una frase del mensaje de commit
    // afirmándolo. Con `ruling` y no con el outcome a propósito: un PASS con
    // hallazgos medios ordena correcciones, y si el presupuesto se agota la
    // tarea entrega igual — ese PASS es el veredicto que la aprueba y tiene
    // que viajar (el reset de `report` lo desstagea entre intentos y el PASS
    // siguiente lo reescribe, así al commit llega siempre el último). Se
    // stagea DESPUÉS de los controles a propósito: es un artefacto de la
    // maquinaria, como el plan, no alcance del implementador.
    const ruta = join('docs', 'superpowers', 'verdicts', `issue-${issue}-task-${run.task}.json`)
    mkdirSync(join(repoRoot, 'docs', 'superpowers', 'verdicts'), { recursive: true })
    writeFileSync(join(repoRoot, ruta), JSON.stringify({ issue, task: run.task, task_name: tarea()?.name ?? null, verdict }, null, 2) + '\n')
    // `allowFail`, por la misma razón que el `git add` de la telemetría en
    // `commit`: sin él, un repo que ignore esta ruta hace que la excepción suba
    // y deje la tarea SIN COMITEAR con el run atascado en el paso del juez.
    // Medido. Un veredicto que no puede viajar degrada el criterio de cierre de
    // F37 y hay que verlo —de ahí el aviso, no un silencio—, pero pararlo no lo
    // arregla: el veredicto sigue escrito en la carpeta del run, y quien revisa
    // la pull request ve que no está. El trabajo se comitea; la evidencia de que
    // no viajó se cuenta.
    if (git(['add', '--', ruta], { allowFail: true }) === null) {
      err(`aviso: el veredicto se escribió en ${ruta} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?). La tarea se comitea igual.`)
    } else {
      out(`veredicto guardado y stageado: ${ruta}`)
    }
    // EL SELLO DEL ÍNDICE — la TERCERA igualdad (slice 12).
    //
    // Las dos del slice 11 atan el veredicto al paquete y el paquete al código, y
    // las dos miden EL INSTANTE de este verbo. Después quedaba una ventana: entre
    // este PASS y `ct-step commit` el conductor podía re-stagear código y `commit`
    // no volvía a mirar nada — entraba código que ningún juez vio, con la fila de
    // telemetría afirmando el `review_token` del código que SÍ se revisó.
    // Reproducido CON el fix del slice 11 puesto (el `medium` de aquel juez): un
    // `git add uno.txt` aquí y la tarea se comiteaba con la versión nueva.
    //
    // Va AQUÍ: DESPUÉS del `git add`. Lo que `commit` va a comitear es el índice
    // CON el artefacto que la maquinaria acaba de poner encima del corte
    // revisado, así que eso es lo que hay que sellar; sellar antes del add sería
    // sellar un índice que ya no existe y haría fallar TODOS los commits — la
    // misma trampa de orden que el comentario de `diffDeTarea` documenta para el
    // token. De rebote, el artefacto queda dentro del sello: un veredicto forjado
    // y stageado en el hueco tampoco entra (medido: hoy entra).
    //
    // Sólo en el PASS, y no hace falta limpiarlo en los otros caminos: al paso
    // COMMIT sólo se llega desde un PASS —`done` y `corrections-ordered` con el
    // presupuesto agotado, las dos ramas de `run-machine.js#trasElJuez`, y las dos
    // salen de `ruling === 'PASS'`—, así que el sello que `commit` lee es SIEMPRE
    // el del veredicto inmediatamente anterior y nunca uno rancio de tres
    // intentos atrás. Un FAIL vuelve a implementar o cierra el run; un descarte
    // vuelve a preguntar.
    run = { ...run, sealedTree: arbolDelIndice() }
  }
  out(`veredicto ${verdict.ruling} con ${verdict.findings.length} hallazgo(s) → ${outcome}`)
  return outcome
}

// H9 — EL CONSEJO. Mismo trato que el veredicto del juez, y por los mismos
// motivos: el insumo se comprueba ANTES que la respuesta (un consejero sin
// paquete aconsejó a ciegas, y volver a preguntarle no hace aparecer el paquete
// que nadie generó), y lo que no cumple el esquema es un DESCARTE y no un
// error — se vuelve a preguntar.
//
// Un descarte aquí NO gasta el intento que le queda a la tarea: el consejero no
// toca el código, así que su respuesta ilegible no puede costar lo mismo que un
// veto. Quien lo respalda es el tope de descartes de la slice.
function verboAdvice() {
  const paquete = join(workDir, `task-${run.task}-advice.md`)
  if (!existsSync(paquete)) {
    const why = `el paquete del consejero no existe (${paquete}): el consejero aconsejó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al consejero con el paquete nuevo`
    medir(STEPS.ADVISE, { outcome: 'discarded', why })
    out(`consejo descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  const ruta = process.argv[3]
  const { valor, why: porLeer } = leerJson(ruta, 'del consejo')
  const { advice, why } = porLeer ? { why: porLeer } : readAdvice(valor)
  medir(STEPS.ADVISE, {
    outcome: advice ? 'done' : 'discarded',
    why: advice ? null : why,
    // El peso de lo que el consejero contestó, medido sobre el fichero que
    // existe en disco — nunca `0` cuando no se puede medir: un cero afirmaría
    // un consejo vacío, y lo que ha pasado es que no se ha podido mirar.
    advice_bytes: typeof ruta === 'string' ? tamanoEnDisco(ruta) : null,
    advice_paths: advice ? advice.files_to_reconsider.length : null,
    ...medidaDePapel(STEPS.ADVISE, paquete),
  })
  if (!advice) {
    out(`consejo descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  run = { ...run, lastAdvice: advice }
  // HAPPY-TO-DELETE: el tercer intento no arranca encima de dos capas de
  // parches. Va DESPUÉS de la fila de telemetría y de aceptar el consejo, para
  // que un fallo de git al limpiar no se lleve por delante el consejo que sí se
  // pudo leer.
  const limpiadas = limpiarElArbolDeLaTarea()
  out(`consejo aceptado: ${advice.files_to_reconsider.length} ruta(s) a reconsiderar; el árbol vuelve al último commit en ${limpiadas} ruta(s)`)
  return OUTCOMES.DONE
}

// EL ÁRBOL DE VUELTA AL ÚLTIMO COMMIT (H9). No es una limpieza general: son
// exactamente las rutas que `entradasDelArbol` mide como trabajo de la tarea, y
// eso ya excluye el fichero del run, su carpeta y la maquinaria, pero YA NO EL
// PLAN: una enmienda del implementador se devuelve con el resto del intento
// vetado, que es la semántica que se quiere —muere con lo que la motivó—
// (`LOOP_ARTIFACT_PATTERNS`, donde vive la telemetría que viaja en el repo). Un
// `git checkout -- .` a secas se llevaría por delante el paquete que el
// consejero acaba de leer y la fila que este mismo verbo acaba de escribir.
//
// Se reutiliza el mecanismo que `report` ya usa para saber qué tocó la tarea, y
// no uno nuevo: dos definiciones de "las rutas de la tarea" son dos respuestas
// que divergen, y aquí la divergencia se paga borrando lo que no era.
//
// El índice se vacía primero por lo mismo que en `report`: con el índice del
// intento anterior puesto, `git status` lee como "añadido y borrado" lo que
// sólo estaba stageado, y lo rastreado se decide sobre un estado que ya no es.
function limpiarElArbolDeLaTarea() {
  git(['reset', '-q'])
  const entradas = entradasDelArbol()
  const esNueva = ({ estado }) => estado === '??'
  const rastreadas = entradas.filter((e) => !esNueva(e)).map(({ ruta }) => ruta)
  const nuevas = entradas.filter(esNueva).map(({ ruta }) => ruta)
  if (rastreadas.length) git(['checkout', '--', ...rastreadas])
  if (nuevas.length) git(['clean', '-q', '-f', '-d', '--', ...nuevas])
  return entradas.length
}

function verboCommit() {
  // LO QUE SE COMITEA ES LO QUE SE APROBÓ, y se comprueba antes que nada.
  //
  // La tercera igualdad (ver el sello en `verboVerdict`): el índice de ahora tiene
  // que ser el MISMO que la maquinaria selló al aceptar el veredicto. Va delante
  // del mensaje y del "no hay nada stageado" porque esas dos preguntan si git
  // PUEDE comitear y ésta pregunta si DEBE: un mensaje mal compuesto se arregla
  // arreglando el plan, y un commit con código no revisado dentro no se arregla
  // nunca, porque ya está en la rama. Y va antes del `git add` de la telemetría
  // por necesidad: ese add cambia el índice.
  //
  // SIN fila de telemetría, como los otros dos fallos de este verbo: el paso
  // `commit` no tiene fila —decisión anterior, fijada por el test "no hay fila de
  // commit": la llevaba dentro del commit siguiente, así que la de la última tarea
  // no viajaba nunca— y estrenar una sólo para el fallo rompería esa propiedad y
  // metería en el JSONL una forma que `run-metrics.js` no agrega. Mudo no se
  // queda: sale por stderr, el exit es 8, y el run se queda parado en `commit`
  // con el sello escrito en el fichero de estado, que es lo que hay que leer para
  // arreglarlo.
  if (typeof run.sealedTree !== 'string') {
    err(`el estado no trae el sello del índice (sealedTree) que el veredicto de esta tarea tenía que dejar: o este run venía de una versión del plugin anterior a esta comprobación —se quedó parado en "commit" mientras se actualizaba—, o alguien editó ${stateFile}. Sin sello no se puede afirmar que lo stageado sea lo que el juez aprobó, y este programa no comitea lo que no puede afirmar. Compruébalo tú y comitea a mano (el veredicto está en docs/superpowers/verdicts/issue-${issue}-task-${run.task}.json), o arranca el run de nuevo: lo que no hay es un modo sin barandilla que se active BORRANDO un campo.`)
    return OUTCOMES.FAILED
  }
  const arbolDeAhora = arbolDelIndice()
  if (arbolDeAhora !== run.sealedTree) {
    err(`el índice ya no es el que el juez aprobó: al aceptar el veredicto quedó sellado el árbol ${run.sealedTree} y el del índice de ahora es ${arbolDeAhora}. Algo lo cambió DESPUÉS del veredicto, así que este commit se llevaría dentro código que ningún juez ha visto, con el veredicto de otro código viajando al lado. NO se comitea nada.
  - para devolver el índice aprobado, tal cual y sin tocar tu worktree:  git read-tree ${run.sealedTree}
    y repite "ct-step commit". Lo que hayas stageado después sigue en los ficheros: no se pierde, deja de estar stageado.
  - si ese código TIENE que entrar, no entra por aquí: desde "commit" no hay vuelta al juez en este run. Sácalo del índice, comitea la tarea aprobada, y que ese trabajo entre por la tarea siguiente o por otro slice.`)
    return OUTCOMES.FAILED
  }
  const t = tarea()
  let mensaje
  try {
    mensaje = commitMessage({ issue, task: run.task, tasksTotal: run.tasksTotal, name: t.name })
  } catch (e) {
    err(String(e.message))
    return OUTCOMES.FAILED
  }
  if (!(git(['diff', '--cached', '--name-only']) || '').trim()) {
    err(`la tarea ${run.task} no dejó nada stageado: no hay nada que commitear`)
    return OUTCOMES.FAILED
  }
  // La telemetría entra AQUÍ, con todas las filas de esta tarea ya escritas —
  // incluidas las de los intentos que el juez vetó, que es el dato que dice lo
  // que costaron las vueltas. El `git reset` que `report` hace al empezar cada
  // intento desstagea, no borra contenido, así que siguen en el fichero.
  //
  // Y NO hay fila de `commit`: era la única que se escribía DESPUÉS del commit,
  // así que viajaba dentro del commit de la tarea siguiente y la de la última no
  // viajaba nunca. Lo que llevaba —el sha y el hecho de que la tarea se
  // comiteó— está entero en `git log`. Sin ella, el fichero que se stagea aquí
  // contiene exactamente las filas de esta tarea y de las anteriores, y no queda
  // ninguna fuera de la pull request.
  // `allowFail`, y no por prudencia genérica: sin él este `git add` es el primer
  // camino por el que la telemetría podría tumbar un run, que es justo lo que el
  // diseño prohíbe ("ninguna transición depende de la medida"). Medido: con
  // `docs/` en el .gitignore del repo, `git add` sale con 1, la excepción sube y
  // la tarea se queda SIN COMITEAR con el run atascado. La medida se pierde y el
  // trabajo se comitea, nunca al revés.
  if (existsSync(join(repoRoot, METRICS_REL)) && git(['add', '--', METRICS_REL], { allowFail: true }) === null) {
    err(`aviso: no se pudo stagear la telemetría (${METRICS_REL}) — la tarea se comitea sin ella. ¿La ruta está gitignoreada en este repo?`)
  }
  if (git(['commit', '-m', mensaje], { allowFail: true }) === null) return OUTCOMES.FAILED
  const sha = headSha()
  // `lastAdvice` se va con la tarea comiteada, como lo demás que la nombraba: el
  // consejo lo dictó un consejero que leyó los dos vetos de ESTA tarea, y
  // heredarlo metería en el brief de la siguiente un enfoque sobre un problema
  // que ya no existe.
  run = { ...run, lastFindings: null, lastPaths: null, lastSummary: null, lastAdvice: null }
  out(`commiteada la tarea ${run.task}/${run.tasksTotal}: ${sha.slice(0, 7)}`)
  return OUTCOMES.DONE
}

// El markdown lo escribe el PROGRAMA, no el agente que atraviesa la slice.
// Mismo reparto que el commit ("comitea el programa, no el implementador"):
// así no hay prosa que validar, no puede faltar un encabezado ni citarse mal
// un recorrido, y lo que llega a la pull request es EXACTAMENTE lo que
// `readE2eReport` aceptó — no una narración aparte que alguien podría
// desalinear del JSON validado.
function escribirInformeE2e(runs) {
  const seccionDe = (r) => {
    const lineas = [`## ${r.run}`, '', `**Veredicto:** ${r.verdict}`]
    if (r.brought_up) lineas.push('', `**Cómo se levantó:** ${r.brought_up}`)
    if (r.verdict === 'verde') {
      lineas.push('', '**Evidencia:**', '')
      for (const e of r.evidence || []) lineas.push(`- \`${e.command}\` → \`${e.output}\``)
    } else if (r.verdict === 'rojo') {
      lineas.push(
        '',
        `**Esperado:** ${r.expected}`,
        `**Real:** ${r.actual}`,
        `**Cómo reproducirlo:** ${r.repro}`,
        `**Por qué no cuenta:** ${r.refuted_by}`,
      )
    } else {
      lineas.push('', `**Motivo:** ${r.reason}`, `**Para desbloquear:** ${r.unblock}`)
    }
    return lineas.join('\n')
  }
  const md = [`# E2E — issue #${issue}`, ...runs.map(seccionDe), ''].join('\n\n')
  const ruta = join('docs', 'superpowers', 'e2e', `${issue}.md`)
  mkdirSync(join(repoRoot, 'docs', 'superpowers', 'e2e'), { recursive: true })
  writeFileSync(join(repoRoot, ruta), md)
  // `allowFail`, mismo motivo que el veredicto y la telemetría: un repo que
  // gitignora `docs/` no puede dejar el run atascado por un `git add` que
  // lanza. El informe queda escrito en el árbol aunque no viaje en el commit;
  // lo que se pierde se avisa, no se calla.
  if (git(['add', '--', ruta], { allowFail: true }) === null) {
    err(`aviso: el informe de e2e se escribió en ${ruta} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?).`)
  }
  return ruta
}

function verboE2e() {
  const { valor, why: porLeer } = leerJson(process.argv[3], 'del informe de e2e')
  const { outcome, runs, why } = porLeer
    ? { outcome: OUTCOMES.DISCARDED, why: porLeer }
    : readE2eReport(valor, run.e2eRuns)
  medir('e2e', {
    outcome,
    runs: runs ? runs.length : 0,
    red: runs ? runs.filter((r) => r.verdict === 'rojo').length : 0,
    unverified: runs ? runs.filter((r) => r.verdict === 'no-verificado').length : 0,
    why: why || null,
  })
  if (outcome === OUTCOMES.DISCARDED) {
    out(`informe de e2e descartado: ${why}`)
    return outcome
  }
  escribirInformeE2e(runs)
  // El veredicto de cada recorrido se PERSISTE en el run. Hasta la review
  // final de rama, `run-<issue>.json` guardaba sólo los NOMBRES (`e2eRuns`,
  // los sembrados), así que la puerta 8 de `dispatch-check --release` no podía
  // distinguir un slice verde de otro cuyos recorridos fueron todos
  // "no-verificado" — y tres textos (este fichero, gates.js#GATES.e2e.issue y
  // el §3.7 del diseño) prometían que --release "lo dice". *No-verificado* es
  // el estado que libera un slice SIN haberlo verificado: que sea silencioso
  // en la puerta es lo contrario de la doctrina de esta rama, "un límite dicho
  // es operable".
  //
  // La forma es la mínima que sostiene ese aviso: recorrido -> veredicto, más
  // el `reason` cuando lo hay (sólo el *no-verificado* lo lleva). Ni la
  // evidencia ni los cuatro campos del rojo: eso ya está entero en
  // `docs/superpowers/e2e/<issue>.md`, que sí viaja en la pull request.
  // `deliveredRun` no se entera de nada: lee `issue` y `closed`, y un campo
  // más en el JSON no le cambia ninguna respuesta.
  run = {
    ...run,
    // `reason` sólo cuando lo hay: `readE2eReport` ya ha exigido que sea texto
    // no vacío en el único veredicto que lo lleva (*no-verificado*), así que
    // aquí basta con mirar si está.
    e2eResults: runs.map((r) => (r.reason ? { run: r.run, verdict: r.verdict, reason: r.reason } : { run: r.run, verdict: r.verdict })),
  }
  for (const r of runs) out(`${r.verdict}: ${r.run}`)
  return outcome
}

// Comitea el informe de e2e que `escribirInformeE2e` dejó STAGEADO. No se hace
// desde allí: comitear pertenece al momento en que se sabe si el run CIERRA,
// no a cuando el fichero se escribe, y eso sólo se sabe después de aplicar la
// transición. Por eso quien llama a esto es el despacho final, no `verboE2e`.
//
// SÓLO en DELIVERED (verde, o verde con algún no-verificado): en BLOCKED_E2E
// (rojo) el run NO cierra, así que `.agent/run-<issue>.json` se vuelve a
// cargar en el próximo intento — y ahí la invariante de commits compara
// `hechos` contra `esperados` (`tasksTotal` en el paso `e2e`, ver la rama de
// arriba). Un commit de más aquí haría `hechos > esperados` y tumbaría ESE
// intento con PRECONDITION antes de que nadie llegara a arreglar el rojo. En
// DELIVERED el run no se vuelve a cargar nunca (el guard `closed ===
// DELIVERED` de la carga del estado contesta y sale ANTES del cruce de
// commits), así que comitear ahí no rompe ninguna cuenta futura. El informe
// del camino rojo se queda stageado a propósito: es la prueba de que está
// esperando a quien arregle el fallo.
function comprometerInformeE2e() {
  const ruta = join('docs', 'superpowers', 'e2e', `${issue}.md`)
  // No cierra el issue: es el informe de la travesía, no el trabajo que la
  // cierra, así que el mensaje no lleva ninguna closing keyword — y se
  // comprueba, con el mismo mecanismo que `commitMessage` (step-contracts.js),
  // porque el hook `commit-keyword-guard` es un PreToolUse sobre la Bash de
  // una SESIÓN: un `git commit` lanzado por este programa no pasa por esa
  // puerta, así que si el programa no se mira el mensaje, nadie lo hace.
  // Sin prefijo de conventional commits ("docs:", "feat:"): ésa es la
  // convención de los commits HUMANOS de este propio repo (ver `git log`),
  // no la de los que emite el programa dentro de una slice — `commitMessage`
  // (step-contracts.js), que comitea cada tarea, tampoco lo usa. Mismo estilo
  // que aquél: título descriptivo + cuerpo con el porqué + coautoría.
  const mensaje = `informe de e2e del issue #${issue}

Generado por ct-step tras el paso e2e de la slice. No cierra el issue.

${CtStepCommit.TRAILER_LINE}
Co-Authored-By: Claude <noreply@anthropic.com>`
  // El MISMO cuidado que en el veredicto del slice y por el mismo motivo: este
  // `git commit` tampoco lleva pathspec. Medido igual (`git add colado.txt` antes
  // de `ct-step e2e` y el fichero acabó dentro del commit del informe). Va antes
  // de la guarda de las closing keywords porque primero se decide QUÉ entra en el
  // repo y después cómo se rotula.
  const ajeno = ajenoEnElIndice([ruta])
  if (ajeno.length) {
    err(`aviso: el índice traía ${ajeno.length} ruta(s) ajenas a la maquinaria (${ajeno.join(', ')}) y este commit se las llevaría dentro sin que ningún juez las haya visto — el informe de e2e (${ruta}) queda STAGEADO y sin comitear. Saca lo ajeno del índice ("git restore --staged ${ajeno[0]}", que no toca tu worktree) y comitéalo a mano antes de abrir la pull request.`)
    return
  }
  const keywords = findClosingKeywords(mensaje)
  if (keywords.length) {
    err(`aviso: el mensaje del commit del informe de e2e contiene una closing keyword (${keywords.map((k) => `${k.keyword} ${k.ref}`).join(', ')}) y cerraría el issue sin que nadie lo haya decidido — NO se comitea. El informe (${ruta}) queda stageado.`)
    return
  }
  // `allowFail`, mismo criterio que el resto de commits de artefactos de este
  // programa (veredicto, telemetría): no comitear no puede tumbar un run ya
  // ENTREGADO, así que se avisa y el fichero se queda stageado en vez de
  // perderse.
  if (git(['commit', '-m', mensaje], { allowFail: true }) === null) {
    err(`aviso: el informe de e2e (${ruta}) quedó stageado pero NO se pudo comitear — revísalo a mano antes de abrir la pull request.`)
    return
  }
  out(`informe de e2e comiteado: ${ruta}`)
}

// ---------------------------------------------------------------------------
// Aplicar el resultado a la tabla, y decir qué toca ahora.
// ---------------------------------------------------------------------------
try {
  if (verbo === 'next') verboNext()

  exigirPaso(verbo)
  const outcome = {
    report: verboReport, controls: verboControls, verdict: verboVerdict, advice: verboAdvice, commit: verboCommit,
    reconcile: verboReconcile, global: verboGlobal, 'slice-verdict': verboSliceVerdict, e2e: verboE2e,
  }[verbo]()

  if (run.discards >= MAX_DISCARDS && outcome === OUTCOMES.DISCARDED) {
    guardar()
    die(`${run.discards} descartes en este run: se para en vez de seguir pidiendo respuestas que no se pueden leer`, EXIT.NO_VERDICT)
  }

  const antes = run.step
  const transicion = after(run, outcome, DEFAULT_BUDGETS)
  run = transicion.run
  // El cierre bueno se PERSISTE: "entregado" tiene que poder leerse del
  // fichero sin reconstruir la tabla, porque `dispatch-check --release` lo
  // exige antes de liberar. Un prompt no es un gate; esto es la mitad
  // ct-step del gate.
  if (transicion.state === RUN_STATES.DELIVERED) run = { ...run, closed: RUN_STATES.DELIVERED }
  guardar()

  // El informe de e2e se comitea AQUÍ, tras persistir el estado y sólo si el
  // verbo que se acaba de aplicar fue `e2e` y la transición cerró el run en
  // DELIVERED — ver el comentario de `comprometerInformeE2e` para el porqué
  // de esa condición exacta (y de por qué el camino rojo NO comitea nada).
  if (verbo === 'e2e' && transicion.state === RUN_STATES.DELIVERED) {
    comprometerInformeE2e()
  }

  if (transicion.state === RUN_STATES.OPEN) {
    out('')
    out(`siguiente: tarea ${run.task}/${run.tasksTotal}, paso ${run.step} — pregunta con "ct-step next"`)
    process.exit(EXIT.OK)
  }

  out('')
  out(`run ${transicion.state}: tarea ${run.task}/${run.tasksTotal}, ${run.discards} descarte(s)`)
  process.exit(codigoDe(transicion.state, antes, outcome))
} catch (e) {
  guardar()
  err(`excepción no prevista: ${e.stack || e.message}`)
  process.exit(EXIT.UNNAMED)
}

function codigoDe(estado, paso, outcome) {
  switch (estado) {
    case RUN_STATES.DELIVERED:
      out('las tareas comiteadas, la Global verification en verde y el slice con veredicto PASS: la rama está lista para la pull request.')
      return EXIT.OK
    case RUN_STATES.BLOCKED_COMMIT: return EXIT.PRECONDITION
    // Fase B: el reconciliador y, agotado su presupuesto, el agente del slice
    // no dejaron la base al día. Código propio, como GLOBAL_RED: lo que sigue
    // no es "corrige la tarea", es resolver el conflicto antes de nada.
    case RUN_STATES.BLOCKED_RECONCILE: return EXIT.RECONCILE_BLOCKED
    case RUN_STATES.BLOCKED_CONTROLS:
      return outcome === OUTCOMES.INDETERMINATE ? EXIT.CONTROLS_UNMEASURED : EXIT.CONTROLS_RED
    case RUN_STATES.BLOCKED_JUDGE:
      // El veto del juez y "no hubo veredicto" cierran por el mismo sitio y
      // significan cosas distintas: uno es un juicio y el otro su ausencia.
      return outcome === OUTCOMES.DISCARDED ? EXIT.NO_VERDICT : EXIT.VETOED
    // §3.7-A: el mismo par que controls (rojo / inmedible), con códigos
    // propios porque la acción siguiente es otra — no hay tarea que corregir,
    // hay una pull request que NO se abre.
    case RUN_STATES.BLOCKED_GLOBAL:
      return outcome === OUTCOMES.INDETERMINATE ? EXIT.GLOBAL_UNMEASURED : EXIT.GLOBAL_RED
    // §3.7-B: el veto del juez de slice es un veto, el mismo código que el del
    // juez de tarea — el descarte nunca cierra por aquí (vuelve a preguntar).
    case RUN_STATES.BLOCKED_SLICE_JUDGE: return EXIT.VETOED
    case RUN_STATES.BLOCKED_E2E: return EXIT.E2E_RED
    case RUN_STATES.ABORTED_BUDGET: return EXIT.UNNAMED // aquí nadie mide dinero
    default: return EXIT.UNNAMED
  }
}
