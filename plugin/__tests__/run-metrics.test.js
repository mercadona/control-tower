// The conductor's telemetry (scripts/run-metrics.js and its writing in
// ct-run.mjs): one row per attempt of a step of a task.
//
// Two properties rule here, and both are of the kind that break in silence:
// that the identity be COMPLETE —a gap in a metric reads as a zero, and a zero
// is an assertion— and that a failure to write it does NOT change what the run
// does. A program that dies because it could not write its own metric has
// turned the thermometer into part of the engine.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync, execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  metricRow, metricLine, metricsPath, planSha256, verdictMeasures, IDENTITY_FIELDS, aggregateVerdictMeasures,
  metricsRepoRelPath, METRICS_REPO_DIR, briefVaraCtMeasures, aggregateBriefMeasures,
  aggregateRoleBytesMeasures,
} from '../scripts/run-metrics.js'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'
import { SEVERITIES } from '../scripts/step-contracts.js'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'ct-step.mjs')
const F = '```'
const AHORA = '2026-08-18T10:00:00.000Z'

const IDENT = {
  repo: 'josemerca/control-tower-plugin', epic: '12', issue: 7,
  plan: 'plan.md', plan_sha256: 'abc', task: 2, task_name: 'la segunda',
  tasks_total: 8, step: 'judge', attempt: 3,
  plugin_version: '0.36.1', actor: 'alcaptar',
}

describe('the identity of the row', () => {
  it('carries the twelve fields of the design, not one less', () => {
    const fila = metricRow(IDENT, {}, { now: AHORA })
    expect(IDENTITY_FIELDS).toHaveLength(12)
    for (const campo of IDENTITY_FIELDS) expect(fila).toHaveProperty(campo)
    expect(fila.written_at).toBe(AHORA)
  })

  it('an issue with no milestone is recorded as "(sin milestone)", never empty', () => {
    for (const vacio of [null, undefined, '']) {
      expect(metricRow({ ...IDENT, epic: vacio }, {}, { now: AHORA }).epic).toBe('(sin milestone)')
    }
  })

  // THE SAME ARGUMENT AS `plan_sha256`, APPLIED TO THE LOOP INSTEAD OF THE
  // PLAN: a plan gets rewritten and then two runs against two versions of the
  // same file are indistinguishable exactly where they are going to be looked at
  // most. `ct-step` gets rewritten too —and more often than any plan—, so
  // without the plugin's version two runs against two different loops compare as
  // if they were the same mechanism. The field run that motivates this was done
  // with 0.36.1: without the field, that figure only exists in the memory of
  // whoever was sitting in front of it.
  it('the plugin version travels in the row: a rewritten ct-step makes two runs incomparable', () => {
    expect(metricRow(IDENT, {}, { now: AHORA }).plugin_version).toBe('0.36.1')
    expect(IDENTITY_FIELDS).toContain('plugin_version')
  })

  // TODAY IT DOES NOT MATTER AND IT IS GOING TO STOP NOT MATTERING. Every row
  // lives on the disk of whoever wrote it, so the actor is implicit; as soon as
  // the rows travel inside the pull request, one and the same file will mix rows
  // from two different machines and with no actor there is no knowing whose the
  // cost is — which is exactly the datum this file gets looked at for.
  it('the actor travels in the row: as soon as the rows mix, the cost has an owner', () => {
    expect(metricRow(IDENT, {}, { now: AHORA }).actor).toBe('alcaptar')
    expect(IDENTITY_FIELDS).toContain('actor')
  })

  // THE RULE OF THIS FILE, applied to the two new fields: absence is DECLARED.
  // A `null` in a column you group by (which version?, whose?) reads as one more
  // value and melts into a single group the rows that did not carry it and the
  // ones that carried it empty. The sentinel keeps the column's type and says
  // out loud that there was no datum there, just as `epic` has spent years
  // saying `(sin milestone)`.
  it('with no version and no actor the absence is declared, the gap is not left', () => {
    for (const vacio of [null, undefined, '']) {
      const fila = metricRow({ ...IDENT, plugin_version: vacio, actor: vacio }, {}, { now: AHORA })
      expect(fila.plugin_version).toBe('(sin versión)')
      expect(fila.actor).toBe('(sin actor)')
    }
  })

  // THE MODULE STAYS PURE, and these two fields are precisely the ones that
  // invite breaking that: the version is in the plugin's package.json and the
  // actor is in the environment, one line away. If it went looking for them
  // itself, the row would say who WRITES the metric instead of who ran the step,
  // and the module would stop being testable without mounting a disk.
  it('it does not go to the environment for the actor: the value arrives INSIDE the identity', () => {
    const previo = process.env.USER
    process.env.USER = 'un-actor-del-entorno'
    try {
      const { plugin_version: version, actor } = metricRow({ ...IDENT, plugin_version: null, actor: null }, {}, { now: AHORA })
      expect(actor).toBe('(sin actor)')
      expect(version).toBe('(sin versión)')
    } finally {
      if (previo === undefined) delete process.env.USER
      else process.env.USER = previo
    }
  })

  // `session` IS GONE, and not out of tidiness: it promised a dimension the
  // mechanism cannot give. With `ct-step` the calls to the model are subagents
  // of the session and there is no conversation identifier to collect, so its
  // only writer passed it a bare `null` and the column was null in ALL the rows.
  // An always-null column teaches you to skip it, and the one beside it gets
  // skipped right behind. It comes back the day there is something to put in it.
  it('`session` is no longer a field: an always-null column teaches you to ignore the file', () => {
    expect(IDENTITY_FIELDS).not.toContain('session')
    expect(metricRow({ ...IDENT, session: 'sesion-1' }, {}, { now: AHORA })).not.toHaveProperty('session')
  })

  it('the attempt is a dimension of the row, not an aggregated counter', () => {
    // It is what lets you measure how many times the judge vetoed and how many
    // rounds each task cost, which is the datum that decides if this is worth it.
    const vueltas = [1, 2, 3].map((attempt) => metricRow({ ...IDENT, attempt }, {}, { now: AHORA }))
    expect(vueltas.map((f) => f.attempt)).toEqual([1, 2, 3])
  })

  it('the measures travel apart from the identity and cannot tread on it', () => {
    const fila = metricRow(IDENT, { cost_usd: 0.03, outcome: 'done' }, { now: AHORA })
    expect(fila.cost_usd).toBe(0.03)
    expect(fila.issue).toBe(7)
  })

  it('every row is one line of JSON, which is what makes the file append-only', () => {
    const linea = metricLine(metricRow(IDENT, {}, { now: AHORA }))
    expect(linea.endsWith('\n')).toBe(true)
    expect(JSON.parse(linea).step).toBe('judge')
  })
})

