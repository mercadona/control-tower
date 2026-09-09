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
import { CONVENTIONS_FILE, yardstickSection } from './repo-yardstick.js'
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
import { metricRow, metricLine, metricsPath, planSha256, verdictMeasures, metricsRepoRelPath, briefCtYardstickMeasures } from './run-metrics.js'
import { RoleBytes } from './role-bytes.js'
// Slice 10: parseStateSafe reads the `senal:` field of the SLICE.md (see
// sliceSignal, below, for why the `epic:` regex will not do), and
// SIGNAL_ABSENT is the ONE constant with which the two writers of the channel
// (buildStateSeed when seeding, this module when packaging the fallback)
// declare that there is no signal — imported, not copied, so that they cannot
// diverge.
import { parseStateSafe } from './state.js'
import { SIGNAL_ABSENT } from './kickoff.js'
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

const USAGE = `usage: ct-step <verbo> [args] --plan <fichero> --issue <n>

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
// (`measure`), and when the same concept was written twice the second copy fell
// behind when `e2e` arrived — with the result that every e2e row was attributed
// to the last task of the plan.
const SLICE_STEPS = [STEPS.RECONCILE, STEPS.GLOBAL, STEPS.SLICE_JUDGE, STEPS.E2E]

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
//   git rev-list --count --no-merges run.baseSha..HEAD ^origin/<base-branch>
//
// `run.baseSha..HEAD` leaves out everything before the run —the plan's commit
// included—, `^origin/<base-branch>` leaves out what an advanced base brought in
// through a merge (every foreign commit counted as if it belonged to a task),
// and `--no-merges` leaves out the merge commit itself.
//
// The branch name comes out of `.agent/SLICE.md` with `parseStateSafe` — the
// same parser this file already uses for `epic:` and `senal:` (see below) — and
// NOT with a regex of its own: `dispatch-check.mjs` does have its own for this
// same field (`seedBaseField`), debt older than this task and outside
// its scope. Which remote branch it is when the seed does not name it is
// decided by `BaseBranch` (scripts/slice-base.js), the same resolver
// `dispatch-check.mjs` consumes: that fallback chain used to be written twice
// and already answered differently in each file.
//
// With no resolvable base branch, or with an `origin/<branch>` that does not
// exist in this worktree, the measurement is made without the exclusion: the
// worst case is counting the way it was counted until today, never "not
// counting".
const remoteRefResolves = (name) =>
  git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${name}`], { allowFail: true }) !== null

// The resolution itself —which branch is "the base"— lives in one single
// function, and not one per consumer: `reconcile` (Task 8) needs the NAME to
// pass it to `BranchReconciliation.merge({ baseBranch })`, and this exclusion
// needs the name to build the `git rev-list` filter. It is the same question
// asked twice for two different reasons, and the reviewer of the previous phase
// warned in writing that a second copy here would be "the third divergent copy"
// of this same decision.
function resolveBaseBranch() {
  const { meta } = parseStateSafe(readFileSync(join(repoRoot, SLICE_REL_PATH), 'utf8'))
  return new BaseBranch({ remoteRefExists: remoteRefResolves }).resolve({ declared: meta.base })
}

function baseExclusion() {
  const branch = resolveBaseBranch()
  if (!branch || !remoteRefResolves(branch)) return null
  return `^origin/${branch}`
}

