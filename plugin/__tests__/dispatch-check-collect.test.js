import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'dispatch-check.mjs')
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeCmuxDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-cmux-bin')

const gitEn = (repo, ...args) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

// bancada: a REAL git checkout with its `.worktrees/7` worktree and its
// `feat/7` branch, because what this file checks is precisely what a git stub
// cannot tell you — that after the harvest the worktree and the branch NO
// LONGER EXIST. `realpathSync` is not cosmetic: on macOS `tmpdir()` is a
// symlink (/var → /private/var) and git ALWAYS reports the resolved path, so
// the `current_directory` shown to cmux has to be the resolved one or
// `findWorkspaceByCwd` would not match the one `localSliceArtifacts` computes.
function bancada({ conWorktree = true } = {}) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ct-collect-')))
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: ['ignore', 'ignore', 'pipe'] })
  gitEn(repo, 'commit', '--allow-empty', '-q', '-m', 'base')
  const worktree = join(repo, '.worktrees', '7')
  if (conWorktree) gitEn(repo, 'worktree', 'add', '-q', '-b', 'feat/7', worktree)
  const b = {
    dir,
    repo,
    worktree,
    stateFile: join(dir, 'cmux-state.json'),
    invokedLog: join(dir, 'cmux-invoked.log'),
    ghArgvLog: join(dir, 'gh-argv.log'),
    tip: conWorktree ? gitEn(repo, 'rev-parse', 'feat/7').trim() : null,
  }
  writeFileSync(b.stateFile, JSON.stringify(conWorktree ? [{ title: 'o/r · #7 slice', cwd: worktree }] : []))
  return b
}

const correr = (b, env = {}, args = ['7', '--repo', 'o/r', '--collect']) => spawnSync('node', [script, ...args], {
  encoding: 'utf8',
  cwd: b.repo,
  env: {
    ...process.env,
    PATH: `${fakeGhDir}:${fakeCmuxDir}:${process.env.PATH}`,
    FAKE_CMUX_STATE_FILE: b.stateFile,
    FAKE_CMUX_INVOKED_LOG_FILE: b.invokedLog,
    FAKE_GH_ARGV_LOG_FILE: b.ghArgvLog,
    ...env,
  },
})

const limpiar = (b) => rmSync(b.dir, { recursive: true, force: true })
const prList = (state, headRefOid) => JSON.stringify([{ headRefOid, number: 71, state }])
const ramas = (b) => gitEn(b.repo, 'branch', '--list', 'feat/7').trim()
const invocaciones = (b) => (existsSync(b.invokedLog) ? readFileSync(b.invokedLog, 'utf8') : '')
const sesiones = (b) => JSON.parse(readFileSync(b.stateFile, 'utf8'))
const OTRA_PUNTA = '1122334455667788990011223344556677889900'

