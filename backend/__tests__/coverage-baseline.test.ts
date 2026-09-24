import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BaselineExists, CoverageBaseline } from './coverage-baseline.ts'
import type { FileCoverage, Tally } from './coverage-baseline.ts'

class Coverage {
  static of(lines: Tally, branches: Tally): FileCoverage {
    return { lines, branches }
  }

  static full(lines: number, branches: number): FileCoverage {
    return Coverage.of({ covered: lines, total: lines }, { covered: branches, total: branches })
  }
}

type RawEntry = {
  statementMap: Record<string, { start: { line: number } }>,
  s: Record<string, number>,
  branchMap: Record<string, { locations: readonly { start: { line: number } }[] }>,
  b: Record<string, readonly number[]>,
}

class RawFile {
  static withStatements(...statements: readonly (readonly [line: number, hit: boolean])[]): RawEntry {
    const statementMap: Record<string, { start: { line: number } }> = {}
    const s: Record<string, number> = {}
    statements.forEach(([line, hit], index) => {
      statementMap[String(index)] = { start: { line } }
      s[String(index)] = hit ? 1 : 0
    })
    return { statementMap, s, branchMap: {}, b: {} }
  }
}

class TemporaryDirectory {
  static make(): string {
    return mkdtempSync(join(tmpdir(), 'coverage-baseline-'))
  }
}

describe('a per-file line and branch ratio measures against the last baseline', () => {
  it('a_file_whose_line_ratio_falls_below_its_baseline_is_a_drop_and_an_equal_ratio_is_not', () => {
    const baseline = { instrument: 'test', files: { 'src/a.ts': Coverage.full(2, 0) } }

    const dropped = CoverageBaseline.dropsAgainst(baseline, {
      'src/a.ts': Coverage.of({ covered: 1, total: 2 }, { covered: 0, total: 0 }),
    })
    const steady = CoverageBaseline.dropsAgainst(baseline, { 'src/a.ts': Coverage.full(2, 0) })

    expect(dropped).toEqual(['src/a.ts lines ratio dropped from 1 to 0.5'])
    expect(steady).toEqual([])
  })

  it('a_branch_drop_is_named_even_when_every_line_holds', () => {
    const baseline = { instrument: 'test', files: { 'src/a.ts': Coverage.full(1, 2) } }

    const drops = CoverageBaseline.dropsAgainst(baseline, {
      'src/a.ts': Coverage.of({ covered: 1, total: 1 }, { covered: 1, total: 2 }),
    })

    expect(drops).toEqual(['src/a.ts branches ratio dropped from 1 to 0.5'])
  })

  it('a_baseline_file_the_report_no_longer_holds_is_named', () => {
    const baseline = { instrument: 'test', files: { 'src/gone.ts': Coverage.full(3, 1) } }

    expect(CoverageBaseline.dropsAgainst(baseline, {})).toEqual([
      'src/gone.ts is in the baseline and the report no longer holds it',
    ])
  })

  it('the_border_is_absent_and_the_entrypoint_lines_do_not_count', () => {
    const report = {
      '/repo/backend/src/infrastructure/process-border.ts': RawFile.withStatements([1, true]),
      '/repo/backend/src/infrastructure/ct-api.ts': RawFile.withStatements([1, true], [3, true], [4, false]),
    }
    const source: Record<string, string> = {
      'src/infrastructure/ct-api.ts': 'const a = 1\nconst b = 2\nawait CtApi.run(x)\nconst c = 3\n',
    }

    const measured = CoverageBaseline.measured(report, (file) => source[file])

    expect(measured['src/infrastructure/process-border.ts']).toBeUndefined()
    expect(measured['src/infrastructure/ct-api.ts']).toEqual({
      lines: { covered: 1, total: 1 },
      branches: { covered: 0, total: 0 },
    })
  })

  it('writing_over_an_existing_baseline_is_refused', () => {
    const directory = TemporaryDirectory.make()
    const path = join(directory, 'coverage-baseline.json')
    writeFileSync(path, '{}')

    try {
      expect(() => CoverageBaseline.write(path, {})).toThrow(BaselineExists)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
