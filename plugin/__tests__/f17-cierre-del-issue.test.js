// F17 — THE KICKOFF MANUFACTURED THE VERY DEADLOCK THE LOOP DESCRIBES AS A
// BREAKDOWN.
//
// The last line of the kickoff every dispatched agent receives said:
//
//   «Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre PR,
//    libera el claim con `node <dispatch-check> <n> --repo <repo> --release`,
//    deja el estado mergeable y PARA.»
//
// It did not ask for `Closes #N` in the PR. The complete chain, all of it
// verifiable in this repo:
//   1. the PR is merged and the issue stays OPEN (nothing closes it);
//   2. since F13 an open issue in `status:in-review` HOLDS ON to its tokens
//      (`area:`/`touches:`) until the merge, and the dispatcher cannot know it
//      has already been merged because it looks at the ISSUE's state
//      (claim.js:52-57);
//   3. those tokens are held indefinitely;
//   4. `merge-after` is satisfied EXACTLY when the issue is closed with
//      `stateReason === 'COMPLETED'` (gh-issue-map.js#filterMergedIssues), so no
//      dependent ever sees its dependency satisfied.
//
// The dispatcher itself already describes that state as a breakdown and gives
// the remedy ("ciérralo como completed si el PR ya se mergeó y nadie lo cerró
// porque le faltaba el Closes #N", ct-next.mjs:726/787/901). That the remedy
// exists and the cause is produced by the kickoff itself was the contradiction
// F17 closes.
//
// Every test in this file was checked RED against the unfixed code; the
// observed output is noted in the test itself.
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderKickoff } from '../scripts/kickoff.js'
import { filterMergedIssues } from '../scripts/gh-issue-map.js'
import { hermeticEnv } from './fixtures/hermetic-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const ctNext = join(root, 'scripts', 'ct-next.mjs')
const ctInit = join(root, 'scripts', 'ct-init.sh')
const fixturesDir = join(here, 'fixtures')

const fakePath = [join(fixturesDir, 'fake-git-bin'), join(fixturesDir, 'fake-gh-bin')]

function runNext(args, env = {}) {
  const r = spawnSync('node', [ctNext, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...hermeticEnv(fakePath), ...env },
  })
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
}

const SLICE = { n: 42, order: 3, name: 'refresh token', type: 'backend', ac: ['AC-1'], deps: [], issue: '#42' }
const OPTS = { repo: 'o/r', dispatchCheckPath: '/plugin/scripts/dispatch-check.mjs', base: 'main' , conventionsDir: '/plugin/conventions' }

// ============================================================================
// H1 — the kickoff has to ask for the `Closes #N`.
// ============================================================================
describe('F17/H1 — the kickoff asks for `Closes #N` in the body of the PR', () => {
  // OBSERVED UNFIXED (kickoff.js:129): the final line was
  //   «Al acabar: commit refs al issue, actualiza .agent/STATE.md, abre PR,
  //    libera el claim con `node /plugin/scripts/dispatch-check.mjs 42 --repo
  //    o/r --release`, deja el estado mergeable y PARA.»
  // — the string "Closes" did not appear ONCE in the whole kickoff.
  it('the kickoff contains the literal `Closes #<issue>` with the number already substituted', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toContain('Closes #42')
  })

  it('uses the ISSUE number, not the §9 order one (they are two different ID spaces)', () => {
    // slice.n = 42 (issue), slice.order = 3 (§9 table). A `Closes #3` would
    // close the wrong issue — or none.
    const k = renderKickoff(SLICE, OPTS)
    expect(k).not.toMatch(/Closes #3\b/)
    expect(k).toContain('Closes #42')
    // And the same number as the --release command, which comes out of the
    // same source (`slice.n`): if they diverged, one of the two would be
    // lying.
    expect(k).toContain('--repo o/r --release')
    expect(k).toMatch(/dispatch-check\.mjs 42 --repo/)
  })

  it('says it goes in the BODY of the PR (not in the title nor in a comment)', () => {
    // GitHub only interprets the closing keywords in the PR's body and in the
    // branch's commit messages; a `Closes #N` in the TITLE closes nothing.
    // Without this precision, "put it in the PR" is ambiguous exactly where it
    // cannot be.
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/CUERPO del PR/)
  })

  // OBSERVED UNFIXED: none of these words appeared in the kickoff. Without the
  // why, the line is one more in a list of six and is the first to fall away
  // when the agent is running short of context.
  it('says WHY: without the closure, the slice holds on to its tokens and does not unblock its dependents', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/tokens/)
    expect(k).toMatch(/merge-after/)
    // The concrete state that is produced, named: it is the one the dispatcher
    // describes as a breakdown.
    expect(k).toMatch(/mergeado.{0,80}issue.{0,40}abierto|issue.{0,40}abierto.{0,80}mergeado/is)
  })

  // An executable check against the source of truth: `merge-after` is NOT
  // satisfied by an open issue nor by one closed in just any way — only by
  // COMPLETED, which is what `Closes #N` produces on merging.
  it('check: filterMergedIssues only counts COMPLETED (what the Closes #N produces on merging)', () => {
    expect(filterMergedIssues([{ number: 7, stateReason: 'COMPLETED' }])).toEqual([7])
    expect(filterMergedIssues([{ number: 7, stateReason: 'NOT_PLANNED' }])).toEqual([])
    expect(filterMergedIssues([{ number: 7, stateReason: null }])).toEqual([])
  })
})