describe('dispatch-check --collect — the harvest', () => {
  it('a merged pull request with a clean tree and the tip that landed: closes cmux, deletes worktree and branch, exit 0', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`collected #7: cerrada la workspace de cmux, borrado el worktree ${b.worktree}, borrada la rama feat/7`)
    // real git says it: the worktree and the branch are no longer there.
    expect(existsSync(b.worktree)).toBe(false)
    expect(ramas(b)).toBe('')
    expect(invocaciones(b)).toContain('close-workspace --workspace workspace:0')
    expect(sesiones(b)).toEqual([])
    limpiar(b)
  })

  it('the gh argv carries the --repo it was asked for and the slice branch, with the three fields the reader consumes', () => {
    const b = bancada()
    correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(readFileSync(b.ghArgvLog, 'utf8').trim())
      .toBe('pr list --repo o/r --head feat/7 --state all --json number,state,headRefOid --limit 10')
    limpiar(b)
  })

  it('the pull request is still open: exit 1, it says so with its status and touches nothing', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('OPEN', OTRA_PUNTA) })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe('waiting on #7 (open): la PR #71 sigue abierta — no se ha tocado nada')
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(invocaciones(b)).toBe('')
    limpiar(b)
  })

  it('the pull request was closed without merging: exit 1 and it deletes nothing either', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('CLOSED', OTRA_PUNTA) })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe('waiting on #7 (abandoned): la PR #71 se cerró sin mergear — no se ha tocado nada')
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })

  it('there is no pull request for the branch: exit 1 naming that there is none', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: '[]' })
    expect(res.status).toBe(1)
    expect(res.stdout.trim()).toBe('waiting on #7 (not-opened): no hay ninguna PR para la rama feat/7 — no se ha tocado nada')
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })

  it('the tree has an untracked file: exit 10, it keeps everything and says why', () => {
    const b = bancada()
    writeFileSync(join(b.worktree, 'sin-commitear.txt'), 'trabajo vivo\n')
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(res.status).toBe(10)
    expect(res.stdout.trim()).toBe(`kept #7: el worktree ${b.worktree} tiene cambios sin commitear — no se ha borrado nada`)
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(invocaciones(b)).toBe('')
    limpiar(b)
  })

  it('the local tip is not the one that merged the pull request: exit 10 and it names the commit that was', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', OTRA_PUNTA) })
    expect(res.status).toBe(10)
    expect(res.stdout.trim()).toBe(`kept #7: la punta local de feat/7 no es el commit que mergeó la PR #71 (${OTRA_PUNTA}) — no se ha borrado nada`)
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })

  it('gh does not answer: exit 3, nothing mutated and the diagnostic goes to stderr', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST_FAIL: '1' })
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('no se pudo leer el estado de #7: gh pr list falló')
    expect(res.stdout).toBe('')
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    limpiar(b)
  })

  it('cmux inconclusive: exit 3 without having deleted anything, even though the pull request is merged', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip), FAKE_CMUX_LIST_WINDOWS_FAIL: '1' })
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('no se pudo leer el estado de #7: cmux workspace list falló')
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(invocaciones(b)).not.toContain('close-workspace')
    limpiar(b)
  })

  it('cmux answers and there is no workspace in that worktree: it harvests git and does not invent a closure', () => {
    const b = bancada()
    writeFileSync(b.stateFile, JSON.stringify([{ title: 'otra cosa', cwd: join(b.dir, 'otro-sitio') }]))
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`collected #7: borrado el worktree ${b.worktree}, borrada la rama feat/7`)
    expect(existsSync(b.worktree)).toBe(false)
    expect(invocaciones(b)).not.toContain('close-workspace')
    limpiar(b)
  })

  it('the cmux closure fails having done nothing and the deletions do happen: exit 4 with the command that is left, unchained', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip), FAKE_CMUX_CLOSE_FAIL: '1' })
    expect(res.status).toBe(4)
    expect(res.stderr).toContain('ATENCIÓN: cosecha a medias de #7')
    expect(res.stderr).toContain('cmux close-workspace --workspace workspace:0')
    expect(res.stderr).not.toContain('&&')
    expect(existsSync(b.worktree)).toBe(false)
    expect(ramas(b)).toBe('')
    limpiar(b)
  })

  it('--dry-run prints the exact commands and leaves the worktree, the branch and the session in place', () => {
    const b = bancada()
    const res = correr(b, { FAKE_GH_PR_LIST: prList('MERGED', b.tip) }, ['7', '--repo', 'o/r', '--collect', '--dry-run'])
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`dry-run: would collect #7: cmux close-workspace --workspace workspace:0 ; git -C ${b.repo} worktree remove --force ${b.worktree} ; git -C ${b.repo} branch -D feat/7`)
    expect(existsSync(b.worktree)).toBe(true)
    expect(ramas(b)).toContain('feat/7')
    expect(sesiones(b)).toHaveLength(1)
    expect(invocaciones(b)).not.toContain('close-workspace')
    limpiar(b)
  })

  it('nothing is left on disk: exit 0 saying there was nothing to collect', () => {
    const b = bancada({ conWorktree: false })
    const res = correr(b, { FAKE_GH_PR_LIST: '[]' })
    expect(res.status).toBe(0)
    expect(res.stdout.trim()).toBe(`nothing left for #7: en ${b.repo} ya no queda ni el worktree .worktrees/7 ni la rama feat/7`)
    limpiar(b)
  })

  it('invoked outside a git checkout: exit 3, because what could not be looked at is not declared absent', () => {
    const b = bancada()
    const res = spawnSync('node', [script, '7', '--repo', 'o/r', '--collect'], {
      encoding: 'utf8',
      cwd: b.dir,
      env: { ...process.env, PATH: `${fakeGhDir}:${fakeCmuxDir}:${process.env.PATH}`, GIT_CEILING_DIRECTORIES: b.dir },
    })
    expect(res.status).toBe(3)
    expect(res.stderr).toContain('no se ha podido comprobar qué queda de #7 en esta máquina')
    limpiar(b)
  })

  it('--collect with --requeue: exit 2, they are mutually exclusive', () => {
    const b = bancada()
    const res = correr(b, {}, ['7', '--repo', 'o/r', '--collect', '--requeue'])
    expect(res.status).toBe(2)
    expect(res.stderr).toContain('--requeue y --collect son mutuamente excluyentes')
    expect(existsSync(b.worktree)).toBe(true)
    limpiar(b)
  })
})
