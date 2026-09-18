// ============================================================================
// THE `plan` GATE RETIRES (issue #434 — decision A-3 of the epic frozen on
// 2026-09-11, `docs/superpowers/specs/2026-09-18-the-plan-gate-retires-design.md`).
//
// This file used to pin the gate's VOCABULARY: that `plan` lived in `GATES`
// with its two texts, that no `Tipo` implied it since D-14, and that `!plan`
// was an inert waiver. The whole go protocol behind it has gone —
// `go-response.js`, `go-registry.js`, `go-channel.js`, `ct-go.mjs`,
// `ct-watch-go.mjs` and the exit-9 ladder of `dispatch-check --release` — so
// the token has nothing left to name: the plan is published as a comment on
// the issue and the run carries on.
//
// RETIRED AND NOT DELETED, and that difference is what this file is for.
// `parseGateCell` validates the token AFTER stripping the `!`, so removing
// `plan` from the vocabulary would turn every `!plan` already written into an
// UNKNOWN token — and an unknown token in the `Gate` column is a hard abort of
// /ct-groom. Nine rows of this repository's own last execution spec write
// `!plan`, and the live specs of the repositories this plugin governs are not
// in this tree: a groom that aborted on them would refuse for a reason that
// has nothing to do with the work.
//
// So `GATES` keeps its three live tokens and `RETIRED_GATES` appears beside
// it: read tolerantly, written nowhere. It is the shape #346 used for the
// milestone heading, and the `!` is IGNORED on a retired token because there
// are no longer two things to tell apart — `plan` and `!plan` both produce
// nothing at all.
// ============================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import {
  GATES, RETIRED_GATES, TYPE_GATES, GATE_LABEL_NONE,
  parseGateCell, resolveGates, gatesForType, gateLabels,
  renderGateKickoffLines, renderGatesIssueContent, resolveGatesForAgent,
} from '../scripts/gates.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(HERE, 'fixtures')
const groomScript = join(HERE, '..', 'scripts', 'ct-groom.mjs')
const nextScript = join(HERE, '..', 'scripts', 'ct-next.mjs')
const releaseScript = join(HERE, '..', 'scripts', 'dispatch-check.mjs')
const fakeGhDir = join(fixturesDir, 'fake-gh-bin')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})

// ============================================================================
// 1. The vocabulary: three live gates, one retired one.
// ============================================================================
describe('the `plan` gate — retired, not deleted', () => {
  it('it is out of the vocabulary and named in RETIRED_GATES, which says what happens instead', () => {
    expect(Object.keys(GATES).sort()).toEqual(['apply', 'e2e', 'visual'])
    expect(Object.hasOwn(GATES, 'plan')).toBe(false)
    expect(Object.hasOwn(RETIRED_GATES, 'plan')).toBe(true)
    // The line is what /ct-groom prints, so it has to say BOTH things: that it
    // was retired, and what the plan does now — a reader who only learns "this
    // token is dead" does not know whether their plan still gets published.
    expect(RETIRED_GATES.plan).toMatch(/retired/i)
    expect(RETIRED_GATES.plan).toMatch(/comment/i)
  })

  it('no `Tipo` implies it, and the two that imply something still do', () => {
    expect(Object.values(TYPE_GATES).flat()).not.toContain('plan')
    expect(gatesForType('ui')).toEqual(['visual'])
    expect(gatesForType('infra')).toEqual(['apply'])
    expect(gatesForType('backend')).toEqual([])
  })

  it('`plan` in a `Gate` cell goes to the `retired` bucket: it is not a gate and it is not unknown', () => {
    expect(parseGateCell('plan')).toEqual({ add: [], waive: [], retired: ['plan'], unknown: [] })
    const r = resolveGates('backend', 'plan')
    expect(r.gates).toEqual([])
    expect(r.added).toEqual([])
    expect(r.unknown).toEqual([])
    expect(r.retired).toEqual(['plan'])
  })

  it('`!plan` produces EXACTLY the same: the `!` is ignored on a retired token', () => {
    // The `!` is not read here, and that is the decision: with the gate gone
    // there is no longer a difference between asking for it and waiving it, so
    // reporting `!plan` as an inert waiver would name a gate that no longer
    // exists in order to say that nothing was removed from it.
    expect(parseGateCell('!plan')).toEqual({ add: [], waive: [], retired: ['plan'], unknown: [] })
    expect(parseGateCell('**!plan**')).toEqual({ add: [], waive: [], retired: ['plan'], unknown: [] })
    expect(parseGateCell('gate:plan')).toEqual({ add: [], waive: [], retired: ['plan'], unknown: [] })
    const r = resolveGates('backend', '!plan')
    expect(r.gates).toEqual([])
    expect(r.waived).toEqual([])
    expect(r.inertWaivers).toEqual([])
    expect(r.retired).toEqual(['plan'])
  })

  it('nothing writes it any more: no label, no kickoff line, no gate for the agent', () => {
    // The three writers named by the issue. They need no branch of their own:
    // all three filter through the canonical order of `GATES`, which no longer
    // has the token — so what is pinned here is the consequence, and it is
    // pinned because a future `RETIRED_GATES` folded back into `GATES` would
    // resurrect the label without anything else failing.
    expect(gateLabels(['plan'])).toEqual([GATE_LABEL_NONE])
    expect(gateLabels(['visual', 'plan'])).toEqual(['gate:visual'])
    expect(renderGateKickoffLines(['plan'])).toEqual([])
    expect(resolveGatesForAgent({ gates: ['plan'], gatesDeclared: true })).toEqual([])
    // And a live issue that still carries `gate:plan` from before the
    // retirement reads as an issue with no gate at all, not as a broken one.
    expect(renderGatesIssueContent(resolveGates('backend', 'plan'), 'backend'))
      .toContain('- (none) — this slice demands no human gate before merging.')
  })

  it('a retired token standing next to a live one does not disturb it', () => {
    const r = resolveGates('ui', 'visual, plan, !plan')
    expect(r.gates).toEqual(['visual'])
    expect(r.retired).toEqual(['plan'])
    expect(r.unknown).toEqual([])
    expect(gateLabels(r.gates)).toEqual(['gate:visual'])
  })
})

