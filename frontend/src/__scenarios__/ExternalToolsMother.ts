const DESTINATION = 'fixture-project:fixture_dataset.fixture_table'

const DELIVERY_DISABLED = { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null }
const DELIVERY_ENABLED = { enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: DESTINATION }

const GH_READY = { tool: 'gh', installed: true, session: 'ready', fix: null }
const BQ_READY = { tool: 'bq', installed: true, session: 'ready', fix: null }
const BQ_MISSING = { tool: 'bq', installed: true, session: 'missing', fix: 'gcloud auth login' }
const BQ_NOT_INSTALLED = { tool: 'bq', installed: false, session: 'missing', fix: 'instala bq' }
const CLAUDE_UNKNOWN = { tool: 'claude', installed: true, session: 'unknown', fix: null }

const bodyOf = (body: unknown) => ({ status: 200, body: JSON.stringify(body) })

const allReady = () => bodyOf({ ready: true, tools: [GH_READY], metricsDelivery: DELIVERY_DISABLED })

const oneMissing = () =>
  bodyOf({
    ready: false,
    tools: [{ tool: 'gh', installed: true, session: 'missing', fix: 'gh auth login' }, BQ_NOT_INSTALLED],
    metricsDelivery: DELIVERY_DISABLED,
  })

const unknownSession = () =>
  bodyOf({ ready: false, tools: [GH_READY, CLAUDE_UNKNOWN], metricsDelivery: DELIVERY_DISABLED })

const metricsDisabled = () => bodyOf({ ready: true, tools: [GH_READY, BQ_NOT_INSTALLED], metricsDelivery: DELIVERY_DISABLED })

const metricsActive = () => bodyOf({ ready: true, tools: [GH_READY, BQ_READY], metricsDelivery: DELIVERY_ENABLED })

const metricsBlocked = () => bodyOf({ ready: false, tools: [GH_READY, BQ_MISSING], metricsDelivery: DELIVERY_ENABLED })

export const ExternalToolsMother = {
  DESTINATION,
  allReady,
  oneMissing,
  unknownSession,
  metricsDisabled,
  metricsActive,
  metricsBlocked,
}
