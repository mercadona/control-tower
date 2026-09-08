// The state machine as an ORACLE (scripts/ct-step.mjs): the session keeps
// driving, but it does not decide the sequence — it asks for it.
//
// This test needs neither process fixtures nor --dry-run, and that is not a
// convenience: the implementer's report and the judge's verdict ARE JSON files,
// so the test writes exactly what a subagent will write. The only thing not
// simulated is git, which runs for real against a temporary repo — half the
// properties here (the program commits, only what was declared goes in, a veto
// leaves no trace) do not exist if git is a double.
//
// THE PREAMBLE LIVES HERE and the 24 describes in nine
// `__tests__/ct-step-*.test.js` files: vitest parallelises BETWEEN files and
// never inside one, so the 111 tests in a single file ran serially on one
// worker with the rest of the cores idle — 530 of the 533 s the whole suite
// took. Split up, 260 s.
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VERDICT_RULES, SLICE_VERDICT_RULES } from '../../scripts/step-contracts.js'
// Slice 10: renderState seeds the SLICE.md of the signal tests through the same
// path as buildStateSeed (it folds and quotes long values — the reason ct-step
// reads `senal:` with parseStateSafe and not with a regex), and SIGNAL_ABSENT
// is the single constant the slice judge's package declares absence with.
import { renderState } from '../../scripts/state.js'

const here = dirname(fileURLToPath(import.meta.url))
export const SCRIPT = join(here, '..', '..', 'scripts', 'ct-step.mjs')
export const PLUGIN_ROOT_TEST = join(here, '..', '..')
export const F = '```'

// §8 is kept apart so the global-phase tests can substitute it in one piece.
// Since §3.7-A a plan without an executable "## 8. Global verification" is not
// executable (exit 6), so EVERY fixture declares it.
export const GLOBAL_VERIFICATION = [
  '## 8. Global verification',
  '',
  F + 'bash',
  'test -f uno.txt && test -f dos.txt',
  F,
  '',
].join('\n')

export const PLAN = [
  '# #7 — two made-up tasks',
  '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**',
  '',
  '## 7. Tasks',
  '',
  '### Task 1 — the first one',
  '**Objective:** one file.',
  '**Files:** `uno.txt` (create).',
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** the file is there.',
  '',
  F + 'bash',
  'test -f uno.txt',
  F,
  '',
  '### Task 2 — the second one',
  '**Objective:** another file.',
  '**Files:** `dos.txt` (create).',
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** the other file is there.',
  '',
  F + 'bash',
  'test -f dos.txt',
  F,
  '',
  GLOBAL_VERIFICATION,
].join('\n')

