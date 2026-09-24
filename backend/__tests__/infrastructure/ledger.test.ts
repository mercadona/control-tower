import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type LedgerRow = {
  text: string,
  line: number,
}

class LedgerRows {
  static readonly HEADER = '| Deleted case | Substitute |'
  static readonly SEPARATOR = '|---|---|'
  static readonly DELETED_WITHOUT_SUBSTITUTE = 'deleted without substitute — decided'
  static readonly CASE = /^`([^`]+) > ([^`]+)`$/

  readonly #headerLine: string | undefined
  readonly #separatorLine: string | undefined
  readonly #rows: readonly LedgerRow[]

  private constructor(headerLine: string | undefined, separatorLine: string | undefined, rows: readonly LedgerRow[]) {
    this.#headerLine = headerLine
    this.#separatorLine = separatorLine
    this.#rows = rows
  }

  static of(text: string): LedgerRows {
    const lines = text.split('\n')
    const headerIndex = lines.indexOf(LedgerRows.HEADER)
    if (headerIndex === -1) return new LedgerRows(undefined, undefined, [])

    const rows = lines
      .slice(headerIndex + 2)
      .map((rowText, offset) => ({ text: rowText, line: headerIndex + offset + 3 }))
      .filter((row) => row.text.trim().length > 0)

    return new LedgerRows(lines[headerIndex], lines[headerIndex + 1], rows)
  }

  header(): string | undefined {
    return this.#headerLine
  }

  separator(): string | undefined {
    return this.#separatorLine
  }

  malformed(): string[] {
    return this.#rows.flatMap((row) => LedgerRows.#problemsIn(row))
  }

  static #problemsIn(row: LedgerRow): string[] {
    const [caseCell, substituteCell] = LedgerRows.#cellsOf(row.text)
    const problems: string[] = []

    if (!LedgerRows.CASE.test(caseCell)) problems.push(`line ${row.line} names its case with no file or no test name`)
    if (!LedgerRows.#isValidSubstitute(substituteCell)) problems.push(`line ${row.line} names an empty substitute`)

    return problems
  }

  static #isValidSubstitute(cell: string): boolean {
    return cell === LedgerRows.DELETED_WITHOUT_SUBSTITUTE || LedgerRows.CASE.test(cell)
  }

  static #cellsOf(text: string): [string, string] {
    const match = /^\|\s*(.*?)\s*\|\s*(.*?)\s*\|$/.exec(text)
    return match === null ? [text, ''] : [match[1], match[2]]
  }
}

class LedgerText {
  static withRow(row: string): string {
    return [LedgerRows.HEADER, LedgerRows.SEPARATOR, row].join('\n')
  }
}

class Ledger {
  static readonly HERE = dirname(fileURLToPath(import.meta.url))
  static readonly PATH = join(Ledger.HERE, '..', '..', '..', 'docs', 'superpowers', 'ledgers', '2026-09-24-backend-without-processes.md')

  static text(): string {
    return readFileSync(Ledger.PATH, 'utf8')
  }
}

describe('the ledger names every deleted test case and its substitute', () => {
  it('the_ledger_exists_with_its_header_and_every_row_in_its_format', () => {
    const ledger = LedgerRows.of(Ledger.text())

    expect(ledger.header()).toBe(LedgerRows.HEADER)
    expect(ledger.separator()).toBe(LedgerRows.SEPARATOR)
    expect(ledger.malformed()).toEqual([])
  })

  it('a_row_whose_case_has_no_file_or_no_test_name_is_named_by_its_line', () => {
    const broken = LedgerRows.of(LedgerText.withRow('| `no-arrow-here` | `substitute.test.ts > kept_test` |'))

    expect(broken.malformed()).toEqual(['line 3 names its case with no file or no test name'])

    const fixed = LedgerRows.of(LedgerText.withRow(
      '| `deleted-elsewhere.test.ts > removed_test` | `substitute.test.ts > kept_test` |'
    ))

    expect(fixed.malformed()).toEqual([])
  })

  it('a_row_with_an_empty_substitute_is_named_by_its_line', () => {
    const rows = LedgerRows.of(LedgerText.withRow('| `deleted-elsewhere.test.ts > removed_test` |  |'))

    expect(rows.malformed()).toEqual(['line 3 names an empty substitute'])
  })

  it('deleted_without_substitute_decided_is_a_substitute_of_its_own', () => {
    const rows = LedgerRows.of(LedgerText.withRow(
      `| \`deleted-elsewhere.test.ts > removed_test\` | ${LedgerRows.DELETED_WITHOUT_SUBSTITUTE} |`
    ))

    expect(rows.malformed()).toEqual([])
  })
})
