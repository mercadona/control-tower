import { describe, expect, it, vi } from 'vitest'
import { CmuxPlanAgents } from '../../src/infrastructure/cmux-plan-agents.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { Deferred, ReviewWatchFixture } from '../fixtures/parallel-workflows.ts'

class PasteTerminal {
  static readonly INSTRUCTION = 'Review the existing plan carefully. '.repeat(200)
  readonly ready = new Deferred<void>()
  readonly submitted: string[] = []
  pending: string | null = null
  input: string | null = null
  readonly agents = new CmuxPlanAgents({
    run: async (argv: string[]) => {
      if (argv[0] === 'send') this.pending = argv[3]!
      if (argv[0] === 'send-key' && this.input !== null) {
        this.submitted.push(this.input)
        this.input = null
      }
      return { code: 0, failed: false, stdout: '', stderr: '' }
    },
    sleep: () => this.ready.promise,
    brief: {
      implementationErrandFor: () => PasteTerminal.INSTRUCTION,
      reviewErrandFor: () => PasteTerminal.INSTRUCTION,
      fixErrandFor: () => PasteTerminal.INSTRUCTION,
    },
    write: vi.fn(), read: vi.fn(), remove: vi.fn(),
    runsIn: '/unused', policy: null, realpathOf: (path: string) => path,
  })

  finishPaste(): void {
    this.input = this.pending
    this.pending = null
    this.ready.resolve()
  }
}

describe('Submitting an instruction to a terminal', () => {
  it.each(['resume', 'review', 'fix'] as const)('%s lets the terminal finish pasting before submitting', async (action) => {
    const terminal = new PasteTerminal()
    const submission = terminal.agents[action]({
      agent: 'workspace:6', issue: 55, repository: new RepositoryName('owner/alpha'), changes: 'Requested changes',
    })
    await ReviewWatchFixture.settle()
    expect(terminal.submitted).toEqual([])

    terminal.finishPaste()
    await submission

    expect(terminal.submitted).toEqual([PasteTerminal.INSTRUCTION])
  })
})
