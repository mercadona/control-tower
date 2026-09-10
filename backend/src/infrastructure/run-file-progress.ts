import { ImplementationProgress } from '../domain/ports/implementation-progress.ts'
import { ImplementationState, ImplementationStep } from '../domain/value-objects/implementation-state.ts'
import { ImplementationProgressNotRead } from '../domain/exceptions.ts'
import { GitWorkspace } from './git-workspace.ts'
import type { ImplementationStepValue } from '../domain/value-objects/implementation-state.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

type RunFile = {
  readonly plan: string,
  readonly step: ImplementationStepValue,
  readonly task: number,
  readonly tasksTotal: number,
  readonly controlRetries: number,
  readonly judgeRetries: number,
  readonly correctionRetries: number,
  readonly discards: number,
  readonly closed?: string,
}

class PlanTaskNames {
  static readonly HEADING = /^### Task (\d+) — (.*)$/
  static readonly FENCE = '```'

  static of(markdown: string): Map<number, string> {
    const names = new Map<number, string>()
    let inFence = false
    for (const line of String(markdown).split('\n')) {
      if (line.startsWith(PlanTaskNames.FENCE)) {
        inFence = !inFence
        continue
      }
      if (inFence) continue
      const matched = line.match(PlanTaskNames.HEADING)
      if (matched !== null) names.set(Number(matched[1]), matched[2].trim())
    }
    return names
  }
}

export class RunFileProgress extends ImplementationProgress {
  static readonly AGENT_DIRECTORY = '.agent'

  readonly read: (path: string) => Promise<string | null>
  readonly exists: (path: string) => Promise<boolean>

  constructor({ read, exists }: {
    read: (path: string) => Promise<string | null>,
    exists: (path: string) => Promise<boolean>,
  }) {
    super()
    this.read = read
    this.exists = exists
  }

  static worktreeFor(root: string, issue: number): string {
    return GitWorkspace.pathFor(root, { number: issue })
  }

  static runFileFor(root: string, issue: number): string {
    return `${RunFileProgress.worktreeFor(root, issue)}/${RunFileProgress.AGENT_DIRECTORY}/run-${issue}.json`
  }

  static attemptOf(run: RunFile): number {
    return run.controlRetries + run.judgeRetries + run.correctionRetries + 1
  }

  async of({ root, issue, repository }: {
    root: CheckoutRoot,
    issue: number,
    repository?: RepositoryName,
  }): Promise<ImplementationState> {
    const worktree = RunFileProgress.worktreeFor(root.text, issue)
    if (!(await this.exists(worktree))) {
      throw new ImplementationProgressNotRead(`the worktree ${worktree} is not there, so its run cannot be read`)
    }
    const path = RunFileProgress.runFileFor(root.text, issue)
    let text
    try {
      text = await this.read(path)
    } catch (cause) {
      throw new ImplementationProgressNotRead(`${path} could not be read: ${RunFileProgress.#messageOf(cause)}`)
    }
    if (text === null) return ImplementationState.starting()

    let run: unknown
    try {
      run = JSON.parse(text)
    } catch (cause) {
      throw new ImplementationProgressNotRead(`${path} could not be parsed as JSON: ${RunFileProgress.#messageOf(cause)}`)
    }
    if (!RunFileProgress.#holdsARun(run)) {
      throw new ImplementationProgressNotRead(`${path} did not hold a JSON object`)
    }

    if (run.closed === 'delivered') {
      return ImplementationState.of({
        step: ImplementationStep.DELIVERED, task: null, totalTasks: run.tasksTotal, name: null, attempt: null,
        discards: run.discards,
      })
    }

    const name = ImplementationState.TASKLESS.includes(run.step)
      ? null
      : await this.#taskName(worktree, run)

    return ImplementationState.of({
      step: run.step, task: run.task, totalTasks: run.tasksTotal, name,
      attempt: RunFileProgress.attemptOf(run), discards: run.discards,
    })
  }

  static #holdsARun(parsed: unknown): parsed is RunFile {
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  }

  static #messageOf(cause: unknown): string | undefined {
    return (cause as Error).message
  }

  async #taskName(worktree: string, run: RunFile): Promise<string | null> {
    let planText
    try {
      planText = await this.read(`${worktree}/${run.plan}`)
    } catch {
      return null
    }
    if (planText === null) return null
    return PlanTaskNames.of(planText).get(run.task) ?? null
  }
}
