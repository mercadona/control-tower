// F38 — THE GO OF THE `plan` GATE: THE AGENT CANNOT WRITE IT, AND WITHOUT IT
// NOTHING IS RELEASED.
//
// The hole this round closes was already written down by the repo itself back
// in #32 (commands/ct-next.md): «no impide que el propio agente escriba `-OK`
// en su propio issue — tiene `gh`, así que puede». And the `plan` gate is
// implied by default in EVERY slice (gates.js#gatesForType), so it was not a
// pending hole: it was today's, with the aggravation of leaving the RECORD of
// a human review that never happened.
//
// Two halves, and both are tested here: the go carries a nonce per dispatch
// that the agent cannot guess (the pure module is covered by
// go-response.test.js; the channel, by ct-next-watch-go.test.js), and
// `--release` DEMANDS that go — before, it demanded nothing, so an agent could
// ignore the whole gate and deliver all the same.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GO_TOKEN, goBody, goCommitment, newGoNonce } from '../scripts/go-response.js'
import { goPath, readGoCommitment, writeGoCommitment } from '../scripts/go-registry.js'
import { GO, GO_HASH, NONCE, goComment, goEnv } from './fixtures/go-gate.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const RELEASE = join(HERE, '..', 'scripts', 'dispatch-check.mjs')
const CT_GO = join(HERE, '..', 'scripts', 'ct-go.mjs')
const WATCH_GO = join(HERE, '..', 'scripts', 'ct-watch-go.mjs')
const FAKE_GH = join(HERE, 'fixtures', 'fake-gh-bin')

const trash = []
afterEach(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true }) })
const tmp = (pref) => { const d = mkdtempSync(join(tmpdir(), pref)); trash.push(d); return d }

// ---------------------------------------------------------------------------
// The worktree of the slice: a branch with the plan and the task committed,
// and the run DELIVERED. It is the state in which a slice asks to release — in
// other words, the only state in which the door of the go has anything to say.
// Copied from the fixture of e2e-release-correspondence.test.js: the tests of
// this repo do not import each other, they only share `fixtures/`.
// ---------------------------------------------------------------------------
const FENCE = '```'
const plan = (issue) => [
  `# #${issue} — fixture slice`, '',
  '> **This plan is written to be executed by task-scoped subagents with zero context.**', '',
  '## 1. Context and goal', 'Fixture.',
  '### Desired end state', 'Work done.',
  '### Out of scope', 'N/A — fixture.',
  '## 2. Closed decisions', '| Decision | Value |', '|---|---|', '| fixture | yes |',
  '## 3. Reference patterns', 'N/A — fixture.',
  '## 4. Inventory', 'work.txt',
  '## 5. Interfaces', 'Consumes: N/A. Produces: N/A.',
  '## 6. Test strategy', 'N/A — fixture.',
  '## 7. Tasks', '### Task 1 — do the work',
  '**Objective:** the work is committed.', '**Files:** work.txt', 'Final text (work.txt):',
  FENCE, 'trabajo', FENCE,
  '**TDD:** No TDD — fixture.', '**Tests:** N/A — fixture.',
  '**Verification:** git log shows the commit.', FENCE + 'bash', 'git log --oneline -1', FENCE,
  '## 8. Global verification', 'N/A — fixture.',
  '## 9. Assumptions', 'None.', '',
].join('\n')

function worktree(issue = 9) {
  const dir = tmp('ct-f38-')
  const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
  writeFileSync(join(dir, 'f.txt'), 'base\n'); git('add', '-A'); git('commit', '-qm', 'base')
  git('checkout', '-qb', `feat/${issue}`)
  mkdirSync(join(dir, 'docs', 'superpowers', 'plans'), { recursive: true })
  writeFileSync(join(dir, 'docs', 'superpowers', 'plans', `2026-08-25-issue-${issue}-work.md`), plan(issue))
  writeFileSync(join(dir, 'work.txt'), 'trabajo\n')
  git('add', '-A'); git('commit', '-qm', 'work')
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'SLICE.md'), `---\nissue: ${issue}\nbase: main\n---\n`)
  writeFileSync(join(dir, '.agent', `run-${issue}.json`), JSON.stringify({
    plan: `docs/superpowers/plans/2026-08-25-issue-${issue}-work.md`,
    issue, baseSha: 'HEAD~1', task: 1, tasksTotal: 1, step: 'e2e', e2eRuns: [], closed: 'delivered',
  }, null, 2))
  return dir
}