// ============================================================================
// H1, the collateral case nobody asked for and which breaks the chain EVEN IF
// the agent obeys: the PR opened against the wrong branch.
//
// `gh pr create` with no `--base` points at the repo's default branch. But
// ct-next.mjs accepts `--base <rama>` and creates the worktree with `git
// worktree add -b feat/<n> <wt> <resolvedBase>`: if that base is NOT the
// default branch, the agent would open the PR against the default branch — a
// diff that is not its own. The kickoff did not tell it the base anywhere.
// ============================================================================
describe('F17/H1 — the kickoff names the base branch the PR is opened against', () => {
  // OBSERVED UNFIXED: the kickoff contained neither the string "main" nor any
  // other mention of the base branch; `renderKickoff` did not even receive the
  // datum (ct-next.mjs:1809 called `renderKickoff(slice, { repo, dispatchCheckPath })`
  // while `buildStateSeed` did receive `base: resolvedBase` on the next line).
  it('with a known base, the kickoff names it', () => {
    const k = renderKickoff(SLICE, { ...OPTS, base: 'release/2026-08' })
    expect(k).toContain('release/2026-08')
  })

  it('with no base, it does NOT invent "main": it refers to the branch the worktree came off', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' , conventionsDir: '/plugin/conventions' })
    expect(k).not.toMatch(/contra `main`/)
    expect(k).toMatch(/rama base de la que sali[óo] este worktree/i)
    // The `Closes` is still there: it does not depend on knowing the base.
    expect(k).toContain('Closes #42')
  })

  it('ct-next passes the resolved base to the kickoff (dry-run, the kickoff is printed whole)', () => {
    const fx = JSON.stringify({
      issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: [] }],
      mergedIssues: [],
    })
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run', '--base', 'develop'], { CT_NEXT_FIXTURE: fx })
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('Closes #2')
    expect(r.stdout).toContain('develop')
  })
})

