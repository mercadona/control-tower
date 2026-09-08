import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'session-start.js')

function runHook(cwd) {
  const out = execFileSync('node', [hook], {
    input: JSON.stringify({ cwd, source: 'startup', hook_event_name: 'SessionStart' }),
    encoding: 'utf8',
  })
  return out.trim()
}

describe('session-start hook', () => {
  it('it injects the STATE.md if there is one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "X"\n---\n## Current State\nvoy por T7')
    const out = JSON.parse(runHook(dir))
    expect(out.hookSpecificOutput.hookEventName).toBe('SessionStart')
    expect(out.hookSpecificOutput.additionalContext).toContain('voy por T7')
    rmSync(dir, { recursive: true, force: true })
  })
  it('with no STATE.md → empty output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    expect(runHook(dir)).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
  it('malformed stdin → empty output, exit 0 (no crash)', () => {
    const r = spawnSync('node', [hook], { input: 'no-json{', encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('')
  })
  // ==========================================================================
  // F7 — through the production BUNDLE (dist/session-start.js), which is what
  // Claude Code really executes, with a real .agent/STATE.md on disk. It
  // reproduces the incident: a `next_action` that could no longer be executed,
  // injected without further ado into every new session of the repo.
  // ==========================================================================
  function writeState(dir, text) {
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'STATE.md'), text)
  }
  const INCIDENT = [
    '---',
    'task: "Plan vs Propuestas"',
    'status: in_progress',
    'next_action: "Lanzar la corrida REAL de /ct-groom sobre el spec"',
    'blocked:',
    '  reason: "la corrida escribiría datos falsos"',
    '  unblock: "corregir la §9 del spec y revalidarla"',
    '---',
    '## Current State',
    'Groom preparado, sin ejecutar.',
  ].join('\n')

  it('a BLOCKED STATE.md → the injected context opens with the warning and declares the next_action suspended', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, INCIDENT)
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx.split('\n')[0]).toMatch(/TRABAJO BLOQUEADO/)
    expect(ctx).toMatch(/SUSPENDIDO/)
    expect(ctx).toMatch(/No lo ejecutes/i)
    expect(ctx).toMatch(/escribiría datos falsos/)
    expect(ctx).toMatch(/corregir la §9 del spec/)
    // And the warning goes BEFORE the raw next_action: whoever reads top to
    // bottom meets the neutralisation first.
    expect(ctx.indexOf('TRABAJO BLOQUEADO')).toBeLessThan(ctx.indexOf('Lanzar la corrida REAL'))
    rmSync(dir, { recursive: true, force: true })
  })

  it('control: the SAME STATE.md without the `blocked` field is injected with no warning at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const withoutBlocked = INCIDENT.replace(/blocked:\n(  .*\n)+/, '')
    expect(withoutBlocked).not.toContain('blocked:') // control: the field really was removed
    writeState(dir, withoutBlocked)
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx).not.toMatch(/TRABAJO BLOQUEADO/)
    expect(ctx).toMatch(/Lanzar la corrida REAL/) // it still hydrates just as always
    rmSync(dir, { recursive: true, force: true })
  })

  it('a STATE.md with `status: blocked` (the wrong field, the likely mistake) → it warns all the same and says which is the right one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, '---\nstatus: blocked\nnext_action: "Lanzar la corrida REAL de /ct-groom"\n---\n## Current State\nx')
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx.split('\n')[0]).toMatch(/TRABAJO BLOQUEADO/)
    expect(ctx).toMatch(/SUSPENDIDO/)
    expect(ctx).toMatch(/`blocked: \{reason:/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a STATE.md with broken frontmatter → it does not crash, it warns that whether it is blocked is unknown, exit 0 and no stderr', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, '---\ntask: "sin cerrar\n  ]: [\n---\n## Current State\nalgo')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).toBe('')
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext
    expect(ctx).toMatch(/NO SE PUDO LEER/)
    expect(ctx).toMatch(/posiblemente bloqueado/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a non-empty `verify` → the context says it is a PENDING check, not a fact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeState(dir, '---\nverify: "`gh issue list` devuelve 6 issues"\n---\n## Current State\nx')
    const ctx = JSON.parse(runHook(dir)).hookSpecificOutput.additionalContext
    expect(ctx).toMatch(/PENDIENTE/)
    expect(ctx).toMatch(/no un hecho ya comprobado/i)
    rmSync(dir, { recursive: true, force: true })
  })

  it('no stderr leak when the cwd is not a git repo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "X"\n---\n## Current State\nhola')
    const r = spawnSync('node', [hook], { input: JSON.stringify({ cwd: dir }), encoding: 'utf8' })
    expect(r.stderr).toBe('')
    rmSync(dir, { recursive: true, force: true })
  })
})
