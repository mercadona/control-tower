import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { analyzeSpecFreeze } from '../scripts/groom.js'

// F32 §4.1 — groom gains ONE check (the only new line of code in the whole
// design of the freeze): exit 2 if the spec has pending
// `[NEEDS CLARIFICATION` or if `## Hipótesis` is missing or empty.
//
// Why it is hard and has no flag: José does not read the specs — the freeze
// gate (15 lines) is his only reading of the cycle. If groom accepted a spec
// with no hypothesis or with unresolved gaps, the "decision laundering" that
// the freeze closes would come straight back in through the door next to it.
// The QUALITY of the hypothesis is judged by the human when freezing; groom
// only looks at PRESENCE. José's decision 2026-08-07, closed — without a
// falsifiable bet it is not an epic and it does not get in through groom.

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-groom.mjs')
const QUIET_STDIO = ['ignore', 'pipe', 'pipe']
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = () => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` })

const TABLE = `## 9. Slices
| # | Slice (issue) | Tipo | Entrega | Dep | Acepta (AC) | Protegido |
|---|---|---|---|---|---|---|
| 1 | login | backend | modelo | – | AC-1.1 | schema |
`

const HYPOTHESIS = '## Hipótesis del experimento\n\nSi X, entonces Y medible.\n\n'

function runGroom(specMd) {
  const dir = makeSpecDir('ctg-freeze-')
  const spec = join(dir, 'spec.md')
  writeFileSync(spec, specMd)
  try {
    const out = execFileSync('node', [script, spec, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', stdio: QUIET_STDIO, env: fakeEnv() })
    return { status: 0, stdout: out, stderr: '' }
  } catch (e) {
    return { status: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('analyzeSpecFreeze — the pure module (two greps)', () => {
  it('freezable spec: hypothesis present and with content, zero pending items', () => {
    const r = analyzeSpecFreeze(HYPOTHESIS + TABLE)
    expect(r.hypothesis).toBe('ok')
    expect(r.clarifications).toEqual([])
  })

  it('accepts the short «## Hipótesis» heading as well as the long one', () => {
    expect(analyzeSpecFreeze('## Hipótesis\n\nApuesta.\n' + TABLE).hypothesis).toBe('ok')
  })

  it('hypothesis absent', () => {
    expect(analyzeSpecFreeze(TABLE).hypothesis).toBe('ausente')
  })

  it('empty hypothesis (whitespace only)', () => {
    expect(analyzeSpecFreeze('## Hipótesis\n\n   \n' + TABLE).hypothesis).toBe('vacia')
  })

  it('empty hypothesis: a leftover HTML comment from the template does NOT count as content', () => {
    const r = analyzeSpecFreeze('## Hipótesis\n\n<!-- escribe aquí la apuesta falsable -->\n' + TABLE)
    expect(r.hypothesis).toBe('vacia')
  })

  it('the hypothesis section ends at the next heading (the content of ANOTHER section does not fill it)', () => {
    const r = analyzeSpecFreeze('## Hipótesis\n## Enfoque técnico\n\nMucho contenido aquí.\n' + TABLE)
    expect(r.hypothesis).toBe('vacia')
  })

  it('a level-3 «### Hipótesis» is not the section (the pre-registered grep is «## Hipótesis»)', () => {
    expect(analyzeSpecFreeze('### Hipótesis\n\nApuesta.\n' + TABLE).hypothesis).toBe('ausente')
  })

  it('collects every pending [NEEDS CLARIFICATION with its line', () => {
    const md = HYPOTHESIS + '[NEEDS CLARIFICATION: ¿qué pasa con X?]\n' + TABLE + '\nOtro [NEEDS CLARIFICATION: ¿e Y?]\n'
    const r = analyzeSpecFreeze(md)
    expect(r.clarifications).toHaveLength(2)
    expect(r.clarifications[0].line).toBeGreaterThan(0)
    expect(r.clarifications[0].raw).toContain('NEEDS CLARIFICATION')
  })
})

describe('ct-groom — the freeze gate (exit 2, before touching anything, under --dry-run too)', () => {
  it('spec with no «## Hipótesis» → exit 2 and the remedy in the message', () => {
    const r = runGroom(TABLE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    // the message says where work with no bet goes: outside the epic cycle
    expect(r.stderr).toMatch(/issue suelto|sin apuesta/i)
  })

  it('empty «## Hipótesis» → exit 2 (presence with no content is not presence)', () => {
    const r = runGroom('## Hipótesis\n\n\n' + TABLE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('vacía')
  })

  it('pending [NEEDS CLARIFICATION → exit 2, naming how many and where', () => {
    const r = runGroom(HYPOTHESIS + TABLE + '\n[NEEDS CLARIFICATION: ¿tabla o lista?]\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('[NEEDS CLARIFICATION')
    expect(r.stderr).toMatch(/línea \d+/)
  })

  it('both faults at once → both messages, a single exit 2 (no fix-one-run-again merry-go-round)', () => {
    const r = runGroom(TABLE + '\n[NEEDS CLARIFICATION: ¿?]\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    expect(r.stderr).toContain('[NEEDS CLARIFICATION')
  })

  it('the gate aggregates with the table errors: absent hypothesis + broken table are reported TOGETHER', () => {
    const r = runGroom('nada de tabla aquí\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    expect(r.stderr).toContain('tabla')
  })

  it('freezable spec → the gate does not fire and the dry-run prints its plan (exit 0)', () => {
    const r = runGroom(HYPOTHESIS + TABLE)
    expect(r.status).toBe(0)
    const plan = JSON.parse(r.stdout)
    expect(plan.issues).toHaveLength(1)
  })
})
