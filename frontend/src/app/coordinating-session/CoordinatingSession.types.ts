export type Attention = {
  status: 'working' | 'waiting'
  question: string | null
}

export type LiveAsk = 'ready' | 'working' | 'awaiting-permission' | 'turn-not-finished'

export type LiveSessionRef = { id: string; name: string }

export type CoordinatingOperation = 'idle' | 'recovering' | 'opening' | 'closing' | 'close-failed'

export type ClosureError = { code: string; detail: string }

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
  | { kind: 'none'; operation: CoordinatingOperation }
  | {
      kind: 'live'
      operation: CoordinatingOperation
      target: string
      conversation: string
      repo: string
      root: string
      session: LiveSessionRef
      attention: Attention
      timeline: TimelineEvent[]
      closureError: ClosureError | null
    }
  | {
      kind: 'unresumable'; operation: CoordinatingOperation; target: string; conversation: string
      repo: string; root: string; detail: string; timeline: TimelineEvent[]; closureError: ClosureError | null
    }
  | {
      kind: 'ended'; operation: CoordinatingOperation; target: string; conversation: string
      repo: string; root: string; detail: string; timeline: TimelineEvent[]; closureError: ClosureError | null
    }
  | { kind: 'unavailable' }

export type OpenedCoordinatingSession = {
  target: string
  conversation: string
  repo: string
  root: string
  session: LiveSessionRef
}

export type OpenOutcome =
  | { kind: 'opened'; opened: OpenedCoordinatingSession }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }

export type CloseOutcome =
  | { kind: 'closed'; conversation: string; target: string }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
