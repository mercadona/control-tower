export type LiveSession = { id: string; name: string }

export type SessionsOutcome =
  | { kind: 'loaded'; sessions: LiveSession[] }
  | { kind: 'unavailable' }

export type SessionFailure = { code: string; detail: string }

export type SessionStreamListener = {
  onBytes: (bytes: string) => void
  onFailure: (failure: SessionFailure) => void
  onUnreachable: () => void
}

export type SessionStreamSubscription = { close: () => void }
