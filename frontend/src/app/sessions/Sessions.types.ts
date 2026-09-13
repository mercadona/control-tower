export type LiveSession = { id: string; name: string }

export type SessionsOutcome =
  | { kind: 'loaded'; sessions: LiveSession[] }
  | { kind: 'unavailable' }

export type SessionFailure = { code: string; detail: string }

export type TypeOutcome =
  | { kind: 'typed' }
  | { kind: 'refused'; code: string; detail: string }
  | { kind: 'unreachable' }

export type SessionStreamListener = {
  onOpened: () => void
  onBytes: (bytes: string) => void
  onFailure: (failure: SessionFailure) => void
  onRefused: () => void
  onUnreachable: () => void
}

export type SessionStreamSubscription = { close: () => void }