// `e2e` seeds the journeys into SLICE.md, which is where ct-step reads them
// from when creating the run (there is no `gh` in this program). It is written
// with `renderState` and not by hand for the same reason the signal's is: what
// parses it is a real YAML, and a journey is a sentence with commas and colons
// inside it.
export function makeRepo({ e2e = null } = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ct-step-'))
  const g = (...a) => execFileSync('git', a, { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  g('init', '-q', '-b', 'main')
  g('config', 'user.email', 't@e.com')
  g('config', 'user.name', 'T')
  g('config', 'commit.gpgsign', 'false')
  mkdirSync(join(d, '.agent'), { recursive: true })
  writeFileSync(join(d, '.agent', 'SLICE.md'), e2e
    ? renderState({ meta: { issue: 7, epic: 12, e2e }, body: '# made-up slice' })
    : '---\nissue: 7\nepic: 12\n---\n\n# made-up slice\n')
  writeFileSync(join(d, 'plan.md'), PLAN)
  // WHAT THIS FIXTURE WRITES INSIDE THE REPO AND IS NO TASK'S WORK: the JSON
  // standing in for the subagent's answer (in a real run `next` dictates it
  // inside `.agent/run-<n>/`) and the telemetry, which here is diverted to
  // `.telemetria/` so it can be read and in a real run lives in
  // CLAUDE_CONFIG_DIR, outside the repo. Since `ct-step report` measures the
  // tree with `git status`, a scaffolding file would count as the task's work
  // and the scope check would veto it for something the implementer never
  // wrote.
  writeFileSync(join(d, '.gitignore'), '.telemetria/\n/*.json\n')
  g('add', '-A')
  g('commit', '-q', '-m', 'slice base')
  // The `reconcile` step (Phase B, Task 8) talks to a real git —
  // `BranchReconciliation.merge` does `git fetch origin <branch>` and measures
  // how many commits it brings — so the repo needs a real `origin`. A bare that
  // starts RIGHT HERE and is never touched again is, by construction, "the base
  // that has not moved": what the tests reaching `reconcile` through this
  // fixture measure by default.
  const origin = mkdtempSync(join(tmpdir(), 'ct-step-origin-'))
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { stdio: 'ignore' })
  g('remote', 'add', 'origin', origin)
  g('push', '-q', 'origin', 'main')
  // THE FILES ARE NOT SEEDED HERE. `writeReport(...)` writes them, the helper
  // standing in for the implementer: since `ct-step report` measures paths with
  // `git status` instead of believing the declaration, seeding the two files of
  // the two tasks while setting the repo up would leave task 1's tree with task
  // 2's work inside it — and the scope check would veto it, rightly. A real
  // implementer touches the files of THEIR task.
  return d
}

// These tests do not care about the rule: task 4 added it to the contract, and
// any valid rule is enough for the verdict to stay valid without rewriting
// every call in this file. The same goes for the rubric's WALKTHROUGH, which
// the contract has demanded in full since Step 3: it is composed here from the
// module's own list of rules, so it is neither typed eight times nor left
// behind the day the rubric changes size.
// And the same for the two fields the contract added later: the CLASS of each
// step's result and the CITATION of each finding. These tests do not care about
// those either — what they measure is the machine, not the judgement — so they
// are filled in here with a valid value instead of at each of the file's twenty
// call sites.
export const fullRubric = () => VERDICT_RULES.map((rule) => ({ rule, result: `looked at in the test: ${rule}`, outcome: 'conforme' }))

// The SLICE judge's verdict (§3.7-B): the walkthrough is composed from
// SLICE_VERDICT_RULES (map), never a hand-written list, for the same reason as
// `fullRubric` — so the fixture is not left behind if the rubric changes size
// (Slice 10 took it from two items to three without touching these lines).
export const sliceRubric = () => SLICE_VERDICT_RULES.map((rule) => ({ rule, result: `looked at in the test: ${rule}`, outcome: 'conforme' }))

// The helpers below CLOSE over the test's temporary repo: a different one in
// each `beforeEach`, and there is a nested `beforeEach` that REASSIGNS it as
// well. That is why they are handed out by a factory and not as module
// functions — `ref` is an accessor (`() => repo`) that reads the test file's
// live binding, never the copy of whatever value it held when imported.
export function makeHelpers(ref) {
  const ct = (...args) => spawnSync('node', [SCRIPT, ...args, '--plan', 'plan.md', '--issue', '7'], {
    cwd: ref(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: join(ref(), '.telemetria') },
  })

  // What a subagent would write, to a file. `paths` is a list of plain paths:
  // the report does not tell production from test (see step-contracts.js). It
  // also writes the files it declares, if they are not there: an implementer
  // who declares a path has touched it, and since the program measures the tree
  // instead of believing the list, a file that does not exist is not staged.
  // What is already written is NOT overwritten — some tests prepare the content
  // beforehand.
  const writeReport = (paths, name = 'report.json', summary = 'done') => {
    for (const declared of paths) {
      const target = join(ref(), declared)
      if (!existsSync(target)) writeFileSync(target, `${declared}\n`)
    }
    const p = join(ref(), name)
    writeFileSync(p, JSON.stringify({ paths, summary }))
    return p
  }
  const writeVerdict = (ruling, findings = [], name = 'verdict.json') => {
    const p = join(ref(), name)
    const withRule = findings.map((f) => ({ rule: 'alcance', evidence: 'the line that proves it', ...f }))
    writeFileSync(p, JSON.stringify({ ruling, rubric: fullRubric(), findings: withRule }))
    return p
  }
  const writeRaw = (text, name = 'crudo.json') => {
    const p = join(ref(), name)
    writeFileSync(p, text)
    return p
  }
  const writeSliceVerdict = (ruling, findings = [], name = 'slice-verdict.json') => {
    const p = join(ref(), name)
    const withRule = findings.map((f) => ({ rule: 'coherencia', evidence: 'the line that proves it', ...f }))
    writeFileSync(p, JSON.stringify({ ruling, rubric: sliceRubric(), findings: withRule }))
    return p
  }

  const log = () => execFileSync('git', ['log', '--oneline'], { cwd: ref(), encoding: 'utf8' })
  const commits = () => log().trim().split('\n').filter(Boolean).length
  const runState = () => JSON.parse(readFileSync(join(ref(), '.agent', 'run-7.json'), 'utf8'))

  const taskPackage = (n = runState().task) => join(ref(), '.agent', 'run-7', `task-${n}-review.diff`)
  const slicePackage = () => join(ref(), '.agent', 'run-7', 'slice-review.diff')
  const judgeRows = (step = 'judge') => readFileSync(join(ref(), '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l)).filter((row) => row.step === step)

  // Slice 11 — the judge COPIES the `Review token:` line from the package's
  // header into the `review_token` field of its verdict. The fixture does
  // exactly that, and that is why it SEALS AFTER `next`: when
  // `writeVerdict(...)` writes the file, the package does not exist yet
  // (`escribirPaquete` only runs in `next`). A file that is not JSON
  // (`writeRaw`) is left untouched — that is the retry for unreadable JSON,
  // which has to go on being discarded for THAT reason and not for the token.
  const packageToken = (path) => {
    const m = /^Review token: ([0-9a-f]{64})$/m.exec(readFileSync(path, 'utf8'))
    return m ? m[1] : null
  }
  const seal = (json, pkg) => {
    const token = existsSync(pkg) ? packageToken(pkg) : null
    if (token === null) return json
    let v
    try { v = JSON.parse(readFileSync(json, 'utf8')) } catch { return json }
    writeFileSync(json, JSON.stringify({ ...v, review_token: token }))
    return json
  }

  // Slice 3 — `next` is the ONLY verb that writes the package the judge judges
  // (`escribirPaquete` / `escribirPaqueteDeSlice` in ct-step.mjs), and from this
  // slice on a `verdict` with no package on disk is DISCARDED. A real run always
  // goes through `next` before dispatching to the judge — the kickoff orders it:
  // "come back to next after every step" — so these tests do too: asking for the
  // verdict is, by definition, having asked first. The two helpers exist so the
  // step is not forgotten at the twenty-first site.
  //
  // Slice 11: and now they also seal the verdict with the token of the package
  // `next` has just written — an honest judge copies that line, and these
  // helpers are that judge.
  const judgeTask = (...args) => { ct('next'); seal(args[0], taskPackage()); return ct('verdict', ...args) }
  const judgeSlice = (...args) => { ct('next'); seal(args[0], slicePackage()); return ct('slice-verdict', ...args) }

  // A whole task down the happy path.
  const taskOk = (file) => {
    ct('report', writeReport([file]))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    return ct('commit')
  }
  // The whole slice down the happy path: the two tasks, the reconciliation with
  // the base (Phase B, Task 8 — the fixture leaves the base unmoved, so it comes
  // out on the first round), the Global verification and the slice's judgement
  // (§3.7).
  const sliceOk = () => {
    taskOk('uno.txt')
    taskOk('dos.txt')
    ct('reconcile')
    ct('global')
    return judgeSlice(writeSliceVerdict('PASS'))
  }

  return {
    ct, writeReport, writeVerdict, writeRaw, writeSliceVerdict, log, commits, runState,
    taskPackage, slicePackage, judgeRows, packageToken, seal,
    judgeTask, judgeSlice, taskOk, sliceOk,
  }
}
