export type FreezeFinding = { code: string; line: number | null; detail: string | null }

export type PullRequestRef = { number: number; url: string }

export type SpecFreezeOutcome =
  | { kind: 'none' }
  | { kind: 'no-spec'; target: string | null }
  | { kind: 'draft'; target: string | null; spec: string; findings: FreezeFinding[]; key: string | null }
  | { kind: 'frozen'; target: string | null; spec: string; on: string | null; pullRequest: PullRequestRef | null }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unavailable' }

export type FreezeAskOutcome =
  | { kind: 'frozen'; on: string; pullRequest: PullRequestRef }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
