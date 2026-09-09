// A piece of the state machine of scripts/ct-step.mjs. The preamble —and why
// there are nine files and not one— is in fixtures/ct-step-harness.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync, cpSync, symlinkSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PluginYardstick } from '../scripts/plugin-yardstick.js'
import { RoleBytes } from '../scripts/role-bytes.js'
import { STEPS } from '../scripts/run-machine.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo, PLUGIN_ROOT_TEST } from './fixtures/ct-step-harness.js'

let repo
const { ct, writeReport, writeVerdict, writeSliceVerdict, log, commits, runState, judgeTask,
  judgeSlice, taskOk, taskPackage, slicePackage, judgeRows, seal } = makeHelpers(() => repo)

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

// Steps 4, 5 and 6 of the spec of the first run in a foreign repo.
describe('what the implementer warns about, and the telemetry, do not stay where nobody reads them', () => {
  it('Step 4: `report` prints the summary of the report', () => {
    // The implementer's prompt orders it to put in `summary` the closed decision
    // it obeyed grudgingly and the problem it saw and did not touch. Measured in
    // the field (jjponz/rust-monitoring#10): it said the Cargo.lock is committed
    // "para CI reproducible" while the workflow runs without --locked, and that
    // reached the pull request ONLY because that session opened the report file
    // on its own account. No verb printed it and no other one consulted it.
    const r = ct('report', writeReport(['uno.txt'], 'report.json', 'obedecí la fila del Cargo.lock y creo que se paga caro'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/obedecí la fila del Cargo.lock/)
  })

  it('Step 4: `next` repeats it at the commit step, which is when the session writes the pull request', () => {
    ct('report', writeReport(['uno.txt'], 'report.json', 'la decisión de la tarea 2 deja el lockfile sin hacer valer'))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    const r = ct('next')
    expect(r.stdout).toMatch(/paso: commit/)
    expect(r.stdout).toMatch(/lockfile sin hacer valer/)
  })

  it('Step 5: the telemetry travels INSIDE the commit of its task', () => {
    taskOk('uno.txt')
    const touched = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })
    expect(touched).toMatch(/docs\/superpowers\/metrics\/issue-7\.jsonl/)
    const rows = readFileSync(join(repo, 'docs', 'superpowers', 'metrics', 'issue-7.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(rows.every((f) => f.issue === 7 && f.task === 1)).toBe(true)
  })

  it('Step 5: it is NOT staged before the checks, or the scope check would veto the task', () => {
    // The verdict already settled this same thing: it is an artefact of the
    // machinery, not the implementer's scope, so it enters the index AFTER
    // measuring.
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const inIndex = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: repo, encoding: 'utf8' })
    expect(inIndex).not.toMatch(/metrics/)
    expect(inIndex).toMatch(/uno\.txt/)
  })

  it('Step 5: the rows of the attempt the judge vetoed travel too — the cost of the round trips is the datum', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('FAIL', [{ severity: 'high', what: 'no', path: 'uno.txt', line: 1 }]))
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    ct('commit')
    const committed = execFileSync('git', ['show', 'HEAD:docs/superpowers/metrics/issue-7.jsonl'], { cwd: repo, encoding: 'utf8' })
    const rows = committed.trim().split('\n').map((l) => JSON.parse(l))
    expect(rows.filter((f) => f.attempt === 1).length).toBeGreaterThan(0)
    expect(rows.filter((f) => f.attempt === 2).length).toBeGreaterThan(0)
    expect(rows.find((f) => f.step === 'judge' && f.attempt === 1).ruling).toBe('FAIL')
  })

  it('Step 6: the `controls` row carries how long it took, which is the only time the program executes', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    const rows = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const controlsRow = rows.find((f) => f.step === 'controls')
    expect(typeof controlsRow.duration_ms).toBe('number')
    expect(controlsRow.duration_ms).toBeGreaterThanOrEqual(0)
  })

  it('Step 6: there is no `commit` row: its sha and its fact are whole in git log', () => {
    taskOk('uno.txt')
    const rows = readFileSync(join(repo, '.telemetria', 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(rows.map((f) => f.step)).toEqual(['implement', 'controls', 'judge'])
  })
})