// ============================================================================
// H1, the case that turns an OBEDIENT agent into the very same deadlock.
//
// VERIFIED IN THE FIELD against josemerca/ct-loop-sandbox (28-jul-2026), not
// deduced from the documentation:
//   - PR #33, `Closes #31` in the body, merged with base `f17-base` (NOT the
//     default branch) → issue #31 was left {"state":"OPEN","stateReason":""}.
//   - PR #34, `Closes #32` in the body, merged with base `main` (the default
//     branch) → issue #32 was left {"state":"CLOSED","stateReason":"COMPLETED"}.
// That is: the closing keywords ONLY close the issue when the PR is merged into
// the repo's DEFAULT branch. With `--base <otra-rama>`, an agent that obeys the
// kickoff to the letter still leaves the issue open and the lane blocked — and
// whoever reads the dispatcher's remedy ("al PR le faltaba el Closes #N") will
// look at the PR, see the `Closes #N`, and dismiss the diagnosis.
// ============================================================================
describe('F17 — a non-default `--base`: the warning that the `Closes #N` will not close the issue', () => {
  const fx = JSON.stringify({
    issues: [{ n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: [] }],
    mergedIssues: [],
  })

  // OBSERVED UNFIXED: a run with `--base develop` said nothing about it
  // (stderr only carried the ACCOUNT_MAP warning if the repo did not match).
  it('with --base, it warns on STDERR about the default branch rule', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run', '--base', 'develop'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).toMatch(/aviso:.*--base develop/)
    expect(r.stderr).toMatch(/rama por defecto/)
    expect(r.stderr).toMatch(/Closes #/)
    // It is diagnostics, not product: it does not sneak into the plan.
    expect(r.stdout).not.toMatch(/^aviso:/m)
  })

  // A negative check: with no --base, the resolved base IS the default branch
  // (`detectDefaultBranch` resolves it against GitHub), so the warning would be
  // pure noise.
  it('with no --base NOTHING is warned about (the resolved base is, by construction, the default branch)', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: fx })
    expect(r.stderr).not.toMatch(/rama por defecto/)
  })
})