// ============================================================================
// 2. /ct-groom: it reports the retired token and carries on (AC 1, 2 and 3).
// ============================================================================
function specWith(rows) {
  return [
    '## Hipótesis\n\nApuesta del fixture.\n\n## 9. Slices',
    '',
    '| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function groom(rows) {
  const dir = makeSpecDir('gate-plan-')
  dirs.push(dir)
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specWith(rows))
  return spawnSync('node', [groomScript, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], {
    encoding: 'utf8',
    stdio: QUIET_STDIO,
    env: { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` },
  })
}

describe('/ct-groom over a spec written before the retirement', () => {
  it('a row that writes `plan` creates no gate:plan label, reports the token as retired and exits 0', () => {
    const res = groom(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | plan |'])
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/retired/i)
    expect(res.stderr).toContain('plan')
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).not.toContain('gate:plan')
    expect(plan.issues[0].labels).toContain(GATE_LABEL_NONE)
  })

  it('a row that writes `!plan` is reported the same way, and the exit code is still 0', () => {
    const res = groom(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | !plan |'])
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/retired/i)
    expect(res.stderr).toContain('plan')
    // And NOT as the inert waiver it used to be reported as: there is no gate
    // left for a waiver to be inert about.
    expect(res.stderr).not.toMatch(/there was nothing to remove/)
    const plan = JSON.parse(res.stdout)
    expect(plan.issues[0].labels).not.toContain('gate:plan')
  })

  it('a token that is neither known nor retired still aborts, naming the gates it knows', () => {
    const res = groom(['| 1 | barra | backend | tabla | – | AC-1.1 | – | med | db | seguridad |'])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('seguridad')
    expect(res.stderr).toContain('visual')
    expect(res.stderr).toContain('apply')
    expect(res.stderr).toContain('e2e')
    // The vocabulary the message names is the LIVE one: offering `plan` as a
    // remedy would send whoever reads it to write a token that produces
    // nothing.
    expect(res.stderr).not.toMatch(/visual, apply, plan/)
    expect(res.stdout).toBe('')
  })
})

// ============================================================================
// 3. /ct-next: no nonce is drawn and no watcher is launched (AC 4).
// ============================================================================
describe('/ct-next dispatches without a go', () => {
  const fakePath = [
    join(fixturesDir, 'fake-git-bin'),
    join(fixturesDir, 'fake-gh-bin'),
    join(fixturesDir, 'fake-cmux-bin'),
    join(fixturesDir, 'fake-claude-bin'),
    // No `fake-osascript-bin`: the stub of `osascript` existed for
    // `CT_GO_CHANNEL=notify`, the channel that dictated the nonce through a
    // system notification instead of stdout, and it retired with
    // `go-channel.js`. Nothing in the plugin calls `osascript` any more, so
    // putting the double on the PATH would double a call that cannot happen.
    process.env.PATH,
  ].join(':')

  // The issue carries `gate:plan` on purpose: it is the case that used to draw
  // the nonce, and the one a live repository still presents until the first
  // `/ct-groom --reconcile` drops the label.
  it('a slice whose issue still carries gate:plan draws no nonce and launches nothing', () => {
    const repoRoot = mkdtempSync(join(tmpdir(), 'gate-plan-next-'))
    dirs.push(repoRoot)
    const configDir = join(repoRoot, 'claude-config')
    const r = spawnSync('node', [nextScript, '--repo', 'o/r', '--cap', '1'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: fakePath,
        FAKE_GIT_TOPLEVEL: repoRoot,
        FAKE_GH_LIST_SEQUENCE: JSON.stringify([[{
          number: 90, title: '#90 el cliente tipado', body: '',
          labels: [{ name: 'status:ready' }, { name: 'gate:plan' }],
        }], []]),
        FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
        CLAUDE_CONFIG_DIR: configDir,
      },
    })
    const out = (r.stdout || '') + (r.stderr || '')
    expect(r.status).toBe(0)
    expect(out).toMatch(/launched #90/)
    // The four traces the protocol used to leave, each one enough on its own
    // to say it came back.
    expect(out).not.toMatch(/-OK/)
    expect(out).not.toMatch(/GO for #90/)
    expect(out).not.toMatch(/watcher of #90/)
    expect(out).not.toMatch(/nonce/i)
    // And nothing is registered outside the repo: the commitment's folder is
    // never created, so `--release` has nothing to look for either.
    expect(existsSync(join(configDir, 'control-tower', 'go'))).toBe(false)
  })
})

// ============================================================================
// 4. `dispatch-check --release`: no door asks for a go (AC 5 and 6).
// ============================================================================
// The plan, the run and the worktree are built here and not imported from
// another test file: the tests of this repository do not import each other, so
// this fixture is the same shape as the one in
// e2e-release-correspondence.test.js and travels with its own file.
const FENCE = '```'
const PLAN = [
  '# #9 — fixture slice',
  '',
  '> **Task-scoped subagents execute this plan. They arrive with no context.**',
  '',
  '## 1. Context and goal',
  'Fixture.',
  '### Desired end state',
  'Work done.',
  '### Out of scope',
  'N/A — fixture.',
  '## 2. Closed decisions',
  '| Decision | Value |',
  '|---|---|',
  '| fixture | yes |',
  '## 3. Reference patterns',
  'N/A — fixture.',
  '## 4. Inventory',
  'work.txt',
  '## 5. Interfaces',
  'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy',
  'N/A — fixture.',
  '## 7. Tasks',
  '### Task 1 — do the work',
  '**Objective:** the commit adds the work.',
  '',
  '**Files:** work.txt',
  'Final text (work.txt):',
  FENCE,
  'trabajo',
  FENCE,
  '**TDD:** No TDD — fixture.',
  '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.',
  FENCE + 'bash',
  'git log --oneline -1',
  FENCE,
  '## 8. Global verification',
  'N/A — fixture.',
  '## 9. Assumptions',
  'None.',
  '',
].join('\n')

const ISSUE_BODY = ['## Acceptance criteria (EARS, 1:1 con tests)', '- un criterio', '', '## Gates', '- (none)', ''].join('\n')

function deliveredSlice() {
  const dir = mkdtempSync(join(tmpdir(), 'gate-plan-release-'))
  dirs.push(dir)
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', 'feat/9')
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', '2026-08-12-issue-9-work.md'), PLAN)
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), '---\nissue: 9\nbase: main\n---\n')
  writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify({
    plan: 'docs/superpowers/plans/2026-08-12-issue-9-work.md',
    issue: 9, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e',
    e2eRuns: [], closed: 'delivered',
  }))
  return dir
}

function release(dir, labels) {
  const configDir = join(dir, 'claude-config')
  const r = spawnSync(process.execPath, [releaseScript, '9', '--repo', 'o/r', '--release'], {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeGhDir}:${process.env.PATH}`,
      FAKE_GH_VIEW_BODY: ISSUE_BODY,
      FAKE_GH_VIEW_LABELS: JSON.stringify(labels),
      // Empty on purpose: there is no commitment registered anywhere, which
      // used to be exit 9 on its own.
      CLAUDE_CONFIG_DIR: configDir,
      CT_WATCH_MERGE_BIN: join(fixturesDir, 'fake-watch-merge-bin', 'recorder.mjs'),
      FAKE_WATCH_MERGE_LOG: join(dir, 'watch-merge.log'),
    },
  })
  return { ...r, configDir }
}

describe('--release releases with no go registered anywhere', () => {
  it('a slice with its plan, its tasks and its Global green releases, and no door asks for a go', () => {
    const r = release(deliveredSlice(), ['status:in-progress', 'gate:plan'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/released #9/)
    expect(r.stderr).not.toMatch(/-OK/)
    expect(r.stderr).not.toMatch(/\bgo\b/)
    expect(existsSync(join(r.configDir, 'control-tower', 'go'))).toBe(false)
  })

  it('an issue whose labels declare NO gate at all no longer refuses for that reason', () => {
    // "Silence is not a waiver" was the exit-9 trap: a hand-made issue with no
    // `gate:` label at all did not release without a registered go. With no go
    // to register, the silence has nothing left to withhold.
    const r = release(deliveredSlice(), ['status:in-progress'])
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/released #9/)
    expect(r.stderr).not.toMatch(/silence is not a waiver/)
  })
})