describe('a failure of the telemetry cannot bring the task down', () => {
  it('if the verdict path is gitignored, `git add` fails and the task is committed all the same', () => {
    // The same defect as the one with the metrics, in earlier code (590b995, the
    // one that made the verdict travel): `git add` on an ignored path exits with
    // 1, the exception rose and the run got stuck at exit 9 with the task
    // uncommitted. A human decision, taken on finding it: warn and carry on. A
    // verdict that cannot travel degrades the F37 contract and that has to be
    // seen, but a stuck run does not fix it — and the verdict is still on disk,
    // in the run's folder.
    appendFileSync(join(repo, '.gitignore'), 'docs/superpowers/verdicts/\n')
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora los veredictos'], { cwd: repo })
    const r = taskOk('uno.txt')
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })).toMatch(/uno\.txt/)
  })

  it('if the metrics path is gitignored, `git add` fails and the task is committed all the same', () => {
    // The principle belongs to the design and it is old: "ninguna transición
    // depende de la medida". Making the telemetry TRAVEL opens a new path by
    // which it could break that — the `git add` of the file — and `git add` on
    // an ignored path exits with 1. A repo that ignores `docs/` is not unusual.
    // ONLY the metrics path is ignored, not the whole of `docs/`: with `docs/`
    // ignored the first thing to blow up is the `git add` of the VERDICT, which
    // is code older than this change and carries the same defect — it exits by 9
    // and leaves the run stuck. That finding is reported separately; this test
    // measures my own.
    appendFileSync(join(repo, '.gitignore'), 'docs/superpowers/metrics/\n')
    // Only the .gitignore: a `git add -A` would take `uno.txt` along too, and
    // then the SCOPE check would veto the task (a `(create)` of a file that is
    // already in the previous commit) and the failure would be a different one.
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora las metricas'], { cwd: repo })
    const r = taskOk('uno.txt')
    expect(r.status).toBe(0)
    expect(commits()).toBe(3)
    expect(execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], { cwd: repo, encoding: 'utf8' })).toMatch(/uno\.txt/)
  })

  it('if the PASS slice verdict cannot be committed, the delivery goes ahead all the same', () => {
    // The same doctrine as the two above, applied to the new phase: with the
    // whole of docs/superpowers/ ignored, neither the slice verdict nor the
    // telemetry can be staged — there is no verdict commit, but the run
    // delivers: evidence that cannot travel warns, it never blocks a slice whose
    // work is already committed whole.
    appendFileSync(join(repo, '.gitignore'), 'docs/superpowers/\n')
    execFileSync('git', ['add', '--', '.gitignore'], { cwd: repo })
    execFileSync('git', ['commit', '-q', '-m', 'ignora la evidencia'], { cwd: repo })
    taskOk('uno.txt')
    taskOk('dos.txt')
    ct('reconcile')
    ct('global')
    const r = judgeSlice(writeSliceVerdict('PASS'))
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/run delivered/)
    expect(r.stderr).toMatch(/nada que commitear del veredicto del slice/)
    expect(runState().closed).toBe('delivered')
    // 1 base + 1 gitignore + 2 tasks, and NO verdict commit at all.
    expect(commits()).toBe(4)
    expect(log()).not.toMatch(/Veredicto del slice entero/)
  })
})

// §3.3 of the handoff: `.agent/conventions.md` is the yardstick of the REPO,
// not of the plan. `ct-step` reads it straight off disk and pastes it at the end
// of every task brief — with no agent in between, so a repo with the file and
// one without behave differently only because of what is on disk, never because
// of what an agent decided to copy.
describe('the repo yardstick travels in the brief, with no agent in between', () => {
  it('with .agent/conventions.md, the brief carries the banner and the content, BEHIND the task', () => {
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'conventions.md'), '# La vara\n\n- `AGENTS.md`\n')
    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).toMatch(/leída directo de `\.agent\/conventions\.md`/)
    expect(brief).toContain('- `AGENTS.md`')
    expect(brief.indexOf('Task 1')).toBeLessThan(brief.indexOf('leída directo'))
  })

  it('without the file, the brief does not mention it — the path of today, intact', () => {
    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).not.toMatch(/conventions\.md/)
  })

  it('with the file blank, the brief does not carry the banner — empty is not a yardstick', () => {
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'conventions.md'), '\n')
    ct('next')
    const brief = readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).not.toMatch(/leída directo de/)
  })
})

