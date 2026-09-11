import { describe, it, expect } from 'vitest'
import { ReadImplementationHistory, ReadImplementationHistoryParams } from '../../src/application/queries/read-implementation-history.ts'
import { ImplementationHistory } from '../../src/domain/ports/implementation-history.ts'
import { ImplementationHistoryEntry } from '../../src/domain/value-objects/implementation-history-entry.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { ImplementationHistoryNotRead } from '../../src/domain/exceptions.ts'

type HistoryAsked = { root: CheckoutRoot, issue: number, repository?: RepositoryName }

class ImplementationHistoryDouble extends ImplementationHistory {
  answer: ImplementationHistoryEntry[] | Error
  asked: HistoryAsked[]

  constructor(answer: ImplementationHistoryEntry[] | Error) {
    super()
    this.answer = answer
    this.asked = []
  }

  static answering(entries: ImplementationHistoryEntry[]): ImplementationHistoryDouble {
    return new ImplementationHistoryDouble(entries)
  }

  static refusing(cause: Error): ImplementationHistoryDouble {
    return new ImplementationHistoryDouble(cause)
  }

  async of(subject: HistoryAsked): Promise<ImplementationHistoryEntry[]> {
    this.asked.push(subject)
    if (this.answer instanceof Error) throw this.answer

    return this.answer
  }
}

class Flow {
  static ROOT = new CheckoutRoot('/checkout')
  static ISSUE = 298
  static REPOSITORY = new RepositoryName('owner/name')
  static ONE_STEP = [
    ImplementationHistoryEntry.of({
      step: 'implement', task: 1, taskName: 'the lookup looks where it says it looks', tasksTotal: 2,
      attempt: 1, outcome: 'done', writtenAt: '2026-09-10T14:55:59.885Z', durationMs: null, summary: 'Renamed ...',
    }),
  ]

  implementationHistory: ImplementationHistoryDouble

  constructor(implementationHistory: ImplementationHistoryDouble = ImplementationHistoryDouble.answering(Flow.ONE_STEP)) {
    this.implementationHistory = implementationHistory
  }

  async run(): Promise<ImplementationHistoryEntry[]> {
    const read = await new ReadImplementationHistory(this)
      .execute(new ReadImplementationHistoryParams({
        root: Flow.ROOT, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
      }))

    return read.entries
  }
}

describe('ReadImplementationHistory', () => {
  it('the_history_it_reads_is_asked_for_the_root_the_issue_and_the_repository', async () => {
    const flow = new Flow()

    await flow.run()

    expect(flow.implementationHistory.asked).toEqual([
      { root: Flow.ROOT, issue: Flow.ISSUE, repository: Flow.REPOSITORY },
    ])
  })

  it('the_entries_come_back_exactly_as_the_port_answered_them', async () => {
    const entries = await new Flow().run()

    expect(entries).toEqual(Flow.ONE_STEP)
  })

  it('no_entries_answers_an_empty_list_and_not_a_refusal', async () => {
    const entries = await new Flow(ImplementationHistoryDouble.answering([])).run()

    expect(entries).toEqual([])
  })

  it('a_history_that_could_not_be_read_travels_out_typed_instead_of_looking_empty', async () => {
    const flow = new Flow(ImplementationHistoryDouble.refusing(new ImplementationHistoryNotRead('no worktree')))

    await expect(flow.run()).rejects.toBeInstanceOf(ImplementationHistoryNotRead)
  })

  it('a_port_that_nobody_implemented_says_so_instead_of_answering_undefined', async () => {
    await expect(new ImplementationHistory().of({
      root: Flow.ROOT, issue: Flow.ISSUE, repository: Flow.REPOSITORY,
    })).rejects.toThrow(/must implement of/)
  })
})
