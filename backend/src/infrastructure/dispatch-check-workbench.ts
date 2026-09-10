import { Workbench } from '../domain/ports/workbench.ts'
import { SliceNotReopened, ReopenNotUnderstood } from '../domain/exceptions.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { ProcessOutput, ToolRunner } from './tool-runner.ts'

type ReopenProjection = (said: ProcessOutput, issueNumber: number) => void

export class DispatchCheckWorkbench extends Workbench {
  static readonly COMMAND = 'dispatch-check --reopen'
  static readonly #REOPENED = 0
  static readonly #LABEL_NOT_WRITTEN = 1
  static readonly #PRECONDITION_UNMET = 2
  static readonly #STATE_NOT_READ = 3

  static readonly #BY_CODE = Object.freeze<Record<number, ReopenProjection | undefined>>({
    [DispatchCheckWorkbench.#REOPENED]: () => undefined,
    [DispatchCheckWorkbench.#LABEL_NOT_WRITTEN]: (said, issueNumber) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} could not move the label of #${issueNumber}, which stays in review: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckWorkbench.#PRECONDITION_UNMET]: (said, issueNumber) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} refused to reopen #${issueNumber} and touched no label: ${said.stderr.trim()}`
      )
    },
    [DispatchCheckWorkbench.#STATE_NOT_READ]: (said, issueNumber) => {
      throw new SliceNotReopened(
        `${DispatchCheckWorkbench.COMMAND} could not read the state of #${issueNumber} and touched no label, so the next tick can try again: ${said.stderr.trim()}`
      )
    },
  })

  readonly node: ToolRunner['run']
  readonly dispatchCheck: string

  constructor({ node, dispatchCheck }: { node: ToolRunner['run'], dispatchCheck: string }) {
    super()
    this.node = node
    this.dispatchCheck = dispatchCheck
  }

  static #argvFor({ dispatchCheck, issueNumber, repository }: {
    dispatchCheck: string,
    issueNumber: number,
    repository: RepositoryName,
  }): string[] {
    return [dispatchCheck, String(issueNumber), '--repo', repository.text, '--reopen']
  }

  static declaredCodes(): number[] {
    return Object.keys(DispatchCheckWorkbench.#BY_CODE).map(Number)
  }

  async reopen({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): Promise<void> {
    const said = await this.node(
      DispatchCheckWorkbench.#argvFor({ dispatchCheck: this.dispatchCheck, issueNumber, repository })
    )
    const projected = DispatchCheckWorkbench.#BY_CODE[said.code]
    if (projected === undefined) {
      throw new ReopenNotUnderstood(
        `${DispatchCheckWorkbench.COMMAND} exited ${said.code} for #${issueNumber} and the reopen contract declares only ${DispatchCheckWorkbench.declaredCodes().join(', ')}: stdout ${JSON.stringify(said.stdout.trim())}, stderr ${JSON.stringify(said.stderr.trim())}`
      )
    }

    return projected(said, issueNumber)
  }
}