describe('the plan gets rewritten, and that is why the issue is not enough as an identity', () => {
  it('two versions of the same file give different hashes', () => {
    expect(planSha256('### Task 1 — a')).not.toBe(planSha256('### Task 1 — b'))
  })

  it('the same content gives the same hash, which is what makes runs comparable', () => {
    expect(planSha256('igual')).toBe(planSha256('igual'))
  })
})

describe('where it gets written', () => {
  it('outside the repo, so that no git add of the slice puts it into the PR', () => {
    const p = metricsPath('ct-step', { home: '/casa' })
    expect(p).toBe('/casa/.claude/control-tower/log/ct-step.jsonl')
  })

  it("under CLAUDE_CONFIG_DIR when there is one, which is where that account's state lives", () => {
    expect(metricsPath('ct-step', { configDir: '/casa/.claude-work' }))
      .toBe('/casa/.claude-work/control-tower/log/ct-step.jsonl')
  })
})

describe('the count by severity', () => {
  it('it lets you read how many vetoes there were without loading the findings again', () => {
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'contrato', severity: 'high', what: 'a', path: 'x' },
        { rule: 'alcance', severity: 'low', what: 'b', path: 'y' },
        { rule: 'alcance', severity: 'low', what: 'c', path: 'z' },
      ],
    })).toEqual({
      ruling: 'FAIL', findings_total: 3, findings_high: 1, findings_medium: 0, findings_low: 2,
      findings_by_rule: { contrato: 1, alcance: 2 },
      rubric_sin_vara: 0,
      rubric_vara_ct_docs: 0,
      findings_vara_ct: 0,
    })
  })

  it('it counts the items the judge walked with nothing to measure them against', () => {
    // The column that turns H5 from a suspicion into a datum. Two people looking
    // at verdicts by hand could not tell whether the judge was finding nothing
    // or had nothing to search with; a run with this figure high is the second.
    expect(verdictMeasures({
      ruling: 'PASS',
      findings: [],
      rubric: [
        { rule: 'objetivo', result: 'está', outcome: 'conforme' },
        { rule: 'patrones', result: 'el plan dice N/A', outcome: 'sin-vara' },
        { rule: 'manipulacion-tests', result: 'no hay tests previos', outcome: 'no-aplica' },
      ],
    }).rubric_sin_vara).toBe(1)
  })

  it('a verdict with no rubric walk counts zero, it does not blow up', () => {
    // `verdictMeasures` measures, and a measure cannot be the reason a step does
    // not close: it is the principle this module already upholds with the rest
    // of its fields.
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).rubric_sin_vara).toBe(0)
  })

  it('a clean PASS counts zero of everything, and says so', () => {
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).findings_total).toBe(0)
  })

  it("the verdict's telemetry counts by rule", () => {
    // One counter per rule PRESENT in the verdict, not all of them at zero: a
    // rule that does not appear contributes nothing to the count.
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'manipulacion-tests', severity: 'high', what: 'a', path: 'x' },
        { rule: 'manipulacion-tests', severity: 'low', what: 'b', path: 'y' },
        { rule: 'alcance', severity: 'low', what: 'c', path: 'z' },
      ],
    }).findings_by_rule).toEqual({ 'manipulacion-tests': 2, alcance: 1 })
  })
})

