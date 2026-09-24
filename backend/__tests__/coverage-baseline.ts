import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export type Tally = {
  readonly covered: number,
  readonly total: number,
}

export type FileCoverage = {
  readonly lines: Tally,
  readonly branches: Tally,
}

export type Exclusion = {
  readonly file: string,
  readonly from: string | null,
  readonly reason: string,
}

type RawLocation = {
  readonly start: { readonly line: number },
}

type RawFileCoverage = {
  readonly statementMap: Record<string, RawLocation>,
  readonly s: Record<string, number>,
  readonly branchMap: Record<string, { readonly locations: readonly RawLocation[] }>,
  readonly b: Record<string, readonly number[]>,
}

type RawCoverageReport = Record<string, RawFileCoverage>

type Baseline = {
  readonly instrument: string,
  readonly files: Record<string, FileCoverage>,
}

export class BaselineExists extends Error {}

export class CoverageBaseline {
  static readonly REPORT = 'node_modules/.cache/coverage/coverage-final.json'
  static readonly BASELINE = 'coverage-baseline.json'
  static readonly INSTRUMENT = 'c8 over vitest run, with the children counted'
  static readonly #BACKEND_MARKER = '/backend/'

  static readonly EXCLUDED: readonly Exclusion[] = [
    {
      file: 'src/infrastructure/process-border.ts',
      from: null,
      reason: 'the declared border of every process this backend starts, logic-free and never covered',
    },
    {
      file: 'src/infrastructure/ct-api.ts',
      from: 'await CtApi.run(',
      reason: 'the line that boots the program runs once outside any test',
    },
    {
      file: 'src/infrastructure/headless-call-worker.ts',
      from: '  static async main(',
      reason: "the worker's own entrypoint, spawned as a detached child and never covered in process",
    },
  ]

  static measured(report: RawCoverageReport, sourceOf: (file: string) => string): Record<string, FileCoverage> {
    const files: Record<string, FileCoverage> = {}
    for (const [absolute, data] of Object.entries(report)) {
      const file = CoverageBaseline.#keyOf(absolute)
      const exclusion = CoverageBaseline.EXCLUDED.find((entry) => entry.file === file)
      if (exclusion !== undefined && exclusion.from === null) continue
      const cutoff = exclusion === undefined || exclusion.from === null
        ? null
        : CoverageBaseline.#cutoffLine(sourceOf(file), exclusion.from)
      files[file] = {
        lines: CoverageBaseline.#lineTally(data, cutoff),
        branches: CoverageBaseline.#branchTally(data, cutoff),
      }
    }
    return files
  }

  static dropsAgainst(baseline: Baseline, measured: Record<string, FileCoverage>): string[] {
    return Object.entries(baseline.files).flatMap(([file, expected]) => {
      const found = measured[file]
      if (found === undefined) return [`${file} is in the baseline and the report no longer holds it`]

      return CoverageBaseline.#lineDropOf(file, expected.lines, found.lines)
    })
  }

  static branchDifferences(baseline: Baseline, measured: Record<string, FileCoverage>): string[] {
    return Object.entries(baseline.files).flatMap(([file, expected]) => {
      const found = measured[file]
      if (found === undefined) return []

      return CoverageBaseline.#branchDifferenceOf(file, expected.branches, found.branches)
    })
  }

  static write(path: string, measured: Record<string, FileCoverage>): void {
    if (existsSync(path)) throw new BaselineExists(`${path} already exists; delete it before writing a new baseline`)
    const baseline: Baseline = { instrument: CoverageBaseline.INSTRUMENT, files: CoverageBaseline.#sorted(measured) }
    writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`)
  }

  static main(argv: readonly string[]): void {
    const verb = argv[0]
    const report: RawCoverageReport = JSON.parse(readFileSync(CoverageBaseline.REPORT, 'utf8'))
    const measured = CoverageBaseline.measured(report, (file) => readFileSync(file, 'utf8'))
    if (verb === 'write') {
      CoverageBaseline.write(CoverageBaseline.BASELINE, measured)
      return
    }
    if (verb === 'compare') {
      const baseline: Baseline = JSON.parse(readFileSync(CoverageBaseline.BASELINE, 'utf8'))
      const differences = CoverageBaseline.branchDifferences(baseline, measured)
      if (differences.length > 0) process.stdout.write(`${differences.join('\n')}\n`)
      const drops = CoverageBaseline.dropsAgainst(baseline, measured)
      if (drops.length > 0) {
        process.stderr.write(`${drops.join('\n')}\n`)
        process.exitCode = 1
      }
      return
    }
    throw new Error(`unknown coverage verb: ${String(verb)}`)
  }

  static #lineDropOf(file: string, baseline: Tally, current: Tally): string[] {
    return current.covered < baseline.covered
      ? [`${file} lines covered dropped from ${baseline.covered} to ${current.covered}`]
      : []
  }

  static #branchDifferenceOf(file: string, baseline: Tally, current: Tally): string[] {
    return baseline.covered !== current.covered || baseline.total !== current.total
      ? [`${file} branches changed from ${baseline.covered}/${baseline.total} to ${current.covered}/${current.total}`]
      : []
  }

  static #sorted(measured: Record<string, FileCoverage>): Record<string, FileCoverage> {
    const sorted: Record<string, FileCoverage> = {}
    for (const file of Object.keys(measured).sort()) sorted[file] = measured[file]
    return sorted
  }

  static #keyOf(absolute: string): string {
    const at = absolute.lastIndexOf(CoverageBaseline.#BACKEND_MARKER)
    if (at === -1) throw new Error(`${absolute} does not sit under a backend/ directory`)
    return absolute.slice(at + CoverageBaseline.#BACKEND_MARKER.length)
  }

  static #cutoffLine(source: string, marker: string): number {
    const lines = source.split('\n')
    const at = lines.findIndex((line) => line.includes(marker))
    return at === -1 ? Number.POSITIVE_INFINITY : at + 1
  }

  static #lineTally(data: RawFileCoverage, cutoff: number | null): Tally {
    const byLine = new Map<number, boolean>()
    for (const [id, statement] of Object.entries(data.statementMap)) {
      const line = statement.start.line
      if (cutoff !== null && line >= cutoff) continue
      byLine.set(line, (byLine.get(line) ?? false) || (data.s[id] ?? 0) > 0)
    }
    return { covered: [...byLine.values()].filter(Boolean).length, total: byLine.size }
  }

  static #branchTally(data: RawFileCoverage, cutoff: number | null): Tally {
    let total = 0
    let covered = 0
    for (const [id, branch] of Object.entries(data.branchMap)) {
      const hits = data.b[id] ?? []
      branch.locations.forEach((location, index) => {
        if (cutoff !== null && location.start.line >= cutoff) return
        total += 1
        if ((hits[index] ?? 0) > 0) covered += 1
      })
    }
    return { covered, total }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    CoverageBaseline.main(process.argv.slice(2))
  } catch (cause) {
    process.stderr.write(`${String(cause)}\n`)
    process.exitCode = 1
  }
}
