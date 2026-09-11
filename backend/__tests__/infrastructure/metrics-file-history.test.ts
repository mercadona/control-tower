import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MetricsFileHistory } from '../../src/infrastructure/metrics-file-history.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { ImplementationHistoryNotRead } from '../../src/domain/exceptions.ts'

class Fixture {
  static HERE = dirname(fileURLToPath(import.meta.url))
  static REPOSITORY = join(Fixture.HERE, '..', '..', '..')
  static ISSUE_298 = readFileSync(
    join(Fixture.REPOSITORY, 'docs', 'superpowers', 'metrics', 'issue-298.jsonl'), 'utf8'
  )

  static ISSUE_296 = readFileSync(
    join(Fixture.HERE, '..', 'fixtures', 'metrics-issue-296.jsonl'), 'utf8'
  )
}

class MetricsFileDouble {
  static ROOT = new CheckoutRoot('/checkout')
  static ISSUE = 298
  static WORKTREE = '/checkout/.worktrees/298'
  static METRICS_FILE = '/checkout/.worktrees/298/docs/superpowers/metrics/issue-298.jsonl'

  readonly exists: boolean
  readonly text: string | null
  readonly readFails: Error | null
  readonly existsAsked: string[]
  readonly readAsked: string[]

  constructor({ exists = true, text = null, readFails = null }: {
    exists?: boolean,
    text?: string | null,
    readFails?: Error | null,
  } = {}) {
    this.exists = exists
    this.text = text
    this.readFails = readFails
    this.existsAsked = []
    this.readAsked = []
  }

  static missingWorktree() {
    return new MetricsFileDouble({ exists: false })
  }

  static withoutMetricsFile() {
    return new MetricsFileDouble({ text: null })
  }

  static withText(text: string) {
    return new MetricsFileDouble({ text })
  }

  static withUnreadableMetricsFile(cause = new Error('EACCES: permission denied')) {
    return new MetricsFileDouble({ readFails: cause })
  }

  history() {
    return new MetricsFileHistory({
      exists: async (path) => {
        this.existsAsked.push(path)
        return this.exists
      },
      read: async (path) => {
        this.readAsked.push(path)
        if (this.readFails !== null) throw this.readFails
        return this.text
      },
    })
  }

  asked() {
    return this.history().of({ root: MetricsFileDouble.ROOT, issue: MetricsFileDouble.ISSUE })
  }

  refusal() {
    return this.asked().catch((cause) => cause)
  }
}

describe('MetricsFileHistory', () => {
  it('a_worktree_that_is_not_there_is_a_history_that_could_not_be_read', async () => {
    const asked = MetricsFileDouble.missingWorktree()

    const refusal = await asked.refusal()

    expect(refusal).toBeInstanceOf(ImplementationHistoryNotRead)
    expect(refusal.message).toContain(MetricsFileDouble.WORKTREE)
    expect(asked.readAsked).toHaveLength(0)
  })

  it('a_worktree_with_no_metrics_file_yet_answers_no_entries', async () => {
    const asked = MetricsFileDouble.withoutMetricsFile()

    expect(await asked.asked()).toEqual([])
    expect(asked.existsAsked).toEqual([MetricsFileDouble.WORKTREE])
    expect(asked.readAsked).toEqual([MetricsFileDouble.METRICS_FILE])
  })

  it('every_well_formed_line_of_the_real_metrics_file_becomes_one_entry_in_file_order', async () => {
    const asked = MetricsFileDouble.withText(Fixture.ISSUE_298)

    const entries = await asked.asked()

    expect(entries).toHaveLength(11)
    expect(entries[0]).toMatchObject({
      step: 'implement', task: 1, taskName: 'the lookup looks where it says it looks', tasksTotal: 2,
      attempt: 1, outcome: 'done', writtenAt: '2026-09-10T14:55:59.885Z', durationMs: null,
      summary:
        "Renamed inIndex's local from ambito to scope so the pathspec's ...scope no longer throws a ReferenceError " +
        'swallowed by the catch, which was making every git grep --cached lookup silently answer false; added the ' +
        'two tests from the brief (14 total, all green) and confirmed both were red against the previous code for ' +
        'the stated reasons before the fix.',
    })
    expect(entries[1]).toMatchObject({ step: 'controls', durationMs: 138 })
    expect(entries.at(-1)).toMatchObject({
      step: 'slice-judge', task: null, taskName: null, tasksTotal: 2, attempt: 1, outcome: 'done', durationMs: null,
    })
  })

  it('a_judge_row_carries_its_ruling_and_findings_total_and_every_row_carries_its_tool_total_tokens', async () => {
    const history = new MetricsFileHistory({
      exists: async () => true,
      read: async () => Fixture.ISSUE_296,
    })

    const entries = await history.of({ root: new CheckoutRoot('/checkout'), issue: 296 })

    expect(entries).toHaveLength(11)
    const judgeEntry = entries.find((entry) => entry.step === 'judge')
    expect(judgeEntry).toMatchObject({ ruling: 'PASS', findingsTotal: 0, toolTotalTokens: 1172301 })
    const implementEntry = entries[0]
    expect(implementEntry).toMatchObject({ ruling: null, findingsTotal: null, toolTotalTokens: 4275995 })
  })

  it('a_line_that_is_not_json_collapses_naming_the_line_number', async () => {
    const asked = MetricsFileDouble.withText('{"step":"implement"}\nnot json\n')

    const refusal = await asked.refusal()

    expect(refusal).toBeInstanceOf(ImplementationHistoryNotRead)
    expect(refusal.message).toContain('line 2')
  })

  it('a_trailing_empty_line_is_ignored_and_not_counted_as_a_malformed_line', async () => {
    const asked = MetricsFileDouble.withText('{"step":"implement"}\n{"step":"controls"}\n')

    const entries = await asked.asked()

    expect(entries).toHaveLength(2)
  })

  it('a_json_array_is_not_a_row_either', async () => {
    const asked = MetricsFileDouble.withText('[1,2,3]')

    const refusal = await asked.refusal()

    expect(refusal).toBeInstanceOf(ImplementationHistoryNotRead)
    expect(refusal.message).toContain('line 1')
  })

  it('a_metrics_file_that_exists_but_cannot_be_read_is_a_history_that_could_not_be_read', async () => {
    const asked = MetricsFileDouble.withUnreadableMetricsFile()

    const refusal = await asked.refusal()

    expect(refusal).toBeInstanceOf(ImplementationHistoryNotRead)
    expect(refusal.message).toContain(MetricsFileDouble.METRICS_FILE)
  })

  it('the_path_inside_the_repository_comes_from_the_plugins_own_metricsRepoRelPath', () => {
    expect(MetricsFileHistory.metricsFileFor('/checkout', 298)).toBe(MetricsFileDouble.METRICS_FILE)
  })
})