// ============================================================================
// H2 — A DECISION, not a change: the reason for the block STAYS on stdout.
//
// F16 fixed "stdout = product, stderr = diagnostics" and, in writing it, had
// already listed the block reason on the PRODUCT side (ct-next.mjs:1040-1046:
// «STDOUT = el PRODUCTO. […] el plan de despacho, la selección, EL MOTIVO DE
// BLOQUEO, el registro de lo lanzado»). It is not a loose end of F16: it is an
// explicit classification, and it is still the right one.
//
// The argument, and why the "dual nature" is not one:
//   - the question /ct-next answers is «what gets dispatched now?». «Nothing,
//     and this is exactly what prevents it, with its remedy» is a COMPLETE and
//     terminal answer to that question, not an observation about the run. An
//     `aviso:` is the second thing: the run did its job and ALSO notes
//     something. That is the dividing line, and the block reason falls on the
//     product's side in BOTH modes;
//   - `--dry-run` does not change WHAT the product is, only whether the plan is
//     executed. Routing the same sentence to a different channel depending on a
//     flag would be the real incoherence: `/ct-next > out.txt` and `/ct-next
//     --dry-run > out.txt` would leave different things in `out.txt` without
//     the user having asked for anything different;
//   - the decisive evidence is in the code: after printing it, `process.exit(0)`
//     is called. If the reason went to stderr, a real blocked run would leave
//     STDOUT EMPTY with exit 0 — which reads as «all fine, nothing to report»,
//     exactly the misunderstanding F16 fought with the recap of warnings.
// This test fixes the decision so that a future "channel coherence sweep" has
// to argue against it instead of applying it in silence.
// ============================================================================
describe('F17/H2 — the block reason is PRODUCT: stdout, in dry-run and for real', () => {
  const bloqueado = JSON.stringify({
    issues: [
      { n: 1, order: 1, status: 'in-progress', deps: [], touches: ['api'], name: 'a' },
      { n: 2, order: 2, status: 'ready', deps: [], touches: ['api'], name: 'b' },
    ],
    mergedIssues: [],
  })

  it('the block reason comes out on stdout and is NOT duplicated on stderr', () => {
    const r = runNext(['--repo', 'o/r', '--cap', '9', '--dry-run'], { CT_NEXT_FIXTURE: bloqueado })
    expect(r.code).toBe(0)
    expect(r.stdout).toMatch(/colisiona con trabajo en vuelo/)
    expect(r.stderr).not.toMatch(/colisiona con trabajo en vuelo/)
  })

  it('the criterion written in the file itself classifies the block reason as stdout', () => {
    // If somebody moves the line to stderr without touching the criterion, this
    // test catches it: the code and its criterion cannot diverge in silence.
    const src = readFileSync(join(root, 'scripts', 'ct-next.mjs'), 'utf8')
    expect(src).toMatch(/STDOUT = el PRODUCTO[\s\S]{0,400}motivo de bloqueo/)
    expect(src).toMatch(/console\.log\(formatBlockReason\(/)
  })
})

// ============================================================================
// The §9 contract (ct-init.sh) lists what the dispatched agent receives and
// describes the "PR merged, issue open" state. Both things change here, and a
// repo that is already bootstrapped cannot deduce them: hence the v6 → v7 bump.
// ============================================================================
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('bash', [ctInit, dir], { encoding: 'utf8' })
  const contrato = readFileSync(join(dir, 'docs', 'superpowers', 'CONTRATO-SLICES.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return contrato
}
const flat = (s) => s.replace(/\*/g, '').replace(/\s+/g, ' ')
const V6 = () => readFileSync(join(root, '__tests__', 'fixtures', 'slices-contract-v6.md'), 'utf8')
// The v6 fixture is not a transcription: its sha256 is 8de58db9…, exactly the
// hash SLICES_PRISTINE_HASHES already had recorded for the v6 block, and it was
// generated by running the ct-init.sh of 25caa11. It is the real block.

// The paragraph of the contract that lists what the kickoff carries. It is
// narrowed to that paragraph on purpose: `Closes #N` and "rama por defecto"
// already appeared at OTHER points of the v6 block (the remedy for the merged
// PR, and the link to the spec «…/blob/<rama por defecto>/…»), so a `toMatch`
// over the whole block would pass green without the enumeration having stopped
// keeping quiet about it. Checked: the first two versions of these tests passed
// against the unfixed v6.
const bulletKickoff = (s) => {
  const m = flat(s).match(/Qué recibe el agente despachado[\s\S]*?no llega al agente\./)
  return m ? m[0] : ''
}

describe('§9 contract (F17): the closure of the issue and the default branch trap', () => {
  it('check: the v6 contract said nothing about this', () => {
    const v6 = flat(V6())
    // It listed what the kickoff carries, and the `Closes #N` was NOT there.
    expect(bulletKickoff(V6())).not.toBe('')
    expect(bulletKickoff(V6())).not.toMatch(/Closes/)
    // And it attributed the "PR merged, issue open" state to ONE single cause.
    expect(v6).toMatch(/al PR le faltaba `Closes #N`/)
    expect(v6).not.toMatch(/DOS causas/)
    expect(v6).not.toMatch(/solo cierra el issue cuando el PR entra en la rama por defecto/)
  })

  it('says the kickoff asks for the `Closes #N` (the list of what the agent receives no longer keeps quiet about it)', () => {
    const b = bulletKickoff(seed())
    expect(b).toMatch(/Closes #N/)
    expect(b).toMatch(/cuerpo/)
    // And the base branch, which is the other datum the kickoff did not give it.
    expect(b).toMatch(/rama base/)
  })

  it('names the SECOND cause of "PR merged, issue open": the merge into a branch that is not the default one', () => {
    const f = flat(seed())
    expect(f).toMatch(/DOS causas/)
    expect(f).toMatch(/solo cierra el issue cuando el PR entra en la rama por defecto/)
    // The actionable consequence, which is what changes a decision: with
    // --base pointing at another branch, closing the issue on merging is a
    // manual step.
    expect(f).toMatch(/--base <otra-rama>/)
    expect(f).toMatch(/paso a mano/)
  })

  // F18: this test pinned the literal '7' and therefore had to be edited on
  // every bump — that is, the guard was touched exactly when it should have
  // been guarding. What really has to be true is that the THREE declarations
  // (the block's marker, the footer note and the script's
  // SLICES_CONTRACT_VERSION) agree with each other; the script supplies the
  // concrete number.
  it('the footer note, the marker and SLICES_CONTRACT_VERSION declare the SAME version', () => {
    const a = seed()
    const declared = readFileSync(ctInit, 'utf8').match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)
    const marker = a.match(/<!-- ct-init:slices-contract-version: (\d+) -->/)
    const footer = a.match(/Este contrato lo mantiene `\/ct-init` \(contrato v(\d+)\)/)
    expect(declared).not.toBeNull()
    expect(marker[1]).toBe(declared[1])
    expect(footer[1]).toBe(declared[1])
    // Check: it never goes backwards. v7 was the previous one.
    expect(Number(declared[1])).toBeGreaterThanOrEqual(8)
  })
})
