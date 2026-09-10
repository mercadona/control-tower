import { ExternalToolsClient } from 'app/external-tools/client'
import { METRICS_DELIVERY_VARIABLE } from 'app/external-tools/ExternalTools.types'

const DESTINATION = 'fixture-project:fixture_dataset.fixture_table'
const disabled = { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null }
const enabled = { enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: DESTINATION }
const gh = { tool: 'gh', installed: true, session: 'ready', fix: null }

const answering = (body: unknown) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body)))

describe('ExternalToolsClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the external-tools survey from its dedicated endpoint', async () => {
    const fetching = answering({ ready: true, tools: [gh], metricsDelivery: disabled })
    vi.stubGlobal('fetch', fetching)

    await expect(ExternalToolsClient.get()).resolves.toEqual({
      kind: 'surveyed',
      ready: true,
      tools: [gh],
      metricsDelivery: disabled,
    })
    expect(fetching).toHaveBeenCalledWith('/external-tools')
  })

  it('keeps the metrics destination the backend validated instead of deriving one', async () => {
    vi.stubGlobal('fetch', answering({ ready: true, tools: [gh], metricsDelivery: enabled }))

    const outcome = await ExternalToolsClient.get()

    expect(outcome).toEqual({ kind: 'surveyed', ready: true, tools: [gh], metricsDelivery: enabled })
  })

  it('trusts the ready the backend answered even when a tool session is not ready', async () => {
    const bq = { tool: 'bq', installed: true, session: 'missing', fix: 'gcloud auth login' }
    vi.stubGlobal('fetch', answering({ ready: true, tools: [gh, bq], metricsDelivery: disabled }))

    const outcome = await ExternalToolsClient.get()

    expect(outcome).toEqual({ kind: 'surveyed', ready: true, tools: [gh, bq], metricsDelivery: disabled })
  })

  it('treats an unreachable or malformed survey as unavailable', async () => {
    vi.stubGlobal('fetch', answering('{"ready":true,"tools":[]}'))

    await expect(ExternalToolsClient.get()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('refuses a survey with no metrics delivery instead of guessing that it is disabled', async () => {
    vi.stubGlobal('fetch', answering({ ready: true, tools: [gh] }))

    await expect(ExternalToolsClient.get()).resolves.toEqual({ kind: 'unavailable' })
  })

  it('refuses a metrics delivery whose enabled and destination disagree', async () => {
    for (const metricsDelivery of [
      { enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: null },
      { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: DESTINATION },
    ]) {
      vi.stubGlobal('fetch', answering({ ready: true, tools: [gh], metricsDelivery }))

      await expect(ExternalToolsClient.get()).resolves.toEqual({ kind: 'unavailable' })
    }
  })

  it('refuses a metrics delivery with an empty destination or an unnamed variable', async () => {
    for (const metricsDelivery of [
      { enabled: true, variable: 'CT_HARVEST_BQ_TABLE', destination: '' },
      { enabled: false, variable: '', destination: null },
      { enabled: false, variable: 'CT_HARVEST_BQ_TABLE' },
    ]) {
      vi.stubGlobal('fetch', answering({ ready: true, tools: [gh], metricsDelivery }))

      await expect(ExternalToolsClient.get()).resolves.toEqual({ kind: 'unavailable' })
    }
  })

  it('refuses a delivery that names a variable other than the one this contract fixes', async () => {
    for (const variable of ['CT_HARVEST_BQ_TABLE_V2', 'ct_harvest_bq_table', 'CT_API_PORT']) {
      vi.stubGlobal('fetch', answering({
        ready: true,
        tools: [gh],
        metricsDelivery: { enabled: false, variable, destination: null },
      }))

      await expect(ExternalToolsClient.get()).resolves.toEqual({ kind: 'unavailable' })
    }
  })

  it('the variable the client demands is the one the endpoint documents', async () => {
    vi.stubGlobal('fetch', answering({
      ready: true,
      tools: [gh],
      metricsDelivery: { enabled: false, variable: METRICS_DELIVERY_VARIABLE, destination: null },
    }))

    expect(METRICS_DELIVERY_VARIABLE).toBe('CT_HARVEST_BQ_TABLE')
    await expect(ExternalToolsClient.get()).resolves.toMatchObject({ kind: 'surveyed' })
  })

  it('refuses a survey whose ready is not a boolean', async () => {
    vi.stubGlobal('fetch', answering({ ready: 'yes', tools: [gh], metricsDelivery: disabled }))

    await expect(ExternalToolsClient.get()).resolves.toEqual({ kind: 'unavailable' })
  })
})
