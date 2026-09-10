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

const METRICS_DELIVERY_TOOL = 'bq'
const METRICS_DELIVERY_VARIABLE = 'CT_HARVEST_BQ_TABLE'

type MetricsDelivery = {
  enabled: boolean
  variable: typeof METRICS_DELIVERY_VARIABLE
  destination: string | null
}

type ExternalToolsOutcome =
  | { kind: 'surveyed'; ready: boolean; tools: ToolSession[]; metricsDelivery: MetricsDelivery }
  | { kind: 'unavailable' }

export { METRICS_DELIVERY_TOOL, METRICS_DELIVERY_VARIABLE, SessionState }
export type { ExternalToolsOutcome, MetricsDelivery, ToolSession }
