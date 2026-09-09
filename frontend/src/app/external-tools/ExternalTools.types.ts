const SessionState = Object.freeze({
  READY: 'ready',
  MISSING: 'missing',
  UNKNOWN: 'unknown',
} as const)

type SessionState = (typeof SessionState)[keyof typeof SessionState]

type ToolSession = {
  tool: string
  installed: boolean
  session: SessionState
  fix: string | null
}

type ExternalToolsOutcome =
  | { kind: 'surveyed'; tools: ToolSession[] }
  | { kind: 'unavailable' }

export { SessionState }
export type { ExternalToolsOutcome, ToolSession }
