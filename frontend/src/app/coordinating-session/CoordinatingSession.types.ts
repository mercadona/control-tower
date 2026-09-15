export type Attention = {
  status: 'working' | 'waiting'
  question: string | null
}

export type LiveSessionRef = { id: string; name: string }

export type TimelineEventKind =
  | 'opened'
  | 'resumed'
  | 'unresumable'
  | 'working'
  | 'waiting-for-permission'
  | 'completed'
  | 'ended'

export type TimelineEvent = {
  id: string
  kind: TimelineEventKind
  at: string
  detail: string | null
}

export type CoordinatingSessionOutcome =
  | { kind: 'none' }
  | {
      kind: 'live'
      conversation: string
      repo: string
      root: string
      session: LiveSessionRef
      attention: Attention
      timeline: TimelineEvent[]
    }
  | { kind: 'unresumable'; conversation: string; detail: string; timeline: TimelineEvent[] }
  | { kind: 'ended'; conversation: string; detail: string; timeline: TimelineEvent[] }
  | { kind: 'unavailable' }

export type OpenedCoordinatingSession = { conversation: string; session: LiveSessionRef }

export type OpenOutcome =
  | { kind: 'opened'; opened: OpenedCoordinatingSession }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
