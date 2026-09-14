export type Attention = {
  status: 'working' | 'waiting'
  question: string | null
}

export type LiveSessionRef = { id: string; name: string }

export type CoordinatingSessionOutcome =
  | { kind: 'none' }
  | {
      kind: 'live'
      conversation: string
      repo: string
      root: string
      session: LiveSessionRef
      attention: Attention
    }
  | { kind: 'unresumable'; conversation: string; detail: string }
  | { kind: 'ended'; conversation: string; detail: string }
  | { kind: 'unavailable' }

export type OpenedCoordinatingSession = { conversation: string; session: LiveSessionRef }

export type OpenOutcome =
  | { kind: 'opened'; opened: OpenedCoordinatingSession }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
