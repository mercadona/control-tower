import type { InspectionBudget } from '../domain/value-objects/inspection-budget.ts'
import { ProcessOutput } from './tool-runner.ts'

type Command = (bin: string, argv: string[], cwd: string, budgetMs: number) => Promise<ProcessOutput>

export class InspectionCommands {
  readonly #run: Command
  readonly #now: () => number

  constructor({ run, now }: { run: Command, now: () => number }) {
    this.#run = run
    this.#now = now
  }

  ask(bin: string, argv: string[], root: string, budget: InspectionBudget): Promise<ProcessOutput> {
    const remaining = budget.allowanceAt(this.#now())
    return remaining === 0
      ? Promise.resolve(new ProcessOutput({ code: 124, stdout: '', stderr: '' }))
      : this.#run(bin, argv, root, remaining)
  }
}
