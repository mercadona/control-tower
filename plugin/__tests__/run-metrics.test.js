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
  metricsRepoRelPath, METRICS_REPO_DIR, briefCtYardstickMeasures, aggregateBriefMeasures,
  aggregateRoleBytesMeasures, aggregateIdentityMeasures, NO_ACTOR_KEY,
} from '../scripts/run-metrics.js'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'
import { SEVERITIES } from '../scripts/step-contracts.js'

const here = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(here, '..', 'scripts', 'ct-step.mjs')
const F = '```'
const NOW = '2026-08-18T10:00:00.000Z'

const IDENT = {
  repo: 'josemerca/control-tower-plugin', epic: '12', issue: 7,
  plan: 'plan.md', plan_sha256: 'abc', task: 2, task_name: 'la segunda',
  tasks_total: 8, step: 'judge', attempt: 3,
  plugin_version: '0.36.1', actor: 'alcaptar',
}

describe('the identity of the row', () => {
  it('carries the twelve fields of the design, not one less', () => {
    const row = metricRow(IDENT, {}, { now: NOW })
    expect(IDENTITY_FIELDS).toHaveLength(12)
    for (const field of IDENTITY_FIELDS) expect(row).toHaveProperty(field)
    expect(row.written_at).toBe(NOW)
  })

  it('an issue with no milestone is recorded as "(sin milestone)", never empty', () => {
    for (const empty of [null, undefined, '']) {
      expect(metricRow({ ...IDENT, epic: empty }, {}, { now: NOW }).epic).toBe('(sin milestone)')
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
    expect(metricRow(IDENT, {}, { now: NOW }).plugin_version).toBe('0.36.1')
    expect(IDENTITY_FIELDS).toContain('plugin_version')
  })

  // TODAY IT DOES NOT MATTER AND IT IS GOING TO STOP NOT MATTERING. Every row
  // lives on the disk of whoever wrote it, so the actor is implicit; as soon as
  // the rows travel inside the pull request, one and the same file will mix rows
  // from two different machines and with no actor there is no knowing whose the
  // cost is — which is exactly the datum this file gets looked at for.
  it('the actor travels in the row: as soon as the rows mix, the cost has an owner', () => {
    expect(metricRow(IDENT, {}, { now: NOW }).actor).toBe('alcaptar')
    expect(IDENTITY_FIELDS).toContain('actor')
  })

  // THE RULE OF THIS FILE, applied to the two new fields: absence is DECLARED.
  // A `null` in a column you group by (which version?, whose?) reads as one more
  // value and melts into a single group the rows that did not carry it and the
  // ones that carried it empty. The sentinel keeps the column's type and says
  // out loud that there was no datum there, just as `epic` has spent years
  // saying `(sin milestone)`.
  it('with no version and no actor the absence is declared, the gap is not left', () => {
    for (const empty of [null, undefined, '']) {
      const row = metricRow({ ...IDENT, plugin_version: empty, actor: empty }, {}, { now: NOW })
      expect(row.plugin_version).toBe('(sin versión)')
      expect(row.actor).toBe('(sin actor)')
    }
  })

  // THE MODULE STAYS PURE, and these two fields are precisely the ones that
  // invite breaking that: the version is in the plugin's package.json and the
  // actor is in the environment, one line away. If it went looking for them
  // itself, the row would say who WRITES the metric instead of who ran the step,
  // and the module would stop being testable without mounting a disk.
  it('it does not go to the environment for the actor: the value arrives INSIDE the identity', () => {
    const previous = process.env.USER
    process.env.USER = 'un-actor-del-entorno'
    try {
      const { plugin_version: version, actor } = metricRow({ ...IDENT, plugin_version: null, actor: null }, {}, { now: NOW })
      expect(actor).toBe('(sin actor)')
      expect(version).toBe('(sin versión)')
    } finally {
      if (previous === undefined) delete process.env.USER
      else process.env.USER = previous
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
    expect(metricRow({ ...IDENT, session: 'sesion-1' }, {}, { now: NOW })).not.toHaveProperty('session')
  })

  it('the attempt is a dimension of the row, not an aggregated counter', () => {
    // It is what lets you measure how many times the judge vetoed and how many
    // rounds each task cost, which is the datum that decides if this is worth it.
    const rounds = [1, 2, 3].map((attempt) => metricRow({ ...IDENT, attempt }, {}, { now: NOW }))
    expect(rounds.map((f) => f.attempt)).toEqual([1, 2, 3])
  })

  it('the measures travel apart from the identity and cannot tread on it', () => {
    const row = metricRow(IDENT, { cost_usd: 0.03, outcome: 'done' }, { now: NOW })
    expect(row.cost_usd).toBe(0.03)
    expect(row.issue).toBe(7)
  })

  it('every row is one line of JSON, which is what makes the file append-only', () => {
    const line = metricLine(metricRow(IDENT, {}, { now: NOW }))
    expect(line.endsWith('\n')).toBe(true)
    expect(JSON.parse(line).step).toBe('judge')
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
  const walk = (steps) => verdictMeasures({ ruling: 'PASS', findings: [], rubric: steps })

  it('it counts DISTINCT documents over the result of ALL the items, not just of patrones', () => {
    expect(walk([
      { rule: 'patrones', result: 'medí contra conventions/style.md', outcome: 'conforme' },
      { rule: 'decisiones-cerradas', result: 'y conventions/defects.md manda esto', outcome: 'conforme' },
    ]).rubric_vara_ct_docs).toBe(2)
  })

  it('the same document cited in two different items is still ONE document read', () => {
    expect(walk([
      { rule: 'patrones', result: 'conventions/style.md', outcome: 'conforme' },
      { rule: 'contrato', result: 'conventions/style.md otra vez', outcome: 'conforme' },
    ]).rubric_vara_ct_docs).toBe(1)
  })

  it('a walk that cites no document counts zero, and the zero is real: it was measured', () => {
    expect(walk([{ rule: 'patrones', result: 'todo bien', outcome: 'conforme' }]).rubric_vara_ct_docs).toBe(0)
  })

  it('a verdict with no rubric walk does not blow up', () => {
    expect(verdictMeasures({ ruling: 'PASS', findings: [] }).rubric_vara_ct_docs).toBe(0)
  })

  it("the REPO's yardstick cited in the walk does not count as ct", () => {
    expect(walk([
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
  const verdict = (measures) => metricLine(metricRow({ ...IDENT, step: 'judge' }, measures, { now: NOW }))
  const nonVerdictStep = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: NOW }))

  it('it sums the sin-vara of every verdict of the file: the row is per attempt and aggregating is summing', () => {
    const text = [
      verdict({ ruling: 'PASS', rubric_sin_vara: 1 }),
      verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
      verdict({ ruling: 'FAIL', rubric_sin_vara: 2 }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.rubricSinVara).toBe(3)
    expect(r.verdicts).toBe(3)
    expect(r.measured).toBe(3)
    expect(r.legacy).toBe(0)
  })

  it('the rows that are not a verdict (implement, controls, commit) do not enter the count', () => {
    const text = [
      nonVerdictStep('implement', { outcome: 'done' }),
      nonVerdictStep('controls', { outcome: 'done' }),
      nonVerdictStep('commit', { outcome: 'done' }),
      verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.verdicts).toBe(1)
    expect(r.rows).toBe(4)
  })

  it('a DISCARDED judge row is not a verdict: it does not inflate the denominator', () => {
    // ct-step.mjs:652 writes these rows WITHOUT any verdict measure at all.
    const text = metricLine(metricRow({ ...IDENT, step: 'judge' }, { outcome: 'discarded', why: 'sin outcome' }, { now: NOW }))
    const r = aggregateVerdictMeasures(text)
    expect(r.verdicts).toBe(0)
  })

  it('a row predating the column counts as old and NOT as a zero', () => {
    const text = [
      verdict({ ruling: 'PASS', rubric_sin_vara: 2 }),
      verdict({ ruling: 'PASS', rubric_sin_vara: 0 }),
      verdict({ ruling: 'PASS' }), // old schema: no rubric_sin_vara
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.measured).toBe(2)
    expect(r.legacy).toBe(1)
  })

  it('if no verdict carries the column, sin-vara is null and not 0 — a zero would assert a measure that was never taken', () => {
    const text = [verdict({ ruling: 'PASS' }), verdict({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.rubricSinVara).toBeNull()
    expect(r.legacy).toBe(2)
  })

  it('the findings are aggregated by rule by summing findings_by_rule of every row', () => {
    const text = [
      verdict({ ruling: 'FAIL', findings_by_rule: { patrones: 2, alcance: 1 } }),
      verdict({ ruling: 'FAIL', findings_by_rule: { patrones: 1 } }),
    ].join('')
    expect(aggregateVerdictMeasures(text).findingsByRule).toEqual({ patrones: 3, alcance: 1 })
  })

  it("a rule no longer in the rubric goes on being counted: filtering against today's enum would erase history", () => {
    const text = verdict({ ruling: 'FAIL', findings_by_rule: { 'una-regla-retirada': 4 } })
    expect(aggregateVerdictMeasures(text).findingsByRule).toEqual({ 'una-regla-retirada': 4 })
  })

  // SEVERITY, which had been written in every row since `verdictMeasures`
  // existed and which the aggregate threw away. `findings_by_rule` says WHICH
  // rule produced the finding; severity says whether that finding VETOED
  // (`high` forces a FAIL by `readVerdict`'s contract), bought the implementer
  // another round (`medium`) or was merely noted down (`low`). Without it, three
  // `alcance` findings in the table are indistinguishable from three vetoes.
  it('the three severities are summed over every verdict of the file', () => {
    const text = [
      verdict({ ruling: 'FAIL', findings_high: 1, findings_medium: 0, findings_low: 2 }),
      verdict({ ruling: 'PASS', findings_high: 0, findings_medium: 1, findings_low: 1 }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
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
    const written = verdictMeasures({
      ruling: 'PASS',
      findings: SEVERITIES.map((severity) => ({ rule: 'alcance', severity })),
    })
    for (const severity of SEVERITIES) expect(written[`findings_${severity}`]).toBe(1)
    expect(written.findings_total).toBe(SEVERITIES.length)

    const oneOfEach = Object.fromEntries(SEVERITIES.map((severity) => [`findings_${severity}`, 1]))
    const r = aggregateVerdictMeasures(verdict({ ruling: 'PASS', ...oneOfEach }))
    expect(r.measuredSeverities).toBe(1)
    expect(r.findingsHigh + r.findingsMedium + r.findingsLow).toBe(SEVERITIES.length)
  })

  it('a clean PASS sums three zeros and they are real: it was measured and there were no findings', () => {
    const text = verdict({ ruling: 'PASS', findings_high: 0, findings_medium: 0, findings_low: 0 })
    const r = aggregateVerdictMeasures(text)
    expect(r.findingsHigh).toBe(0)
    expect(r.findingsMedium).toBe(0)
    expect(r.findingsLow).toBe(0)
    expect(r.measuredSeverities).toBe(1)
  })

  it('a verdict predating the severity columns counts as old and NOT as three zeros', () => {
    const text = [
      verdict({ ruling: 'PASS', findings_high: 0, findings_medium: 1, findings_low: 0 }),
      verdict({ ruling: 'PASS' }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.measuredSeverities).toBe(1)
    expect(r.legacySeverities).toBe(1)
    expect(r.findingsMedium).toBe(1)
  })

  it('if no verdict carries the severities, the three of them are null and not 0', () => {
    const text = [verdict({ ruling: 'PASS' }), verdict({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.findingsHigh).toBeNull()
    expect(r.findingsMedium).toBeNull()
    expect(r.findingsLow).toBeNull()
    expect(r.legacySeverities).toBe(2)
  })

  it('the three go together: a row missing a single one of them is old entirely', () => {
    const text = verdict({ ruling: 'PASS', findings_high: 0, findings_low: 1 })
    const r = aggregateVerdictMeasures(text)
    expect(r.legacySeverities).toBe(1)
    expect(r.findingsLow).toBeNull()
  })

  it('a severity that is not a non-negative integer treats the row as old, just like sin-vara', () => {
    for (const garbage of ['1', -1, 1.5, null]) {
      const text = verdict({ ruling: 'PASS', findings_high: garbage, findings_medium: 0, findings_low: 0 })
      const r = aggregateVerdictMeasures(text)
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
    const text = [
      verdict({ ruling: 'FAIL' }),
      verdict({ ruling: 'PASS' }),
      verdict({ ruling: 'FAIL' }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.fails).toBe(2)
    expect(r.verdicts).toBe(3)
    expect(r.findingsHigh).toBeNull()
  })

  it('a discarded judge row is not a veto: with no ruling it counts neither as a verdict nor as a fail', () => {
    const text = nonVerdictStep('judge', { outcome: 'discarded', why: 'sin outcome' })
    const r = aggregateVerdictMeasures(text)
    expect(r.verdicts).toBe(0)
    expect(r.fails).toBe(0)
  })

  it('an unreadable line is counted and does not throw the file away: the good ones go on being aggregated', () => {
    const text = [verdict({ ruling: 'PASS', rubric_sin_vara: 1 }), '{no es json\n', verdict({ ruling: 'PASS', rubric_sin_vara: 1 })].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.malformed).toBe(1)
    expect(r.verdicts).toBe(2)
    expect(r.rubricSinVara).toBe(2)
  })

  it('a line that is valid JSON but not an object is unreadable too', () => {
    const text = ['[1,2]', 'null', '"x"'].join('\n') + '\n'
    expect(aggregateVerdictMeasures(text).malformed).toBe(3)
  })

  it('the empty lines and the trailing newline are not unreadable lines', () => {
    const text = verdict({ ruling: 'PASS', rubric_sin_vara: 0 }) + '\n\n'
    expect(aggregateVerdictMeasures(text).malformed).toBe(0)
  })

  it('a rubric_sin_vara that is not a non-negative integer is not summed: it is treated as an old row', () => {
    const text = [
      verdict({ ruling: 'PASS', rubric_sin_vara: '2' }),
      verdict({ ruling: 'PASS', rubric_sin_vara: -1 }),
      verdict({ ruling: 'PASS', rubric_sin_vara: 1.5 }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.measured).toBe(0)
    expect(r.legacy).toBe(3)
    expect(r.rubricSinVara).toBeNull()
  })

  it('an empty file does not blow up and asserts nothing', () => {
    for (const empty of ['', undefined]) {
      const r = aggregateVerdictMeasures(empty)
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
    const text = [
      verdict({ ruling: 'PASS', rubric_vara_ct_docs: 5, findings_vara_ct: 1 }),
      verdict({ ruling: 'PASS', rubric_vara_ct_docs: 3, findings_vara_ct: 0 }),
      verdict({ ruling: 'FAIL', rubric_vara_ct_docs: 4, findings_vara_ct: 2 }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.varaCtDocs).toBe(12)
    expect(r.measuredVaraCtDocs).toBe(3)
    expect(r.legacyVaraCtDocs).toBe(0)
    expect(r.findingsVaraCt).toBe(3)
    expect(r.measuredFindingsVaraCt).toBe(3)
    expect(r.legacyFindingsVaraCt).toBe(0)
  })

  it('a row predating these columns counts as old and NOT as a zero', () => {
    const text = [
      verdict({ ruling: 'PASS', rubric_vara_ct_docs: 2, findings_vara_ct: 1 }),
      verdict({ ruling: 'PASS' }),
    ].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.legacyVaraCtDocs).toBe(1)
    expect(r.varaCtDocs).toBe(2)
    expect(r.legacyFindingsVaraCt).toBe(1)
    expect(r.findingsVaraCt).toBe(1)
  })

  it('if no verdict carries the columns, both figures are null and not 0', () => {
    const text = [verdict({ ruling: 'PASS' }), verdict({ ruling: 'FAIL' })].join('')
    const r = aggregateVerdictMeasures(text)
    expect(r.varaCtDocs).toBeNull()
    expect(r.findingsVaraCt).toBeNull()
    expect(r.legacyVaraCtDocs).toBe(2)
    expect(r.legacyFindingsVaraCt).toBe(2)
  })

  it("the yardstick's two columns carry counters SEPARATE from each other: a row can carry one and not the other", () => {
    const text = verdict({ ruling: 'PASS', rubric_vara_ct_docs: 4 })
    const r = aggregateVerdictMeasures(text)
    expect(r.measuredVaraCtDocs).toBe(1)
    expect(r.varaCtDocs).toBe(4)
    expect(r.legacyFindingsVaraCt).toBe(1)
    expect(r.findingsVaraCt).toBeNull()
  })

  it("the yardstick's counters are independent of rubric_sin_vara's: different birth dates", () => {
    const text = verdict({ ruling: 'PASS', rubric_sin_vara: 0 })
    const r = aggregateVerdictMeasures(text)
    expect(r.measured).toBe(1)
    expect(r.legacyVaraCtDocs).toBe(1)
    expect(r.varaCtDocs).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// MEASURE 2: whether the yardstick reached the brief, and how much it weighed.
// `briefCtYardstickMeasures` is PURE (it does not read disk: it receives the content
// already read) and counts `## Vara de ct: conventions/` headings — exactly what
// `PluginYardstick.composeSection` (scripts/plugin-yardstick.js) writes per
// document — instead of comparing against `PluginYardstick.FILES.length`, so
// that a fifth document tomorrow also counts without touching this function.
// ---------------------------------------------------------------------------
describe('briefCtYardstickMeasures — how many documents the brief carries and how much it weighs', () => {
  const brief = (docs) => [
    '# Task 1',
    '',
    'texto de la tarea',
    '',
    ...docs.flatMap((d) => [`## Vara de ct: conventions/${d}`, '', 'cuerpo del documento', '']),
  ].join('\n')

  it('it counts the four headings of today', () => {
    const content = brief(['code.md', 'decisions.md', 'architecture.md', 'testing.md'])
    expect(briefCtYardstickMeasures(content).brief_vara_ct_docs).toBe(4)
  })

  it("it does not depend on today's names: a fifth document is counted too", () => {
    const content = brief(['code.md', 'decisions.md', 'architecture.md', 'testing.md', 'naming.md'])
    expect(briefCtYardstickMeasures(content).brief_vara_ct_docs).toBe(5)
  })

  it('a brief with no heading at all counts zero, and it is a real zero: it could be measured', () => {
    expect(briefCtYardstickMeasures('# Task 1\n\nsin vara de ct por aquí\n').brief_vara_ct_docs).toBe(0)
  })

  it('it weighs the brief in bytes, not in characters — real UTF-8', () => {
    const withAccents = '## Vara de ct: conventions/code.md\ncondición, año, ñ\n'
    const { brief_bytes: bytes } = briefCtYardstickMeasures(withAccents)
    expect(bytes).toBe(Buffer.byteLength(withAccents, 'utf8'))
    expect(bytes).toBeGreaterThan(withAccents.length) // the accents weigh more than 1 byte
  })
})

describe('aggregateBriefMeasures — the reader of what the brief measured, brother of aggregateVerdictMeasures', () => {
  const attemptRow = (measures) => metricLine(metricRow({ ...IDENT, step: 'implement' }, measures, { now: NOW }))
  const anotherStep = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: NOW }))

  it('it sums docs and bytes of every implement attempt of the file', () => {
    const text = [
      attemptRow({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
      attemptRow({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 520 }),
    ].join('')
    const r = aggregateBriefMeasures(text)
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
    const text = [
      anotherStep('judge', { ruling: 'PASS', rubric_sin_vara: 0 }),
      anotherStep('controls', { outcome: 'done' }),
      anotherStep('commit', { outcome: 'done' }),
      attemptRow({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
    ].join('')
    expect(aggregateBriefMeasures(text).briefAttempts).toBe(1)
  })

  // THE RULE OF THIS FILE: a row without the field (telemetry predating this
  // measure, or an attempt in which the brief could not be read) does NOT count
  // as zero.
  it('a row predating the measure, or with the brief unread (null), counts as old and NOT as zero', () => {
    const text = [
      attemptRow({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }),
      attemptRow({ outcome: 'done' }), // old schema: without the two fields
      attemptRow({ outcome: 'discarded', brief_vara_ct_docs: null, brief_bytes: null }), // the brief could not be read
    ].join('')
    const r = aggregateBriefMeasures(text)
    expect(r.briefAttempts).toBe(3)
    expect(r.briefMeasured).toBe(1)
    expect(r.briefLegacy).toBe(2)
    expect(r.briefVaraCtDocs).toBe(4)
  })

  it('if no attempt carries the column, briefVaraCtDocs and briefBytes are null and not 0', () => {
    const text = [attemptRow({ outcome: 'done' }), attemptRow({ outcome: 'discarded' })].join('')
    const r = aggregateBriefMeasures(text)
    expect(r.briefVaraCtDocs).toBeNull()
    expect(r.briefBytes).toBeNull()
    expect(r.briefLegacy).toBe(2)
  })

  it('a brief with zero documents (genuinely broken) is summed as the zero it is: it is not confused with "unmeasured"', () => {
    const text = attemptRow({ outcome: 'done', brief_vara_ct_docs: 0, brief_bytes: 40 })
    const r = aggregateBriefMeasures(text)
    expect(r.briefMeasured).toBe(1)
    expect(r.briefVaraCtDocs).toBe(0)
  })

  it('an empty file does not blow up and asserts nothing', () => {
    for (const empty of ['', undefined]) {
      expect(aggregateBriefMeasures(empty)).toEqual({
        briefAttempts: 0, briefMeasured: 0, briefLegacy: 0, briefVaraCtDocs: null, briefBytes: null,
      })
    }
  })

  it('an unreadable line does not blow up the aggregator', () => {
    const text = [attemptRow({ outcome: 'done', brief_vara_ct_docs: 4, brief_bytes: 500 }), '{no es json\n'].join('')
    expect(() => aggregateBriefMeasures(text)).not.toThrow()
    expect(aggregateBriefMeasures(text).briefAttempts).toBe(1)
  })
})

// #92 — the reader of the three fields `RoleBytes` writes. Third brother of the
// other two aggregators, and for the same reason: the columns travelled in the
// pull request and with no reader of their own nobody would look at them.
describe('aggregateRoleBytesMeasures — how much fixed material each role of the slice read', () => {
  const roleRow = (step, measures) => metricLine(metricRow({ ...IDENT, step }, measures, { now: NOW }))
  const bytes = (agent, skill, packageBytes) => ({ agent_bytes: agent, skill_bytes: skill, package_bytes: packageBytes })

  it('it sums the three sizes of every dispatched role, whatever the step', () => {
    const text = [
      roleRow('implement', { outcome: 'done', ...bytes(100, 50, 900) }),
      roleRow('judge', { ruling: 'PASS', ...bytes(5000, 50, 300) }),
      roleRow('slice-judge', { ruling: 'PASS', ...bytes(3000, 0, 400) }),
      roleRow('reconcile', { outcome: 'conflicting', ...bytes(2000, 0, 100) }),
    ].join('')
    const r = aggregateRoleBytesMeasures(text)
    expect(r.roleAttempts).toBe(4)
    expect(r.roleMeasured).toBe(4)
    expect(r.roleLegacy).toBe(0)
    expect(r.agentBytes).toBe(10100)
    expect(r.skillBytes).toBe(100)
    expect(r.packageBytes).toBe(1700)
  })

  it('the steps that dispatch nobody —controls, commit, global— do not enter the count', () => {
    const text = [
      roleRow('controls', { outcome: 'done', duration_ms: 3 }),
      roleRow('commit', { outcome: 'done' }),
      roleRow('global', { outcome: 'done' }),
      roleRow('judge', { ruling: 'PASS', ...bytes(5000, 50, 300) }),
    ].join('')
    expect(aggregateRoleBytesMeasures(text).roleAttempts).toBe(1)
  })

  it('an implement attempt predating the measure counts as old and NOT as zero', () => {
    const text = [
      roleRow('implement', { outcome: 'done', ...bytes(100, 50, 900) }),
      roleRow('implement', { outcome: 'done', brief_bytes: 900 }),
    ].join('')
    const r = aggregateRoleBytesMeasures(text)
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
    const text = [
      roleRow('judge', { outcome: 'discarded', why: 'el packageBytes no existe' }),
      roleRow('slice-judge', { outcome: 'discarded', why: 'token ajeno' }),
    ].join('')
    const r = aggregateRoleBytesMeasures(text)
    expect(r.roleAttempts).toBe(0)
    expect(r.roleLegacy).toBe(0)
  })

  // A reconcile round with no package written is a round in which nobody
  // dispatched `ct-reconciler`. Counting it as old would inflate the denominator
  // with calls to the model that were never made.
  it('a reconcile round that dispatched nobody does not count as an unmeasured role', () => {
    const text = roleRow('reconcile', { outcome: 'up-to-date', files: [] })
    const r = aggregateRoleBytesMeasures(text)
    expect(r.roleAttempts).toBe(0)
    expect(r.roleLegacy).toBe(0)
  })

  it('a role that is ordered no skill sums the zero it is, and is not confused with unmeasured', () => {
    const text = roleRow('slice-judge', { ruling: 'PASS', ...bytes(3000, 0, 400) })
    const r = aggregateRoleBytesMeasures(text)
    expect(r.roleMeasured).toBe(1)
    expect(r.skillBytes).toBe(0)
  })

  it('if no role carries the columns, the three sums are null and not 0', () => {
    const text = roleRow('implement', { outcome: 'done', brief_bytes: 900 })
    expect(aggregateRoleBytesMeasures(text)).toEqual({
      roleAttempts: 1, roleMeasured: 0, roleLegacy: 1, agentBytes: null, skillBytes: null, packageBytes: null,
    })
  })

  it('an empty file does not blow up and asserts nothing', () => {
    for (const empty of ['', undefined]) {
      expect(aggregateRoleBytesMeasures(empty)).toEqual({
        roleAttempts: 0, roleMeasured: 0, roleLegacy: 0, agentBytes: null, skillBytes: null, packageBytes: null,
      })
    }
  })

  it('an unreadable line does not blow up the aggregator', () => {
    const text = [roleRow('judge', { ruling: 'PASS', ...bytes(5000, 50, 300) }), '{no es json\n'].join('')
    expect(() => aggregateRoleBytesMeasures(text)).not.toThrow()
    expect(aggregateRoleBytesMeasures(text).roleAttempts).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// implementer_email and tool_account_email — the slice's identity aggregates.
// Both reuse IdentityCollapse (one value, `(mixed)`, or none), the same rule
// ToolUsageTotal already applies to `tool`/`tool_version`. `actor` never
// carries `null` — metricRow normalizes an absent actor to NO_ACTOR_KEY — so
// that sentinel is the blank the collapse drops, exactly like `null` is the
// blank for `tool_account_email`.
// ---------------------------------------------------------------------------
describe('aggregateIdentityMeasures — who implemented the slice, and whose tool account ran it', () => {
  const attemptRow = (measures) => metricLine(metricRow({ ...IDENT, ...measures }, {}, { now: NOW }))
  const withToolAccountEmail = (actor, toolAccountEmail) => metricLine({
    ...metricRow({ ...IDENT, actor }, {}, { now: NOW }), tool_account_email: toolAccountEmail,
  })

  it('one_distinct_actor_across_every_row_lands_as_the_implementer_email', () => {
    const text = [attemptRow({ actor: 'a@mercadona.es' }), attemptRow({ actor: 'a@mercadona.es' })].join('')
    expect(aggregateIdentityMeasures(text).implementerEmail).toBe('a@mercadona.es')
  })

  it('two_distinct_actors_collapse_to_mixed', () => {
    const text = [attemptRow({ actor: 'a@mercadona.es' }), attemptRow({ actor: 'b@mercadona.es' })].join('')
    expect(aggregateIdentityMeasures(text).implementerEmail).toBe('(mixed)')
  })

  it('the_sin_actor_sentinel_counts_as_no_signal_and_never_as_a_third_actor', () => {
    const text = [attemptRow({ actor: 'a@mercadona.es' }), attemptRow({ actor: NO_ACTOR_KEY })].join('')
    expect(aggregateIdentityMeasures(text).implementerEmail).toBe('a@mercadona.es')
  })

  it('no_row_carrying_a_real_actor_lands_null_and_not_the_sentinel', () => {
    const text = [attemptRow({ actor: NO_ACTOR_KEY }), attemptRow({ actor: NO_ACTOR_KEY })].join('')
    expect(aggregateIdentityMeasures(text).implementerEmail).toBeNull()
  })

  it('one_distinct_tool_account_email_across_every_row_lands_as_the_tool_account_email', () => {
    const text = [withToolAccountEmail('a@mercadona.es', 't@mercadona.es'), withToolAccountEmail('a@mercadona.es', 't@mercadona.es')].join('')
    expect(aggregateIdentityMeasures(text).toolAccountEmail).toBe('t@mercadona.es')
  })

  it('two_distinct_tool_account_emails_collapse_to_mixed', () => {
    const text = [withToolAccountEmail('a@mercadona.es', 't1@mercadona.es'), withToolAccountEmail('a@mercadona.es', 't2@mercadona.es')].join('')
    expect(aggregateIdentityMeasures(text).toolAccountEmail).toBe('(mixed)')
  })

  it('a_null_tool_account_email_is_no_signal_and_never_a_third_value', () => {
    const text = [withToolAccountEmail('a@mercadona.es', 't@mercadona.es'), withToolAccountEmail('a@mercadona.es', null)].join('')
    expect(aggregateIdentityMeasures(text).toolAccountEmail).toBe('t@mercadona.es')
  })

  it('no_row_carrying_a_tool_account_email_lands_null', () => {
    const text = [withToolAccountEmail('a@mercadona.es', null), attemptRow({ actor: 'a@mercadona.es' })].join('')
    expect(aggregateIdentityMeasures(text).toolAccountEmail).toBeNull()
  })

  it('an_unreadable_line_does_not_blow_up_the_aggregator', () => {
    const text = [attemptRow({ actor: 'a@mercadona.es' }), '{no es json\n'].join('')
    expect(() => aggregateIdentityMeasures(text)).not.toThrow()
    expect(aggregateIdentityMeasures(text).implementerEmail).toBe('a@mercadona.es')
  })

  it('an_empty_file_does_not_blow_up_and_asserts_nothing', () => {
    for (const empty of ['', undefined]) {
      expect(aggregateIdentityMeasures(empty)).toEqual({ implementerEmail: null, toolAccountEmail: null })
    }
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

  let repo, homeDir

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'ct-metrics-'))
    homeDir = mkdtempSync(join(tmpdir(), 'ct-casa-'))
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
    rmSync(homeDir, { recursive: true, force: true })
  })

  const spawnCtStep = (env, ...args) => spawnSync('node', [SCRIPT, ...args, '--plan', 'plan.md', '--issue', '7'], {
    cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env,
  })
  const ct = (configDir, ...args) => spawnCtStep({ ...process.env, CLAUDE_CONFIG_DIR: configDir }, ...args)

  it('the row carries the complete identity, with the seeded epic and the hash of the plan', () => {
    const r = ct(homeDir, 'report', 'report.json')
    expect(r.status).toBe(0)
    const rows = readFileSync(join(homeDir, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(rows).toHaveLength(1)
    const f = rows[0]
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
    const blockedDir = join(homeDir, 'bloqueado')
    writeFileSync(blockedDir, 'no soy un directorio\n')
    const r = ct(blockedDir, 'report', 'report.json')
    expect(r.status).toBe(0)                            // the same code as with telemetry
    expect(r.stdout).toMatch(/staged 1 file/)     // and the step was applied all the same
    expect(r.stderr).toMatch(/the telemetry could not be written/)
    // The transition was saved: the measure decides nothing.
    expect(JSON.parse(readFileSync(join(repo, '.agent', 'run-7.json'), 'utf8')).step).toBe('controls')
  })

  // MEASURE 2 against the real oracle: `ct-step next` writes the REAL brief to
  // disk (with the plugin's ct yardstick pasted in by `writeBrief`), and
  // `ct-step report` measures it by reading exactly that path.
  it('if the brief reached disk, the row counts its ct yardstick documents and its weight', () => {
    const n = ct(homeDir, 'next')
    expect(n.status).toBe(0)
    const r = ct(homeDir, 'report', 'report.json')
    expect(r.status).toBe(0)
    const rows = readFileSync(join(homeDir, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const f = rows[0]
    // The plugin's conventions/ documents, counted by heading and not by
    // comparing against PluginYardstick.FILES.length. That is why neither the
    // fifth (defects.md, when code.md was split) nor the ones that arrived
    // afterwards forced anyone to touch briefCtYardstickMeasures.
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
    const r = ct(homeDir, 'report', 'report.json')
    expect(r.status).toBe(0)
    const rows = readFileSync(join(homeDir, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    const f = rows[0]
    expect(f.brief_vara_ct_docs).toBeNull()
    expect(f.brief_bytes).toBeNull()
  })

  // tool_account_email — read from <CLAUDE_CONFIG_DIR>/.claude.json, never
  // from the ~/.claude/ directory the transcript lives under: the two are
  // separate roots and only CLAUDE_CONFIG_DIR (the same variable `ct()`
  // already sets for every other test in this file) decides both.
  it('the row carries tool_account_email read from oauthAccount.emailAddress in <CLAUDE_CONFIG_DIR>/.claude.json', () => {
    writeFileSync(join(homeDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'dev@mercadona.es' } }))
    const r = spawnCtStep({ ...process.env, CLAUDE_CONFIG_DIR: homeDir, CLAUDECODE: '1' }, 'report', 'report.json')
    expect(r.status).toBe(0)
    const rows = readFileSync(join(homeDir, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(rows[0].tool_account_email).toBe('dev@mercadona.es')
  })

  it('outside Claude Code the field lands null even with a readable oauthAccount.emailAddress', () => {
    writeFileSync(join(homeDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'dev@mercadona.es' } }))
    const env = { ...process.env, CLAUDE_CONFIG_DIR: homeDir }
    delete env.CLAUDECODE
    delete env.CLAUDE_CODE_SESSION_ID
    const r = spawnCtStep(env, 'report', 'report.json')
    expect(r.status).toBe(0)
    const rows = readFileSync(join(homeDir, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(rows[0].tool_account_email).toBeNull()
  })

  it('with no .claude.json the field lands null and the step still succeeds', () => {
    const r = ct(homeDir, 'report', 'report.json')
    expect(r.status).toBe(0)
    const rows = readFileSync(join(homeDir, 'control-tower', 'log', 'ct-step.jsonl'), 'utf8')
      .trim().split('\n').map((l) => JSON.parse(l))
    expect(rows[0].tool_account_email).toBeNull()
  })
})
