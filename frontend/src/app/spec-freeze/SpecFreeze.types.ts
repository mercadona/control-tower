export type FreezeFinding = { code: string; line: number | null; detail: string | null }

export type PullRequestRef = { number: number; url: string }

export type SpecFreezeOutcome =
  | { kind: 'none' }
  | { kind: 'no-spec' }
  | { kind: 'draft'; spec: string; findings: FreezeFinding[]; key: string | null }
  | { kind: 'frozen'; spec: string; on: string; pullRequest: PullRequestRef | null }
  | { kind: 'unavailable' }

export type FreezeAskOutcome =
  | { kind: 'frozen'; on: string; pullRequest: PullRequestRef }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