// ---------------------------------------------------------------------------
// MEASURE 1: whether the ct yardstick got used, and whether it caught anything.
// TWO columns, because the first version of this counted only findings of the
// `patrones` item —the only one that measures against the yardsticks, the
// argument went— and the run of rust-monitoring's slice #7 refuted it by
// measuring: the yardstick came out cited twice under `decisiones-cerradas`. A
// finding the yardstick produced and that got filed under another item was
// invisible.
//
// WHAT COUNTS AS A CITATION is not tested here: it lives in `YardstickCitation`
// and `__tests__/yardstick-citation.test.js` tests it. What is down here is that
// these two columns use it on the right subject — every item of the walk
// for one, every finding for the other—.
// ---------------------------------------------------------------------------
describe('rubric_vara_ct_docs — how many documents of the yardstick actually got used', () => {
  const recorrido = (pasos) => verdictMeasures({ ruling: 'PASS', findings: [], rubric: pasos })

  it('it counts DISTINCT documents over the result of ALL the items, not just of patrones', () => {
    expect(recorrido([
      { rule: 'patrones', result: 'medí contra conventions/style.md', outcome: 'conforme' },
      { rule: 'decisiones-cerradas', result: 'y conventions/defects.md manda esto', outcome: 'conforme' },
    ]).rubric_vara_ct_docs).toBe(2)
  })

  it('the same document cited in two different items is still ONE document read', () => {
    expect(recorrido([
      { rule: 'patrones', result: 'conventions/style.md', outcome: 'conforme' },
      { rule: 'contrato', result: 'conventions/style.md otra vez', outcome: 'conforme' },
    ]).rubric_vara_ct_docs).toBe(1)
  })

  it('a walk that cites no document counts zero, and the zero is real: it was measured', () => {
    expect(recorrido([{ rule: 'patrones', result: 'todo bien', outcome: 'conforme' }]).rubric_vara_ct_docs).toBe(0)
  })

  it('a verdict with no rubric walk does not blow up', () => {
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).rubric_vara_ct_docs).toBe(0)
  })

  it("the REPO's yardstick cited in the walk does not count as ct", () => {
    expect(recorrido([
      { rule: 'patrones', result: 'medí contra `docs/conventions/style.md`', outcome: 'conforme' },
    ]).rubric_vara_ct_docs).toBe(0)
  })
})

