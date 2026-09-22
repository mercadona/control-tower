import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSpecDir } from './fixtures/spec-repo.js'
import { analyzeSpecFreeze, FROZEN_DECISIONS_HEADING } from '../scripts/groom.js'

// F32 §4.1 — groom gains ONE check (the only new line of code in the whole
// design of the freeze): exit 2 if the spec has pending
// `[NEEDS CLARIFICATION` or if `## Hipótesis` is missing or empty. Amendment 1
// of #339 (issue #343) adds the third rule to the same check: a frozen decision
// that does not say where it comes from.
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

const decisions = (...lines) => `${FROZEN_DECISIONS_HEADING}\n${lines.join('\n')}\n\n`

const SPOKEN_DECISION = '- **D-1 · versión** — iOS 17. *(Procedencia: hablada — «lo dijo el PO».)*'
const SOURCELESS_DECISION = '- **D-1 · versión** — iOS 17.'

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

const CONTEXT_WITH_SCOPE = '## Contexto del milestone\n\n- **Alcance:** `src/**`, `tests/**`\n- Stack: node.\n\n'
const CONTEXT_WITHOUT_SCOPE = '## Contexto del milestone\n\n- Stack: node.\n\n'

describe('analyzeSpecFreeze — the pure module (three greps)', () => {
  it('freezable spec: hypothesis present and with content, zero pending items', () => {
    const r = analyzeSpecFreeze(HYPOTHESIS + TABLE)
    expect(r.hypothesis).toBe('ok')
    expect(r.clarifications).toEqual([])
  })

  it('the scope the gate reads is declared: a scope line inside the milestone context', () => {
    expect(analyzeSpecFreeze(HYPOTHESIS + CONTEXT_WITH_SCOPE + TABLE).scope).toBe('ok')
  })

  it('a milestone context without the scope line leaves the scope absent', () => {
    expect(analyzeSpecFreeze(HYPOTHESIS + CONTEXT_WITHOUT_SCOPE + TABLE).scope).toBe('absent')
  })

  it('a spec with no milestone context section leaves the scope absent too', () => {
    expect(analyzeSpecFreeze(HYPOTHESIS + TABLE).scope).toBe('absent')
  })

  it('a scope line outside the milestone context does not count: the gate only reads that section', () => {
    expect(analyzeSpecFreeze(HYPOTHESIS + '## Otra sección\n\n- **Alcance:** `src/**`\n\n' + TABLE).scope).toBe('absent')
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

  it('a frozen decision that does not say where it comes from is reported with its line and its raw line', () => {
    const md = [
      '## Hipótesis',
      '',
      'Si X, entonces Y medible.',
      '',
      FROZEN_DECISIONS_HEADING,
      SOURCELESS_DECISION + '   ',
      '',
      TABLE,
    ].join('\n')

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toEqual([{ line: 6, raw: SOURCELESS_DECISION }])
  })

  it('every decision naming its source leaves the rule silent, and the suffix may sit on the line that continues the decision', () => {
    const sameLine = HYPOTHESIS + decisions(SPOKEN_DECISION, '- **D-2 · nombre** — Pilares. *(Procedencia: deducida de D-1.)*') + TABLE
    const ownLine = HYPOTHESIS + decisions(
      '- **D-1 · versión** — iOS 17, porque la tienda ya no sirve la',
      '  anterior.',
      '  *(Procedencia: hablada — «lo dijo el PO».)*',
    ) + TABLE

    expect(analyzeSpecFreeze(sameLine).decisionsWithoutProvenance).toEqual([])
    expect(analyzeSpecFreeze(ownLine).decisionsWithoutProvenance).toEqual([])
  })

  it('a user story, a PRD and a prototype at a version are sources like the TL\'s word and a deduction', () => {
    const md = HYPOTHESIS + decisions(
      '- **D-1 · alcance** — solo el listado. *(Procedencia: historia ABC-123.)*',
      '- **D-2 · copy** — el del documento de producto. *(Procedencia: prd «Pilares 2026», §4.)*',
      '- **D-3 · layout** — dos columnas. *(Procedencia: prototipo v3.)*',
    ) + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toEqual([])
  })

  it('a spec with no «## Decisiones congeladas» section reports nothing, however many bullets its other sections carry: a milestone with no frozen decision is not a defect', () => {
    const md = '- una nota suelta antes de la primera cabecera\n\n## Hipótesis\n\n- la apuesta cabe en una lista\n- y sigue siendo la apuesta\n\n' + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toEqual([])
  })

  it('a level-3 «### Decisiones congeladas» is not the section, the same grep the hypothesis uses', () => {
    const md = HYPOTHESIS + '### Decisiones congeladas\n' + SOURCELESS_DECISION + '\n\n' + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toEqual([])
  })

  it('a suffix with nothing after the colon names no source', () => {
    const md = HYPOTHESIS + decisions('- **D-1 · versión** — iOS 17. *(Procedencia: )*') + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toHaveLength(1)
  })

  it('a marker the projection does not strip («_(Procedencia: …)_») is no source either: the gate asks for the suffix that is trimmed', () => {
    const md = HYPOTHESIS + decisions('- **D-1 · versión** — iOS 17. _(Procedencia: hablada.)_') + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toHaveLength(1)
  })

  it('a bullet indented under a decision elaborates it and is not asked for a source of its own', () => {
    const md = HYPOTHESIS + decisions(SPOKEN_DECISION, '  - y excluye iOS 16') + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toEqual([])
  })

  it('the decisions section ends at the next heading: a bullet of ANOTHER section is not a decision', () => {
    const md = HYPOTHESIS + decisions(SPOKEN_DECISION) + '## Enfoque técnico\n\n- primero el modelo\n\n' + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance).toEqual([])
  })

  it('every sourceless decision is collected, not just the first', () => {
    const md = HYPOTHESIS + decisions(SOURCELESS_DECISION, '- **D-2 · nombre** — Pilares.', SPOKEN_DECISION.replace('D-1', 'D-3')) + TABLE

    expect(analyzeSpecFreeze(md).decisionsWithoutProvenance.map((d) => d.line)).toEqual([6, 7])
  })
})

describe('ct-groom — the freeze gate (exit 2, before touching anything, under --dry-run too)', () => {
  it('spec with no «## Hipótesis» → exit 2 and the remedy in the message', () => {
    const r = runGroom(TABLE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    // the message says where work with no bet goes: outside the epic cycle
    expect(r.stderr).toMatch(/loose issues|falsifiable bet/i)
  })

  it('empty «## Hipótesis» → exit 2 (presence with no content is not presence)', () => {
    const r = runGroom('## Hipótesis\n\n\n' + TABLE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('is empty')
  })

  it('pending [NEEDS CLARIFICATION → exit 2, naming how many and where', () => {
    const r = runGroom(HYPOTHESIS + TABLE + '\n[NEEDS CLARIFICATION: ¿tabla o lista?]\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('[NEEDS CLARIFICATION')
    expect(r.stderr).toMatch(/line \d+/)
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
    expect(r.stderr).toContain('table')
  })

  it('a frozen decision with no source → exit 2, naming how many there are and where the first one is', () => {
    const r = runGroom(HYPOTHESIS + decisions(SOURCELESS_DECISION) + TABLE)
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('Procedencia')
    expect(r.stderr).toContain(SOURCELESS_DECISION)
    expect(r.stderr).toMatch(/line \d+/)
  })

  it('the third rule aggregates with the other two: the three messages come out together, a single exit 2', () => {
    const r = runGroom(decisions(SOURCELESS_DECISION) + TABLE + '\n[NEEDS CLARIFICATION: ¿?]\n')
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('## Hipótesis')
    expect(r.stderr).toContain('[NEEDS CLARIFICATION')
    expect(r.stderr).toContain('Procedencia')
  })

  it('freezable spec → the gate does not fire and the dry-run prints its plan (exit 0)', () => {
    const r = runGroom(HYPOTHESIS + TABLE)
    expect(r.status).toBe(0)
    const plan = JSON.parse(r.stdout)
    expect(plan.issues).toHaveLength(1)
  })

  it('a spec whose decisions all name their source goes through the gate (exit 0)', () => {
    const r = runGroom(HYPOTHESIS + decisions(SPOKEN_DECISION) + TABLE)
    expect(r.status).toBe(0)
    expect(JSON.parse(r.stdout).issues).toHaveLength(1)
  })
})
