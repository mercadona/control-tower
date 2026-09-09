// ===========================================================================
// F20 — THE AGENT'S START-UP STOPS DEPENDING ON NOBODY WRITING INTO THE PTY AT
// THE WRONG MOMENT.
//
// WHAT WAS MEASURED (against the real cmux of the development machine, opening
// and closing throwaway workspaces — never against a working repo):
//
//   1. `--layout` does NOT exec. It was the route F19 flagged as a possible
//      exec and could not test because it was forbidden to launch cmux. With
//      `--layout '{"pane":{"surfaces":[{"type":"terminal","command":"…"}]}}'`
//      the text comes out ECHOED after the prompt on the session's screen, and
//      the launched process hangs off `-/bin/zsh` (login) → `login -flp …
//      exec -l /bin/zsh` → cmux. It is typing, just like `--command`. And as a
//      bonus: with `--layout`, the requested `--cwd` is IGNORED (the measured
//      `$PWD` was the default directory).
//   2. There is no other exec route: `new-surface` does not accept `--command`,
//      and the only type that starts a binary on its own (`agent-session
//      --provider claude`) is cmux's own Claude session, with no way of passing
//      it arguments or a prompt.
//   3. `--env` does reach the shell (`CLAUDE_CONFIG_DIR` visible inside), but
//      `ZDOTDIR` does NOT: cmux/Ghostty uses it for its own integration and it
//      arrives EMPTY — so an rc that starts the agent cannot be injected either.
//   4. With F19's mechanism as it was, SIX consecutive launches gave ZERO
//      sentinels. On the screen:
//
//          [oh-my-zsh] Would you like to update? [Y/n]
//          … >  '/…/launch.sh'
//          zsh: permission denied: /…/launch.sh
//
//      The one-character `read` ate the `.` of `. '/…/launch.sh'`.
//   5. A clean login shell runs what was typed at ~723 ms; a resend, ~250–400 ms
//      after sending it. F19's 8000 ms (which nobody measured) are ten times the
//      real start-up: waiting longer was never going to fix it.
//   6. With a resend: 5 out of 5 started, all on the second attempt, and the
//      agent was launched ONCE in each of them.
//
// These tests pin the properties, not the implementation: (a) a lost keystroke
// no longer condemns the dispatch, (b) resending can NEVER launch two agents,
// and (c) when not even the resend is enough, it still does not lie.
// ===========================================================================
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { buildLauncherScript } from '../scripts/launch-sentinel.js'
import { buildStateSeed } from '../scripts/kickoff.js'
import { buildCmuxSendArgv, buildCmuxSendKeyArgv, collectFinishedResidue, formatFinishedResidueWarning } from '../scripts/dispatch.js'
import { shQuote } from '../scripts/shquote.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')
const fixturesDir = join(here, 'fixtures')

const fakePath = [
  join(fixturesDir, 'fake-git-bin'),
  join(fixturesDir, 'fake-gh-bin'),
  join(fixturesDir, 'fake-cmux-bin'),
  join(fixturesDir, 'fake-claude-bin'),
  process.env.PATH,
].join(':')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSyncBestEffort(d)
})
function makeRepoRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ct-f20-'))
  dirs.push(d)
  return d
}

const openIssue90 = { number: 90, title: '#90 algo', labels: [{ name: 'status:ready' }], body: '' }

function runReal(args, envOverrides = {}) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: fakePath, ...envOverrides },
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '', all: (r.stdout || '') + (r.stderr || '') }
}

function dispatchOne(repoRoot, envOverrides = {}) {
  return runReal(['--repo', 'o/r', '--cap', '1'], {
    FAKE_GIT_TOPLEVEL: repoRoot,
    FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
    FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    ...envOverrides,
  })
}

function claudeRuns(repoRoot) {
  const f = join(repoRoot, 'claude-runs')
  return existsSync(f) ? readFileSync(f, 'utf8').length : 0
}