describe('findings_vara_ct — findings that cite the yardstick, IN ANY rule', () => {
  it('it counts the finding filed under decisiones-cerradas, which is the case the old column did not see', () => {
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'patrones', severity: 'high', what: 'a', path: 'x', evidence: 'conventions/style.md dice inglés' },
        { rule: 'patrones', severity: 'low', what: 'b', path: 'y', evidence: 'se lee mal, sin cita' },
        { rule: 'decisiones-cerradas', severity: 'low', what: 'c', path: 'z', evidence: 'conventions/defects.md también aquí' },
      ],
    }).findings_vara_ct).toBe(2)
  })

  it('a finding that cites docs/conventions/ does NOT count as the ct yardstick', () => {
    expect(verdictMeasures({
      ruling: 'FAIL',
      findings: [
        { rule: 'patrones', severity: 'low', what: 'a', path: 'x', evidence: '`docs/conventions/style.md` pide camelCase' },
      ],
    }).findings_vara_ct).toBe(0)
  })

  it('a clean PASS counts zero, and the zero is real: it was measured', () => {
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).findings_vara_ct).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// THE AGGREGATE `/ct-harvest` READS (§3.4 of the handoff). `rubric_sin_vara`
// had been travelling in the pull request since `1422c67` and nobody read it:
// the column existed on disk and the question —«is the yardstick arriving?»—
// was answered by opening `jsonl` files by hand. The rows down here are
// realistic (complete identity, like `IDENT`, plus the measures), not a bare
// `{ruling:'PASS'}`: the aggregator reads real lines, not idealised test objects.
// ---------------------------------------------------------------------------
describe('the aggregate of what the judge left written (§3.4)', () => {
  const veredicto = (measures) => metricLine(metricRow({ ...IDENT, step: 'judge' }, measures, { now: AHORA }))
  const pasoNoVeredicto = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: AHORA }))

  it('it sums the sin-vara of every verdict of the file: the row is per attempt and aggregating is summing', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_sin_vara: 1 }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
      veredicto({ ruling: 'FAIL', rubric_sin_vara: 2 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.rubricSinVara).toBe(3)
    expect(r.verdicts).toBe(3)
    expect(r.measured).toBe(3)
    expect(r.legacy).toBe(0)
  })

  it('the rows that are not a verdict (implement, controls, commit) do not enter the count', () => {
    const texto = [
      pasoNoVeredicto('implement', { outcome: 'done' }),
      pasoNoVeredicto('controls', { outcome: 'done' }),
      pasoNoVeredicto('commit', { outcome: 'done' }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.verdicts).toBe(1)
    expect(r.rows).toBe(4)
  })

  it('a DISCARDED judge row is not a verdict: it does not inflate the denominator', () => {
    // ct-step.mjs:652 writes these rows WITHOUT any verdict measure at all.
    const texto = metricLine(metricRow({ ...IDENT, step: 'judge' }, { outcome: 'discarded', why: 'sin outcome' }, { now: AHORA }))
    const r = aggregateVerdictMeasures(texto)
    expect(r.verdicts).toBe(0)
  })

  it('a row predating the column counts as old and NOT as a zero', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_sin_vara: 2 }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }),
      veredicto({ ruling: 'PASS' }), // old schema: no rubric_sin_vara
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.measured).toBe(2)
    expect(r.legacy).toBe(1)
  })

  it('if no verdict carries the column, sin-vara is null and not 0 — a zero would assert a measure that was never taken', () => {
    const texto = [veredicto({ ruling: 'PASS' }), veredicto({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.rubricSinVara).toBeNull()
    expect(r.legacy).toBe(2)
  })

  it('the findings are aggregated by rule by summing findings_by_rule of every row', () => {
    const texto = [
      veredicto({ ruling: 'FAIL', findings_by_rule: { patrones: 2, alcance: 1 } }),
      veredicto({ ruling: 'FAIL', findings_by_rule: { patrones: 1 } }),
    ].join('')
    expect(aggregateVerdictMeasures(texto).findingsByRule).toEqual({ patrones: 3, alcance: 1 })
  })

  it("a rule no longer in the rubric goes on being counted: filtering against today's enum would erase history", () => {
    const texto = veredicto({ ruling: 'FAIL', findings_by_rule: { 'una-regla-retirada': 4 } })
    expect(aggregateVerdictMeasures(texto).findingsByRule).toEqual({ 'una-regla-retirada': 4 })
  })

  // SEVERITY, which had been written in every row since `verdictMeasures`
  // existed and which the aggregate threw away. `findings_by_rule` says WHICH
  // rule produced the finding; severity says whether that finding VETOED
  // (`high` forces a FAIL by `readVerdict`'s contract), bought the implementer
  // another round (`medium`) or was merely noted down (`low`). Without it, three
  // `alcance` findings in the table are indistinguishable from three vetoes.
  it('the three severities are summed over every verdict of the file', () => {
    const texto = [
      veredicto({ ruling: 'FAIL', findings_high: 1, findings_medium: 0, findings_low: 2 }),
      veredicto({ ruling: 'PASS', findings_high: 0, findings_medium: 1, findings_low: 1 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.findingsHigh).toBe(1)
    expect(r.findingsMedium).toBe(1)
    expect(r.findingsLow).toBe(3)
    expect(r.measuredSeverities).toBe(2)
    expect(r.legacySeverities).toBe(0)
  })

  // THE PARTITION OF THE VOCABULARY, tied to `SEVERITIES` in a single place. The
  // three keys are declared by hand in four places (the writer, the aggregate,
  // the table's columns and the report's cell) because the SHAPE of three
  // columns is closed by BigQuery's schema: it cannot be derived from the enum
  // without a new member changing the schema. What can be done is that a fourth
  // member turns this red instead of disappearing from the split in silence —
  // `decisions.md`: an unavoidable copy of the two halves of a contract asks for
  // the test that compares them.
  it('every severity of the closed vocabulary has its key written and aggregated: a fourth member turns this red', () => {
    const escritas = verdictMeasures({
      ruling: 'PASS',
      findings: SEVERITIES.map((severity) => ({ rule: 'alcance', severity })),
    })
    for (const severidad of SEVERITIES) expect(escritas[`findings_${severidad}`]).toBe(1)
    expect(escritas.findings_total).toBe(SEVERITIES.length)

    const unaDeCada = Object.fromEntries(SEVERITIES.map((severidad) => [`findings_${severidad}`, 1]))
    const r = aggregateVerdictMeasures(veredicto({ ruling: 'PASS', ...unaDeCada }))
    expect(r.measuredSeverities).toBe(1)
    expect(r.findingsHigh + r.findingsMedium + r.findingsLow).toBe(SEVERITIES.length)
  })

  it('a clean PASS sums three zeros and they are real: it was measured and there were no findings', () => {
    const texto = veredicto({ ruling: 'PASS', findings_high: 0, findings_medium: 0, findings_low: 0 })
    const r = aggregateVerdictMeasures(texto)
    expect(r.findingsHigh).toBe(0)
    expect(r.findingsMedium).toBe(0)
    expect(r.findingsLow).toBe(0)
    expect(r.measuredSeverities).toBe(1)
  })

  it('a verdict predating the severity columns counts as old and NOT as three zeros', () => {
    const texto = [
      veredicto({ ruling: 'PASS', findings_high: 0, findings_medium: 1, findings_low: 0 }),
      veredicto({ ruling: 'PASS' }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.measuredSeverities).toBe(1)
    expect(r.legacySeverities).toBe(1)
    expect(r.findingsMedium).toBe(1)
  })

  it('if no verdict carries the severities, the three of them are null and not 0', () => {
    const texto = [veredicto({ ruling: 'PASS' }), veredicto({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.findingsHigh).toBeNull()
    expect(r.findingsMedium).toBeNull()
    expect(r.findingsLow).toBeNull()
    expect(r.legacySeverities).toBe(2)
  })

  it('the three go together: a row missing a single one of them is old entirely', () => {
    const texto = veredicto({ ruling: 'PASS', findings_high: 0, findings_low: 1 })
    const r = aggregateVerdictMeasures(texto)
    expect(r.legacySeverities).toBe(1)
    expect(r.findingsLow).toBeNull()
  })

  it('a severity that is not a non-negative integer treats the row as old, just like sin-vara', () => {
    for (const basura of ['1', -1, 1.5, null]) {
      const texto = veredicto({ ruling: 'PASS', findings_high: basura, findings_medium: 0, findings_low: 0 })
      const r = aggregateVerdictMeasures(texto)
      expect(r.measuredSeverities).toBe(0)
      expect(r.legacySeverities).toBe(1)
    }
  })

  // THE VETO IS COUNTED SEPARATELY. `verdicts` says how many times a judgement
  // was made; this one says how many of them the judge stopped. It is not
  // derived from `findingsHigh`: a FAIL can arrive with no high finding at all
  // (the judge signs it), and a file of old telemetry always has `ruling` —it is
  // the key that defines the row— so this count is never legacy.
  it('the FAILs are counted separately, and a file with no severities still knows how many vetoes there were', () => {
    const texto = [
      veredicto({ ruling: 'FAIL' }),
      veredicto({ ruling: 'PASS' }),
      veredicto({ ruling: 'FAIL' }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.fails).toBe(2)
    expect(r.verdicts).toBe(3)
    expect(r.findingsHigh).toBeNull()
  })

  it('a discarded judge row is not a veto: with no ruling it counts neither as a verdict nor as a fail', () => {
    const texto = pasoNoVeredicto('judge', { outcome: 'discarded', why: 'sin outcome' })
    const r = aggregateVerdictMeasures(texto)
    expect(r.verdicts).toBe(0)
    expect(r.fails).toBe(0)
  })

  it('an unreadable line is counted and does not throw the file away: the good ones go on being aggregated', () => {
    const texto = [veredicto({ ruling: 'PASS', rubric_sin_vara: 1 }), '{no es json\n', veredicto({ ruling: 'PASS', rubric_sin_vara: 1 })].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.malformed).toBe(1)
    expect(r.verdicts).toBe(2)
    expect(r.rubricSinVara).toBe(2)
  })

  it('a line that is valid JSON but not an object is unreadable too', () => {
    const texto = ['[1,2]', 'null', '"x"'].join('\n') + '\n'
    expect(aggregateVerdictMeasures(texto).malformed).toBe(3)
  })

  it('the empty lines and the trailing newline are not unreadable lines', () => {
    const texto = veredicto({ ruling: 'PASS', rubric_sin_vara: 0 }) + '\n\n'
    expect(aggregateVerdictMeasures(texto).malformed).toBe(0)
  })

  it('a rubric_sin_vara that is not a non-negative integer is not summed: it is treated as an old row', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_sin_vara: '2' }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: -1 }),
      veredicto({ ruling: 'PASS', rubric_sin_vara: 1.5 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.measured).toBe(0)
    expect(r.legacy).toBe(3)
    expect(r.rubricSinVara).toBeNull()
  })

  it('an empty file does not blow up and asserts nothing', () => {
    for (const vacio of ['', undefined]) {
      const r = aggregateVerdictMeasures(vacio)
      expect(r).toEqual({
        rows: 0, malformed: 0, verdicts: 0, fails: 0, measured: 0, legacy: 0, rubricSinVara: null, findingsByRule: {},
        measuredVaraCtDocs: 0, legacyVaraCtDocs: 0, varaCtDocs: null,
        measuredFindingsVaraCt: 0, legacyFindingsVaraCt: 0, findingsVaraCt: null,
        measuredSeverities: 0, legacySeverities: 0, findingsHigh: null, findingsMedium: null, findingsLow: null,
      })
    }
  })

  it('the reader looks exactly where the writer writes', () => {
    expect(metricsRepoRelPath(7)).toBe('docs/superpowers/metrics/issue-7.jsonl')
    expect(METRICS_REPO_DIR).toBe('docs/superpowers/metrics')
  })

  // MEASURE 1, traced from rubric_sin_vara: measured/legacy OF THEIR OWN for
  // EACH of the two columns, and a row without the column never counts as zero.
  it('it sums rubric_vara_ct_docs and findings_vara_ct of every verdict of the file', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_vara_ct_docs: 5, findings_vara_ct: 1 }),
      veredicto({ ruling: 'PASS', rubric_vara_ct_docs: 3, findings_vara_ct: 0 }),
      veredicto({ ruling: 'FAIL', rubric_vara_ct_docs: 4, findings_vara_ct: 2 }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.varaCtDocs).toBe(12)
    expect(r.measuredVaraCtDocs).toBe(3)
    expect(r.legacyVaraCtDocs).toBe(0)
    expect(r.findingsVaraCt).toBe(3)
    expect(r.measuredFindingsVaraCt).toBe(3)
    expect(r.legacyFindingsVaraCt).toBe(0)
  })

  it('a row predating these columns counts as old and NOT as a zero', () => {
    const texto = [
      veredicto({ ruling: 'PASS', rubric_vara_ct_docs: 2, findings_vara_ct: 1 }),
      veredicto({ ruling: 'PASS' }),
    ].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.legacyVaraCtDocs).toBe(1)
    expect(r.varaCtDocs).toBe(2)
    expect(r.legacyFindingsVaraCt).toBe(1)
    expect(r.findingsVaraCt).toBe(1)
  })

  it('if no verdict carries the columns, both figures are null and not 0', () => {
    const texto = [veredicto({ ruling: 'PASS' }), veredicto({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(texto)
    expect(r.varaCtDocs).toBeNull()
    expect(r.findingsVaraCt).toBeNull()
    expect(r.legacyVaraCtDocs).toBe(2)
    expect(r.legacyFindingsVaraCt).toBe(2)
  })

  it("the yardstick's two columns carry counters SEPARATE from each other: a row can carry one and not the other", () => {
    const texto = veredicto({ ruling: 'PASS', rubric_vara_ct_docs: 4 })
    const r = aggregateVerdictMeasures(texto)
    expect(r.measuredVaraCtDocs).toBe(1)
    expect(r.varaCtDocs).toBe(4)
    expect(r.legacyFindingsVaraCt).toBe(1)
    expect(r.findingsVaraCt).toBeNull()
  })

  it("the yardstick's counters are independent of rubric_sin_vara's: different birth dates", () => {
    const texto = veredicto({ ruling: 'PASS', rubric_sin_vara: 0 })
    const r = aggregateVerdictMeasures(texto)
    expect(r.measured).toBe(1)
    expect(r.legacyVaraCtDocs).toBe(1)
    expect(r.varaCtDocs).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// MEASURE 2: whether the yardstick reached the brief, and how much it weighed.
// `briefVaraCtMeasures` is PURE (it does not read disk: it receives the content
// already read) and counts `## Vara de ct: conventions/` headings — exactly what
// `PluginYardstick.composeSection` (scripts/plugin-yardstick.js) writes per
// document — instead of comparing against `PluginYardstick.FILES.length`, so
// that a fifth document tomorrow also counts without touching this function.
// ---------------------------------------------------------------------------
describe('briefVaraCtMeasures — how many documents the brief carries and how much it weighs', () => {
  const brief = (docs) => [
    '# Task 1',
    '',
    'texto de la tarea',
    '',
    ...docs.flatMap((d) => [`## Vara de ct: conventions/${d}`, '', 'cuerpo del documento', '']),
  ].join('\n')

  it('it counts the four headings of today', () => {
    const contenido = brief(['code.md', 'decisions.md', 'architecture.md', 'testing.md'])
    expect(briefVaraCtMeasures(contenido).brief_vara_ct_docs).toBe(4)
  })

  it("it does not depend on today's names: a fifth document is counted too", () => {
    const contenido = brief(['code.md', 'decisions.md', 'architecture.md', 'testing.md', 'naming.md'])
    expect(briefVaraCtMeasures(contenido).brief_vara_ct_docs).toBe(5)
  })

  it('a brief with no heading at all counts zero, and it is a real zero: it could be measured', () => {
    expect(briefVaraCtMeasures('# Task 1\n\nsin vara de ct por aquí\n').brief_vara_ct_docs).toBe(0)
  })

  it('it weighs the brief in bytes, not in characters — real UTF-8', () => {
    const conAcentos = '## Vara de ct: conventions/code.md\ncondición, año, ñ\n'
    const { brief_bytes: bytes } = briefVaraCtMeasures(conAcentos)
    expect(bytes).toBe(Buffer.byteLength(conAcentos, 'utf8'))
    expect(bytes).toBeGreaterThan(conAcentos.length) // the accents weigh more than 1 byte
  })
})

describe('aggregateBriefMeasures — the reader of what the brief measured, brother of aggregateVerdictMeasures', () => {
  const intento = (measures) => metricLine(metricRow({ ...IDENT, step: 'implement' }, measures, { now: AHORA }))
  const otroPaso = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: AHORA }))

  it('it sums docs and bytes of every implement attempt of the file', () => {
    const texto = [
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 520 }),
    ].join('')
    const r = aggregateBriefMeasures(texto)
    expect(r.briefAttempts).toBe(2)
    expect(r.briefMeasured).toBe(2)
    expect(r.briefLegacy).toBe(0)
    expect(r.briefVaraCtDocs).toBe(8)
    expect(r.briefBytes).toBe(1020)
  })

  // THESE ROWS DO NOT CARRY `ruling`: that is exactly why aggregateVerdictMeasures
  // ignores them by design (tolerance nº3 up above), and why an aggregator of
  // its own is needed instead of reusing that one.
  it('the judge/controls/commit rows do not enter the count of brief attempts', () => {
    const texto = [
      otroPaso('judge', { ruling: 'PASS', rubric_sin_vara: 0 }),
      otroPaso('controls', { outcome: 'done' }),
      otroPaso('commit', { outcome: 'done' }),
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
    ].join('')
    expect(aggregateBriefMeasures(texto).briefAttempts).toBe(1)
  })

  // THE RULE OF THIS FILE: a row without the field (telemetry predating this
  // measure, or an attempt in which the brief could not be read) does NOT count
  // as zero.
  it('a row predating the measure, or with the brief unread (null), counts as old and NOT as zero', () => {
    const texto = [
      intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
      intento({ outcome: 'done' }), // old schema: without the two fields
      intento({ outcome: 'discarded', brief_vara_ct_docs: null, brief_bytes: null }), // the brief could not be read
    ].join('')
    const r = aggregateBriefMeasures(texto)
    expect(r.briefAttempts).toBe(3)
    expect(r.briefMeasured).toBe(1)
    expect(r.briefLegacy).toBe(2)
    expect(r.briefVaraCtDocs).toBe(4)
  })

  it('if no attempt carries the column, briefVaraCtDocs and briefBytes are null and not 0', () => {
    const texto = [intento({ outcome: 'done' }), intento({ outcome: 'discarded' })].join('')
    const r = aggregateBriefMeasures(texto)
    expect(r.briefVaraCtDocs).toBeNull()
    expect(r.briefBytes).toBeNull()
    expect(r.briefLegacy).toBe(2)
  })

  it('a brief with zero documents (genuinely broken) is summed as the zero it is: it is not confused with "unmeasured"', () => {
    const texto = intento({ outcome: 'done', brief_vara_ct_docs: 0, brief_bytes: 40 })
    const r = aggregateBriefMeasures(texto)
    expect(r.briefMeasured).toBe(1)
    expect(r.briefVaraCtDocs).toBe(0)
  })

  it('an empty file does not blow up and asserts nothing', () => {
    for (const vacio of ['', undefined]) {
      expect(aggregateBriefMeasures(vacio)).toEqual({
        briefAttempts: 0, briefMeasured: 0, briefLegacy: 0, briefVaraCtDocs: null, briefBytes: null,
      })
    }
  })

  it('an unreadable line does not blow up the aggregator', () => {
    const texto = [intento({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }), '{no es json\n'].join('')
    expect(() => aggregateBriefMeasures(texto)).not.toThrow()
    expect(aggregateBriefMeasures(texto).briefAttempts).toBe(1)
  })
})

