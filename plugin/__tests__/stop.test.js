import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { NOTICE_REPEAT_EVERY_TURNS, STOP_NOTICE_REL_NAME } from '../scripts/state.js'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'stop.js')

function bareRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 't@t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}
function commit(dir, name) {
  writeFileSync(join(dir, name), name)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', name], { cwd: dir })
  return head(dir)
}
function initRepo() {
  const dir = bareRepo()
  commit(dir, 'a.txt')
  return dir
}
function head(dir) { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim() }
function git(dir, ...args) { return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim() }
function writeState(dir, sha) {
  mkdirSync(join(dir, '.agent'), { recursive: true })
  writeFileSync(join(dir, '.agent', 'STATE.md'), `---\nlast_commit: ${sha}\n---\nx`)
}
function run(dir, stopActive = false) {
  return execFileSync('node', [hook], {
    input: JSON.stringify({ cwd: dir, stop_hook_active: stopActive, hook_event_name: 'Stop' }),
    encoding: 'utf8',
  }).trim()
}

describe('stop hook', () => {
  it('it blocks if HEAD moved on with respect to STATE.last_commit', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/STATE\.md/)
    rmSync(dir, { recursive: true, force: true })
  })
  it('it does not block if STATE.last_commit == HEAD', () => {
    const dir = initRepo()
    writeState(dir, head(dir))
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
  it('it does not block with stop_hook_active (anti-loop)', () => {
    const dir = initRepo()
    writeState(dir, 'sha_viejo')
    expect(run(dir, true)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
  it('malformed stdin → empty output, exit 0 (no crash)', () => {
    const r = spawnSync('node', [hook], { input: 'no-json{', encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('')
  })
  it('it does not run commands injected through last_commit (it blocks, with no effects)', () => {
    const dir = initRepo()
    writeState(dir, '$(touch pwned)')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })
  // F7: the hook reminds which fields to update before closing; the place where
  // a block is recorded is that very moment, and `blocked` was not in the list.
  it('the warning names the `blocked` field as the way to say the work cannot go on', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.reason).toMatch(/`blocked`/)
    expect(out.reason).toMatch(/no lo escribas en prosa dentro de next_action/i)
    rmSync(dir, { recursive: true, force: true })
  })

  // F7: `parseState` THROWS on a broken frontmatter and here it was called with
  // no net — the hook blew up with a stack trace on stderr at EVERY turn
  // closure of that repo, without ever saying the problem was the file.
  it('STATE.md with a broken frontmatter → it neither crashes nor spits a stack trace; it says so and asks for a fix', () => {
    const dir = initRepo()
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "sin cerrar\n  ]: [\n---\nx')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    const out = JSON.parse(r.stdout)
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/frontmatter/i)
    expect(out.reason).toMatch(/`blocked`/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('broken frontmatter + stop_hook_active → it does not block (anti-loop)', () => {
    const dir = initRepo()
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "sin cerrar\n  ]: [\n---\nx')
    expect(run(dir, true)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('no stderr leak when cwd is not a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, 'sha_viejo')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ===========================================================================
// F12: the guard compared `last_commit` with HEAD by EQUALITY and, on failing,
// asserted «Hay commits más nuevos» — an ancestry relation it never checked. In
// a repo with two live lines of work that was false AND a wall: the block could
// only be satisfied by deleting the other line's handoff.
// ===========================================================================
describe('stop hook — the relation between last_commit and HEAD', () => {
  it('ancestor of HEAD: it blocks, and now it COUNTS the commits instead of assuming them', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    commit(dir, 'c.txt')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/2 commits/)
    expect(out.reason).toMatch(/ancestro de HEAD/)
    expect(out.reason).toMatch(/rama `main`/)
    rmSync(dir, { recursive: true, force: true })
  })

  // THE REAL CASE. Two divergent branches; the root's STATE.md points at a
  // commit of the one that is NOT in the checkout. That SHA resolves (same
  // object store) but will never be equal to HEAD: before, it blocked on EVERY
  // turn accusing of «más nuevos» commits that did not exist.
  it('divergent branches: it does NOT block, does not say "más nuevos", and names the branch where the commit lives', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'polish-v2-geometria')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)

    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/divergentes/)
    expect(out.systemMessage).toMatch(/polish-v2-geometria/)
    expect(out.systemMessage).not.toMatch(/más nuevos/)
    rmSync(dir, { recursive: true, force: true })
  })

  // A guard that cannot be satisfied is a wall: the same state, turn after
  // turn, cannot keep blocking for ever.
  it('divergent branches: the closure is not a dead end (two turns in a row, neither blocks)', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'otra')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    // #95: the second turn no longer repeats the warning (it comes out empty),
    // and that is also "it does not block" — what this test protects is that
    // there is no `decision`.
    for (const _ of [1, 2]) {
      const salida = run(dir)
      expect(salida ? JSON.parse(salida).decision : undefined).toBeUndefined()
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('the state is AHEAD of HEAD: it does not block and explicitly advises against repointing last_commit', () => {
    const dir = initRepo()
    const base = head(dir)
    git(dir, 'checkout', '-qb', 'adelantada')
    const delante = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    expect(head(dir)).toBe(base)
    writeState(dir, delante)

    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/descendiente de HEAD/)
    expect(out.systemMessage).toMatch(/hacia atrás/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('divergent + stop_hook_active: neither block nor warning (anti-loop)', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'otra')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    expect(run(dir, true)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  // The real case came from ANOTHER WORKTREE writing into the root's STATE.md.
  it('worktree: another worktree\'s commit resolves and is treated as divergent, not as "más nuevo"', () => {
    const dir = initRepo()
    const wt = join(dir, '..', `wt-${Math.random().toString(36).slice(2)}`)
    git(dir, 'worktree', 'add', '-q', '-b', 'rama-worktree', wt)
    const otro = commit(wt, 'w.txt')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/divergentes/)
    expect(out.systemMessage).toMatch(/rama-worktree/)
    git(dir, 'worktree', 'remove', '--force', wt)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a SHA that does not resolve: it blocks saying it is not a commit of this repo, without asserting age', () => {
    const dir = initRepo()
    writeState(dir, 'sha_viejo')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/no es ningún commit de este repositorio/)
    expect(out.reason).toMatch(/sha_viejo/)
    expect(out.reason).not.toMatch(/más nuevos/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an empty or null last_commit: it does not block (nothing to compare)', () => {
    for (const linea of ['last_commit:', "last_commit: ''", 'last_commit: "   "']) {
      const dir = initRepo()
      mkdirSync(join(dir, '.agent'), { recursive: true })
      writeFileSync(join(dir, '.agent', 'STATE.md'), `---\n${linea}\n---\nx`)
      expect(run(dir)).toBe('')
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a last_commit that looks like a git option: it is rejected before reaching git, without running it', () => {
    const dir = initRepo()
    writeState(dir, '--output=pwned')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect(JSON.parse(r.stdout).decision).toBe('block')
    expect(existsSync(join(dir, 'pwned'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a repo with no commit at all: it exits in silence, with no stack trace', () => {
    const dir = bareRepo()
    writeState(dir, 'sha_viejo')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    expect((r.stdout || '').trim()).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('detached HEAD: it does not invent a branch, it says so', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', '--detach', 'HEAD')
    writeState(dir, viejo)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/desprendido/)
    expect(out.reason).not.toMatch(/rama `/)
    rmSync(dir, { recursive: true, force: true })
  })

  // The warning comes out on EVERY turn while the anomaly lasts (on purpose: it
  // is the visible pressure on a structural problem someone has to solve). That
  // price is paid by being short.
  it('the divergence warning is brief: only what changes a decision', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'polish-v2-geometria')
    const otro = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    writeState(dir, otro)
    const msg = JSON.parse(run(dir)).systemMessage
    expect(msg.length).toBeLessThan(340)
    // What has to keep being there: where it lives, that they diverge, and the
    // price of the obvious action.
    expect(msg).toMatch(/polish-v2-geometria/)
    expect(msg).toMatch(/divergentes/)
    expect(msg).toMatch(/sustituyes el de la otra/)
    // What is superfluous: explaining why the guard does not block, every turn.
    expect(msg).not.toMatch(/pisándose por turnos/)
    expect(msg).not.toMatch(/NO se bloquea el cierre/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the "va por delante" warning is brief too', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'adelantada')
    const delante = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    writeState(dir, delante)
    const msg = JSON.parse(run(dir)).systemMessage
    expect(msg.length).toBeLessThan(280)
    expect(msg).toMatch(/hacia atrás/)
    expect(msg).not.toMatch(/No se bloquea el cierre/)
    rmSync(dir, { recursive: true, force: true })
  })

  // A `reset --hard` that takes out the commit the STATE.md describes: the state
  // points at work that no longer exists under any ref.
  it('orphan commit after reset --hard: its own warning, distinct from the "va por delante" one, and it does NOT block', () => {
    const dir = initRepo()
    const huerfano = commit(dir, 'b.txt')
    git(dir, 'reset', '-q', '--hard', 'HEAD~1')
    writeState(dir, huerfano)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/huérfano/)
    expect(out.systemMessage).toMatch(/ni local ni remota/)
    expect(out.systemMessage).toMatch(/git gc/)
    // It is not the `ahead` message: here there is no handoff to protect.
    expect(out.systemMessage).not.toMatch(/va por delante/)
    expect(out.systemMessage).not.toMatch(/hacia atrás/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('deleted divergent branch: the commit is left orphan and falls into that warning, not the divergence one', () => {
    const dir = initRepo()
    git(dir, 'checkout', '-qb', 'efimera')
    const huerfano = commit(dir, 'b.txt')
    git(dir, 'checkout', '-q', 'main')
    commit(dir, 'c.txt')
    git(dir, 'branch', '-qD', 'efimera')
    writeState(dir, huerfano)
    const out = JSON.parse(run(dir))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/huérfano/)
    expect(out.systemMessage).not.toMatch(/divergentes/)
    rmSync(dir, { recursive: true, force: true })
  })

  // «Vive en `origin/polish-v2`» is far more useful than «no sé dónde está».
  it('with no local branch containing it, the remote ones are looked at and origin/… is named', () => {
    const origen = initRepo()
    git(origen, 'checkout', '-qb', 'polish-v2')
    const otro = commit(origen, 'b.txt')
    git(origen, 'checkout', '-q', 'main')

    const clon = mkdtempSync(join(tmpdir(), 'ct-clon-'))
    execFileSync('git', ['clone', '-q', origen, clon], { encoding: 'utf8' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: clon })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: clon })
    commit(clon, 'c.txt')
    // In the clone there is no LOCAL branch containing that commit.
    expect(git(clon, 'branch', '--contains', otro, '--format=%(refname:short)')).toBe('')
    writeState(clon, otro)

    const out = JSON.parse(run(clon))
    expect(out.decision).toBeUndefined()
    expect(out.systemMessage).toMatch(/`origin\/polish-v2`/)
    expect(out.systemMessage).toMatch(/divergentes/)
    expect(out.systemMessage).not.toMatch(/huérfano/)
    rmSync(clon, { recursive: true, force: true })
    rmSync(origen, { recursive: true, force: true })
  })

  it('with a local branch containing it, the noise of origin/* does not creep in', () => {
    const origen = initRepo()
    const clon = mkdtempSync(join(tmpdir(), 'ct-clon-'))
    execFileSync('git', ['clone', '-q', origen, clon], { encoding: 'utf8' })
    execFileSync('git', ['config', 'user.email', 't@t'], { cwd: clon })
    execFileSync('git', ['config', 'user.name', 't'], { cwd: clon })
    git(clon, 'checkout', '-qb', 'local-viva')
    const otro = commit(clon, 'b.txt')
    git(clon, 'checkout', '-q', 'main')
    commit(clon, 'c.txt')
    writeState(clon, otro)

    const msg = JSON.parse(run(clon)).systemMessage
    expect(msg).toMatch(/`local-viva`/)
    expect(msg).not.toMatch(/origin\//)
    rmSync(clon, { recursive: true, force: true })
    rmSync(origen, { recursive: true, force: true })
  })

  it('a tag or a branch as last_commit resolves to its commit (it is not treated as unreadable)', () => {
    const dir = initRepo()
    git(dir, 'tag', 'v1')
    writeState(dir, 'v1')
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ============================================================================
// F15/H4 — THE FRESHNESS CHECK WAS UNSATISFIABLE BY CONSTRUCTION.
//
// The commit that updates STATE.md includes STATE.md, so obeying the guard
// creates the very commit that invalidates it again. Reproduced against
// dac5326's dist/stop.js, two rounds in a row:
//   HEAD=2926a17 last_commit=192baa2 → block "hay 1 commit … por encima"
//   HEAD=3346b8e last_commit=2926a17 → block "hay 1 commit … por encima"
// ============================================================================

// commitState: writes last_commit and COMMITS that change — that is, it does
// exactly what the guard asks for, including the commit that reintroduced it.
function commitState(dir, sha) {
  writeState(dir, sha)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', 'chore(state): apunte'], { cwd: dir })
  return head(dir)
}

describe('F15/H4 — obeying the freshness guard has to leave it green', () => {
  it('updating and committing STATE.md leaves the guard IN SILENCE (before: block, for ever)', () => {
    const dir = initRepo()
    commit(dir, 'b.txt')
    commitState(dir, head(dir))
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  it('and the second round too: there is no regression that reintroduces itself', () => {
    const dir = initRepo()
    commit(dir, 'b.txt')
    commitState(dir, head(dir))
    commitState(dir, head(dir)) // two entries in a row, with no work in between
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })

  // WHAT CANNOT BE LOST (1): real unrecorded work still blocks.
  it('a CODE commit without updating STATE.md still blocks, with its count', () => {
    const dir = initRepo()
    commitState(dir, head(dir))
    commit(dir, 'c.txt')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/1 commit de trabajo/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the count separates work from entries instead of mixing them', () => {
    const dir = initRepo()
    const base = head(dir)
    commitState(dir, base)      // entry (does not count)
    commit(dir, 'c.txt')        // work
    commit(dir, 'd.txt')        // work
    writeState(dir, base)       // the state stays at the base commit
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/2 commits de trabajo/)
    expect(out.reason).toMatch(/1 commit que solo toca/)
    rmSync(dir, { recursive: true, force: true })
  })

  // WHAT CANNOT BE LOST (2): the obvious hole in the fix. If it were enough for
  // the commit to TOUCH STATE.md, real unrecorded work would slip through by
  // being put in the same commit as the entry.
  it('a commit that touches STATE.md AND ALSO code DOES count as work', () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), `---\nlast_commit: ${base}\n---\nx`)
    writeFileSync(join(dir, 'code.txt'), 'trabajo de verdad')
    execFileSync('git', ['add', '-A'], { cwd: dir })
    execFileSync('git', ['commit', '-qm', 'apunte + código'], { cwd: dir })
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(out.reason).toMatch(/1 commit de trabajo/)
    rmSync(dir, { recursive: true, force: true })
  })

  // FAIL CLOSED: a merge lists no files in `git log --name-only`, and it can
  // bring real work along. It counts as work, not as an entry.
  it('a merge (with no files listed) counts as work, not as an entry', () => {
    const dir = initRepo()
    const base = head(dir)
    git(dir, 'checkout', '-q', '-b', 'side')
    commit(dir, 'side.txt')
    git(dir, 'checkout', '-q', 'main')
    writeState(dir, base)
    git(dir, 'merge', '-q', '--no-ff', 'side', '-m', 'merge')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    rmSync(dir, { recursive: true, force: true })
  })

  // The sibling that dragged the same defect along: `unresolvable` blocks and
  // its remedy ("put the real SHA in") ended, before F15, in the same loop as
  // soon as you committed the fix.
  it('the `unresolvable` remedy (put the real SHA in and commit it) now TERMINATES', () => {
    const dir = initRepo()
    writeState(dir, 'relleno-que-no-es-un-sha')
    const bloqueado = JSON.parse(run(dir))
    expect(bloqueado.decision).toBe('block')
    expect(bloqueado.reason).toMatch(/no es ningún commit de este repositorio/)
    commitState(dir, head(dir))
    expect(run(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})

// ===========================================================================
// #95/H5 — THE AGENT DID NOT COMMIT, BUT HEAD MOVED ON: THE PROGRAM KNOWS THE SHA.
//
// On the `ct-step` path, the one who commits is the PROGRAM. The agent did not
// touch `last_commit` because it made no commit at all, and the guard blocked
// its turn asking it to copy a value the hook itself already has in hand
// (`headSha`). When the commits above carry the trailer `ct-step` writes, the
// hook recognises them as its own, updates the state file itself and lets the
// turn close. What it cannot attribute still blocks.
// ===========================================================================
function ctStepCommit(dir, name) {
  writeFileSync(join(dir, name), name)
  execFileSync('git', ['add', '-A'], { cwd: dir })
  execFileSync('git', ['commit', '-qm', `${name} (#42, tarea 1/3)\n\nTarea 1 de 3 del plan del slice.\n\nCommitted-By: ct-step`], { cwd: dir })
  return head(dir)
}
function lastCommitOf(dir, rel = '.agent/STATE.md') {
  return /^last_commit:\s*(.*)$/m.exec(readFileSync(join(dir, rel), 'utf8'))[1].trim()
}

describe('#95 — the commits ct-step made do not block the turn closure', () => {
  it("after a ct-step commit the closure does NOT block and the state file is left with HEAD's sha", () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    const nuevo = ctStepCommit(dir, 'b.txt')
    const out = run(dir)
    expect(out).toBe('')
    expect(lastCommitOf(dir)).toBe(nuevo)
    rmSync(dir, { recursive: true, force: true })
  })

  it('several ct-step commits in a row are all attributed and the state jumps to the last one', () => {
    const dir = initRepo()
    writeState(dir, head(dir))
    ctStepCommit(dir, 'b.txt')
    const ultimo = ctStepCommit(dir, 'c.txt')
    expect(run(dir)).toBe('')
    expect(lastCommitOf(dir)).toBe(ultimo)
    rmSync(dir, { recursive: true, force: true })
  })

  // WHAT CANNOT BE LOST: a commit ct-step did NOT make still blocks, even when
  // it comes accompanied by others that it did.
  it('a commit without the trailer among ct-step\'s brings the block back and does NOT touch the file', () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    ctStepCommit(dir, 'b.txt')
    commit(dir, 'a-mano.txt')
    const out = JSON.parse(run(dir))
    expect(out.decision).toBe('block')
    expect(lastCommitOf(dir)).toBe(base)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a commit made by hand, with no trailer at all, still blocks just as before', () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    commit(dir, 'a-mano.txt')
    expect(JSON.parse(run(dir)).decision).toBe('block')
    expect(lastCommitOf(dir)).toBe(base)
    rmSync(dir, { recursive: true, force: true })
  })

  // The precedence of state-paths: in a slice worktree the file that gets
  // written is SLICE.md, which is the one the hook read — never the
  // coordinator's tracked STATE.md.
  it("in a slice worktree SLICE.md is written, and the coordinator's STATE.md is not touched", () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\nlast_commit: intacto\n---\nc')
    writeFileSync(join(dir, '.agent', 'SLICE.md'), `---\nlast_commit: ${base}\n---\ns`)
    const nuevo = ctStepCommit(dir, 'b.txt')
    expect(run(dir)).toBe('')
    expect(lastCommitOf(dir, '.agent/SLICE.md')).toBe(nuevo)
    expect(lastCommitOf(dir, '.agent/STATE.md')).toBe('intacto')
    rmSync(dir, { recursive: true, force: true })
  })

  // The rest of the file belongs to the agent: comments, fields this hook does
  // not know about and the prose body. ONE line is rewritten, nothing is
  // re-serialised.
  it('only the last_commit line changes: the comments, the foreign fields and the body are left intact', () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    const antes = [
      '---',
      '# un comentario que explica el campo',
      'task: "algo"',
      `last_commit: ${base}`,
      'baseline: "un campo que este hook no conoce"',
      '---',
      '## Current State',
      'prosa del agente',
      '',
    ].join('\n')
    writeFileSync(join(dir, '.agent', 'STATE.md'), antes)
    const nuevo = ctStepCommit(dir, 'b.txt')
    expect(run(dir)).toBe('')
    const despues = readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')
    expect(despues).toBe(antes.replace(base, nuevo))
    rmSync(dir, { recursive: true, force: true })
  })

  // The quoted value is the shape `buildStateSeed` writes: the VALUE is
  // rewritten, not the whole line, and the quotes are still there.
  it('a quoted last_commit keeps its quotes when it is updated', () => {
    const dir = initRepo()
    const base = head(dir)
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), `---\nlast_commit: "${base}"\n---\nx`)
    const nuevo = ctStepCommit(dir, 'b.txt')
    expect(run(dir)).toBe('')
    expect(readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')).toContain(`last_commit: "${nuevo}"`)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with stop_hook_active nothing is written (anti-loop)', () => {
    const dir = initRepo()
    const base = head(dir)
    writeState(dir, base)
    ctStepCommit(dir, 'b.txt')
    expect(run(dir, true)).toBe('')
    expect(lastCommitOf(dir)).toBe(base)
    rmSync(dir, { recursive: true, force: true })
  })
})

// ===========================================================================
// #95/H8 — the non-blocking warning came out on EVERY turn while the anomaly
// lasted. It comes out on the first, when the relation changes, and every N
// turns.
// ===========================================================================
function repoAdelantado() {
  const dir = initRepo()
  git(dir, 'checkout', '-qb', 'adelantada')
  const delante = commit(dir, 'b.txt')
  git(dir, 'checkout', '-q', 'main')
  writeState(dir, delante)
  return dir
}
const avisosEn = (dir, turnos) => {
  const out = []
  for (let i = 0; i < turnos; i++) {
    const salida = run(dir)
    if (salida) out.push(JSON.parse(salida).systemMessage)
  }
  return out.filter(Boolean)
}

describe('#95 — the non-blocking warning stops coming out on every turn', () => {
  it('five turns in a row in `ahead` give ONE single warning, not five', () => {
    const dir = repoAdelantado()
    const avisos = avisosEn(dir, 5)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/descendiente de HEAD/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the warning comes out again once the period is up, so the anomaly does not become invisible', () => {
    const dir = repoAdelantado()
    expect(avisosEn(dir, NOTICE_REPEAT_EVERY_TURNS * 2)).toHaveLength(2)
    rmSync(dir, { recursive: true, force: true })
  })

  it('if the relation changes, the new warning comes out without waiting for the period', () => {
    const dir = repoAdelantado()
    expect(avisosEn(dir, 1)).toHaveLength(1)
    expect(avisosEn(dir, 1)).toHaveLength(0)
    // The same session goes from `ahead` to `diverged`: it is another anomaly.
    commit(dir, 'c.txt')
    const avisos = avisosEn(dir, 1)
    expect(avisos).toHaveLength(1)
    expect(avisos[0]).toMatch(/divergentes/)
    rmSync(dir, { recursive: true, force: true })
  })

  // The marker is the hook's bookkeeping: it cannot end up inside a PR.
  it('the marker lives in .agent/ and git does not see it', () => {
    const dir = repoAdelantado()
    avisosEn(dir, 1)
    expect(existsSync(join(dir, '.agent', STOP_NOTICE_REL_NAME))).toBe(true)
    expect(git(dir, 'status', '--porcelain', '--ignored=no')).not.toMatch(/stop-notice/)
    rmSync(dir, { recursive: true, force: true })
  })

  // A warning silenced by mistake is worse than a repeated one: if the marker
  // cannot be read or cannot be kept out of git, the warning goes out anyway.
  it('a corrupt marker does not silence the warning', () => {
    const dir = repoAdelantado()
    avisosEn(dir, 1)
    writeFileSync(join(dir, '.agent', STOP_NOTICE_REL_NAME), 'esto no es json')
    expect(avisosEn(dir, 1)).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the `behind` block does not go through the marker: it always comes out', () => {
    const dir = initRepo()
    const viejo = head(dir)
    commit(dir, 'b.txt')
    writeState(dir, viejo)
    for (const _ of [1, 2, 3]) {
      expect(JSON.parse(run(dir)).decision).toBe('block')
    }
    rmSync(dir, { recursive: true, force: true })
  })
})