// ---------------------------------------------------------------------------
// H1 — the lost keystroke stops condemning the dispatch
// ---------------------------------------------------------------------------
describe('F20/H1 — if the pty eats the line, it is resent', () => {
  it('the field case (oh-my-zsh eats the first character) NO LONGER condemns the dispatch: it is resent and the agent starts', () => {
    const repoRoot = makeRepoRoot()
    // Verified against the code WITHOUT the fix: exit 1, «lanzados 0/1» and
    // «it cannot be confirmed that the command got to run» — the
    // dispatcher behaved honestly, but the dispatch failed all the same and left
    // a claim + branch + worktree for a human to clean up.
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs'),
    })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/launched #90 at .*\.worktrees\/90/)
    expect(r.all).toMatch(/launched 1\/1 of the slice\(s\)/)
    // …and it does NOT keep quiet about having needed it: a shell that eats what
    // is typed into it is still a datum the human has to find out about.
    expect(r.all).toMatch(/the line had to be RESENT 1 time/)
    // The property that makes resending safe.
    expect(claudeRuns(repoRoot)).toBe(1)
  })

  it('resending NEVER launches two agents: if the first keystroke arrives late, the second sourcing is a no-op', () => {
    const repoRoot = makeRepoRoot()
    // The original keystroke takes 3 s; the resend goes out at 2.5 s and starts
    // the agent. When the original finally arrives, the launcher's guard turns it
    // into a no-op. Without the guard there would be TWO `claude` processes on
    // the same worktree — the damage a blind retry would have introduced.
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_COMMAND_DELAY_MS: '3000',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '8000',
      FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs'),
    })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/launched #90/)
    // Margin so that the delayed keystroke arrives after the resend.
    const t0 = Date.now()
    while (Date.now() - t0 < 2000) { /* short busy wait: the delayed stub runs in the background */ }
    expect(claudeRuns(repoRoot)).toBe(1)
  })

  it('when not even the resends are enough, it still does not lie — and it says it resent, not just that it waited', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      FAKE_CMUX_EAT_ALWAYS_SUBSTR: '#90', // an rc that devours EVERYTHING that is typed
      CT_NEXT_LAUNCH_TIMEOUT_MS: '5200',
      FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs'),
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/launched 0\/1 of the slice\(s\)/)
    expect(r.all).toMatch(/it cannot be confirmed that the command got to run/)
    expect(r.all).toMatch(/the line was resent \d+ times? to that session within the budget and still did not run/)
    expect(r.all).toMatch(/were left LAUNCHED WITHOUT VERIFICATION/)
    expect(claudeRuns(repoRoot)).toBe(0)
  })

  it('with no budget for a second attempt, it says there was NO resend — it does not let you believe it tried', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '600',
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/There was no automatic resend: the budget \(600 ms\)/)
  })

  it('cmux exposes no handle for the session: the resend cannot be addressed, and that does NOT happen in silence', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, {
      FAKE_CMUX_EAT_FIRST_CHAR_SUBSTR: '#90',
      FAKE_CMUX_NO_REF: '1',
      CT_NEXT_LAUNCH_TIMEOUT_MS: '5200',
    })
    expect(r.code).toBe(1)
    expect(r.all).toMatch(/the automatic resend of the line could not be done either/)
    expect(r.all).toMatch(/exposed no handle/)
  })

  it('the happy path with no resends mentions none: the note only shows up when there was something to report', () => {
    const repoRoot = makeRepoRoot()
    const r = dispatchOne(repoRoot, { FAKE_CMUX_CLAUDE_RUNS_FILE: join(repoRoot, 'claude-runs') })
    expect(r.code).toBe(0)
    expect(r.all).toMatch(/launched #90/)
    expect(r.all).not.toMatch(/REENVIAR/)
    expect(claudeRuns(repoRoot)).toBe(1)
  })

  it('the default budget is enough for several resends, not for exactly one', () => {
    // The measurement that pins it: idle, 1 resend at ~2.9 s; with the machine
    // loaded, 2 resends and ~7 s (1 in 3 went past F19's 8000). A budget that
    // was only enough for two attempts would fail again under load — and now,
    // unlike in F19, more budget DOES buy something: every extra window is
    // another keystroke, not another wait.
    const src = readFileSync(join(here, '..', 'scripts', 'ct-next.mjs'), 'utf8')
    const total = Number(src.match(/^const DEFAULT_LAUNCH_SENTINEL_TIMEOUT_MS = (\d+)$/m)?.[1])
    const attempt = Number(src.match(/^const LAUNCH_ATTEMPT_MS = (\d+)$/m)?.[1])
    expect(total).toBeGreaterThan(0)
    expect(attempt).toBeGreaterThan(0)
    expect(Math.floor(total / attempt)).toBeGreaterThanOrEqual(5)
  })

  it('the --dry-run shows the split into attempts and the measurement that justifies it', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1', '--dry-run'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[openIssue90], []]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    expect(r.out).toMatch(/the same line is RESENT/)
    expect(r.out).toMatch(/0 of 6 launches/)
  })
})

