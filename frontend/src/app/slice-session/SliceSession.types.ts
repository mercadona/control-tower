type SliceMessageOutcome =
  | { kind: 'delivered' }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }

type SliceMessageAsked = { issue: number; repo: string; agent: string; text: string }

export type { SliceMessageAsked, SliceMessageOutcome }
