import type { EpicIssue } from './epic-issue.ts'

export class EpicIssuesListing {
  readonly issues: readonly EpicIssue[]
  readonly exhausted: boolean
  readonly reason: string | null

  constructor({ issues, exhausted, reason }: {
    issues: readonly EpicIssue[], exhausted: boolean, reason: string | null,
  }) {
    if (exhausted && reason !== null) {
      throw new Error(`an exhausted listing carries no reason, got ${JSON.stringify(reason)}`)
    }
    if (!exhausted && reason === null) {
      throw new Error('a listing that could not be exhausted must carry, in words, the reason it could not be')
    }
    this.issues = Object.freeze([...issues])
    this.exhausted = exhausted
    this.reason = reason
    Object.freeze(this)
  }
}