// The yardstick is dictated by ct
// (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md). The ct
// yardstick ALWAYS travels, it goes AHEAD of the repo one —its header settles
// the precedence and it has to be read before the yardstick it decides about
// arrives— and its absence is a broken installation, not a state of the repo:
// it aborts.
describe('the ct yardstick travels in the brief, and goes ahead of the repo one', () => {
  const briefOfTaskOne = () => readFileSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')

  it('the brief ends with the yardstick documents, BEHIND the task', () => {
    ct('next')
    const brief = briefOfTaskOne()
    expect(brief).toMatch(/\*\*La vara de ct\*\*/)
    for (const name of PluginYardstick.FILES) {
      expect(brief).toContain(`## Vara de ct: conventions/${name}`)
    }
    expect(brief.indexOf('Task 1')).toBeLessThan(brief.indexOf('La vara de ct'))
  })

  it('it pastes the real content of the documents, not a summary', () => {
    ct('next')
    for (const name of PluginYardstick.FILES) {
      const document = readFileSync(join(PLUGIN_ROOT_TEST, 'conventions', name), 'utf8')
      expect(briefOfTaskOne(), `${name} no viaja verbatim`).toContain(document.trim())
    }
  })

  it('with a declaration from the repo, the ct one goes FIRST', () => {
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'conventions.md'), '# La vara del repo\n\n- `AGENTS.md`\n')
    ct('next')
    const brief = briefOfTaskOne()
    expect(brief.indexOf('La vara de ct')).toBeLessThan(brief.indexOf('leída directo de `.agent/conventions.md`'))
  })

  // THE SCOPE NO LONGER FILTERS BY `**Files:**`: the eight documents reach
  // every diff, whether or not the task creates a module. `architecture.md`
  // used to travel only when the plan declared a `(create)` path; now it always
  // travels.
  const withTaskOneModifying = () => {
    const plan = readFileSync(join(repo, 'plan.md'), 'utf8').replace('`uno.txt` (create)', '`uno.txt` (modify)')
    writeFileSync(join(repo, 'plan.md'), plan)
  }

  it('a task that opens no new module takes the whole yardstick, architecture.md included', () => {
    withTaskOneModifying()
    ct('next')
    const brief = briefOfTaskOne()
    for (const name of PluginYardstick.FILES) {
      expect(brief, `${name} should travel`).toContain(`## Vara de ct: conventions/${name}`)
    }
  })

  it('without a declaration from the repo, the ct one travels all the same: they are two independent yardsticks', () => {
    ct('next')
    const brief = briefOfTaskOne()
    expect(brief).toContain('## Vara de ct: conventions/defects.md')
    expect(brief).not.toMatch(/leída directo de `\.agent\/conventions\.md`/)
  })

  it('without the yardstick directory, it aborts naming what is missing and delivers no brief', () => {
    // A FAKE plugin: `scripts/` and `skills/` are copied and `conventions/` is
    // omitted, which is exactly the state of a broken installation. `PLUGIN_ROOT`
    // comes from the location of the script itself, so copying it is the only way
    // to move it.
    const fake = mkdtempSync(join(tmpdir(), 'ct-plugin-roto-'))
    try {
      cpSync(join(PLUGIN_ROOT_TEST, 'scripts'), join(fake, 'scripts'), { recursive: true })
      cpSync(join(PLUGIN_ROOT_TEST, 'skills'), join(fake, 'skills'), { recursive: true })
      // `scripts/state.js` imports the npm package `yaml`. Copied outside the
      // repo (here, under tmpdir()), ESM module resolution does not find
      // `node_modules/yaml` by walking up directories and the process dies with
      // MODULE_NOT_FOUND (exit 1) before it reaches the yardstick check. The
      // same problem is already solved by `ct-next-claim.test.js` with a symlink
      // to `node_modules` instead of copying the whole repo.
      symlinkSync(join(PLUGIN_ROOT_TEST, 'node_modules'), join(fake, 'node_modules'), 'dir')
      const r = spawnSync('node', [join(fake, 'scripts', 'ct-step.mjs'), 'next', '--plan', 'plan.md', '--issue', '7'], {
        cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLAUDE_CONFIG_DIR: join(repo, '.telemetria') },
      })
      expect(r.status).toBe(8)
      expect(r.stderr).toMatch(/defects\.md/)
      expect(r.stderr).toMatch(/incomplete plugin installation/)
      expect(existsSync(join(repo, '.agent', 'run-7', 'task-1-brief.md'))).toBe(false)
    } finally {
      rmSyncBestEffort(fake)
    }
  })
})