// ---------------------------------------------------------------------------
// H1 — unit tests: the guard and the argv of the resend
// ---------------------------------------------------------------------------
describe('F20/H1 — the idempotency guard (unit)', () => {
  it('the launcher does NOT relaunch the agent if its sentinel already exists', () => {
    const d = mkdtempSync(join(tmpdir(), 'ct-f20-guard-'))
    dirs.push(d)
    const sentinelPath = join(d, 'started')
    const marker = join(d, 'ran')
    const s = buildLauncherScript(
      { sentinelPath, agentCommand: `printf 'X' >> ${shQuote(marker)}`, agentBin: 'claude', issue: 7, worktree: d },
      shQuote,
    )
    const launcher = join(d, 'launch.sh')
    writeFileSync(launcher, s, { mode: 0o600 })
    const run = () => spawnSync('/bin/sh', ['-c', `. ${shQuote(launcher)}`], { cwd: d, encoding: 'utf8' })
    run()
    expect(existsSync(sentinelPath)).toBe(true)
    expect(readFileSync(marker, 'utf8')).toBe('X')
    // Second sourcing: the sentinel is already there, so nothing is relaunched.
    const r2 = run()
    expect(readFileSync(marker, 'utf8')).toBe('X')
    expect(r2.stdout).toMatch(/already started \(sentinel present\)/)
  })

  it('the sentinel is still written BEFORE the agent: the guard does not invert the order', () => {
    const s = buildLauncherScript({ sentinelPath: '/tmp/s', agentCommand: 'claude --x', agentBin: 'claude', issue: 7, worktree: '/wt' }, shQuote)
    expect(s.indexOf("> '/tmp/s'")).toBeLessThan(s.indexOf('claude --x'))
  })

  it('`send` and `send-key` go separately: cmux send does not send Enter on its own', () => {
    expect(buildCmuxSendArgv({ workspace: 'workspace:3', text: ". '/tmp/x'" })).toEqual(['send', '--workspace', 'workspace:3', ". '/tmp/x'"])
    expect(buildCmuxSendKeyArgv({ workspace: 'workspace:3' })).toEqual(['send-key', '--workspace', 'workspace:3', 'Enter'])
  })
})