// A real `--release` (without --dry-run: what is being tested includes that it
// does NOT mutate). `labels` carries `gate:plan` by default, which is the
// normal case of every slice.
function release(dir, { issue = 9, comments, labels, configDir, viewFail = false, commentsFail = false } = {}) {
  const log = join(dir, 'gh-argv.log')
  const r = spawnSync(process.execPath, [RELEASE, String(issue), '--repo', 'o/r', '--release'], {
    cwd: dir, encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${FAKE_GH}:${process.env.PATH}`,
      FAKE_GH_ARGV_LOG_FILE: log,
      FAKE_GH_VIEW_LABELS: JSON.stringify(labels ?? ['status:in-progress', 'gate:plan']),
      ...(comments !== undefined ? { FAKE_GH_VIEW_COMMENTS: JSON.stringify({ comments }) } : {}),
      ...(viewFail ? { FAKE_GH_VIEW_FAIL: '1' } : {}),
      ...(commentsFail ? { FAKE_GH_VIEW_COMMENTS_FAIL: '1' } : {}),
      ...(configDir !== undefined ? { CLAUDE_CONFIG_DIR: configDir } : {}),
    },
  })
  return { ...r, output: (r.stdout || '') + (r.stderr || ''), argv: existsSync(log) ? readFileSync(log, 'utf8') : '' }
}

// The commitment of a dispatch, registered where it really lives.
const register = (issue = 9, commitment = GO_HASH) => {
  const cfg = tmp('ct-f38-cfg-')
  writeGoCommitment({ repo: 'o/r', issue, commitment, configDir: cfg })
  return cfg
}

describe('door 9: the `plan` gate does not close by itself', () => {
  it('with the go of THIS dispatch answered → it releases, and says who gave it', () => {
    const r = release(worktree(), { configDir: register(), comments: [goComment('josemerca')] })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/released #9/)
    // Who authorised it, on stderr: it is the only place where a go given by
    // the very identity the agent runs with would be seen.
    expect(r.stderr).toMatch(/gate `plan` closed: go of this dispatch given by @josemerca/)
  })

  it('with no go answered at all → exit 9, and it mutates NOTHING', () => {
    const r = release(worktree(), { configDir: register(), comments: [] })
    expect(r.status).toBe(9)
    expect(r.output).toMatch(/the `plan` gate is not closed/)
    expect(r.output).toMatch(/is still at status:in-progress/)
    // The proof that it did not mutate is not the message: it is the real argv of `gh`.
    expect(r.argv).not.toMatch(/issue edit/)
  })

  // -------------------------------------------------------------------------
  // THE CASE THAT JUSTIFIES THE ROUND. A bare `-OK` is exactly what an agent
  // knows how to write: `gh issue comment` on its own issue, inside its normal
  // repertoire, with a trace indistinguishable from the legitimate one.
  // -------------------------------------------------------------------------
  it('a BARE `-OK` does not release: it is the go the agent WOULD know how to fabricate', () => {
    const r = release(worktree(), {
      configDir: register(),
      comments: [{ id: 'IC_1', body: GO_TOKEN, createdAt: '2026-08-25T10:00:00Z', author: { login: 'un-agente' } }],
    })
    expect(r.status).toBe(9)
    expect(r.argv).not.toMatch(/issue edit/)
  })

  it('the go of ANOTHER dispatch does not either: the nonce is per dispatch', () => {
    const other = goBody(newGoNonce(Buffer.from([1, 2, 3, 4])))
    const r = release(worktree(), {
      configDir: register(),
      comments: [{ id: 'IC_1', body: other, createdAt: '2026-08-25T10:00:00Z', author: { login: 'josemerca' } }],
    })
    expect(r.status).toBe(9)
    // And that is why this door can look at the WHOLE issue with no window of
    // ids: an inherited go does not fit, by construction.
    expect(r.output).toMatch(/no comment on this issue carries the go of this dispatch/)
  })

  it('the right go in an old comment of the issue DOES count: there is no window here, the nonce makes it', () => {
    const r = release(worktree(), {
      configDir: register(),
      comments: [
        { id: 'IC_0', body: 'prosa', createdAt: '2026-08-01T00:00:00Z', author: { login: 'x' } },
        goComment('josemerca'),
      ],
    })
    expect(r.status).toBe(0)
  })

  it('with no commitment registered and with a `plan` gate → exit 9, and it names the remedy', () => {
    const r = release(worktree(), { configDir: tmp('ct-f38-vacio-'), comments: [goComment()] })
    expect(r.status).toBe(9)
    expect(r.output).toMatch(/is NOT RECORDED/)
    expect(r.output).toMatch(/ct-go\.mjs --issue 9 --repo o\/r/)
  })

  it('with no commitment and with an issue that declares NO gate at all → exit 9: silence is not a waiver', () => {
    // It is also the path an agent would open by deleting its own labels.
    const r = release(worktree(), { configDir: tmp('ct-f38-vacio-'), labels: ['status:in-progress'], comments: [] })
    expect(r.status).toBe(9)
    expect(r.output).toMatch(/declare NO gate at all/)
  })

  it('the EXPLICIT waiver (`gate:none`) releases without looking at any go', () => {
    const r = release(worktree(), { configDir: tmp('ct-f38-vacio-'), labels: ['status:in-progress', 'gate:none'], comments: [] })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/released #9/)
  })

  it('an unreadable registry does NOT release, and does not claim the go is missing', () => {
    // The doctrine of the exits 5/6/8: this file does not call clean what it
    // has not been able to look at.
    const cfg = register()
    writeFileSync(goPath({ repo: 'o/r', issue: 9, configDir: cfg }), '{ esto no es json\n')
    const r = release(worktree(), { configDir: cfg, comments: [goComment()] })
    expect(r.status).toBe(9)
    expect(r.output).toMatch(/could NOT be read/)
    expect(r.output).not.toMatch(/no está cerrado/)
  })

  it('if the comments cannot be read it does not release either, and does NOT say the go is missing', () => {
    // An issue with a real go whose comments could not be read is not
    // indistinguishable from one with none — and this file does not confuse
    // the two at any of its doors.
    const r = release(worktree(), { configDir: register(), commentsFail: true })
    expect(r.status).toBe(9)
    expect(r.output).toMatch(/the issue's comments could not be read/)
    expect(r.output).toMatch(/it is not asserted that it is missing/)
    expect(r.argv).not.toMatch(/issue edit/)
  })

  // -------------------------------------------------------------------------
  // THE ORDER OF THE LADDER. The door of the go goes LAST on purpose: with the
  // run half done, asking about the go is noise over a slice that has not
  // finished yet. With everything green, a missing go is no longer a «not
  // yet».
  // -------------------------------------------------------------------------
  it('it goes AFTER the door of the run: with no delivered run the 7 wins, not the 9', () => {
    const dir = worktree()
    const run = JSON.parse(readFileSync(join(dir, '.agent', 'run-9.json'), 'utf8'))
    delete run.closed
    writeFileSync(join(dir, '.agent', 'run-9.json'), JSON.stringify(run))
    const r = release(dir, { configDir: tmp('ct-f38-vacio-'), comments: [] })
    expect(r.status).toBe(7)
  })
})

describe('the registry of the commitment', () => {
  it('one file per issue and per repo: the same number exists in every repo in the world', () => {
    const cfg = tmp('ct-f38-reg-')
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: cfg })
    writeGoCommitment({ repo: 'otro/repo', issue: 7, commitment: 'b'.repeat(64), configDir: cfg })
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).commitment).toBe(GO_HASH)
    expect(readGoCommitment({ repo: 'otro/repo', issue: 7, configDir: cfg }).commitment).toBe('b'.repeat(64))
  })

  it('rewriting is the normal case: redispatching draws a new nonce and the old one stops counting', () => {
    const cfg = tmp('ct-f38-reg-')
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: cfg })
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: 'c'.repeat(64), configDir: cfg })
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).commitment).toBe('c'.repeat(64))
  })

  it('the file is not readable by the rest of the machine', () => {
    const cfg = tmp('ct-f38-reg-')
    const path = writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: cfg })
    expect(statSync(path).mode & 0o077).toBe(0)
  })

  it('a repo name with slashes or `..` does not write outside the folder', () => {
    const cfg = tmp('ct-f38-reg-')
    const path = goPath({ repo: '../../etc/passwd', issue: 7, configDir: cfg })
    expect(dirname(path)).toBe(join(cfg, 'control-tower', 'go'))
  })

  it('with neither HOME nor CLAUDE_CONFIG_DIR it writes NOTHING: a relative path would end up in the cwd', () => {
    // The failure mode this avoids is one of the worst: the commitment gets
    // written where nobody reads it, the watcher starts, the person gives the
    // go and `--release` refuses. A slice stuck without anything failing.
    // Verified by construction: a test of this suite running with HOME='' left
    // a `.claude/control-tower/go/o__r-90.json` inside the checkout.
    expect(() => writeGoCommitment({ repo: 'o/r', issue: 7, commitment: GO_HASH, configDir: 'relativo/mal' }))
      .toThrow(/absolute path/)
    // And the read does not say «there is no go», it says «it could not be checked».
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: 'relativo/mal' }).error).toMatch(/absolute path/)
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: 'relativo/mal' }).missing).toBe(undefined)
  })

  it('it tells the THREE answers apart: there is one, there is none, and it could not be read', () => {
    const cfg = tmp('ct-f38-reg-')
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).missing).toBe(true)
    writeGoCommitment({ repo: 'o/r', issue: 7, commitment: 'no-es-un-sha', configDir: cfg })
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).error).toMatch(/sha256/)
  })
})

describe('ct-go: reissuing the go of a dispatch in flight', () => {
  it('it registers a new commitment and dictates the go, without writing the nonce into the file', () => {
    const cfg = tmp('ct-f38-ctgo-')
    const r = spawnSync(process.execPath, [CT_GO, '--issue', '7', '--repo', 'o/r'], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    })
    expect(r.status).toBe(0)
    const nonce = (r.stdout.match(/-OK ([0-9a-f]{8})/) || [])[1]
    expect(nonce).toMatch(/^[0-9a-f]{8}$/)
    const path = goPath({ repo: 'o/r', issue: 7, configDir: cfg })
    expect(readFileSync(path, 'utf8')).not.toContain(nonce)
    expect(readGoCommitment({ repo: 'o/r', issue: 7, configDir: cfg }).commitment).toBe(goCommitment(nonce))
  })

  it('it says the watcher in flight is still looking for the previous go: it does not hide it', () => {
    const cfg = tmp('ct-f38-ctgo-')
    const r = spawnSync(process.execPath, [CT_GO, '--issue', '7', '--repo', 'o/r'], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    })
    expect(r.stdout).toMatch(/is looking for the PREVIOUS go/)
    expect(r.stdout).toMatch(/by hand/)
  })

  it('the go it reissues really does release: it is the complete recovery path', () => {
    const cfg = tmp('ct-f38-ctgo-')
    const issued = spawnSync(process.execPath, [CT_GO, '--issue', '9', '--repo', 'o/r'], {
      encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg },
    })
    const nonce = (issued.stdout.match(/-OK ([0-9a-f]{8})/) || [])[1]
    const r = release(worktree(), {
      configDir: cfg,
      comments: [{ id: 'IC_1', body: goBody(nonce), createdAt: '2026-08-25T11:00:00Z', author: { login: 'josemerca' } }],
    })
    expect(r.status).toBe(0)
  })

  it('invalid arguments → exit 2, registering nothing', () => {
    const cfg = tmp('ct-f38-ctgo-')
    for (const args of [['--issue', 'siete', '--repo', 'o/r'], ['--issue', '7', '--repo', 'sin-barra'], ['--issue', '7']]) {
      const r = spawnSync(process.execPath, [CT_GO, ...args], { encoding: 'utf8', env: { ...process.env, CLAUDE_CONFIG_DIR: cfg } })
      expect(r.status).toBe(2)
    }
    expect(existsSync(join(cfg, 'control-tower', 'go'))).toBe(false)
  })
})

describe('the watcher demands the commitment', () => {
  // Without this, the door would open by OMITTING an argument: an agent that
  // wanted to skip the gate would only have to relaunch the watcher itself.
  it('with no --go-hash it does not watch: exit 2, and it does NOT fall back to the `-OK` with no nonce', () => {
    const r = spawnSync(process.execPath, [WATCH_GO, '--issue', '5', '--repo', 'o/r', '--session', 'x'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/--go-hash invalid or absent/)
    expect(r.stderr).toMatch(/that door would be opened by the agent itself/)
  })

  it('with a --go-hash that is not a sha256, it does not either', () => {
    const r = spawnSync(process.execPath, [WATCH_GO, '--issue', '5', '--repo', 'o/r', '--session', 'x', '--go-hash', 'abc'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
  })
})

describe('the texts of the gate', () => {
  it('the AGENT one tells it that it cannot fabricate the go and that without it there is no delivery', async () => {
    const { GATES } = await import('../scripts/gates.js')
    // An agent that believes it can skip the gate does the work twice.
    expect(GATES.plan.kickoff).toMatch(/no puedes fabricarlo/)
    expect(GATES.plan.kickoff).toMatch(/exit 9/)
    // #99 — the sentence used to be «NO está en este kickoff, ni en el issue,
    // ni en tu worktree». It states the SAME fact in the positive: where the
    // nonce lives, which is what turns it into a human permission.
    expect(GATES.plan.kickoff).toMatch(/vive fuera de este kickoff, del issue y de tu worktree/)
  })

  it('the HUMAN one says what to type and where it comes from, without writing the nonce into the issue', async () => {
    const { GATES } = await import('../scripts/gates.js')
    expect(GATES.plan.issue).toContain(`${GO_TOKEN} <nonce>`)
    expect(GATES.plan.issue).toMatch(/ct-go\.mjs/)
    // The issue is read by the agent: the nonce cannot be there, nor an
    // example that looks like one.
    expect(GATES.plan.issue).not.toMatch(/-OK [0-9a-f]{8}/)
  })

  it('the fixture and the module do not diverge: NONCE, GO and GO_HASH are the same thing', () => {
    expect(GO).toBe(goBody(NONCE))
    expect(GO_HASH).toBe(goCommitment(NONCE))
    expect(goEnv({ repo: 'o/r', issue: 1 }).CLAUDE_CONFIG_DIR).toMatch(/ct-go-cfg-/)
  })
})