// Task 8: the slice judge measures end state, coherence and signal — not code
// rule by rule —, so out of the whole yardstick it only gets the one that
// measures precisely that: `simplicity.md` (the burden of proof lies on what
// gets added), the yardstick of its `observabilidad` item. One single path, not
// the pasted document: `## Vara` goes FIRST, ahead even of `## Señal`, for the
// same reason that `## Señal` goes ahead of the diff -U10.
describe('the slice package carries the path of simplicity.md, not the whole document', () => {
  it('the "## Vara" section is the first of the package and carries the absolute path of simplicity.md', () => {
    taskOk('uno.txt')
    taskOk('dos.txt')
    ct('reconcile')
    ct('global')
    ct('next')
    const packageText = readFileSync(join(repo, '.agent', 'run-7', 'slice-review.diff'), 'utf8')
    expect(packageText).toMatch(/## Vara/)
    expect(packageText.indexOf('## Vara')).toBeLessThan(packageText.indexOf('## Señal'))
    const yardstickSection = packageText.slice(packageText.indexOf('## Vara'), packageText.indexOf('## Señal'))
    const path = join(PLUGIN_ROOT_TEST, PluginYardstick.DIRECTORY, 'simplicity.md')
    expect(yardstickSection).toContain(path)
  })
})

// H7a (#92): the telemetry noted `brief_bytes` of the `implement` step and
// nothing else. The size of the dispatched agent, that of the skills its prompt
// orders it to load and that of the package it receives were not measured, so
// the context saving per slice was an opinion. The three fields are measured on
// the file that EXISTS on disk, never on what the program meant to write.
describe('every dispatched role notes what reading cost it, in bytes', () => {
  const bytesInPlugin = (relativePath) => statSync(join(PLUGIN_ROOT_TEST, relativePath)).size
  const agentBytesOf = (step) => bytesInPlugin(RoleBytes.filesOf(step)[0])
  const skillBytesOf = (step) => RoleBytes.filesOf(step).slice(1).reduce((sum, r) => sum + bytesInPlugin(r), 0)

  it('the `implement` row carries the agent, the skills its prompt orders it to load and the brief it was handed', () => {
    ct('next')
    const brief = join(repo, '.agent', 'run-7', 'task-1-brief.md')
    const briefBytes = statSync(brief).size
    ct('report', writeReport(['uno.txt']))
    const row = judgeRows('implement').at(-1)
    expect(row.agent_bytes).toBe(agentBytesOf(STEPS.IMPLEMENT))
    expect(row.skill_bytes).toBe(skillBytesOf(STEPS.IMPLEMENT))
    expect(row.package_bytes).toBe(briefBytes)
    expect(row.agent_bytes).toBeGreaterThan(0)
    expect(row.skill_bytes).toBeGreaterThan(0)
  })

  // The unavoidable duplication of `conventions/decisions.md`: `brief_bytes` and
  // `package_bytes` measure the SAME file of the `implement` step, one reading
  // its content and the other asking the filesystem for its size. It is declared
  // here and measured, so that the day one of the two stops looking at the brief
  // it is this test that fails and not a reading of the table three months
  // later.
  it('in `implement`, the package is the brief: the two columns measure the same file and cannot diverge', () => {
    ct('report', writeReport(['uno.txt']))
    const row = judgeRows('implement').at(-1)
    expect(row.package_bytes).toBe(row.brief_bytes)
  })

  it('the judge row carries the agent, its skill and the review package it judged', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('next')
    const packageBytes = statSync(taskPackage()).size
    const v = writeVerdict('PASS')
    seal(v, taskPackage())
    expect(ct('verdict', v).status).toBe(0)
    const row = judgeRows('judge').at(-1)
    expect(row.agent_bytes).toBe(agentBytesOf(STEPS.JUDGE))
    expect(row.skill_bytes).toBe(skillBytesOf(STEPS.JUDGE))
    expect(row.package_bytes).toBe(packageBytes)
    expect(row.agent_bytes).toBeGreaterThan(0)
    expect(row.skill_bytes).toBeGreaterThan(0)
    expect(row.package_bytes).toBeGreaterThan(0)
  })

  it('the slice judge loads no skill: its row notes zero, which is not the same as not having measured it', () => {
    taskOk('uno.txt')
    taskOk('dos.txt')
    ct('reconcile')
    ct('global')
    ct('next')
    const packageBytes = statSync(slicePackage()).size
    const v = writeSliceVerdict('PASS')
    seal(v, slicePackage())
    expect(ct('slice-verdict', v).status).toBe(0)
    const row = judgeRows('slice-judge').at(-1)
    expect(row.agent_bytes).toBe(agentBytesOf(STEPS.SLICE_JUDGE))
    expect(row.skill_bytes).toBe(0)
    expect(row.package_bytes).toBe(packageBytes)
  })

  it('a discarded verdict names no input, nor its size', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    ct('verdict', writeVerdict('PASS'))
    const row = judgeRows('judge').at(-1)
    expect(row.outcome).toBe('discarded')
    expect(Object.hasOwn(row, 'agent_bytes')).toBe(false)
  })

  it('with no reconciliation package in the run directory, the `reconcile` row does not invent the cost of a role nobody dispatched', () => {
    taskOk('uno.txt')
    taskOk('dos.txt')
    expect(ct('reconcile').status).toBe(0)
    const row = judgeRows('reconcile').at(-1)
    expect(Object.hasOwn(row, 'agent_bytes')).toBe(false)
  })
})
