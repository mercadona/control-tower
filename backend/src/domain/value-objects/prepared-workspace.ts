import type { WorkspaceLocation } from './workspace-location.ts'

export class PreparedWorkspace {
  readonly issueNumber: number
  readonly located: WorkspaceLocation

  constructor({ issueNumber, located }: { issueNumber: unknown, located: WorkspaceLocation }) {
    if (typeof issueNumber !== 'number' || !Number.isInteger(issueNumber) || issueNumber < 1) {
      throw new Error(
        `a prepared workspace belongs to an issue numbered from one, got ${JSON.stringify(issueNumber)}`
      )
    }
    this.issueNumber = issueNumber
    this.located = located
    Object.freeze(this)
  }
}