const runCommits = (since, exclusion) => {
  const argv = ['rev-list', '--count', '--no-merges', `${since}..HEAD`]
  if (exclusion) argv.push(exclusion)
  const output = git(argv, { allowFail: true })
  return output === null ? null : Number(output.trim())
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
  const exclusion = baseExclusion()
  const range = [`${run.baseSha}..HEAD`, exclusion].filter(Boolean).join(' ')
  const shortRange = [`${run.baseSha.slice(0, 7)}..HEAD`, exclusion].filter(Boolean).join(' ')
  const actual = runCommits(run.baseSha, exclusion)
  if (actual === null) {
    die(`git no pudo contar los commits del run: no resuelve \`${range}\` en este worktree. Borra ${stateFile} si el run es de otra rama.`, EXIT.PRECONDITION)
  }
  // At `global`/`slice-judge`/`e2e` the `tasksTotal` tasks are ALREADY
  // committed — `run.task` stays on the last one and not on `tasksTotal + 1`,
  // so the count that applies is not `run.task - 1` but `tasksTotal` whole
  // commits. They are steps of the SLICE, not of a task. Without this branch,
  // every verb of those phases (a new process, with no state in memory) dies
  // here at PRECONDITION before it gets to run anything.
  //
  // And `tasksTotal` on its own is NOT enough: the slice steps commit too. The
  // slice verdict opens a commit of its own on approval (`sliceVerdictVerb`),
  // so on reaching `e2e` —a new process, the file read again— there are
  // `tasksTotal + 1` commits since `baseSha` and the fixed count brought down
  // EVERY verb with PRECONDITION: no slice with journeys could close, the run
  // never reached DELIVERED and `dispatch-check --release` rejected it with the
  // 7 for ever. This file already had that very reasoning written down for the
  // NEXT commit (see `commitE2eReport`, which is why it only commits at
  // DELIVERED); nobody applied it to the one placed in front of it. That is why
  // the slice commits are COUNTED in the state (`sliceCommits`) instead of being
  // taken for zero: `|| 0` covers the runs written before the field existed.
  const expected = SLICE_STEPS.includes(run.step)
    ? run.tasksTotal + (run.sliceCommits || 0)
    : run.task - 1
  if (actual !== expected) {
    die(`el estado y git no cuentan lo mismo: el fichero espera ${expected} commit(s) (tarea ${run.task}, paso ${run.step}) y en \`${shortRange}\` (sin fusiones) hay ${actual}. No se sigue a ciegas.`, EXIT.PRECONDITION)
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

const save = () => writeFileSync(stateFile, JSON.stringify(run, null, 2) + '\n')
const currentTask = () => tasks.find((t) => t.n === run.task)

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
// `declaredScope` would see it as a path the plan does not declare and would
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
const sliceEpic = (() => {
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
// absence with SIGNAL_ABSENT.
const sliceSignal = (() => {
  const { meta } = parseStateSafe(readFileSync(join(repoRoot, '.agent', 'SLICE.md'), 'utf8'))
  return typeof meta.senal === 'string' && meta.senal.trim() ? meta.senal.trim() : null
})()
const currentAttempt = () => StepSeal.attemptOf(run)
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

function measure(step, measures) {
  // `global`, `slice-judge` and `e2e` belong to no task: a `task: 3` on that row
  // would be a gap read as an assertion (the same doctrine that already forbids
  // filling in with `null` disguised as zero throughout the rest of this file).
  // In those steps `run.task` stays nailed to the last task, so attributing the
  // cost to it would be a false assertion, not one datum too many.
  const isSliceStep = SLICE_STEPS.includes(step)
  const line = metricLine(metricRow({
    repo: repoSlug, epic: sliceEpic, issue, plan: planPath, plan_sha256: PLAN_SHA,
    task: isSliceStep ? null : run.task, task_name: isSliceStep ? null : (currentTask()?.name ?? null), tasks_total: run.tasksTotal,
    step, attempt: currentAttempt(), plugin_version: PLUGIN_VERSION, actor: ACTOR,
  }, measures, { now: new Date().toISOString() }))
  // The two destinations are attempted separately: the account's disk being
  // full cannot cost the repo the row that travels, nor the other way round.
  for (const destination of [metricsPath('ct-step', { configDir: process.env.CLAUDE_CONFIG_DIR }), join(repoRoot, METRICS_REL)]) {
    try {
      mkdirSync(dirname(destination), { recursive: true })
      appendFileSync(destination, line)
    } catch (e) {
      err(`warning: no se pudo escribir la telemetría en ${destination} (${String(e.message).trim()}). Esto sigue: ninguna transición depende de la medida.`)
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
const VERB_OF = {
  report: STEPS.IMPLEMENT, controls: STEPS.CONTROLS, verdict: STEPS.JUDGE, advice: STEPS.ADVISE, commit: STEPS.COMMIT,
  reconcile: STEPS.RECONCILE, global: STEPS.GLOBAL, 'slice-verdict': STEPS.SLICE_JUDGE, e2e: STEPS.E2E,
}
function requireStep(v) {
  if (run.step !== VERB_OF[v]) {
    die(`"${v}" no es el paso que toca: el run está en "${run.step}" (tarea ${run.task}/${run.tasksTotal}). Pregunta con "ct-step next".`, EXIT.WRONG_STEP)
  }
}

// ---------------------------------------------------------------------------
// next — it does not transition: it reports, and prepares what the step needs.
// ---------------------------------------------------------------------------
function nextVerb() {
  const t = currentTask()
  // §3.7: `global` and `slice-judge` run AFTER the last task — there is no
  // "task N/M" to announce, but the whole slice with its tasks already
  // committed.
  if (run.step === STEPS.RECONCILE || run.step === STEPS.GLOBAL || run.step === STEPS.SLICE_JUDGE) {
    out(`slice del issue ${issue} — las ${run.tasksTotal} tareas comiteadas`)
  } else {
    out(`tarea ${run.task}/${run.tasksTotal} — ${t.name}`)
  }
  out(`paso: ${run.step} (intento ${currentAttempt()})`)
  out('')
  switch (run.step) {
    case STEPS.IMPLEMENT: {
      const brief = writeBrief()
      const reportPath = join(workDir, `task-${run.task}-report.json`)
      // The list comes out of the constant and is not typed again: the hand copy
      // of the judge's already diverged once, and `ct-step next` ended up
      // announcing tools that were not those of the agent being dispatched.
      out(`DESPACHA UN IMPLEMENTADOR (subagente con modelo ${IMPLEMENTER_MODEL} — herramientas: ${IMPLEMENTER_TOOLS}) con:`)
      out(`  - la rúbrica de ${join(PLUGIN_ROOT, 'prompts', 'task-implementer.md')}`)
      out(`  - el brief de la tarea: ${brief}`)
      out(`  - que escriba su informe en: ${reportPath}`)
      if (run.lastFindings) {
        out('')
        out('El juez devolvió esta tarea. Lo que hay que arreglar:')
        out(run.lastFindings)
      }
      out('')
      out(`Cuando vuelva:  ct-step report ${reportPath} --plan ${planPath} --issue ${issue}`)
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
      const packagePath = writeReviewPackage()
      const verdictPath = join(workDir, `task-${run.task}-verdict.json`)
      out(`DESPACHA EL JUEZ (subagente ct-judge — declarado SIN Bash: ${JUDGE_TOOLS}) con:`)
      out(`  - el paquete de revisión: ${packagePath}`)
      out(`  - el brief de la tarea: ${join(workDir, `task-${run.task}-brief.md`)}`)
      out(`  - los logs de los controles, YA en verde, por si los quiere: ${run.lastControlsLog ?? '(ninguno)'}`)
      out(`  - que escriba su veredicto en: ${verdictPath}`)
      // The `review_token` is NOT asked of it: this program writes it when it
      // reads the verdict, with the value it computed itself. Asking the judge
      // for it meant asking it to copy 64 hex characters from a line the program
      // had just written, and one copying slip cost a whole opus verdict.
      out('')
      out(`Cuando vuelva:  ct-step verdict ${verdictPath} --plan ${planPath} --issue ${issue}`)
      out('No le pases la SALIDA de los controles: un lint sucio no debe ensuciarle el criterio.')
      break
    }
    // H9: the SECOND veto. Between it and the third attempt there does not go
    // another implementer reading the same verdict, there goes an adviser of a
    // higher tier that sees BOTH attempts and BOTH vetoes at once — which is the
    // one thing neither of the two implementers could see.
    case STEPS.ADVISE: {
      const packagePath = writeAdviceReviewPackage()
      const advicePath = join(workDir, `task-${run.task}-advice.json`)
      out(`DESPACHA EL CONSEJERO (subagente ct-advisor — declarado sólo con ${ADVISOR_TOOLS}) con:`)
      out(`  - el paquete del consejero: ${packagePath}`)
      out(`  - que escriba su consejo en: ${advicePath}`)
      out('')
      out('El juez ha vetado dos veces esta tarea. Al aceptar el consejo, el programa devuelve el árbol al último commit para las rutas de la tarea y el brief del tercer intento lleva dentro el enfoque que dicte el consejero: NO despaches un implementador ahora.')
      out(`Cuando vuelva:  ct-step advice ${advicePath} --plan ${planPath} --issue ${issue}`)
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
      const packagePath = writeSliceReviewPackage()
      const verdictPath = join(workDir, 'slice-verdict.json')
      out(`DESPACHA EL JUEZ DE SLICE (subagente ct-slice-judge — declarado SIN Bash: ${SLICE_JUDGE_TOOLS}) con:`)
      out(`  - el paquete de revisión del slice: ${packagePath}`)
      out(`  - el plan: ${planPath}`)
      out(`  - el log de la Global verification, YA en verde, por si lo quiere: ${run.lastGlobalLog ?? '(N/A declarado)'}`)
      out(`  - los veredictos de cada tarea, ya comiteados: docs/superpowers/verdicts/issue-${issue}-task-*.json`)
      out(`  - que escriba su veredicto en: ${verdictPath}`)
        out('')
      out(`Cuando vuelva:  ct-step slice-verdict ${verdictPath} --plan ${planPath} --issue ${issue}`)
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
      for (const [verdict, fields] of Object.entries(E2E_SCHEMA.properties.runs.items.requiredByVerdict)) {
        out(`  - ${verdict}: ${fields.join(', ')}`)
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
  // discard, `consumePackage` does not run and that attempt's artefact is still
  // on disk, so forcing another pass through here would be asking for what is
  // already there to be regenerated. The three self-loops of `discarded` are
  // those of run-machine.js.
  if (StepSeal.inputWrittenFor(run.step) !== null) {
    run = { ...run, nextSeal: StepSeal.of(run) }
    save()
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
// Branch reconciliation, Task 9: it is shared by `writeBrief` (the brief of
// the implementer and of the judge) and `writeReconcileReviewPackage` (the
// reconciler's package) — one single read and one single abort message, instead
// of two copies which it already warned diverge (see JUDGE_TOOLS in
// step-contracts.js).
function loadCtYardstick() {
  const ctDocs = PluginYardstick.FILES.map((name) => {
    const path = join(PLUGIN_ROOT, PluginYardstick.DIRECTORY, name)
    try {
      return { name, path, content: readFileSync(path, 'utf8') }
    } catch {
      return { name, path, content: null }
    }
  })
  const missing = PluginYardstick.missingDocuments(ctDocs)
  if (missing.length) {
    die(`la vara de ct no se puede leer: falta o está vacío ${missing.join(', ')} en ${join(PLUGIN_ROOT, PluginYardstick.DIRECTORY)}. Es una instalación del plugin incompleta, no una propiedad de este repo: sin esos documentos quien implementa, juzga o reconcilia mide contra nada, y eso no se distingue en silencio de un diff conforme. Reinstala el plugin.`, EXIT.PRECONDITION)
  }
  return ctDocs
}

// §3.3: the repo's yardstick crosses the funnel HERE, read straight off disk
// and with no agent in between. Its absence does not warn: it is the normal
// state of almost every repo today, and the judge measures it as `sin-vara`,
// not as an error. `artifactName` only enters the read-failure warning,
// so that the same message serves the brief and the reconciliation package
// without lying about which of the two came up short.
function repoYardstickSection(artifactName) {
  try {
    const path = join(repoRoot, CONVENTIONS_FILE)
    if (!existsSync(path)) return ''
    return yardstickSection(readFileSync(path, 'utf8'))
  } catch (e) {
    err(`warning: ${CONVENTIONS_FILE} existe y no se ha podido leer (${String(e.message).trim()}): ${artifactName} sale sin la vara del repo.`)
    return ''
  }
}

function writeBrief() {
  const brief = join(workDir, `task-${run.task}-brief.md`)
  // It is checked before calling `task-brief` so as not to leave a brief on
  // disk that nobody is going to use.
  const ctDocs = loadCtYardstick()
  try {
    execFileSync(join(PLUGIN_ROOT, 'skills', 'subagent-driven-development', 'scripts', 'task-brief'),
      ['--with-plan-context', planPath, String(run.task), brief], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    die(`no se pudo extraer el brief de la tarea ${run.task}: ${String(e.stderr || e.message).trim()}`, EXIT.PRECONDITION)
  }
  appendFileSync(brief, PluginYardstick.composeSection(ctDocs))
  appendFileSync(brief, repoYardstickSection('el brief'))
  // H9: the advice for the third attempt, inside the brief and not on a loose
  // line of `next`. The brief is what the subagent receives —the dispatch
  // message says so itself—, so an approach announced outside it is an approach
  // that depends on the session copying it. It goes AT THE END, after the
  // yardstick: it is the last thing decided about this task.
  if (run.lastAdvice) appendFileSync(brief, adviceSection(run.lastAdvice))
  return brief
}

// The advice, in the language of the brief (the rest is written by `task-brief`
// out of a plan in English). The paths are listed even when the approach
// already names them: it is what makes the paragraph actionable without
// re-reading it.
function adviceSection(advice) {
  const paths = advice.files_to_reconsider.length
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
    paths,
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
// `writeSliceReviewPackage`).
const taskDiff = () => git(['diff', '--cached', '-U10']) || ''
const sliceDiff = () => git(['diff', '-U10', run.baseSha, 'HEAD']) || ''

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
const indexTree = () => git(['write-tree']).trim()

// The package comes out of the INDEX and not out of a range of commits: the
// implementer does not commit, so what has to be judged is not a commit yet.
function writeReviewPackage() {
  const packagePath = join(workDir, `task-${run.task}-review.diff`)
  // This section used to carry, alongside each path, whether it was production
  // or test code (the `kind` the implementer's report declared). It was removed:
  // the judge has the diff in front of it and tells a test from a production
  // file apart without anyone saying so, so the label brought it nothing it
  // could not see for itself. On top of that it was produced by the very agent
  // being judged, nobody verified it, and when it came out wrong it did not
  // degrade the judgement: it disabled it. Do not add it back.
  const paths = (run.lastPaths || []).map((p) => `- ${p}`).join('\n') || '(ninguna)'
  // The first heading of PACKAGE_SECTIONS is written by `composePathSection`
  // (it is `PluginYardstick.PATH_SECTION`), so it is not typed here: what gets
  // destructured are the three this verb writes.
  const [, FILES_SECTION, PATHS_SECTION, DIFF_SECTION] = PACKAGE_SECTIONS
  const diff = taskDiff()
  // THE CT YARDSTICK, BY PATH and with the same scope as the brief: the judge
  // has `Read` (JUDGE_TOOLS), and what it needs in order to cite a rule is to
  // know which documents reach this task and where they are. The section goes
  // AHEAD of the diff for the same reason as `Señal` in the slice package:
  // behind a `-U10` it would be buried.
  const ctYardstick = PluginYardstick.composePathSection(loadCtYardstick())
  writeFileSync(packagePath, [
    `# Review package: task ${run.task}/${run.tasksTotal} of issue #${issue} (staged, not yet committed)`,
    // The HEADER carries the token: the sha256 of exactly the diff that goes
    // below. A second line and not a `##` section, so as not to touch
    // PACKAGE_SECTIONS (which the rubric cites heading by heading) nor the order
    // slice 10 decided on for the slice package.
    reviewTokenLine(reviewToken(diff)),
    ctYardstick,
    '', `## ${FILES_SECTION}`, git(['diff', '--cached', '--stat']) || '',
    '', `## ${PATHS_SECTION}`, paths,
    '', `## ${DIFF_SECTION}`, diff,
  ].join('\n'))
  return packagePath
}

// The package of the WHOLE SLICE comes out of a RANGE OF COMMITS and not out of
// the index: unlike a task, here everything is already committed — there is
// nothing staged to judge, and the "index" of the last committed task is empty.
// `## Commits` is the piece the per-task package neither has nor needs (a task
// is ONE commit with no history of its own to show): the sequence matters for
// judging `coherencia` — a later task undoing the earlier one is only visible in
// the order of the commits, not in the accumulated diff on its own.
function writeSliceReviewPackage() {
  const packagePath = join(workDir, 'slice-review.diff')
  const [YARDSTICK_SECTION, SIGNAL_SECTION, COMMITS_SECTION, FILES_SECTION, DIFF_SECTION] = SLICE_PACKAGE_SECTIONS
  const diff = sliceDiff()
  // Task 8: the slice judge measures end state, coherence and signal — not code
  // rule by rule —, so the whole yardstick is not pasted onto it: it is given
  // ONE single path, that of `simplicity.md`, which is exactly the rule its
  // `observabilidad` item measures (a trace names its reader). The FIRST
  // section, ahead even of `Señal`, for the same reason `Señal` goes ahead of
  // the diff: behind a `-U10` it would be buried.
  const simplicityPath = join(PLUGIN_ROOT, PluginYardstick.DIRECTORY, 'simplicity.md')
  // Slice 10: the signal crosses the funnel HERE, read off disk (the `senal:`
  // field the dispatch seeded into the SLICE.md) and with no agent in between —
  // the same doctrine of §3.3 by which the repo's yardstick travels in the
  // brief. The SIGNAL_ABSENT fallback covers a SLICE.md seeded by a plugin older
  // than the column: the absence is declared, not omitted, and its text is
  // exactly what the rubric reads as sin-vara.
  writeFileSync(packagePath, [
    `# Slice review package: issue #${issue} — ${run.tasksTotal} tasks committed since ${run.baseSha.slice(0, 7)}`,
    reviewTokenLine(reviewToken(diff)),
    '', `## ${YARDSTICK_SECTION}`, `Ábrela con \`Read\`: \`${simplicityPath}\``,
    '', `## ${SIGNAL_SECTION}`, sliceSignal ?? SIGNAL_ABSENT,
    '', `## ${COMMITS_SECTION}`, git(['log', '--reverse', '--format=%h %s', `${run.baseSha}..HEAD`]) || '',
    '', `## ${FILES_SECTION}`, git(['diff', '--stat', run.baseSha, 'HEAD']) || '',
    '', `## ${DIFF_SECTION}`, diff,
  ].join('\n'))
  return packagePath
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
function writeAdviceReviewPackage() {
  const packagePath = join(workDir, `task-${run.task}-advice.md`)
  const [BRIEF_SECTION, ATTEMPTS_SECTION, VERDICTS_SECTION] = ADVICE_PACKAGE_SECTIONS
  writeFileSync(packagePath, [
    `# Advice package: task ${run.task}/${run.tasksTotal} of issue #${issue} — vetoed twice, one attempt left`,
    '', `## ${BRIEF_SECTION}`, readOrAbsent(briefPath(), 'el brief de la tarea'),
    '', `## ${ATTEMPTS_SECTION}`, sectionsByAttempt('report', 'el informe del implementador'),
    '', `## ${VERDICTS_SECTION}`, sectionsByAttempt('verdict', 'el veredicto del juez'),
  ].join('\n'))
  return packagePath
}

const readOrAbsent = (path, what) => {
  try {
    return readFileSync(path, 'utf8')
  } catch (e) {
    return `(no se pudo leer ${what} en ${path}: ${String(e.message).trim()})`
  }
}

// The artefacts this run archived per attempt, from the first to the last. The
// numbering comes out of the name itself and not out of `currentAttempt()`: the vetoed
// attempts are not necessarily 1 and 2 —a red from the checks or a correction
// shifts them— so what is there gets read, in the order it was written. The same
// criterion as `reconcilePackages`, and for the same reason: one list and
// not two walks of the directory with the same expression.
const ARCHIVED_ATTEMPT_RE = /-(\d+)\.json$/
function taskArchives(kind) {
  const prefix = `task-${run.task}-${kind}-`
  try {
    return readdirSync(workDir)
      .filter((f) => f.startsWith(prefix) && ARCHIVED_ATTEMPT_RE.test(f))
      .sort((a, b) => Number(ARCHIVED_ATTEMPT_RE.exec(a)[1]) - Number(ARCHIVED_ATTEMPT_RE.exec(b)[1]))
  } catch {
    return []
  }
}

function sectionsByAttempt(kind, what) {
  const files = taskArchives(kind)
  if (!files.length) return `(este run no archivó ningún ${what} de esta tarea)`
  return files.map((f) => [
    `### Intento ${ARCHIVED_ATTEMPT_RE.exec(f)[1]}`,
    '',
    readOrAbsent(join(workDir, f), what),
  ].join('\n')).join('\n\n')
}

// WHAT EACH ATTEMPT LEFT WRITTEN, archived by the program and not by whoever
// dispatches. The paths `next` dictates to the implementer and to the judge are
// the SAME on every attempt (`task-<N>-report.json`), so attempt 2 overwrites 1
// and by the time the adviser is needed there is no trace left of the first. What
// gets archived is what the verb ACCEPTED —not the file that arrived through
// argv— because it is the only thing this program answers for.
function archive(kind, content) {
  try {
    writeFileSync(join(workDir, `task-${run.task}-${kind}-${currentAttempt()}.json`), JSON.stringify(content, null, 2) + '\n')
  } catch (e) {
    err(`warning: no se pudo archivar ${kind} del intento ${currentAttempt()} (${String(e.message).trim()}): si esta tarea llega al consejero, su paquete lo dirá.`)
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
// decoupling this file already paid for with the SLICE_STEPS list.
// ---------------------------------------------------------------------------
function currentToken(packagePath, diffNow) {
  let text
  try {
    text = readFileSync(packagePath, 'utf8')
  } catch (e) {
    return { why: `el paquete de revisión existe y no se puede leer (${packagePath}): ${String(e.message).trim()} — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al juez` }
  }
  const declared = reviewTokenOf(text)
  if (declared === null) {
    // A package without the line: it was written by a version of the plugin
    // older than this field (a run in flight when the plugin was updated), or
    // somebody edited it. A discard cures it in one round —`next` regenerates it
    // with its token— and there is no way back to the package with no token:
    // tolerating it would be a «no guardrail» mode that is switched on by
    // DELETING a line, which is exactly what this fix takes out of the
    // repertoire.
    return { why: `el paquete de revisión (${packagePath}) no declara su "${REVIEW_TOKEN_LABEL}": lo escribió una versión anterior del plugin, o se editó a mano. Vuelve a "ct-step next", que lo regenera con su token, y REDESPACHA al juez` }
  }
  const now = reviewToken(diffNow)
  if (declared !== now) {
    return { why: `el paquete de revisión ya no describe el código de ahora: declara el token ${declared.slice(0, 12)}… y el del corte recién medido es ${now.slice(0, 12)}… — el código cambió DESPUÉS de generarse el paquete, así que el juez juzgó otro diff. Vuelve a "ct-step next" y REDESPACHA al juez: repreguntarle con este paquete no arregla nada` }
  }
  return { token: declared }
}

// The verdict carries the token OF THIS package. `verdict.review_token` already
// arrives validated in shape and in lower case by `readVerdict`, so all that
// happens here is the comparison.
function whyForeignToken(fromVerdict, fromPackage) {
  return `el veredicto no es de este paquete: copia el token ${String(fromVerdict).slice(0, 12)}… y el paquete declara ${fromPackage.slice(0, 12)}… — es el veredicto de OTRO juicio, sobre un diff que ya no es el que hay delante. No hace falta volver a "ct-step next" (el paquete de disco es el bueno): REDESPACHA al juez con él`
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
// token it is checkable at the moment of use: if the cut changed, `currentToken`
// discards it before reading the verdict. Keeping the package after a discard
// stops being a gap —what survives is an input that VERIFIES ITSELF— and it
// still buys what it bought: asking the judge again over an unreadable JSON
// without forcing anything to be regenerated.
function consumePackage(packagePath) {
  try {
    unlinkSync(packagePath)
  } catch (e) {
    err(`warning: el veredicto se midió pero NO se pudo consumir el paquete de revisión (${packagePath}): ${String(e.message).trim()}. El paso sigue, pero ese fichero ya no corresponde a ningún juicio pendiente: vuelve a "ct-step next" antes de despachar al juez otra vez, porque un paquete que sobrevive a su veredicto es el que deja pasar un juicio rancio.`)
  }
}

// ---------------------------------------------------------------------------
// The verbs that transition
// ---------------------------------------------------------------------------
function readJson(path, whose) {
  if (typeof path !== 'string' || !path || path.startsWith('--')) {
    die(`falta la ruta del JSON ${whose}\n\n${USAGE}`, EXIT.USAGE)
  }
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) }
  } catch (e) {
    // A JSON that cannot be read is a DISCARD, not a usage error: the subagent
    // answered, and what it answered is no good.
    return { why: `no se pudo leer el ${whose} en ${path}: ${e.message}` }
  }
}

// Whether the ct yardstick reached the brief, and how much it weighed —
// measured on the BRIEF THAT IS ON DISK, not on what `writeBrief` meant to
// write: that function ran in an EARLIER invocation of the process (the one of
// `ct-step next`), so there is nothing in memory here to drag along, and
// measuring the artefact that really exists is better instrumentation than
// measuring a code path. The path is derived JUST AS in `writeBrief`.
//
// If the brief cannot be read, the two fields go to `null`, never to `0`: a zero
// would assert a brief with no yardstick, and what has happened is that it could
// not be looked at.
function briefPath() {
  return join(workDir, `task-${run.task}-brief.md`)
}

function briefMeasures() {
  try {
    return briefCtYardstickMeasures(readFileSync(briefPath(), 'utf8'))
  } catch {
    return { brief_vara_ct_docs: null, brief_bytes: null }
  }
}

// WHAT THE TASK TOUCHED, MEASURED AGAINST THE PREVIOUS TREE. `git status`
// compares the worktree with HEAD, and HEAD is the previous task's commit:
// every task commits its own, so "what changed since HEAD" is exactly "what
// this task did".
//
// `-z` and not the default output: ordinary porcelain QUOTES a path with
// spaces or accents (`"src/a\303\261o.js"`) and whoever parses it by hand
// would stage a path that does not exist. With `-z` every entry is literal and
// comes separated by NUL. A rename brings TWO entries —destination and origin—
// and both are needed: without the origin, the deletion does not go into the
// commit.
//
// WHAT BELONGS TO THE LOOP ITSELF IS FILTERED OUT. The run writes under
// `.agent/run-<n>` and the machinery under `docs/superpowers/**`
// (`LOOP_ARTIFACT_PATTERNS`, the same list the reconciliation already uses),
// and none of that was touched by the implementer: staging it would put the
// run's state inside the task's commit. The verdict and the telemetry are
// staged by this program on its own account, each one at its own moment.
//
// AND THE SAFETY FILTER IS KEPT for absolute paths or paths with `..`: git
// does not produce them, but what is handed to `git add` does not stop being
// checked just because it comes from where it is expected to.
const isSafePath = (p) => p !== '' && !p.startsWith('/') && !p.split('/').includes('..')

const esDelRun = (p) => {
  const suyo = `${relative(repoRoot, workDir)}/`
  return p === relative(repoRoot, stateFile) || p.startsWith(suyo)
}

// THE PLAN IS THE TASK'S WORK, SINCE THE AMENDMENT (issue 161). A plan amended
// halfway through a task is the implementer saying "this that I declared
// changes too", and that change has to travel in the commit of ITS task, not be
// left orphaned until somebody commits it separately. `esDelRun` no longer
// excludes it: the path is chosen by whoever dispatches and can be anywhere at
// all, so it is named here from `planPath`, the only place where this program
// knows it.
// Normalised to `/` at SOURCE, not in every consumer: the three comparisons of
// this path are against git output, which always uses `/`, while `relative`
// would give `\` on Windows. It is the same care `ajenoEnElIndice` documents,
// applied where the path is built.
const planRelPath = () => relative(repoRoot, resolve(planPath)).replace(/\\/g, '/')

//
// WHAT THIS FUNCTION MEASURES HAS TWO CONSUMERS: `report`, which stages what
// was measured, and `advice`, which returns what was measured to the last
// commit. That is why it returns the whole ENTRY and not just the path:
// whoever cleans up needs to know whether git knows that file
// (`git checkout --`) or has never seen it (`git clean`), and deriving it a
// second time with another `git status` would be the second reading that
// answers differently the day one of the two changes its flags.
const treeEntries = () => {
  const chunks = (git(['status', '--porcelain', '-z', '--untracked-files=all']) || '').split('\0')
  const entries = []
  for (let i = 0; i < chunks.length; i++) {
    const entry = chunks[i]
    if (!entry) continue
    const status = entry.slice(0, 2)
    const path = entry.slice(3)
    if (status.startsWith('R') || status.startsWith('C')) {
      const origin = chunks[++i]
      if (origin) entries.push({ status, path: origin })
    }
    if (path) entries.push({ status, path })
  }
  const seen = new Set()
  // THE PLAN GETS THROUGH BOTH GUARDS. `isMachineryPath` covers it in a real
  // run (it lives under `docs/superpowers/plans/**`), and that guard still
  // stands for everything else; only the plan's path crosses it, because it is
  // the one piece of the machinery the implementer legitimately changes.
  return entries.filter(({ path }) => {
    if (seen.has(path)) return false
    seen.add(path)
    return isSafePath(path) && !esDelRun(path) &&
      (path === planRelPath() || !isMachineryPath(path))
  })
}

const touchedPaths = () => treeEntries().map(({ path }) => path)

// WHAT IT COST THE ROLE TO READ WHAT IT WAS SENT (#92). `brief_bytes` measured
// a single one of the four calls to the model, so the fixed half of the
// context —the agent's file and the skills its prompt orders it to load— was in
// no column at all: the saving per slice was being claimed with no measure.
//
// Same doctrine as `briefMeasures`: what gets measured is the file that EXISTS
// on disk, never what the program intended to write, and a file that cannot be
// measured is worth `null` and never `0` — a zero would claim a role dispatched
// with no material. That is why the port RoleBytes receives returns `null`
// instead of throwing: what the absence means is decided by the measure, not by
// `statSync`.
const sizeOnDisk = (path) => {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

const roleBytes = new RoleBytes({ pluginRoot: PLUGIN_ROOT, sizeOf: sizeOnDisk })

function roleMeasures(step, packagePath) {
  return { ...roleBytes.measuresOf({ step, packagePath }) }
}

// The reconciliation packages this run has already written, from the first to
// the last. `nextReconcileAttempt` reads them to number the next one,
// and the step's measure reads them to know WHICH one this round's reconciler
// read: the last one written. One single list and not two walks of the
// directory with the same expression, which is the copy that would end up
// numbering by one criterion and measuring by another.
function reconcilePackages() {
  try {
    return readdirSync(workDir).filter((f) => /^reconcile-package-\d+\.md$/.test(f))
      .sort((a, b) => Number(/(\d+)/.exec(a)[1]) - Number(/(\d+)/.exec(b)[1]))
  } catch {
    return []
  }
}

// A reconcile round in which there is still no package is a round in which
// NOBODY dispatched `ct-reconciler`: the row does not carry the three fields,
// and it does not carry them as `null` but ABSENT, because a null here would
// say "an attempt was made to measure the material of a role that ran" and what
// happened is that the role did not run.
function reconcileRoleMeasures() {
  const previous = reconcilePackages()
  if (previous.length === 0) return {}
  return roleMeasures(STEPS.RECONCILE, join(workDir, previous.at(-1)))
}

function reportVerb() {
  const { value, why: whyRead } = readJson(process.argv[3], 'del informe')
  const { report, why } = whyRead ? { why: whyRead } : readReport(value)
  // The summary goes into the telemetry only when there is a valid report: a
  // discarded report has no summary to tell, just as `why` only carries a
  // value when the report is discarded.
  measure('implement', {
    outcome: report ? 'done' : 'discarded',
    paths: report ? report.paths.length : 0,
    why: report ? null : why,
    summary: report ? report.summary : null,
    ...briefMeasures(),
    // Also when the report is discarded: the implementer WAS DISPATCHED and
    // read its material all the same, so that cost existed and the row says so.
    ...roleMeasures(STEPS.IMPLEMENT, briefPath()),
  })
  if (!report) {
    out(`informe descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // THE PATHS ARE MEASURED BY THE PROGRAM, and the implementer's declaration
  // is a cross-check. What used to be staged was what the report declared: a
  // forgotten path never reached the commit, a path declared and not touched
  // was a lie nothing detected, and a repeated one discarded the whole report.
  // `git status` against the tree previous to the task —the previous commit,
  // because every task commits its own— knows exactly what changed.
  //
  // THE DECLARATION IS NOT THROWN AWAY: if it differs, it WARNS. That the
  // implementer believes it touched something other than what it touched is
  // information about the attempt, and keeping quiet about it would lose the
  // only reading this step had of it. What it no longer does is decide.
  // THE INDEX IS EMPTIED FIRST, and that now orders the measure as well. The
  // reset (mixed: the worktree is not touched) was here because between
  // attempts the index accumulates — attempt 1 may have staged a path out of
  // scope that the veto returned, and without it that version would travel
  // inside attempt 2's commit without any check seeing it again.
  //
  // And it goes BEFORE measuring because `git status` looks at the index as
  // much as at the worktree: with the previous attempt's index still in place,
  // a file staged back then and DELETED afterwards reads as "added and
  // deleted" and would go into the list even though it no longer exists.
  // Measured: `git add` of that path fails with `pathspec did not match` and
  // the step dies by exception.
  git(['reset', '-q'])
  const paths = touchedPaths()
  const onlyDeclared = report.paths.filter((p) => !paths.includes(p))
  // The plan does not go into the discrepancy: amending it is a capability the
  // implementer has and its report does not declare —the report lists the
  // WORK—, so without this exemption every legitimate amendment came out warned
  // about as "touched and not declared", labelling as a defect the very thing
  // that was wanted.
  const onlyMeasured = paths.filter((p) => !report.paths.includes(p) && p !== planRelPath())
  if (onlyDeclared.length || onlyMeasured.length) {
    err(`warning: lo que el implementador declara y lo que el árbol dice no coinciden. Se stagea lo MEDIDO.${onlyMeasured.length ? ` Tocado y no declarado: ${onlyMeasured.join(', ')}.` : ''}${onlyDeclared.length ? ` Declarado y no tocado: ${onlyDeclared.join(', ')}.` : ''}`)
  }
  // It is staged BEFORE measuring the checks: one that reads the index does
  // not see a new file that is not staged. After reset+add, the index is
  // EXACTLY what the tree says changed — which is what gets committed.
  //
  // With no paths `git add` is not called: `git add --` with no path behind it
  // adds nothing and warns on its own account, and an empty index is already
  // the right answer to a task that touched nothing — the checks measure it
  // all the same.
  if (paths.length) git(['add', '--', ...paths])
  // `lastPaths` feeds the `--` of a `git grep` in `declaredTests`, which
  // narrows the scope of that check to what the task staged — the most fragile
  // property in all of this (see the commit that fixed it, e4cc3dc).
  archive('report', { paths, summary: report.summary })
  run = {
    ...run,
    lastPaths: paths,
    lastSummary: report.summary,
  }
  out(`stageados ${report.paths.length} fichero(s): ${paths.join(', ')}`)
  // The summary is PRINTED. It is the channel through which the implementer
  // warns about a skill it did not load, a frozen decision it obeyed
  // reluctantly or a problem it saw and did not touch — and until now nobody
  // read it: no verb printed it, the judge is under orders to ignore it, and
  // nobody consulted `run.lastSummary`. Measured in the field
  // (jjponz/rust-monitoring#10): the warning that the lockfile committed "for
  // reproducible CI" is not enforced in continuous integration reached the
  // pull request only because that session opened the report's file on its own
  // initiative.
  if (report.summary) out(`el implementador dice: ${report.summary}`)
  return OUTCOMES.DONE
}

function controlsVerb() {
  const t = currentTask()
  // The only time this program can really measure: the two calls to the model
  // are made by the session, so of those there is neither cost nor turns nor
  // duration. And it is the only one that cannot be reconstructed by
  // subtracting consecutive `written_at`, because between two rows there is
  // session latency mixed with work.
  const startedAt = Date.now()
  const log = join(workDir, `task-${run.task}-controls-${currentAttempt()}.log`)
  const lines = []
  let result = OUTCOMES.DONE

  // Scope goes ahead of everything, because it is the cheapest of all:
  // comparing two lists of paths and looking at the previous commit's tree
  // costs nothing, so it runs even before the test names.
  const outOfScope = declaredScope(t)
  if (outOfScope.length) {
    lines.push('# alcance declarado por la tarea', ...outOfScope.map((f) => `- ${f}`), '')
    result = OUTCOMES.FAILED
  }

  // The other direction of the scope control: an amendment can only ADD paths
  // to **Files:**, never remove them — removing one would switch the control
  // above off from inside the plan itself.
  const amendment = amendmentOnlyAdds(t)
  if (amendment.length) {
    lines.push('# enmienda del plan', ...amendment.map((f) => `- ${f}`), '')
    result = OUTCOMES.FAILED
  }

  // Then the names, which are free too. A plan's yardstick measures that
  // nothing broke, not that what was promised was added — measured in the
  // field: a task asked for a function and its test, the function arrived
  // without the test, and the suite stayed green because the previous commit's
  // one passed.
  const failures = declaredTests(t)
  if (failures.length) {
    lines.push('# tests declarados por la tarea', ...failures.map((f) => `- ${f}`), '')
    result = OUTCOMES.FAILED
  }

  // And last what the plan's BLOCKS promise, which is still free: none of
  // this runs a command.
  const blocks = declaredBlocks(t)
  if (blocks.length) {
    lines.push('# bloques declarados por la tarea', ...blocks.map((f) => `- ${f}`), '')
    result = OUTCOMES.FAILED
  }

  for (const command of result === OUTCOMES.FAILED ? [] : t.commands) {
    const measured = runCheck(command)
    lines.push(`$ ${command}`, measured.output ?? '', `-> exit ${measured.code}`, '')
    if (measured.code === 'unmeasured') { result = OUTCOMES.INDETERMINATE; break }
    if (measured.code !== 0) { result = OUTCOMES.FAILED; break }
  }

  writeFileSync(log, lines.join('\n'))
  measure('controls', { outcome: result, controls_log: log, commands: t.commands.length, duration_ms: Date.now() - startedAt })
  run = { ...run, lastControlsLog: log }
  out(`controles: ${result} (log en ${log})`)
  return result
}

// What really gets committed is the INDEX, not the list the report declared:
// the scope checks measure `git diff --cached` instead of `run.lastPaths`, so
// that nothing staged —whether the report declares it or not— escapes the
// check. It is the second half of `report`'s reset: that one guarantees the
// index is what was declared, and this VERIFIES it instead of assuming it.
const stagedPaths = () => (git(['diff', '--cached', '--name-only']) || '').split('\n').map((l) => l.trim()).filter(Boolean)

// WHAT IS STAGED AND IS WORK, WITHOUT THE MACHINERY. `stagedPaths` answers
// "what is in the index" and that is exactly what `ajenoEnElIndice` needs
// (membership, not content). But an amended plan lives in the index from the
// moment `report` lets it through, and a control that looked at it as if it
// were the task's code would answer wrongly: the plan QUOTES verbatim the names
// of the tests the task withdraws, so a control on names would see "it is still
// there" for a test that really was deleted (the false positive that motivates
// this function). The three controls that read content —`declaredScope`,
// `declaredBlocks`, `inIndex`— filter out the plan and the rest of the
// machinery before looking; `ajenoEnElIndice` goes on reading the raw index,
// because to that question the plan does belong.
const workingPathsInTheIndex = () =>
  stagedPaths().filter((p) => p !== planRelPath() && !isMachineryPath(p))

// AND THE VERSION FOR THE CONTROLS THAT COMPARE LISTS OF PATHS, which only
// takes the plan out. The false positive above is one of CONTENT —the plan
// quotes test names verbatim— and it does not happen to a comparison of paths:
// exempting the whole machinery here would leave outside the scope control any
// `docs/superpowers/**` path that reaches the index, which is exactly the
// vector `scope.js` documents from dispatch 1, and would make it travel inside
// the task's commit without any control seeing it.
const workPathsInTheIndex = () => stagedPaths().filter((p) => p !== planRelPath())

// WHAT IS FOREIGN IN THE INDEX: what is staged that this program did NOT put there.
//
// The machinery's three `git commit` calls —the task, the slice's verdict and
// the e2e report— go WITHOUT a pathspec, so they carry the whole index away:
// whatever the conductor stages before calling them travels inside without any
// judge having seen it. Reproduced in the last two (`git add colado.txt`
// before `slice-verdict` and before `e2e`: in both cases `colado.txt` ended up
// committed, and the run delivered all the same).
//
// For those two, BELONGING is enough: in their steps the index has to be empty
// except for the paths the program has just staged, and the program REWRITES
// its artefacts right before staging them, so a foreign edit of the file does
// not survive. That cannot be said of the implementer's work — which is why
// the task commit carries a seal (`indexTree`) and not belonging: there
// the attack overwrites a path that IS within scope.
const foreignInIndex = (ours) => {
  // `stagedPaths` returns git paths (always with `/`) and ours are built with
  // `join`, which on Windows would give `\`. Normalising is one line and it
  // stops the guard from firing ALWAYS on the platform nobody looks at.
  const mine = ours.map((p) => p.replace(/\\/g, '/'))
  return stagedPaths().filter((p) => !mine.includes(p))
}

// The task's scope is decided by the PLAN, not by the implementer: this check
// crosses the INDEX (what is really going to be committed) against `t.files`
// (what the task declares in **Files:**). A path on one side and not on the
// other is a failure, and so is an action that does not square with the
// previous commit's tree — `git cat-file -e HEAD:<path>`, not the disk,
// because the implementer has already created the file by the time this runs.
// A path with `action: null` is not checked against git: it is a decision of
// the plan, not an oversight (task 1, `splitFiles`).
//
// Each failure's message says whether the PLAN or the CODE is what gets fixed,
// because a plan that left a path out of its **Files:** is just as likely as
// an implementer that touched too much, and confusing them costs a whole
// cycle.
function declaredScope(t) {
  const failures = []
  const touched = workPathsInTheIndex()
  const declared = t.files

  for (const path of touched) {
    if (!declared.some((f) => f.path === path)) {
      failures.push(`la tarea ${t.n} tocó '${path}' y el plan no la declara en sus **Files:** — dos explicaciones son igual de plausibles y este control no puede arbitrar entre ellas: sobra en el CÓDIGO, o hace falta añadirla al PLAN`)
    }
  }

  for (const f of declared) {
    if (!touched.includes(f.path)) {
      failures.push(`el plan declara '${f.path}' en las **Files:** de la tarea ${t.n} y no está entre lo que tocó: escribe el CÓDIGO que la tarea prometió. Si de verdad sobra en el PLAN, QUITARLA NO ES TU SALIDA —una enmienda sólo puede añadir rutas, porque quitarlas desactiva este mismo control— así que dilo en tu informe y deja la ruta en el plan`)
      continue
    }
    if (f.action === null) continue
    const existedBefore = git(['cat-file', '-e', `HEAD:${f.path}`], { allowFail: true }) !== null
    if (f.action === 'create' && existedBefore) {
      failures.push(`el plan declara '${f.path}' como (create) y ya existía en el commit anterior — revisa el PLAN, la acción debería ser (modify)`)
    }
    if (f.action === 'modify' && !existedBefore) {
      failures.push(`el plan declara '${f.path}' como (modify) y no existía en el commit anterior — revisa el PLAN, la acción debería ser (create)`)
    }
  }

  return failures
}

// The other direction of the scope control (issue 161): an amendment can ADD
// paths to the **Files:** of its own task — that is what `declaredScope`
// already lets through, comparing against TODAY'S INDEX — but it can never
// REMOVE one it already declared, because that would switch the control above
// off from inside the plan itself: deleting the surplus path from **Files:**
// would be enough for `declaredScope` to stop seeing it.
//
// IT IS NOT CONDITIONED ON THE INDEX, and that was the open door. `t` comes
// from the plan of the TREE, read when the process starts; the index is another
// thing. With the guard conditioned on the plan being staged, editing it AFTER
// `report` was enough: the guard did not run, `t.files` —already reduced—
// governed `declaredScope`, and the commit took the old plan, so the judge
// saw no amendment either. Delivering green with the committed plan
// contradicting the code is exactly what this slice exists to prevent.
//
// Hence the first invariant, which covers both directions at once: THE PLAN
// THAT GOVERNS THE CONTROLS HAS TO BE THE ONE THAT IS GOING TO BE COMMITTED.
// The tree's text is compared against the index's if the plan is staged, and
// against HEAD's if it is not.
//
// AND IT FAILS CLOSED, like `allWorkCommittedByCtStep` in state.js: if the plan
// of HEAD cannot be read, or its text does not declare the task `t.n`, there is
// nothing to compare against and that is NOT a permission — it is a control
// that could not measure, and it is said.
function amendmentOnlyAdds(t) {
  const ruta = planRelPath()
  const anterior = git(['show', `HEAD:${ruta}`], { allowFail: true })
  if (anterior === null) {
    return [`no se pudo leer '${ruta}' en HEAD: sin el plan comiteado no hay contra qué comparar el del árbol, y este control no puede medir si la tarea ${t.n} le quitó rutas a sus **Files:**. Comitea el plan —el gate \`plan\` ya lo pide antes de implementar— y vuelve a pedir el paso.`]
  }

  // GIT IS ASKED whether the tree and the index say the same thing, instead of
  // comparing the two texts by hand: `git diff --quiet` respects the
  // end-of-line filters (`core.autocrlf`, `.gitattributes`) and a string
  // comparison would ignore them — in a repo that uses them, the tree and the
  // blob always differ and THIS control would come out red on every step.
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

// Checks whether `nombre` appears in the INDEX, bounded to what is staged (not
// to the repo's whole index). A prescriptive plan QUOTES the code verbatim and
// lives committed under docs/, so searching the whole index always finds the
// name: the withdrawn one "is still there" (a false positive, measured in task
// 1 of repo-pulse's slice #5) and the promised one "is already there" even
// though nobody wrote it (a false negative, which is precisely the failure this
// check exists to catch). With no staged files there is nowhere to look, and
// that is a NO. Shared by `testsDeclarados` and `declaredBlocks`: same
// question, same scope, same mechanism.
function inIndex(nombre) {
  const ambito = workingPathsInTheIndex()
  if (!ambito.length) return false
  try {
    execFileSync('git', ['grep', '--cached', '--quiet', '-F', '-e', name, '--', ...scope], { cwd: repoRoot, stdio: 'ignore', timeout: 60_000 })
    return true
  } catch { return false }
}

function declaredTests(t) {
  const failures = []
  for (const n of t.testsAdded) if (!inIndex(n)) failures.push(`la tarea dijo que añadía el test '${n}' y no está en lo stageado`)
  for (const n of t.testsRemoved) if (inIndex(n)) failures.push(`la tarea dijo que retiraba el test '${n}' y sigue estando`)
  return failures
}

// What the plan's BLOCKS promise has to be there, just as `declaredScope`
// measures what **Files:** promises. Three checks, all of them narrowed to
// what is staged for the same reason as `declaredTests`: the plan lives
// committed inside the repo, so searching the repo is searching the plan.
//
//  - `blockPaths`: every `{role, path}` demands that `path` be among the
//    touched paths. A Contract or a Call site nobody touched is scaffolding
//    declared and never written.
//  - `tddName`: the same `inIndex` as `declaredTests`, and the same
//    message — the test the task promised in its **TDD:** is just as
//    enforceable as those of **Tests:**.
//  - `finalTexts`: the text has to appear verbatim in the INDEX of its path.
//    It is compared against `git show :<path>` and not with `git grep`,
//    because it is a MULTI-LINE block and `git grep` works line by line;
//    comparing the whole staged content is what makes it possible to say
//    WHICH line is missing, and that is half the value of this check.
//
// Each failure's message says whether the PLAN or the CODE is what gets fixed,
// just as in `declaredScope`: confusing the two costs a whole cycle.
function declaredBlocks(t) {
  const failures = []
  const touched = workPathsInTheIndex()

  for (const { role, path } of t.blockPaths) {
    if (!touched.includes(path)) {
      failures.push(`la tarea ${t.n} declara un bloque ${role} (${path}) y no está entre lo que tocó — falta en el CÓDIGO, o el bloque sobra en el PLAN`)
    }
  }

  if (t.tddName && !inIndex(t.tddName)) {
    failures.push(`la tarea dijo que añadía el test '${t.tddName}' y no está en lo stageado`)
  }

  for (const { path, text } of t.finalTexts) {
    const staged = git(['show', `:${path}`], { allowFail: true })
    if (staged === null) {
      failures.push(`la tarea ${t.n} declara un Final text (${path}) y ese fichero no está entre lo que tocó — falta en el CÓDIGO, o el bloque sobra en el PLAN`)
      continue
    }
    for (const line of text.split('\n')) {
      if (line.trim() !== '' && !staged.includes(line)) {
        failures.push(`la tarea ${t.n} declara Final text (${path}) y la línea '${line}' no está verbatim en lo stageado — falta en el CÓDIGO, o el PLAN cita mal el texto`)
      }
    }
  }

  return failures
}

function runCheck(command) {
  try {
    return { code: 0, output: execFileSync('sh', ['-c', command], {
      encoding: 'utf8', cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 20 * 60_000, killSignal: 'SIGKILL',
    }) }
  } catch (e) {
    // A command that ran and said no is RED and gets retried; one that could
    // not be executed or that hung could not be MEASURED, and retrying it
    // blindly repeats the cost without changing anything.
    const hung = e.killed || e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT'
    const notFound = e.status === 127 || e.code === 'ENOENT'
    const code = (hung || notFound) ? 'unmeasured' : (typeof e.status === 'number' ? e.status : 'unmeasured')
    return { code, output: String(e.stdout || '') + String(e.stderr || '') }
  }
}

// Phase B — RECONCILE. `BranchReconciliation` (Tasks 6-7) talks to git through
// an adapter `(argv) => ({ code, stdout })` that NEVER throws: unlike the
// `git(...)` above —meant for commands that only make sense if they work—,
// here a `git merge` that returns 1 is the expected half of the road
// (CONFLICTING), not a failure of the program. That is why this adapter is its
// own and not the one above: wrapping the one above in a try/catch would have
// been reimplementing `execFileSync` with more steps.
const gitForReconcile = (argv) => {
  try {
    return { code: 0, stdout: execFileSync('git', argv, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: GIT_MAX_BUFFER, timeout: 120_000, killSignal: 'SIGKILL',
    }) }
  } catch (e) {
    // With no numeric `status` the process did not end on its own account: a
    // signal killed it, and the one that arrives here is the time cap's
    // (SIGKILL). Returning `code: 1` closes on a falsehood — a killed
    // `git merge` would be classified as a merge git refused
    // (UNMERGEABLE_TREE), and the message would send the slice agent off to
    // clean up a tree that is perfectly fine. What was never measured cannot
    // be interpreted: it stops here.
    if (typeof e.status !== 'number') {
      die(`git ${argv.join(' ')} no terminó por su cuenta (señal ${e.signal || 'desconocida'}): saltó el tope de tiempo o alguien lo mató. No se distingue de un fallo de git y no se va a interpretar como tal.`, EXIT.PRECONDITION)
    }
    return { code: e.status, stdout: String(e.stdout || '') }
  }
}

// The loop's own footprint —telemetry, verdicts, the plan, the e2e report— is
// NOT a resolution touching too much: it is the SAME list `scope.js` already
// declares for the pull request's scope gate, with the same reason stated
// there ("the other way round, the first slice that produces one comes out red
// because of a file of the loop's, and whoever reads the gate will not be able
// to tell whether the red was put there by the agent or by the machinery").
// One single source for the decision of what is "the machinery's":
// `LOOP_ARTIFACT_PATTERNS`, consumed here and in the target repo's workflow,
// never a second list typed in by hand.
const isMachineryPath = (path) => LOOP_ARTIFACT_PATTERNS.some((pat) => matchesPattern(path, pat))

// The extractor of one section of the plan by its literal heading, up to the
// next heading of equal or lesser level — the same criterion as
// `extract_section` of `skills/subagent-driven-development/scripts/task-brief`
// (bash/awk), rewritten here because the reconciliation package is pasted by
// `reconcileVerb` directly, with no such script in between.
//
// THE COPY IS DECLARED AND MEASURED (`conventions/decisions.md`, "when the
// copy is unavoidable"): the rule lives in two languages because the script is
// bash and this is JavaScript, and `__tests__/plan-section-real-process.test.js`
// passes the same plans through both implementations and compares the output
// byte for byte — so rewriting both passes and touching only one fails. Until
// that test existed, the two had already diverged over the quotes of the
// absent-section message.
//
// It respects
// code fences so as not to mistake a "### ..." comment inside a block for a
// real heading. Absence is declared, never kept quiet — a blank gap read as
// "empty section" is not the same as "the plan does not carry it".
function seccionDelPlan(markdown, heading) {
  const level = /^#+/.exec(heading)[0].length
  let inFence = false
  let inside = false
  let seen = false
  const output = []
  for (const line of markdown.split('\n')) {
    if (/^```/.test(line)) inFence = !inFence
    if (!inFence && !seen && line.startsWith(heading)) {
      seen = true
      inside = true
      output.push(line)
      continue
    }
    if (inside && !inFence && /^#+[ \t]/.test(line)) {
      if (/^#+/.exec(line)[0].length <= level) inside = false
    }
    if (inside) output.push(line)
  }
  const content = output.join('\n').trim()
  return content || `(sección '${heading}' no encontrada en el plan)`
}

// The log of the commits the base brought — the first thing a human resolving
// the same conflict would open, and what Task 9's brief asks for by name:
// without it, `ct-reconciler` looks at two texts that clash and does not know
// what the other side was after, and guessing that is exactly the invention
// the role is forbidden. `allowFail` because a merge-base that cannot be
// computed is not a failure of the program: it is one datum less in the
// package, declared instead of kept quiet.
function baseLog(branch) {
  const mergeBase = git(['merge-base', 'HEAD', `origin/${branch}`], { allowFail: true })
  if (!mergeBase) return '(no se pudo calcular el merge-base con la base: no hay log de commits que enseñar)'
  const log = git(['log', `${mergeBase.trim()}..origin/${branch}`, '--oneline'], { allowFail: true })
  return log || '(la base no trae ningún commit nuevo)'
}

// This round's attempt: how many reconciliation packages have already been
// written for this run. Neither `run.reconcileRetries` (which counts only the
// first time a CONFLICTING is left unresolved, not every discard) nor
// `run.discards` (the run's GLOBAL budget, shared with implement, judge and
// slice-judge, so it could already arrive above zero without this conflict
// having seen a single package) counts what is needed here: every call that is
// going to dispatch `ct-reconciler` writes one, and the next number is simply
// how many there already are in the run's directory.
function nextReconcileAttempt() {
  return reconcilePackages().length + 1
}

// The fix text of every `DiscardReason`, for the package and for the stdout
// message — ONE list and not two copies that could diverge on what each reason
// says. `reconcileVerb`, further down, uses it for the message.
const DISCARD_FIX = {
  [DiscardReason.MARKERS_LEFT]: 'quedaron marcas de conflicto (<<<<<<< / ======= / >>>>>>>) sin quitar en alguno de los ficheros resueltos.',
  [DiscardReason.TOUCHED_OUTSIDE_THE_CONFLICT]: 'la resolución tocó ficheros que no estaban en la lista de conflicto: el índice sólo puede llevar los ficheros en disputa.',
  [DiscardReason.UNRESOLVED_FILES_REMAIN]: 'siguen quedando ficheros sin resolver tras intentar stagearlos: hay que resolverlos todos antes de concluir.',
}

// The package `ct-reconciler` consumes (Task 9) — same pattern as
// `writeReviewPackage`/`writeSliceReviewPackage`: the program pastes already
// resolved text onto disk and the agent reads it in one go. With no review
// token: unlike a judge, the reconciler does not emit a verdict that has to be
// tied to a cut of the index — it edits files, and it is the PROGRAM that
// validates the tree afterwards (`BranchReconciliation.conclude()`), never a
// JSON this package has to anchor.
function writeReconcileReviewPackage({ branch, round, attempt }) {
  const packagePath = join(workDir, `reconcile-package-${attempt}.md`)
  const ctDocs = loadCtYardstick()
  const files = round.files.map((f) => `- ${f}`).join('\n') || '(ninguno)'
  const header = round.reason
    ? `# Reconcile package: issue #${issue}, round ${attempt} (previous round discarded: ${round.reason})`
    : `# Reconcile package: issue #${issue}, round ${attempt}`
  const lines = [
    header, '',
    '## Conflicted files', files,
    '', '## Base commits', baseLog(branch),
    '', seccionDelPlan(planText, '### Desired end state'),
  ]
  if (round.reason) {
    lines.push('', '## Discard reason', DISCARD_FIX[round.reason] ?? round.reason)
  }
  writeFileSync(packagePath, lines.join('\n'))
  // BY PATH AND NOT PASTED: the reconciler has `Read` (RECONCILER_TOOLS), and
  // the eight whole documents in front of a conflict are some 41 KB of fixed
  // material that does not depend on the conflict. With no task to narrow the
  // scope, all of them go: a merge can touch any file at all, a new one
  // included.
  appendFileSync(packagePath, PluginYardstick.composePathSection(ctDocs))
  appendFileSync(packagePath, repoYardstickSection('el paquete de reconciliación'))
  return packagePath
}

// The ladder's last bullet, and the promise `agents/ct-reconciler.md` makes to
// the reconciler when it tells it that declaring "I do not know how to resolve
// it" leads to somebody with a shell. It is said THE SAME whether it comes
// from a CONFLICTING nobody touched or from a discarded round: it is the same
// handover, and writing it twice is what would leave one of the two halves
// unwritten.
function handoverToSliceAgent() {
  out(`ct-reconciler agotó sus ${DEFAULT_BUDGETS.reconcileRetries} ronda(s) sin resolverlo: le toca al agente del propio slice, que sí tiene Bash. Que resuelva el conflicto a mano, deje los ficheros stageados y llame a:`)
  out(`  ct-step reconcile --plan ${planPath} --issue ${issue}`)
}

// Idempotent through MERGE_HEAD (Task 7): with no merge under way, it starts
// the next round against the base; with one half done, it concludes the
// resolution the session has already left in the index. The state of "which
// round we are in" is carried by git, not by this file — there is no counter
// to keep in sync and no way to invoke it out of order.
//
// The base branch's name is NOT resolved here: `resolveBaseBranch()` is the
// same function `baseExclusion()` already uses (see its comment, above).
// Asking for it twice by two roads —one to exclude commits, another to merge—
// is the divergent copy the previous phase's reviewer warned in writing must
// not be written again.
function reconcileVerb() {
  const startedAt = Date.now()
  const branch = resolveBaseBranch()
  if (!branch) {
    die('reconcile no puede resolver la rama base del slice (ni "base:" en .agent/SLICE.md, ni main/master remotos en este worktree): no hay con qué fusionar.', EXIT.PRECONDITION)
  }
  const reconciliation = new BranchReconciliation({ git: gitForReconcile, isMachineryPath })
  const round = reconciliation.isMergeInProgress()
    ? reconciliation.conclude()
    : reconciliation.merge({ baseBranch: branch })
  measure('reconcile', {
    outcome: round.outcome, files: round.files, reason: round.reason,
    duration_ms: Date.now() - startedAt,
    ...reconcileRoleMeasures(),
  })
  // The budget that decides the message is THIS round's, BEFORE `after()`
  // (further down, in the final dispatch) consumes it. The question is
  // answered by `run-machine.js`, which is the one that holds the rule: here
  // it is only read. Re-deriving it — writing
  // `run.reconcileRetries < DEFAULT_BUDGETS.reconcileRetries` out again — was
  // the same decision in two files, and with a discarded round spending a
  // retry the two copies would have stopped agreeing: the verb would announce
  // another round and the table would close the run.
  const budgetLeft = !reconcileBudgetSpent(run)
  switch (round.outcome) {
    case ReconcileOutcome.UP_TO_DATE:
      out(`reconcile: up-to-date (la base "${branch}" no se ha movido)`)
      break
    case ReconcileOutcome.MERGED:
      out(`reconcile: merged (la base "${branch}" se fusionó sin conflictos)`)
      break
    case ReconcileOutcome.RESOLVED:
      out(`reconcile: resolved (la resolución de ${round.files.length} fichero(s) se comiteó)`)
      break
    // The CONTENT conflict: there is something to work with (the files in
    // dispute), so while there is budget left it is the reconciler (Task 9,
    // `ct-reconciler`) that resolves it and not the slice agent.
    case ReconcileOutcome.CONFLICTING:
      out(`reconcile: conflicting — ${round.files.length} fichero(s) en conflicto con "${branch}":`)
      for (const f of round.files) out(`  - ${f}`)
      out('')
      if (budgetLeft) {
        const packagePath = writeReconcileReviewPackage({ branch, round, attempt: nextReconcileAttempt() })
        out(`DESPACHA ct-reconciler (subagente — declarado SIN Bash y SIN Write: ${RECONCILER_TOOLS}) a resolver el conflicto: que deje los ficheros resueltos, sin marcas de conflicto, y sin tocar nada fuera de esa lista — no puede stagear, comitear ni abortar la fusión: eso lo hace este programa al concluir. Dale:`)
        out(`  - el paquete de reconciliación: ${packagePath}`)
        out(`Cuando vuelva:  ct-step reconcile --plan ${planPath} --issue ${issue}  (concluye la fusión a medias — lo decide MERGE_HEAD, no hace falta indicar nada más).`)
      } else {
        handoverToSliceAgent()
      }
      break
    // The mitigation the design promised in writing ("Declared limits"): the
    // slice agent has Bash, so it can stage and commit the merge on its own
    // account without coming back through here. When that happens, the only
    // thing left to look at is the merge commit already made — and what gets
    // looked at is what the validation skipped: that it does not carry markers
    // inside. It is not airtight; it moves the case from the human's retina to
    // the loop.
    case ReconcileOutcome.MARKERS_COMMITTED:
      out(`reconcile: markers-committed — HEAD ya es un commit de fusión, hecho fuera de este verbo, y ${round.files.length} fichero(s) suyos traen marcas de conflicto DENTRO del commit:`)
      for (const f of round.files) out(`  - ${f}`)
      out('No hay fusión viva que concluir ni ronda que descartar: la pull request llevaría los marcadores dentro, y si el conflicto cae en un fichero que los controles no compilan, sale verde.')
      out('DESPACHA AL AGENTE DEL SLICE (tiene Bash) a quitar las marcas y comitear el arreglo, y vuelve a preguntar con ct-step next.')
      break
    // The slice's own dirty tree: git could not even BEGIN the merge. There is
    // no conflicting content to show the reconciler —showing it would be
    // sending it off to resolve something that does not exist— so it goes
    // straight to the slice agent, with no mention of ct-reconciler.
    case ReconcileOutcome.UNMERGEABLE_TREE:
      out(`reconcile: unmergeable-tree — git no pudo empezar la fusión con "${branch}": esto no es un conflicto de contenido, es el árbol del propio slice (cambios sin comitear, o algo a medias).`)
      out('DESPACHA AL AGENTE DEL SLICE (tiene Bash) a dejar el árbol limpio, y vuelve a preguntar con ct-step next.')
      break
    // The round that was discarded WITHOUT touching the tree
    // (`checkout --merge` undoes it) — like implement and the judge, it does
    // not spend a retry, only the slice's discard budget. The message says
    // WHICH of the three reasons it was, because each one is fixed
    // differently.
    case ReconcileOutcome.ROUND_DISCARDED: {
      out(`reconcile: round-discarded (${round.reason}) — ${DISCARD_FIX[round.reason]}`)
      out('La ronda se descartó sin comitear nada: el merge sigue vivo, con los ficheros en conflicto restaurados a como los dejó git.')
      // The merge IS STILL UNDER WAY (the discard does not abort it), so
      // while there is budget left it is still ct-reconciler's turn — the new
      // package carries the discard's reason so that the next attempt is not
      // blind to why the previous one failed. With the budget spent, the
      // handover is the SAME as in CONFLICTING: it is the same ladder, and a
      // discarded round spends a retry precisely so that it reaches the
      // bottom.
      if (!budgetLeft) {
        handoverToSliceAgent()
        break
      }
      const packagePath = writeReconcileReviewPackage({ branch, round, attempt: nextReconcileAttempt() })
      out(`REDESPACHA ct-reconciler (subagente — declarado SIN Bash y SIN Write: ${RECONCILER_TOOLS}) con el paquete nuevo:`)
      out(`  - el paquete de reconciliación: ${packagePath}`)
      out(`Cuando vuelva:  ct-step reconcile --plan ${planPath} --issue ${issue}`)
      break
    }
    default:
      throw new Error(`ronda de reconciliación con desenlace sin mensaje: "${round.outcome}"`)
  }
  return outcomeOfReconcile(round.outcome)
}

// §3.7-A: the plan's end to end, executed BY THE PROGRAM after the last
// committed task. Same machinery as the `controls` commands
// (`runCheck`: the exit code rules, `unmeasured` is a different class
// of red), but without the index checks — here nothing is staged: the subject
// is the whole committed tree. A §8 declared "N/A" arrives here as an empty
// list of commands (plan-tasks.js accepts the N/A with the same tolerance as a
// task's **Tests:** one — the reason is asked for in the template, no program
// validates it), it is recorded and it moves on: demanding a command of it
// would be F14's impossible guard applied to §8.
function globalVerb() {
  const startedAt = Date.now()
  if (!globalVerification.commands.length) {
    measure('global', { outcome: OUTCOMES.DONE, global_log: null, commands: 0, duration_ms: Date.now() - startedAt })
    out('global: done (el plan declara N/A — no hay punta a punta que correr)')
    return OUTCOMES.DONE
  }
  const log = join(workDir, 'global-verification.log')
  const lines = []
  let result = OUTCOMES.DONE
  for (const command of globalVerification.commands) {
    const measured = runCheck(command)
    lines.push(`$ ${command}`, measured.output ?? '', `-> exit ${measured.code}`, '')
    if (measured.code === 'unmeasured') { result = OUTCOMES.INDETERMINATE; break }
    if (measured.code !== 0) { result = OUTCOMES.FAILED; break }
  }
  writeFileSync(log, lines.join('\n'))
  measure('global', { outcome: result, global_log: log, commands: globalVerification.commands.length, duration_ms: Date.now() - startedAt })
  // `lastGlobalLog` is what `next` shows the slice judge: the proof that the
  // end to end has already run, so that it does not re-derive it from the diff.
  run = { ...run, lastGlobalLog: log }
  out(`global: ${result} (log en ${log})`)
  return result
}

// §3.7-B: the verdict on the whole slice. Unlike the task's, a PASS does not
// wait for any `commit` — the last task is already committed, so the verdict
// opens its own commit right here, with the telemetry of the two new phases
// inside (the `global` and `slice-judge` rows are written after the last task
// commit, and without this add they would never travel).
// A FAIL leaves no tracked verdict, just as with the task judge: only the one
// that approves travels — the FAIL closes the run and the human reads it in
// the run's folder.
// THE TOKEN IS WRITTEN BY THE PROGRAM, not by the judge. `next` already
// dictates the verdict's path and this verb has already computed the token of
// the package and of the cut as it stands now: asking the model to copy 64 hex
// characters from a line the program has just written was the fourth thing it
// knew and asked about all the same, and a copying error discarded a whole
// opus verdict and spent one of the six discards that kill the run.
//
// IT IS INJECTED ONLY IF IT IS MISSING. A verdict that brings ANOTHER token is
// still rejected downstream (`verdict.review_token !== token`): it is defence
// in depth against the file of an earlier judgement at the same path, and
// overwriting it here would disarm exactly that check.
const withProgramToken = (value, token) =>
  (value && typeof value === 'object' && !Array.isArray(value) && value.review_token === undefined)
    ? { ...value, review_token: token }
    : value

function sliceVerdictVerb() {
  // THE INPUT BEFORE THE VERDICT, and for the same reason as in
  // `verdictVerb` (see the long comment there, which is where the field case
  // is): `writeSliceReviewPackage` is invoked ONLY by `next`, so with no file on
  // disk the slice judge had no accumulated diff to judge.
  const packagePath = join(workDir, 'slice-review.diff')
  if (!existsSync(packagePath)) {
    const why = `el paquete de revisión del slice no existe (${packagePath}): el juez de slice juzgó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al juez de slice. El paquete es de UN SOLO USO: lo consume el veredicto que lo lee, así que tras un veredicto aceptado hay que volver a pasar por next antes de despachar al juez de slice otra vez`
    measure('slice-judge', { outcome: 'discarded', why })
    out(`veredicto de slice descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // The same pair of checks as in `verdictVerb`, with the RANGE's diff
  // instead of the index's (see `sliceDiff`). Here the token covers what the
  // state's commit invariant does NOT cover: a commit ADDED in the gap already
  // dies at the `hechos !== esperados` crossing of the state load, but an
  // `--amend` leaves the count the same and the content different.
  const { token, why: whyPackage } = currentToken(packagePath, sliceDiff())
  if (whyPackage) {
    measure('slice-judge', { outcome: 'discarded', why: whyPackage })
    out(`veredicto de slice descartado: ${whyPackage}`)
    return OUTCOMES.DISCARDED
  }
  const { value, why: whyRead } = readJson(process.argv[3], 'del veredicto de slice')
  const { verdict, why } = whyRead ? { why: whyRead } : readSliceVerdict(withProgramToken(value, token))
  if (!verdict) {
    measure('slice-judge', { outcome: 'discarded', why })
    out(`veredicto de slice descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  if (verdict.review_token !== token) {
    const whyForeign = whyForeignToken(verdict.review_token, token)
    measure('slice-judge', { outcome: 'discarded', why: whyForeign })
    out(`veredicto de slice descartado: ${whyForeign}`)
    return OUTCOMES.DISCARDED
  }
  const outcome = outcomeOfSliceVerdict(verdict)
  measure('slice-judge', { outcome, review_package: packagePath, review_token: token, ...verdictMeasures(verdict), ...roleMeasures(STEPS.SLICE_JUDGE, packagePath) })
  // Here and not further down: AFTER measuring (the row names the package the
  // slice judge read, and it is written while that is still true) and BEFORE
  // the PASS branch, which writes, stages and COMMITS. Any of those writes can
  // throw —`mkdirSync`/`writeFileSync` over a read-only tree— and climb up to
  // the dispatch's catch: leaving the consumption behind them would open a
  // window in which a verdict already emitted did not spend its input.
  consumePackage(packagePath)
  if (verdict.ruling === 'PASS') {
    const path = join('docs', 'superpowers', 'verdicts', `issue-${issue}-slice.json`)
    mkdirSync(join(repoRoot, 'docs', 'superpowers', 'verdicts'), { recursive: true })
    writeFileSync(join(repoRoot, path), JSON.stringify({ issue, tasks_total: run.tasksTotal, verdict }, null, 2) + '\n')
    // The two `add` calls with `allowFail` follow the same doctrine as in
    // `verdict` and `commit`: evidence that cannot travel is warned about, it
    // never blocks a delivery whose work is already committed in full.
    if (git(['add', '--', path], { allowFail: true }) === null) {
      err(`warning: el veredicto del slice se escribió en ${path} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?). La entrega sigue.`)
    }
    if (existsSync(join(repoRoot, METRICS_REL)) && git(['add', '--', METRICS_REL], { allowFail: true }) === null) {
      err(`warning: no se pudo stagear la telemetría (${METRICS_REL}) — el veredicto del slice viaja sin ella. ¿La ruta está gitignoreada en este repo?`)
    }
    // AND THE INDEX IS NOT COMMITTED BLIND. This `git commit` goes without a
    // pathspec, so it carries EVERYTHING that is staged: if the conductor left
    // code in the index before calling `slice-verdict`, it went into the slice
    // verdict's commit without anyone having judged it — and nothing caught it,
    // because the slice package measures `baseSha..HEAD` and the index does not
    // show up in that diff. Measured: `git add colado.txt` before this verb and
    // `colado.txt` ended up inside "Veredicto del slice entero (#7)", with the
    // run delivering.
    //
    // BELONGING is enough (see `foreignInIndex`): here the index has to carry
    // only the two paths the lines above have just staged.
    //
    // And the treatment is that of evidence that cannot travel, not that of a
    // veto: the slice's verdict is VALID —it is of `baseSha..HEAD`, which this
    // does not change— and the slice's work is committed in full. Returning
    // FAILED would close the run at `blocked-slice-judge`, which exits with the
    // VETO's code (1) and would say the judge rejected the slice: it would be
    // lying about the judgement in order to punish a dirty index. So it warns,
    // it does not commit, and the delivery goes on — the two paths stay STAGED,
    // so taking the foreign material out and committing them by hand is one
    // line. Same doctrine as the `else` further down ("nada que commitear del
    // veredicto del slice ... la entrega sigue") and as the three `allowFail`.
    const foreign = foreignInIndex([path, METRICS_REL])
    if (foreign.length) {
      err(`warning: el índice traía ${foreign.length} ruta(s) ajenas a la maquinaria (${foreign.join(', ')}) y este commit se las llevaría dentro sin que ningún juez las haya visto — NO se comitea el veredicto del slice. La entrega sigue: el trabajo del slice ya está comiteado entero. El veredicto está escrito y STAGEADO en ${path}: saca lo ajeno del índice ("git restore --staged ${foreign[0]}", que no toca tu worktree) y comitéalo a mano antes de abrir la pull request.`)
    } else if ((git(['diff', '--cached', '--name-only']) || '').trim()) {
      let message = null
      try {
        message = sliceVerdictCommitMessage({ issue, tasksTotal: run.tasksTotal })
      } catch (e) {
        err(`warning: ${String(e.message)} — el veredicto del slice se queda sin commitear. La entrega sigue.`)
      }
      if (message !== null) {
        if (git(['commit', '-m', message], { allowFail: true }) === null) {
          err('warning: no se pudo commitear el veredicto del slice — la entrega no depende de la evidencia, pero revisa el índice antes de abrir la pull request.')
        } else {
          // The commit is counted in the STATE, and only when it really
          // happened. The next step (`e2e`) is another process: it re-reads
          // the file and crosses the commits against
          // `tasksTotal + sliceCommits` (see the state load). Without this
          // increment the crossing came out one short and the run stayed stuck
          // at PRECONDITION for ever. And it goes INSIDE the `else` because if
          // the two evidence paths are gitignored there is no commit: counting
          // it then would throw the count off in the other direction. Same
          // in-situ pattern as `lastGlobalLog` in `globalVerb` — `save()`
          // persists it at the end of the dispatch.
          run = { ...run, sliceCommits: (run.sliceCommits || 0) + 1 }
          out(`veredicto del slice comiteado: ${headSha().slice(0, 7)}`)
        }
      }
    } else {
      err('warning: nada que commitear del veredicto del slice (¿las dos rutas gitignoreadas?) — la entrega sigue.')
    }
  }
  out(`veredicto de slice ${verdict.ruling} con ${verdict.findings.length} hallazgo(s) → ${outcome}`)
  return outcome
}

function verdictVerb() {
  // THE INPUT BEFORE THE VERDICT. `next` is the ONLY verb that writes the
  // review package (`writeReviewPackage`, above; it is invoked only in
  // `nextVerb`'s JUDGE case), so if it is not on disk the judge had nothing to
  // judge: it judged blind. Measured in the field — an agent chained
  // report→controls→verdict without going back through `next`, and that PASS
  // only failed to get in because the judge itself confessed it could not find
  // the package. Without that confession, the PASS got in and the telemetry row
  // was left naming a file that does not exist. A step that demands an input
  // and does not check that it arrived delegates its guarantee to the agent's
  // honesty, which is exactly what this pipeline does nowhere else (the checks
  // do not take the implementer's word for it; the commit is not made by the
  // implementer; the index is verified instead of assumed).
  //
  // And it goes BEFORE `readJson` on purpose. With both things wrong —package
  // absent and JSON unreadable— the row that has to be written is the
  // package's: asking the judge again fixes a broken JSON, but it does not make
  // a package nobody generated appear, so measuring "the verdict could not be
  // read" would send the loop off to spend its six discards answering the
  // problem that was not the one, and the telemetry would count a judge that
  // writes badly instead of a conductor that skipped a step. The cause rules
  // over the symptom.
  const packagePath = join(workDir, `task-${run.task}-review.diff`)
  if (!existsSync(packagePath)) {
    const why = `el paquete de revisión no existe (${packagePath}): el juez juzgó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al juez con el paquete nuevo. El paquete es de UN SOLO USO: lo consume el veredicto que lo lee, así que tras un FAIL (o cualquier veredicto aceptado) hay que volver a pasar por next antes de despachar al juez otra vez — y volver a next SIN redespachar al juez deja un veredicto de otro diff, que este verbo también rechaza`
    // The row carries `outcome` and `why`, and no other measure: exactly the
    // shape of the other discards in this file. Without `ruling` —for
    // `aggregateVerdictMeasures` a row with `ruling` IS a verdict, and this is
    // its absence: counting it would inflate `rubric_sin_vara`'s denominator—
    // and without `review_package`, because naming in the telemetry the file
    // that is missing is writing precisely the row that points at a
    // non-existent one, which is what this guard exists to keep out.
    measure('judge', { outcome: 'discarded', why })
    out(`veredicto descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // THE INPUT IS STILL THE CUT AS IT STANDS NOW, and it goes BEFORE `readJson`
  // for the same reason as the existence guard: with both things wrong, the row
  // that has to be written is the package's. Asking the judge again fixes a
  // broken JSON and does NOT make the code go back to being the one it judged,
  // so measuring "the verdict could not be read" would send the loop off to
  // spend discards answering the problem that was not the one. The cause rules
  // over the symptom.
  const { token, why: whyPackage } = currentToken(packagePath, taskDiff())
  if (whyPackage) {
    // Same shape as the other discards: `outcome` and `why`, no other
    // measure. Without `review_package` or `review_token`, because naming in
    // the row the input of a judgement that is not accepted is writing the very
    // claim this guard exists to keep out.
    measure('judge', { outcome: 'discarded', why: whyPackage })
    out(`veredicto descartado: ${whyPackage}`)
    return OUTCOMES.DISCARDED
  }
  const { value, why: whyRead } = readJson(process.argv[3], 'del veredicto')
  const { verdict, why } = whyRead ? { why: whyRead } : readVerdict(withProgramToken(value, token))
  if (!verdict) {
    measure('judge', { outcome: 'discarded', why })
    out(`veredicto descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  // THE PRODUCT BELONGS TO THIS INPUT. Here is where the recycled verdict
  // dies: the one from the previous judgement brings the previous package's
  // token.
  if (verdict.review_token !== token) {
    const whyForeign = whyForeignToken(verdict.review_token, token)
    measure('judge', { outcome: 'discarded', why: whyForeign })
    out(`veredicto descartado: ${whyForeign}`)
    return OUTCOMES.DISCARDED
  }
  const outcome = outcomeOfVerdict(verdict)
  const major = verdict.findings.filter((f) => f.severity !== 'low')
  // `review_token` next to `review_package`: the input's path and its
  // IDENTITY. The path is no longer good for checking anything (the package is
  // consumed two lines further down), and the token says which code this
  // judgement was of — which is exactly what was indistinguishable in the
  // JSONL by either road. It is not derived from `verdictMeasures` because it
  // is not a measure of the judgement: it is the input's, and it goes where
  // the input's already lives.
  measure('judge', { outcome, review_package: packagePath, review_token: token, ...verdictMeasures(verdict), ...roleMeasures(STEPS.JUDGE, packagePath) })
  // The consumption goes HERE for the same reason as in the slice twin: the
  // row that names the package is written first, and everything that comes
  // after —`mkdirSync`, `writeFileSync` and the `git add` of the verdict that
  // travels in the task's commit— can fail without that turning the verdict
  // into one never emitted. None of those roads touches the package (the `add`
  // calls are by path, never `-A`), so consuming it earlier cannot sneak into
  // any commit.
  consumePackage(packagePath)
  archive('verdict', verdict)
  run = {
    ...run,
    lastVerdict: verdict,
    lastFindings: major.length ? major.map((f) => `- [${f.severity}] ${findingLocation(f)}: ${f.what}`).join('\n') : null,
  }
  if (verdict.ruling === 'PASS') {
    // The verdict TRAVELS in the pull request (F37's closure criterion: "el
    // PR de un slice trae un veredicto emitido por un agente que no ejecutó
    // nada"): the one that approves the task is written to a tracked path and
    // staged, so `commit` carries it inside its task's commit. What reaches
    // the PR is the judge's JSON, not a sentence of the commit message
    // claiming it. With `ruling` and not with the outcome, on purpose: a PASS
    // with medium findings orders corrections, and if the budget runs out the
    // task delivers all the same — that PASS is the verdict that approves it
    // and it has to travel (`report`'s reset unstages it between attempts and
    // the next PASS rewrites it, so the commit always gets the last one). It
    // is staged AFTER the checks on purpose: it is an artefact of the
    // machinery, like the plan, not the implementer's scope.
    const path = join('docs', 'superpowers', 'verdicts', `issue-${issue}-task-${run.task}.json`)
    mkdirSync(join(repoRoot, 'docs', 'superpowers', 'verdicts'), { recursive: true })
    writeFileSync(join(repoRoot, path), JSON.stringify({ issue, task: run.task, task_name: currentTask()?.name ?? null, verdict }, null, 2) + '\n')
    // `allowFail`, for the same reason as the telemetry's `git add` in
    // `commit`: without it, a repo that ignores this path makes the exception
    // climb up and leaves the task UNCOMMITTED with the run stuck at the
    // judge's step. Measured. A verdict that cannot travel degrades F37's
    // closure criterion and has to be seen —hence the warning, not a
    // silence—, but stopping does not fix it: the verdict is still written in
    // the run's folder, and whoever reviews the pull request sees that it is
    // not there. The work is committed; the evidence that it did not travel is
    // counted.
    if (git(['add', '--', path], { allowFail: true }) === null) {
      err(`warning: el veredicto se escribió en ${path} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?). La tarea se comitea igual.`)
    } else {
      out(`veredicto guardado y stageado: ${path}`)
    }
    // THE INDEX'S SEAL — the THIRD equality (slice 12).
    //
    // Slice 11's two tie the verdict to the package and the package to the
    // code, and both measure THE INSTANT of this verb. After that a window was
    // left: between this PASS and `ct-step commit` the conductor could
    // re-stage code and `commit` did not look at anything again — code no
    // judge had seen got in, with the telemetry row claiming the
    // `review_token` of the code that WAS reviewed. Reproduced WITH slice 11's
    // fix in place (that judge's `medium`): a `git add uno.txt` here and the
    // task was committed with the new version.
    //
    // It goes HERE: AFTER the `git add`. What `commit` is going to commit is
    // the index WITH the artefact the machinery has just laid on top of the
    // reviewed cut, so that is what has to be sealed; sealing before the add
    // would be sealing an index that no longer exists and would make ALL the
    // commits fail — the same trap of ordering that `taskDiff`'s comment
    // documents for the token. As a side effect, the artefact ends up inside
    // the seal: a verdict forged and staged in the gap does not get in either
    // (measured: today it does).
    //
    // Only on the PASS, and there is no need to clear it on the other roads:
    // the COMMIT step is only reached from a PASS —`done` and
    // `corrections-ordered` with the budget spent, the two branches of
    // `run-machine.js#afterJudge`, and both come out of `ruling === 'PASS'`—,
    // so the seal `commit` reads is ALWAYS that of the immediately preceding
    // verdict and never a stale one from three attempts back. A FAIL goes back
    // to implementing or closes the run; a discard asks again.
    run = { ...run, sealedTree: indexTree() }
  }
  out(`veredicto ${verdict.ruling} con ${verdict.findings.length} hallazgo(s) → ${outcome}`)
  return outcome
}

// H9 — THE ADVICE. Same treatment as the judge's verdict, and for the same
// reasons: the input is checked BEFORE the answer (an adviser with no package
// advised blind, and asking it again does not make the package nobody
// generated appear), and what does not meet the schema is a DISCARD and not an
// error — it gets asked again.
//
// A discard here does NOT spend the attempt the task has left: the adviser
// does not touch the code, so its unreadable answer cannot cost the same as a
// veto. What backs it is the slice's discard cap.
function adviceVerb() {
  const packagePath = join(workDir, `task-${run.task}-advice.md`)
  if (!existsSync(packagePath)) {
    const why = `el paquete del consejero no existe (${packagePath}): el consejero aconsejó a ciegas — vuelve a "ct-step next", que es el único paso que lo genera, y REDESPACHA al consejero con el paquete nuevo`
    measure(STEPS.ADVISE, { outcome: 'discarded', why })
    out(`consejo descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  const path = process.argv[3]
  const { value, why: whyRead } = readJson(path, 'del consejo')
  const { advice, why } = whyRead ? { why: whyRead } : readAdvice(value)
  measure(STEPS.ADVISE, {
    outcome: advice ? 'done' : 'discarded',
    why: advice ? null : why,
    // The weight of what the adviser answered, measured on the file that
    // exists on disk — never `0` when it cannot be measured: a zero would
    // claim an empty piece of advice, and what has happened is that it could
    // not be looked at.
    advice_bytes: typeof path === 'string' ? sizeOnDisk(path) : null,
    advice_paths: advice ? advice.files_to_reconsider.length : null,
    ...roleMeasures(STEPS.ADVISE, packagePath),
  })
  if (!advice) {
    out(`consejo descartado: ${why}`)
    return OUTCOMES.DISCARDED
  }
  run = { ...run, lastAdvice: advice }
  // HAPPY-TO-DELETE: the third attempt does not start on top of two layers of
  // patches. It goes AFTER the telemetry row and after accepting the advice,
  // so that a git failure while cleaning does not sweep away the advice that
  // could be read.
  const cleaned = resetTaskTree()
  out(`consejo aceptado: ${advice.files_to_reconsider.length} ruta(s) a reconsiderar; el árbol vuelve al último commit en ${cleaned} ruta(s)`)
  return OUTCOMES.DONE
}

// THE TREE BACK TO THE LAST COMMIT (H9). It is not a general clean-up: it is
// exactly the paths `entradasDelArbol` measures as the task's work, and that
// already excludes the run's file, its folder and the machinery, but NO LONGER
// THE PLAN: an implementer's amendment is returned along with the rest of the
// vetoed attempt, which is the semantics that is wanted —it dies with what
// motivated it— (`LOOP_ARTIFACT_PATTERNS`, where the telemetry that travels in
// the repo lives). A bare `git checkout -- .` would take with it the package
// the advisor has just read and the row this very verb has just written.
//
// The mechanism `report` already uses to know what the task touched is reused,
// and not a new one: two definitions of "the task's paths" are two answers
// that diverge, and here the divergence is paid for by deleting what was not
// it.
//
// The index is emptied first for the same reason as in `report`: with the
// previous attempt's index in place, `git status` reads what was only staged
// as "added and deleted", and what counts as tracked gets decided over a state
// that no longer is.
function resetTaskTree() {
  git(['reset', '-q'])
  const entries = treeEntries()
  const isNew = ({ status }) => status === '??'
  const tracked = entries.filter((e) => !isNew(e)).map(({ path }) => path)
  const untracked = entries.filter(isNew).map(({ path }) => path)
  if (tracked.length) git(['checkout', '--', ...tracked])
  if (untracked.length) git(['clean', '-q', '-f', '-d', '--', ...untracked])
  return entries.length
}

function commitVerb() {
  // WHAT GETS COMMITTED IS WHAT WAS APPROVED, and it is checked before
  // anything else.
  //
  // The third equality (see the seal in `verdictVerb`): the index as it
  // stands now has to be the SAME one the machinery sealed when it accepted
  // the verdict. It goes ahead of the message and of the "nothing is staged"
  // because those two ask whether git CAN commit and this one asks whether it
  // SHOULD: a badly composed message is fixed by fixing the plan, and a commit
  // with unreviewed code inside is never fixed, because it is already on the
  // branch. And it goes before the telemetry's `git add` out of necessity:
  // that add changes the index.
  //
  // WITHOUT a telemetry row, like this verb's other two failures: the `commit`
  // step has no row —an earlier decision, pinned by the test "there is no
  // commit row": it used to be carried inside the following commit, so the last
  // task's never travelled at all— and opening one just for the failure would
  // break that property and would put into the JSONL a shape `run-metrics.js`
  // does not aggregate. It does not go mute: it comes out on stderr, the exit
  // is 8, and the run stays stopped at `commit` with the seal written in the
  // state file, which is what has to be read in order to fix it.
  if (typeof run.sealedTree !== 'string') {
    err(`el estado no trae el sello del índice (sealedTree) que el veredicto de esta tarea tenía que dejar: o este run venía de una versión del plugin anterior a esta comprobación —se quedó parado en "commit" mientras se actualizaba—, o alguien editó ${stateFile}. Sin sello no se puede afirmar que lo stageado sea lo que el juez aprobó, y este programa no comitea lo que no puede afirmar. Compruébalo tú y comitea a mano (el veredicto está en docs/superpowers/verdicts/issue-${issue}-task-${run.task}.json), o arranca el run de nuevo: lo que no hay es un modo sin barandilla que se active BORRANDO un campo.`)
    return OUTCOMES.FAILED
  }
  const currentTree = indexTree()
  if (currentTree !== run.sealedTree) {
    err(`el índice ya no es el que el juez aprobó: al aceptar el veredicto quedó sellado el árbol ${run.sealedTree} y el del índice de ahora es ${currentTree}. Algo lo cambió DESPUÉS del veredicto, así que este commit se llevaría dentro código que ningún juez ha visto, con el veredicto de otro código viajando al lado. NO se comitea nada.
  - para devolver el índice aprobado, tal cual y sin tocar tu worktree:  git read-tree ${run.sealedTree}
    y repite "ct-step commit". Lo que hayas stageado después sigue en los ficheros: no se pierde, deja de estar stageado.
  - si ese código TIENE que entrar, no entra por aquí: desde "commit" no hay vuelta al juez en este run. Sácalo del índice, comitea la tarea aprobada, y que ese trabajo entre por la tarea siguiente o por otro slice.`)
    return OUTCOMES.FAILED
  }
  const t = currentTask()
  let message
  try {
    message = commitMessage({ issue, task: run.task, tasksTotal: run.tasksTotal, name: t.name })
  } catch (e) {
    err(String(e.message))
    return OUTCOMES.FAILED
  }
  if (!(git(['diff', '--cached', '--name-only']) || '').trim()) {
    err(`la tarea ${run.task} no dejó nada stageado: no hay nada que commitear`)
    return OUTCOMES.FAILED
  }
  // The telemetry goes in HERE, with all this task's rows already written —
  // including those of the attempts the judge vetoed, which is the datum that
  // says what the round trips cost. The `git reset` that `report` does at the
  // start of every attempt unstages, it does not delete content, so they are
  // still in the file.
  //
  // And there is NO `commit` row: it was the only one written AFTER the
  // commit, so it travelled inside the following task's commit and the last
  // one's never travelled at all. What it carried —the sha and the fact that
  // the task was committed— is there in full in `git log`. Without it, the
  // file staged here contains exactly this task's rows and the previous ones',
  // and none is left out of the pull request.
  // `allowFail`, and not out of generic prudence: without it this `git add` is
  // the first road by which the telemetry could bring a run down, which is
  // exactly what the design forbids ("ninguna transición depende de la
  // medida"). Measured: with `docs/` in the repo's .gitignore, `git add` exits
  // with 1, the exception climbs up and the task is left UNCOMMITTED with the
  // run stuck. The measure is lost and the work is committed, never the other
  // way round.
  if (existsSync(join(repoRoot, METRICS_REL)) && git(['add', '--', METRICS_REL], { allowFail: true }) === null) {
    err(`warning: no se pudo stagear la telemetría (${METRICS_REL}) — la tarea se comitea sin ella. ¿La ruta está gitignoreada en este repo?`)
  }
  if (git(['commit', '-m', message], { allowFail: true }) === null) return OUTCOMES.FAILED
  const sha = headSha()
  // `lastAdvice` goes away with the committed task, like everything else that
  // named it: the advice was dictated by an adviser that read THIS task's two
  // vetoes, and inheriting it would put into the next one's brief an approach
  // to a problem that no longer exists.
  run = { ...run, lastFindings: null, lastPaths: null, lastSummary: null, lastAdvice: null }
  out(`commiteada la tarea ${run.task}/${run.tasksTotal}: ${sha.slice(0, 7)}`)
  return OUTCOMES.DONE
}

// The markdown is written by the PROGRAM, not by the agent that crosses the
// slice. Same division as with the commit ("the program commits, not the
// implementer"): that way there is no prose to validate, no heading can be
// missing and no journey can be quoted wrong, and what reaches the pull
// request is EXACTLY what `readE2eReport` accepted — not a separate narration
// somebody could let drift out of line with the validated JSON.
function writeE2eReport(runs) {
  const sectionOf = (r) => {
    const lines = [`## ${r.run}`, '', `**Veredicto:** ${r.verdict}`]
    if (r.brought_up) lines.push('', `**Cómo se levantó:** ${r.brought_up}`)
    if (r.verdict === 'verde') {
      lines.push('', '**Evidencia:**', '')
      for (const e of r.evidence || []) lines.push(`- \`${e.command}\` → \`${e.output}\``)
    } else if (r.verdict === 'rojo') {
      lines.push(
        '',
        `**Esperado:** ${r.expected}`,
        `**Real:** ${r.actual}`,
        `**Cómo reproducirlo:** ${r.repro}`,
        `**Por qué no cuenta:** ${r.refuted_by}`,
      )
    } else {
      lines.push('', `**Motivo:** ${r.reason}`, `**Para desbloquear:** ${r.unblock}`)
    }
    return lines.join('\n')
  }
  const md = [`# E2E — issue #${issue}`, ...runs.map(sectionOf), ''].join('\n\n')
  const path = join('docs', 'superpowers', 'e2e', `${issue}.md`)
  mkdirSync(join(repoRoot, 'docs', 'superpowers', 'e2e'), { recursive: true })
  writeFileSync(join(repoRoot, path), md)
  // `allowFail`, same reason as the verdict and the telemetry: a repo that
  // gitignores `docs/` cannot be allowed to leave the run stuck because of a
  // `git add` that throws. The report stays written in the tree even if it does
  // not travel in the commit; what is lost is warned about, not kept quiet.
  if (git(['add', '--', path], { allowFail: true }) === null) {
    err(`warning: el informe de e2e se escribió en ${path} pero NO se pudo stagear, así que no viajará en la pull request (¿la ruta está gitignoreada en este repo?).`)
  }
  return path
}

function e2eVerb() {
  const { value, why: whyRead } = readJson(process.argv[3], 'del informe de e2e')
  const { outcome, runs, why } = whyRead
    ? { outcome: OUTCOMES.DISCARDED, why: whyRead }
    : readE2eReport(value, run.e2eRuns)
  measure('e2e', {
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
  writeE2eReport(runs)
  // Each journey's verdict is PERSISTED in the run. Until this branch's final
  // review, `run-<issue>.json` kept only the NAMES (`e2eRuns`, the seeded
  // ones), so gate 8 of `dispatch-check --release` could not tell a green
  // slice from one whose journeys were all "no-verificado" — and three texts
  // (this file, gates.js#GATES.e2e.issue and the design's §3.7) promised that
  // --release "says so". *No-verificado* is the state that releases a slice
  // WITHOUT having verified it: for it to be silent at the gate is the
  // opposite of this branch's doctrine, "a stated limit is operable".
  //
  // The shape is the minimum that sustains that warning: journey -> verdict,
  // plus the `reason` when there is one (only *no-verificado* carries it).
  // Neither the evidence nor the red's four fields: that is already there in
  // full in `docs/superpowers/e2e/<issue>.md`, which does travel in the pull
  // request. `deliveredRun` notices nothing at all: it reads `issue` and
  // `closed`, and one more field in the JSON changes none of its answers.
  run = {
    ...run,
    // `reason` only when there is one: `readE2eReport` has already demanded
    // that it be non-empty text in the only verdict that carries it
    // (*no-verificado*), so here it is enough to look at whether it is there.
    e2eResults: runs.map((r) => (r.reason ? { run: r.run, verdict: r.verdict, reason: r.reason } : { run: r.run, verdict: r.verdict })),
  }
  for (const r of runs) out(`${r.verdict}: ${r.run}`)
  return outcome
}

// Commits the e2e report that `writeE2eReport` left STAGED. It is not done
// from there: committing belongs to the moment in which it is known whether
// the run CLOSES, not to when the file is written, and that is only known
// after applying the transition. That is why the one that calls this is the
// final dispatch and not `e2eVerb`.
//
// ONLY on DELIVERED (green, or green with some no-verificado): on BLOCKED_E2E
// (red) the run does NOT close, so `.agent/run-<issue>.json` gets loaded again
// on the next attempt — and there the commit invariant compares `hechos`
// against `esperados` (`tasksTotal` at the `e2e` step, see the branch above).
// One commit too many here would make `hechos > esperados` and would bring
// THAT attempt down with PRECONDITION before anybody got round to fixing the
// red. On DELIVERED the run is never loaded again (the state load's
// `closed === DELIVERED` guard answers and exits BEFORE the commit crossing),
// so committing there breaks no future count. The red road's report stays
// staged on purpose: it is the proof that it is waiting for whoever fixes the
// failure.
function commitE2eReport() {
  const path = join('docs', 'superpowers', 'e2e', `${issue}.md`)
  // It does not close the issue: it is the report of the crossing, not the
  // work that closes it, so the message carries no closing keyword — and that
  // is checked, with the same mechanism as `commitMessage`
  // (step-contracts.js), because the `commit-keyword-guard` hook is a
  // PreToolUse over a SESSION's Bash: a `git commit` launched by this program
  // does not pass through that gate, so if the program does not look at the
  // message, nobody does.
  // With no conventional-commits prefix ("docs:", "feat:"): that is the
  // convention of this very repository's HUMAN commits (see `git log`), not
  // that of the ones the program emits inside a slice — `commitMessage`
  // (step-contracts.js), which commits every task, does not use it either.
  // Same style as that one: descriptive title + body with the why +
  // co-authorship.
  const message = `informe de e2e del issue #${issue}

Generado por ct-step tras el paso e2e de la slice. No cierra el issue.

${CtStepCommit.TRAILER_LINE}
Co-Authored-By: Claude <noreply@anthropic.com>`
  // The SAME care as in the slice's verdict and for the same reason: this
  // `git commit` does not carry a pathspec either. Measured the same way
  // (`git add colado.txt` before `ct-step e2e` and the file ended up inside
  // the report's commit). It goes before the closing-keywords guard because
  // first it is decided WHAT goes into the repo and afterwards how it is
  // labelled.
  const foreign = foreignInIndex([path])
  if (foreign.length) {
    err(`warning: el índice traía ${foreign.length} ruta(s) ajenas a la maquinaria (${foreign.join(', ')}) y este commit se las llevaría dentro sin que ningún juez las haya visto — el informe de e2e (${path}) queda STAGEADO y sin comitear. Saca lo ajeno del índice ("git restore --staged ${foreign[0]}", que no toca tu worktree) y comitéalo a mano antes de abrir la pull request.`)
    return
  }
  const keywords = findClosingKeywords(message)
  if (keywords.length) {
    err(`warning: el mensaje del commit del informe de e2e contiene una closing keyword (${keywords.map((k) => `${k.keyword} ${k.ref}`).join(', ')}) y cerraría el issue sin que nadie lo haya decidido — NO se comitea. El informe (${path}) queda stageado.`)
    return
  }
  // `allowFail`, same criterion as the rest of this program's artefact
  // commits (verdict, telemetry): not committing cannot bring down a run that
  // has already been DELIVERED, so it warns and the file stays staged instead
  // of being lost.
  if (git(['commit', '-m', message], { allowFail: true }) === null) {
    err(`warning: el informe de e2e (${path}) quedó stageado pero NO se pudo comitear — revísalo a mano antes de abrir la pull request.`)
    return
  }
  out(`informe de e2e comiteado: ${path}`)
}

// ---------------------------------------------------------------------------
// Apply the outcome to the table, and say what comes now.
// ---------------------------------------------------------------------------
try {
  if (verbo === 'next') nextVerb()

  requireStep(verbo)
  const outcome = {
    report: reportVerb, controls: controlsVerb, verdict: verdictVerb, advice: adviceVerb, commit: commitVerb,
    reconcile: reconcileVerb, global: globalVerb, 'slice-verdict': sliceVerdictVerb, e2e: e2eVerb,
  }[verbo]()

  if (run.discards >= MAX_DISCARDS && outcome === OUTCOMES.DISCARDED) {
    save()
    die(`${run.discards} descartes en este run: se para en vez de seguir pidiendo respuestas que no se pueden leer`, EXIT.NO_VERDICT)
  }

  const before = run.step
  const transition = after(run, outcome, DEFAULT_BUDGETS)
  run = transition.run
  // The good closure is PERSISTED: "delivered" has to be readable from the
  // file without rebuilding the table, because `dispatch-check --release`
  // demands it before releasing. A prompt is not a gate; this is the gate's
  // ct-step half.
  if (transition.state === RUN_STATES.DELIVERED) run = { ...run, closed: RUN_STATES.DELIVERED }
  save()

  // The e2e report is committed HERE, after persisting the state and only if
  // the verb just applied was `e2e` and the transition closed the run in
  // DELIVERED — see `commitE2eReport`'s comment for why that exact
  // condition (and for why the red road commits NOTHING).
  if (verbo === 'e2e' && transition.state === RUN_STATES.DELIVERED) {
    commitE2eReport()
  }

  if (transition.state === RUN_STATES.OPEN) {
    out('')
    out(`siguiente: tarea ${run.task}/${run.tasksTotal}, paso ${run.step} — pregunta con "ct-step next"`)
    process.exit(EXIT.OK)
  }

  out('')
  out(`run ${transition.state}: tarea ${run.task}/${run.tasksTotal}, ${run.discards} descarte(s)`)
  process.exit(exitCodeOf(transition.state, before, outcome))
} catch (e) {
  save()
  err(`excepción no prevista: ${e.stack || e.message}`)
  process.exit(EXIT.UNNAMED)
}

function exitCodeOf(state, step, outcome) {
  switch (state) {
    case RUN_STATES.DELIVERED:
      out('las tareas comiteadas, la Global verification en verde y el slice con veredicto PASS: la rama está lista para la pull request.')
      return EXIT.OK
    case RUN_STATES.BLOCKED_COMMIT: return EXIT.PRECONDITION
    // Phase B: the reconciler and, once its budget was spent, the slice agent
    // did not leave the base up to date. Its own code, like GLOBAL_RED: what
    // comes next is not "fix the task", it is resolving the conflict before
    // anything else.
    case RUN_STATES.BLOCKED_RECONCILE: return EXIT.RECONCILE_BLOCKED
    case RUN_STATES.BLOCKED_CONTROLS:
      return outcome === OUTCOMES.INDETERMINATE ? EXIT.CONTROLS_UNMEASURED : EXIT.CONTROLS_RED
    case RUN_STATES.BLOCKED_JUDGE:
      // The judge's veto and "there was no verdict" close through the same
      // place and mean different things: one is a judgement and the other is
      // its absence.
      return outcome === OUTCOMES.DISCARDED ? EXIT.NO_VERDICT : EXIT.VETOED
    // §3.7-A: the same pair as controls (red / unmeasurable), with their own
    // codes because the next action is a different one — there is no task to
    // fix, there is a pull request that does NOT get opened.
    case RUN_STATES.BLOCKED_GLOBAL:
      return outcome === OUTCOMES.INDETERMINATE ? EXIT.GLOBAL_UNMEASURED : EXIT.GLOBAL_RED
    // §3.7-B: the slice judge's veto is a veto, the same code as the task
    // judge's — a discard never closes through here (it asks again).
    case RUN_STATES.BLOCKED_SLICE_JUDGE: return EXIT.VETOED
    case RUN_STATES.BLOCKED_E2E: return EXIT.E2E_RED
    case RUN_STATES.ABORTED_BUDGET: return EXIT.UNNAMED // nobody measures money here
    default: return EXIT.UNNAMED
  }
}
