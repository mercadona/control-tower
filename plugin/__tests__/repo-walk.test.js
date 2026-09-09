// scripts/repo-walk.js pulls out the tree walk that used to live ONLY inside
// scripts/detect-conventions.mjs. §3.12 of the handoff
// (docs/prompt-juez-lo-que-queda.md) adds a SECOND sweep —the one for
// candidates to the yardstick of the repository, scripts/detect-yardstick.mjs—
// which needs exactly the same walk: the same caps (`MAX_DEPTH`,
// `MAX_ENTRIES`), the same exclusions (`SKIP_DIRS`), the same
// do-not-descend-into-`worktrees` and the same do-not-follow-symlinks.
// Duplicating the walker would be two sets of these rules diverging in silence
// — exactly what this repository ties down with tests everywhere
// (`CONVENTIONS_FILE`, `JUDGE_TOOLS`, `buildOptions`). So there is a single
// walk, and this file is the one that protects it.
//
// The three odd rules (do not descend into `worktrees`, do not follow
// symlinks, `.worktrees` in SKIP_DIRS) are measured against a real case from
// the field (see detect-conventions.mjs / conventions-output.test.js) and are
// not "simplified" here.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { walkRepo, SKIP_DIRS, MAX_DEPTH, MAX_ENTRIES } from '../scripts/repo-walk.js'

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})
function tmp(prefix = 'repo-walk-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

describe('walkRepo', () => {
  it('lists files with a relative path and "/" as the separator, and marks directories with a trailing "/"', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'docs', 'a.md'), 'x')
    writeFileSync(join(dir, 'raiz.txt'), 'x')
    const { entradas } = walkRepo(dir)
    expect(entradas).toContain('docs/')
    expect(entradas).toContain('docs/a.md')
    expect(entradas).toContain('raiz.txt')
    // no entry uses a platform separator other than "/"
    expect(entradas.some((e) => e.includes('\\'))).toBe(false)
  })

  it('skips node_modules, .git and dist — nothing inside them shows up', () => {
    const dir = tmp()
    for (const skip of ['node_modules', '.git', 'dist']) {
      mkdirSync(join(dir, skip))
      writeFileSync(join(dir, skip, 'dentro.txt'), 'x')
    }
    writeFileSync(join(dir, 'visible.txt'), 'x')
    const { entradas } = walkRepo(dir)
    expect(entradas).toContain('visible.txt')
    for (const skip of ['node_modules', '.git', 'dist']) {
      expect(entradas.some((e) => e.startsWith(`${skip}/`))).toBe(false)
    }
  })

  it('SKIP_DIRS includes exactly the directories it always has', () => {
    for (const d of ['.git', '.worktrees', 'node_modules', '.venv', 'venv', '__pycache__',
      'dist', 'build', 'target', 'vendor', 'Pods', '.next', '.ruff_cache',
      '.mypy_cache', '.pytest_cache', '.gradle', 'DerivedData']) {
      expect(SKIP_DIRS.has(d)).toBe(true)
    }
  })

  it('records a directory called "worktrees" but does not descend into it', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'worktrees'))
    writeFileSync(join(dir, 'worktrees', 'copia.txt'), 'x')
    const { entradas } = walkRepo(dir)
    expect(entradas).toContain('worktrees/')
    expect(entradas.some((e) => e.startsWith('worktrees/') && e !== 'worktrees/')).toBe(false)
  })

  it('respects maxDepth: a file at depth 7 with maxDepth 2 does not show up', () => {
    const dir = tmp()
    let cursor = dir
    for (let i = 0; i < 7; i++) {
      cursor = join(cursor, `n${i}`)
      mkdirSync(cursor)
    }
    writeFileSync(join(cursor, 'hondo.txt'), 'x')
    const { entradas } = walkRepo(dir, { maxDepth: 2 })
    expect(entradas.some((e) => e.includes('hondo.txt'))).toBe(false)
  })

  it('with a low maxEntries, it returns truncated: true', () => {
    const dir = tmp()
    for (let i = 0; i < 10; i++) writeFileSync(join(dir, `f${i}.txt`), 'x')
    const { truncated } = walkRepo(dir, { maxEntries: 2 })
    expect(truncated).toBe(true)
  })

  it('with no explicit caps, MAX_DEPTH and MAX_ENTRIES are the ones they always were', () => {
    expect(MAX_DEPTH).toBe(5)
    expect(MAX_ENTRIES).toBe(20000)
  })

  it('a directory symlink is not followed', () => {
    const dir = tmp()
    const fuera = tmp('repo-walk-fuera-')
    writeFileSync(join(fuera, 'secreto.txt'), 'x')
    symlinkSync(fuera, join(dir, 'enlace'), 'dir')
    const { entradas } = walkRepo(dir)
    expect(entradas.some((e) => e.includes('secreto.txt'))).toBe(false)
    // the symlink itself is not left dangling as a phantom file either: it
    // does not show up as an entry "inside" itself
    expect(entradas.some((e) => e.startsWith('enlace/') && e !== 'enlace/')).toBe(false)
  })

  it('an unreadable subdirectory does not invalidate the rest of the scan', () => {
    if (process.getuid && process.getuid() === 0) return // root ignores permissions
    const dir = tmp()
    const ilegible = join(dir, 'sin-permiso')
    mkdirSync(ilegible)
    writeFileSync(join(ilegible, 'dentro.txt'), 'x')
    writeFileSync(join(dir, 'ok.txt'), 'x')
    chmodSync(ilegible, 0o000)
    try {
      const { entradas } = walkRepo(dir)
      expect(entradas).toContain('ok.txt')
      expect(entradas).toContain('sin-permiso/')
    } finally {
      chmodSync(ilegible, 0o755)
    }
  })
})
