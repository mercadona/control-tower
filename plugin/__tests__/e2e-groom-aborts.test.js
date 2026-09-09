// ============================================================================
// The FIVE abort conditions of the E2E column. All five are the same family:
// the spec says two incompatible things about the SAME row, and no winner gets
// picked in silence.
//
// Why it ABORTS instead of warning: a warning would leave alive the very
// ambiguity the `no` token exists to remove (warnings get ignored, and F14
// documents what happens to the ones that get ignored), and then the token
// would have been good for nothing.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const GROOM = fileURLToPath(new URL('../scripts/ct-groom.mjs', import.meta.url))

// --dry-run enumerates the existing issues of `--repo` (F5, a pure read to
// detect drift) BEFORE printing the plan — without a fake `gh` on the PATH,
// that would invoke the real `gh` against an "o/r" repo that does not exist.
// Same stub and same criterion as ct-groom-dryrun.test.js.
const fakeGhDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-gh-bin')
const fakeEnv = () => ({ ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` })

const specWith = (gateCell, e2eCell) => `# Spec

Estado: CONGELADA

## Hipótesis del experimento
Que esto funcione.

## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | E2E |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-----|
| 1 | uno | backend | algo | – | un criterio | – | core | – | ${gateCell} | ${e2eCell} |
`

// specSinColumnaE2e: the SAME table, but with no "E2E" column at all (neither
// header nor cell). It exists for abort 4 on its own: with the column present,
// any undeclared "E2E" cell already fires abort 1 (undeclared cell), so a test
// with the column in place cannot tell "abort 4 works" from "abort 1 is
// masking it" — it would pass just the same even if abort 4 did not exist. The
// condition of abort 4
// (`parseGateCell(s.gate).add.includes('e2e') && r.runs.length === 0`)
// deliberately does NOT look at `e2eColumnPresent`, so the only way to test it
// for real is a spec where abort 1 can never fire.
const specSinColumnaE2e = (gateCell) => `# Spec

Estado: CONGELADA

## Hipótesis del experimento
Que esto funcione.

## 9. Slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |
|---|-------|------|---------|-----|--------|-----------|------|------|------|
| 1 | uno | backend | algo | – | un criterio | – | core | – | ${gateCell} |
`

function run(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-e2e-'))
  mkdirSync(join(dir, 'docs'), { recursive: true })
  const specFile = join(dir, 'docs', 'spec.md')
  writeFileSync(specFile, spec)
  const r = spawnSync(process.execPath, [GROOM, specFile, '--repo', 'o/r', '--dry-run'], { encoding: 'utf8', env: fakeEnv() })
  rmSync(dir, { recursive: true, force: true })
  return r
}

const groom = (gateCell, e2eCell) => run(specWith(gateCell, e2eCell))
const groomSinE2e = (gateCell) => run(specSinColumnaE2e(gateCell))

describe('aborts of the E2E column', () => {
  it('an undeclared cell (a dash) aborts and names the row', () => {
    const r = groom('–', '–')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/E2E/)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/"no"/)
  })

  it('the token next to a journey aborts', () => {
    const r = groom('–', 'no, curl -i :9115/metrics')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
  })

  it('Gate: e2e with the cell saying `no` aborts', () => {
    const r = groom('e2e', 'no')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
  })

  it('Gate: e2e with no "E2E" column in the table aborts (abort 4 on its own, with abort 1 unable to mask it)', () => {
    const r = groomSinE2e('e2e')
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/e2e/)
  })

  // The fifth abort (final branch review). Before it, this was a WARNING, on
  // the premise —false, verified by running the chain— that the waiver took the
  // work down with it. It takes nothing down: the "## E2E" section is emitted
  // just the same, /ct-next seeds just the same, ct-step demands the step just
  // the same and --release demands the correspondence just the same. The only
  // thing the waiver removes is the label, that is, the signal for the human —
  // and a waiver that waives nothing is the very same contradiction between two
  // cells that the other four aborts refuse to resolve in silence.
  it('Gate: !e2e on a row with journeys aborts, and sends you to the "E2E" cell', () => {
    const r = groom('!e2e', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/#1/)
    expect(r.stderr).toMatch(/celda "E2E" declara recorridos/)
    // The remedy is the cell, not the "Gate" column: the gate is DERIVED from there.
    expect(r.stderr).toMatch(/escribe "no" en su celda "E2E"/)
    // And it aborts BEFORE printing the plan, like the other four.
    expect(r.stdout.trim()).toBe('')
  })

  it('a `no` cell with nothing else does NOT abort', () => {
    const r = groom('–', 'no')
    expect(r.status).toBe(0)
  })

  it('a cell with a journey does NOT abort', () => {
    const r = groom('–', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(0)
  })
})

// ============================================================================
// The "e2e" gate, said out loud (task "e2e at the close of the slice",
// addition 2). `resolveGates` never classifies this case as `g.added` — `e2e`
// comes from no `Tipo` (it does not live in TYPE_GATES), so with a row that
// only carries journeys (with nothing written by hand in "Gate") it goes into
// `implied`. The warning has to come out all the same: if it does not, the
// "gate:e2e" label reaches the issue and groom's report stays quiet, which is
// the SAME leak F21 closed for the "Gate" column.
//
// And it has to name the right column: the generic "added" message says "it is
// deliberate (that is what the Gate column is for)", which here is FALSE —
// declaring "e2e" by hand in "Gate" is one of the five aborts above. A warning
// that sends the author to the wrong column is worse than none.
// ============================================================================
describe('the "e2e" gate is announced on stderr, and names the right column', () => {
  it('a row with journeys produces the warning and names "E2E", never "Gate"', () => {
    const r = groom('–', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/gate/i)
    expect(r.stderr).toContain('"e2e"')
    expect(r.stderr).toMatch(/columna "E2E"/)
    expect(r.stderr).not.toMatch(/columna "Gate"/)
    const plan = JSON.parse(r.stdout)
    expect(plan.issues[0].labels).toContain('gate:e2e')
  })

  it('a row with no journeys (`no`) carries no "e2e" warning at all', () => {
    const r = groom('–', 'no')
    expect(r.status).toBe(0)
    expect(r.stderr).not.toContain('"e2e"')
  })
})

// ============================================================================
// Review of addition 2: `redundant`/`inertWaivers` also attributed the "e2e"
// gate to the `Tipo` ("that its Tipo ... implies/already implies/does not imply
// that gate"), which is FALSE for exactly the same reason as "added" — `e2e`
// does not live in TYPE_GATES, no Tipo ever implies it: the row implies it, via
// the "E2E" column. The worst case (finding 1): with `Gate: e2e` PLUS real
// journeys (a legitimate row, it does not abort — the aborts of the E2E
// column require ZERO journeys), a real `--dry-run` printed both the correct
// "added"/"implied" warning and the generic "redundant" one, which said "its
// Tipo already implies" the gate: two claims about the SAME gate contradicting
// each other three lines apart.
// ============================================================================
// (`waived` no longer has a case: with declared journeys, `!e2e` aborts —
// see the fifth abort above —, and without them the waiver falls into
// `inertWaivers`.)
describe('review of addition 2 — redundant/inertWaivers also name "E2E", not "Tipo"', () => {
  it('Gate: e2e + real journeys: it does not abort, and "redundante" no longer contradicts the warning above', () => {
    const r = groom('e2e', 'curl -i :9115/metrics responde 200')
    expect(r.status).toBe(0)
    // The "the gate already comes from the row" warning (the same one that
    // fires with journeys alone) is still there...
    expect(r.stderr).toMatch(/columna "E2E"/)
    // ...and "redundante" no longer says the Tipo implies it: the two lines
    // that mention "e2e" agree that the source is the row/E2E column, and
    // neither names "Tipo" as the cause.
    expect(r.stderr).toMatch(/redundante/)
    expect(r.stderr).not.toMatch(/Tipo\s*"?backend"?\s*ya implica/)
    const e2eLines = r.stderr.split('\n').filter((l) => l.includes('"e2e"'))
    expect(e2eLines.length).toBeGreaterThanOrEqual(2)
    for (const line of e2eLines) expect(line).toMatch(/columna "E2E"/)
    const plan = JSON.parse(r.stdout)
    expect(plan.issues[0].labels).toContain('gate:e2e')
  })

  it('Gate: !e2e + no journeys: the inert waiver names "E2E", not "Tipo"', () => {
    const r = groom('!e2e', 'no')
    expect(r.status).toBe(0)
    expect(r.stderr).toMatch(/no había nada que quitar/)
    expect(r.stderr).toMatch(/columna "E2E"/)
    expect(r.stderr).not.toMatch(/su Tipo .* no implica ese gate/)
  })
})