// #92 — the reader of the three fields `RoleBytes` writes. Third brother of the
// other two aggregators, and for the same reason: the columns travelled in the
// pull request and with no reader of their own nobody would look at them.
describe('aggregateRoleBytesMeasures — how much fixed material each role of the slice read', () => {
  const papel = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: AHORA }))
  const bytes = (agent, skill, paquete) => ({ agent_bytes: agent, skill_bytes: skill, package_bytes: paquete })

  it('it sums the three sizes of every dispatched role, whatever the step', () => {
    const texto = [
      papel('implement', { outcome: 'done', ...bytes(100, 50, 900) }),
      papel('judge', { ruling: 'PASS', ...bytes(5000, 50, 300) }),
      papel('slice-judge', { ruling: 'PASS', ...bytes(3000, 0, 400) }),
      papel('reconcile', { outcome: 'conflicting', ...bytes(2000, 0, 100) }),
    ].join('')
    const r = aggregateRoleBytesMeasures(texto)
    expect(r.roleAttempts).toBe(4)
    expect(r.roleMeasured).toBe(4)
    expect(r.roleLegacy).toBe(0)
    expect(r.agentBytes).toBe(10100)
    expect(r.skillBytes).toBe(100)
    expect(r.packageBytes).toBe(1700)
  })

  it('the steps that dispatch nobody —controls, commit, global— do not enter the count', () => {
    const texto = [
      papel('controls', { outcome: 'done', duration_ms: 3 }),
      papel('commit', { outcome: 'done' }),
      papel('global', { outcome: 'done' }),
      papel('judge', { ruling: 'PASS', ...bytes(5000, 50, 300) }),
    ].join('')
    expect(aggregateRoleBytesMeasures(texto).roleAttempts).toBe(1)
  })

  it('an implement attempt predating the measure counts as old and NOT as zero', () => {
    const texto = [
      papel('implement', { outcome: 'done', ...bytes(100, 50, 900) }),
      papel('implement', { outcome: 'done', brief_bytes: 900 }),
    ].join('')
    const r = aggregateRoleBytesMeasures(texto)
    expect(r.roleAttempts).toBe(2)
    expect(r.roleMeasured).toBe(1)
    expect(r.roleLegacy).toBe(1)
    expect(r.agentBytes).toBe(100)
  })

  // The same tolerance nº3 as `aggregateVerdictMeasures`, for the same reason:
  // `ct-step` writes DISCARDED judge rows with no measure at all, and counting
  // them as old telemetry would say there was a judgement nobody measured when
  // what there was is a judgement that was not accepted.
  it('a discarded judge is not an unmeasured role: it does not even enter as old', () => {
    const texto = [
      papel('judge', { outcome: 'discarded', why: 'el paquete no existe' }),
      papel('slice-judge', { outcome: 'discarded', why: 'token ajeno' }),
    ].join('')
    const r = aggregateRoleBytesMeasures(texto)
    expect(r.roleAttempts).toBe(0)
    expect(r.roleLegacy).toBe(0)
  })

  // A reconcile round with no package written is a round in which nobody
  // dispatched `ct-reconciler`. Counting it as old would inflate the denominator
  // with calls to the model that were never made.
  it('a reconcile round that dispatched nobody does not count as an unmeasured role', () => {
    const texto = papel('reconcile', { outcome: 'up-to-date', files: [] })
    const r = aggregateRoleBytesMeasures(texto)
    expect(r.roleAttempts).toBe(0)
    expect(r.roleLegacy).toBe(0)
  })

  it('a role that is ordered no skill sums the zero it is, and is not confused with unmeasured', () => {
    const texto = papel('slice-judge', { ruling: 'PASS', ...bytes(3000, 0, 400) })
    const r = aggregateRoleBytesMeasures(texto)
    expect(r.roleMeasured).toBe(1)
    expect(r.skillBytes).toBe(0)
  })

  it('if no role carries the columns, the three sums are null and not 0', () => {
    const texto = papel('implement', { outcome: 'done', brief_bytes: 900 })
    expect(aggregateRoleBytesMeasures(texto)).toEqual({
      roleAttempts: 1, roleMeasured: 0, roleLegacy: 1, agentBytes: null, skillBytes: null, packageBytes: null,
    })
  })

  it('an empty file does not blow up and asserts nothing', () => {
    for (const vacio of ['', undefined]) {
      expect(aggregateRoleBytesMeasures(vacio)).toEqual({
        roleAttempts: 0, roleMeasured: 0, roleLegacy: 0, agentBytes: null, skillBytes: null, packageBytes: null,
      })
    }
  })

  it('an unreadable line does not blow up the aggregator', () => {
    const texto = [papel('judge', { ruling: 'PASS', ...bytes(5000, 50, 300) }), '{no es json\n'].join('')
    expect(() => aggregateRoleBytesMeasures(texto)).not.toThrow()
    expect(aggregateRoleBytesMeasures(texto).roleAttempts).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// And against the real oracle: that the rows do come out, and —what really has
// to be pinned— that NOT coming out does not change what the step does. A
// program that dies because it could not write its own metric has turned the
// thermometer into part of the engine.
// ---------------------------------------------------------------------------
describe('the telemetry of a real step', () => {
  const PLAN = [
    '# #7 — una tarea',
    '',
    '## 7. Tasks',
    '',
    '### Task 1 — la única',
    '**Objective:** un fichero.',
    '**Files:** `uno.txt`',
    '**TDD:** No TDD — fixture.',
    '**Tests:** N/A — fixture.',
    '**Verification:** el fichero está.',
    '',
    F + 'bash',
    'test -f uno.txt',
    F,
    '',
    '## 8. Global verification',
    '',
    'N/A — fixture de telemetría.',
    '',
  ].join('\n')

  let repo, casa

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ct-metrics-'))
    casa = mkdtempSync(join(tmpdir(), 'ct-casa-'))
    const g = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    g('init', '-q', '-b', 'main')
    g('config', 'user.email', 't@e.com')
    g('config', 'user.name', 'T')
    g('config', 'commit.gpgsign', 'false')
    g('remote', 'add', 'origin', 'git@github.com:josemerca/control-tower-plugin.git')
    mkdirSync(join(repo, '.agent'), { recursive: true })
    writeFileSync(join(repo, '.agent', 'SLICE.md'), '---\nissue: 7\nepic: 12\n---\n\n# slice\n')
    writeFileSync(join(repo, 'plan.md'), PLAN)
    g('add', '-A')
    g('commit', '-q', '-m', 'base')
    writeFileSync(join(repo, 'uno.txt'), 'uno\n')
    writeFileSync(join(repo, 'report.json'), JSON.stringify({ paths: ['uno.txt'], summary: 'hecho' }))
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
    rmSync(casa, { recursive: true, force: true })
  })

  const ct = (configDir, ...args) => spawnSync('node', [SCRIPT, ...args, '--plan', 'plan.md', '--issue', '7'], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
  })

  it('the row carries the complete identity, with the seeded epic and the hash of the plan', () => {
    const r = ct(casa, 'report', 'report.json')
    expect(r.status).toBe(0)
    const filas = readFileSync(join(casa, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(filas).toHaveLength(1)
    const f = filas[0]
    expect(f.repo).toBe('josemerca/control-tower-plugin')
    expect(f.epic).toBe('12')            // read from the SLICE.md the dispatch seeded
    expect(f.issue).toBe(7)
    expect(f.step).toBe('implement')
    expect(f.attempt).toBe(1)
    expect(f.plan_sha256).toBe(planSha256(PLAN))
    expect(f.written_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('if it cannot be written, the step does the SAME and merely warns', () => {
    // A file where the directory should go: mkdir fails with ENOTDIR.
    const bloqueado = join(casa, 'bloqueado')
    writeFileSync(bloqueado, 'no soy un directorio\n')
    const r = ct(bloqueado, 'report', 'report.json')
    expect(r.status).toBe(0)                            // the same code as with telemetry
    expect(r.stdout).toMatch(/stageados 1 fichero/)     // and the step was applied all the same
    expect(r.stderr).toMatch(/no se pudo escribir la telemetría/)
    // The transition was saved: the measure decides nothing.
    expect(JSON.parse(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8')).step).toBe('controls')
  })

  // MEASURE 2 against the real oracle: `ct-step next` writes the REAL brief to
  // disk (with the plugin's ct yardstick pasted in by `escribirBrief`), and
  // `ct-step report` measures it by reading exactly that path.
  it('if the brief reached disk, the row counts its ct yardstick documents and its weight', () => {
    const n = ct(casa, 'next')
    expect(n.status).toBe(0)
    const r = ct(casa, 'report', 'report.json')
    expect(r.status).toBe(0)
    const filas = readFileSync(join(casa, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const f = filas[0]
    // The plugin's conventions/ documents, counted by heading and not by
    // comparing against PluginYardstick.FILES.length. That is why neither the
    // fifth (defects.md, when code.md was split) nor the ones that arrived
    // afterwards forced anyone to touch briefVaraCtMeasures.
    // All eight: the ct yardstick is no longer filtered by whatever `**Files:**`
    // declares, so the brief carries the whole list whether or not the task
    // creates a module.
    expect(f.brief_vara_ct_docs).toBe(PluginYardstick.FILES.length)
    expect(typeof f.brief_bytes).toBe('number')
    expect(f.brief_bytes).toBeGreaterThan(0)
  })

  // If nobody called `next`, the brief does not exist on disk: the two fields go
  // to `null`, never to `0` — a zero would assert a brief with no yardstick, and
  // what happened is that it could not be looked at.
  it('if the brief cannot be read, the two fields go to null, not to 0', () => {
    const r = ct(casa, 'report', 'report.json')
    expect(r.status).toBe(0)
    const filas = readFileSync(join(casa, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const f = filas[0]
    expect(f.brief_vara_ct_docs).toBeNull()
    expect(f.brief_bytes).toBeNull()
  })
})