// ---------------------------------------------------------------------------
// H2 — the harvest
// ---------------------------------------------------------------------------
describe('F20/H2 — the residue of a FINISHED slice gets named', () => {
  it('an already merged issue with its worktree and its branch still on disk comes out named, with the exact commands', () => {
    const repoRoot = makeRepoRoot()
    mkdirSync(join(repoRoot, '.worktrees', '451'), { recursive: true })
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GIT_BRANCH_LIST: 'feat/451',
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 451, state_reason: 'completed', body: '' }]]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    // Verified against the UNFIXED code: not a single mention of #451, of
    // `.worktrees/451` or of `feat/451` in the whole output.
    expect(r.all).toMatch(/pending harvest: 1 slice\(s\)/)
    expect(r.all).toMatch(/#451: worktree .*\.worktrees\/451, branch feat\/451/)
    expect(r.all).toMatch(/git worktree remove --force .*\.worktrees\/451 && git branch -D feat\/451/)
    // The added edge: that residue blocks the redispatch of the SAME number.
    expect(r.all).toMatch(/will REFUSE to redispatch/)
  })

  it('a repo with no residue says nothing (and does not invent a harvest)', () => {
    const repoRoot = makeRepoRoot()
    const r = runReal(['--repo', 'o/r', '--cap', '1'], {
      FAKE_GIT_TOPLEVEL: repoRoot,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([[], [{ number: 451, state_reason: 'completed', body: '' }]]),
      FAKE_GH_COUNTER_FILE: join(repoRoot, 'gh-list-count'),
    })
    expect(r.all).not.toMatch(/pending harvest/)
  })

  it('the cmux session still open on an already merged slice is named separately: that `claude` has been alive for hours', () => {
    const residue = collectFinishedResidue([451], {
      worktreeDirs: ['451'],
      branchNames: ['feat/451'],
      cmuxTitles: ['menoplus · #451 Segmented control', 'otra cosa'],
    })
    expect(residue).toHaveLength(1)
    expect(residue[0].cmuxTitle).toBe('menoplus · #451 Segmented control')
    const w = formatFinishedResidueWarning(residue, { repo: 'o/r' })
    expect(w).toMatch(/cmux session .* still open/)
    expect(w).toMatch(/still alive with the work ALREADY delivered/)
  })

  it('#45 does not match inside #451: the number is looked up as a whole token', () => {
    const residue = collectFinishedResidue([45], {
      worktreeDirs: ['45'],
      branchNames: [],
      cmuxTitles: ['repo · #451 otro slice'],
    })
    expect(residue[0].cmuxTitle).toBe(null)
  })

  it('a merged issue with NO residue does not go into the list', () => {
    expect(collectFinishedResidue([451, 452], { worktreeDirs: ['451'], branchNames: [] })).toHaveLength(1)
    expect(formatFinishedResidueWarning([], { repo: 'o/r' })).toBe(null)
  })
})

// ---------------------------------------------------------------------------
// H3 — who is who
// ---------------------------------------------------------------------------
describe('F20/H3 — the division of roles lives in the state, not only in a kickoff', () => {
  it('the STATE.md seeded in the worktree declares that that session is the DISPATCHED one and that it stops', () => {
    // Verified against the UNFIXED code: the seeded frontmatter had no `role`
    // field at all, so a dispatched session that re-hydrated from its STATE.md
    // had no way of knowing that merging or dispatching the next slice is not
    // its job.
    const seed = buildStateSeed(
      { name: 'algo', issue: '#90', n: 90, ac: ['ac1'], order: 1 },
      { branch: 'feat/90', base: 'main' },
    )
    expect(seed).toMatch(/^role: /m)
    expect(seed).toMatch(/DESPACHADA/)
    expect(seed).toMatch(/No groomeas, no mergeas/)
  })

  it('the template of the main checkout declares the OPPOSITE role: coordinator', () => {
    const tpl = readFileSync(join(here, '..', 'skills', 'state-template', 'STATE.template.md'), 'utf8')
    expect(tpl).toMatch(/^role: "coordinador/m)
    expect(tpl).toMatch(/NO implementas slices aquí/)
  })

  it('the §9 contract /ct-init seeds names both sessions and where each role lives', () => {
    const src = readFileSync(join(here, '..', 'scripts', 'ct-init.sh'), 'utf8')
    expect(src).toMatch(/Dos sesiones por repo, con papeles OPUESTOS/)
    // F21: this pinned the EXACT version (`=9`), and that turned every later
    // round touching the contract into an edit of this test, which is not about
    // the number. What does matter is that F20's content travels in a version
    // equal to or later than that one — if someone removed it and lowered the
    // version, this test would see it just the same. Same criterion as
    // ct-init.test.js#CONTRACT_VERSION, which already stopped hardcoding it for
    // this very reason.
    expect(Number(src.match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)[1])).toBeGreaterThanOrEqual(9)
  })
})
