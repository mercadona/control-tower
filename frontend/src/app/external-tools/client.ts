import {
  ExternalToolsOutcome,
  METRICS_DELIVERY_VARIABLE,
  MetricsDelivery,
  SessionState,
  ToolSession,
} from 'app/external-tools/ExternalTools.types'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isTool = (value: unknown): value is ToolSession =>
  isRecord(value) &&
  typeof value.tool === 'string' &&
  typeof value.installed === 'boolean' &&
  Object.values(SessionState).includes(value.session as SessionState) &&
  (value.fix === null || typeof value.fix === 'string') &&
  (value.fix === null) === (value.session === SessionState.READY)

const isMetricsDelivery = (value: unknown): value is MetricsDelivery =>
  isRecord(value) &&
  typeof value.enabled === 'boolean' &&
  value.variable === METRICS_DELIVERY_VARIABLE &&
  (value.destination === null || (typeof value.destination === 'string' && value.destination.length > 0)) &&
  value.enabled === (value.destination !== null)

const get = async (): Promise<ExternalToolsOutcome> => {
  try {
    const response = await fetch('/external-tools')
    const body: unknown = response.ok ? await response.json() : null
    if (
      !isRecord(body) ||
      typeof body.ready !== 'boolean' ||
      !Array.isArray(body.tools) ||
      body.tools.length === 0 ||
      !body.tools.every(isTool) ||
      !isMetricsDelivery(body.metricsDelivery)
    ) {
      return { kind: 'unavailable' }
    }
    return {
      kind: 'surveyed',
      ready: body.ready,
      tools: body.tools,
      metricsDelivery: body.metricsDelivery,
    }
  } catch {
    return { kind: 'unavailable' }
  }
}

export const ExternalToolsClient = { get }
