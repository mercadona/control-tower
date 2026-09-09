import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')

// F11, part B. The REAL case that started this (menoplus, verified by reading
// that repository): before the plugin arrived there already were
//   - `scripts/dispatch-check.sh` (a script of the repository itself) and a
//     line in AGENTS.md that orders it to be run before implementing and with
//     `--release` when the PR is opened;
//   - a worktree convention: `git worktree add .claude/worktrees/<slug>`, with
//     a hook (`menoplus-branch-isolation-guard.sh`) that watches it.
// The plugin brings ITS OWN `dispatch-check.mjs` and uses `.worktrees/<n>`, and
// `ct-init` used to write its block next to the one already there without
// looking: AGENTS.md ends up contradicting itself and two claim protocols
// operate over the same label space. These tests demand that ct-init CANNOT
// leave a repository like that in silence.
function menoplusLikeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
  mkdirSync(join(dir, '.claude', 'worktrees'), { recursive: true })
  writeFileSync(join(dir, 'scripts', 'dispatch-check.sh'), '#!/usr/bin/env bash\n# claim of the repository itself\n')
  writeFileSync(join(dir, '.claude', 'hooks', 'branch-isolation-guard.sh'), '#!/usr/bin/env bash\n')
  writeFileSync(
    join(dir, 'AGENTS.md'),
    [
      '# AGENTS.md',
      '## Workflow: 1 issue = 1 slice = 1 session',
      '- **Aislamiento de ramas ESTRICTO.** Trabajo nuevo:',
      '  `git worktree add .claude/worktrees/<slug> -b <rama> main`. Hay un hook que lo vigila.',
      '- **Claim anti-colisión:** `scripts/dispatch-check.sh <issue#>` antes de implementar,',
      '  `--release <issue#>` al abrir PR.',
      '',
    ].join('\n')
  )
  return dir
}

function runInit(dir, args = []) {
  return spawnSync('bash', [script, dir, ...args], { encoding: 'utf8' })
}

describe('ct-init: conventions the repository already has on the turf the loop claims', () => {
  it('warns that the repository ALREADY has a claim of its own (script + instruction in AGENTS.md) that collides with the plugin one', () => {
    const dir = menoplusLikeRepo()
    const res = runInit(dir)
    expect(res.status).toBe(0)
    // The warning goes out on stderr, like every other warning of ct-init.
    expect(res.stderr).toMatch(/convenci/i)
    expect(res.stderr).toContain('scripts/dispatch-check.sh')
    // And it does not stop at naming it: it says which decision has to be taken.
    expect(res.stderr).toMatch(/dispatch-check\.mjs/)
    expect(res.stderr).toMatch(/status:/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('warns about the worktree convention that is not ours (`.claude/worktrees/`) against `.worktrees/<n>` of the dispatcher', () => {
    const dir = menoplusLikeRepo()
    const res = runInit(dir)
    expect(res.stderr).toContain('.claude/worktrees')
    expect(res.stderr).toContain('.worktrees/<n>')
    expect(res.stderr).toMatch(/feat\//)
    rmSync(dir, { recursive: true, force: true })
  })

  it('names the hook that watches branches/worktrees: it is the one that can knock down every dispatch', () => {
    const dir = menoplusLikeRepo()
    const res = runInit(dir)
    expect(res.stderr).toContain('branch-isolation-guard.sh')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a clean repository gets NO conventions warning at all (no false positives to start with)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    const res = runInit(dir)
    expect(res.status).toBe(0)
    expect(res.stderr).not.toMatch(/convenci/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the SECOND run does not detect itself: the block ct-init seeds does not count as a convention of someone else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    runInit(dir)
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // Check: the seeded block DOES speak of the ground the detection looks at
    // (if it stopped doing so, this test would stop proving anything).
    expect(agents).toMatch(/\.worktrees\/|dispatch-check|status:in-progress/)
    const res = runInit(dir)
    expect(res.stderr).not.toMatch(/convenci/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an AGENTS.md with CRLF line breaks is scanned too (the markers of our own block are recognised all the same)', () => {
    const dir = menoplusLikeRepo()
    const lf = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    writeFileSync(join(dir, 'AGENTS.md'), lf.split('\n').join('\r\n'))
    const res = runInit(dir)
    expect(res.stderr).toContain('scripts/dispatch-check.sh')
    rmSync(dir, { recursive: true, force: true })
  })

  it('if the detection cannot run (no node), it says so — it does not pass for "there is nothing"', () => {
    const dir = menoplusLikeRepo()
    // A PATH with no node: the detector cannot run. Silence here would be
    // indistinguishable from "clean repository", which is exactly the expensive
    // false negative.
    const emptyBin = mkdtempSync(join(tmpdir(), 'ct-nobin-'))
    const res = spawnSync('bash', [script, dir], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${emptyBin}:/usr/bin:/bin` },
    })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/no se ha podido comprobar si este repo ya tiene convenciones/i)
    rmSync(dir, { recursive: true, force: true })
    rmSync(emptyBin, { recursive: true, force: true })
  })

  it('it does not descend into .worktrees/ or node_modules (worktrees of the loop itself and dependencies are not conventions of the repository)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-conv-'))
    mkdirSync(join(dir, '.worktrees', '7', 'scripts'), { recursive: true })
    writeFileSync(join(dir, '.worktrees', '7', 'scripts', 'dispatch-check.sh'), '#!/bin/sh\n')
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(dir, 'node_modules', 'pkg', 'dispatch-check.sh'), '#!/bin/sh\n')
    const res = runInit(dir)
    expect(res.stderr).not.toMatch(/convenci/i)
    rmSync(dir, { recursive: true, force: true })
  })
})
