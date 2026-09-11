import { render, screen, within } from '@testing-library/react'
import { ToolsStatus } from 'app/external-tools/components/tools-status'
import { ExternalTools } from 'app/external-tools/useExternalTools'

const DESTINATION = 'fixture-project:fixture_dataset.fixture_table'
const DELIVERY_DISABLED = { enabled: false, variable: 'CT_HARVEST_BQ_TABLE' as const, destination: null }
const DELIVERY_ENABLED = { enabled: true, variable: 'CT_HARVEST_BQ_TABLE' as const, destination: DESTINATION }

const GH_READY = { tool: 'gh', installed: true, session: 'ready' as const, fix: null }
const BQ_READY = { tool: 'bq', installed: true, session: 'ready' as const, fix: null }
const BQ_MISSING = { tool: 'bq', installed: true, session: 'missing' as const, fix: 'gcloud auth login' }
const BQ_NOT_INSTALLED = { tool: 'bq', installed: false, session: 'missing' as const, fix: 'instala bq' }
const CLAUDE_UNKNOWN = { tool: 'claude', installed: true, session: 'unknown' as const, fix: null }

const checking: ExternalTools = { phase: 'checking' }
const unknown: ExternalTools = { phase: 'unknown' }
const ready: ExternalTools = { phase: 'ready', tools: [GH_READY], metricsDelivery: DELIVERY_DISABLED }
const attention: ExternalTools = {
  phase: 'attention',
  tools: [{ tool: 'gh', installed: true, session: 'missing', fix: 'gh auth login' }, BQ_NOT_INSTALLED],
  metricsDelivery: DELIVERY_DISABLED,
}
const withUnknownSession: ExternalTools = {
  phase: 'attention',
  tools: [GH_READY, CLAUDE_UNKNOWN],
  metricsDelivery: DELIVERY_DISABLED,
}
const deliveryDisabled: ExternalTools = {
  phase: 'ready',
  tools: [GH_READY, BQ_NOT_INSTALLED],
  metricsDelivery: DELIVERY_DISABLED,
}
const deliveryActive: ExternalTools = {
  phase: 'ready',
  tools: [GH_READY, BQ_READY],
  metricsDelivery: DELIVERY_ENABLED,
}
const deliveryBlocked: ExternalTools = {
  phase: 'attention',
  tools: [GH_READY, BQ_MISSING],
  metricsDelivery: DELIVERY_ENABLED,
}

const list = () => screen.getByRole('list')

describe('ToolsStatus', () => {
  it('renders one row per tool with its status icon, name and detail', () => {
    render(<ToolsStatus tools={attention} />)

    const rows = within(list()).getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('gh')
    expect(rows[0]).toHaveTextContent('necesita iniciar sesión')
    expect(rows[1]).toHaveTextContent('bq')
    expect(rows[1]).toHaveTextContent('no está instalada')
  })

  it('gives a ready session the success icon with a visually hidden Spanish label', () => {
    render(<ToolsStatus tools={ready} />)

    const [row] = within(list()).getAllByRole('listitem')
    expect(row.querySelector('.tools-status__icon--ready')).toBeInTheDocument()
    expect(within(row).getByText('Lista')).toHaveClass('tools-status__visually-hidden')
  })

  it('gives a missing session the ko icon with a visually hidden Spanish label', () => {
    render(<ToolsStatus tools={attention} />)

    const [ghRow] = within(list()).getAllByRole('listitem')
    expect(ghRow.querySelector('.tools-status__icon--missing')).toBeInTheDocument()
    expect(within(ghRow).getByText('Falta')).toHaveClass('tools-status__visually-hidden')
  })

  it('gives an unknown session the warning icon with a visually hidden Spanish label', () => {
    render(<ToolsStatus tools={withUnknownSession} />)

    const rows = within(list()).getAllByRole('listitem')
    const claudeRow = rows.find((row) => row.textContent?.includes('claude'))
    expect(claudeRow?.querySelector('.tools-status__icon--unknown')).toBeInTheDocument()
    expect(within(claudeRow!).getByText('Desconocida')).toHaveClass('tools-status__visually-hidden')
  })

  it('does not present an unneeded bq as a general blocking error while delivery is disabled', () => {
    render(<ToolsStatus tools={deliveryDisabled} />)

    expect(list()).toHaveTextContent('opcional: solo hace falta si activas la entrega de métricas')
    expect(list()).not.toHaveTextContent('instala bq')
  })

  it('shows the checking message while the survey is in flight', () => {
    render(<ToolsStatus tools={checking} />)

    expect(screen.getByText('Consultando disponibilidad y sesión de cada herramienta.')).toHaveAttribute('role', 'status')
  })

  it('shows the unavailable message when the backend could not be reached', () => {
    render(<ToolsStatus tools={unknown} />)

    expect(screen.getByText('No se pudo contactar con el backend para comprobar las herramientas.')).toBeInTheDocument()
  })
})

describe('ToolsStatus — the metrics delivery row', () => {
  it('renders the metrics delivery as a row of the list, with the informative icon', () => {
    render(<ToolsStatus tools={ready} />)

    const rows = within(list()).getAllByRole('listitem')
    const metricsRow = rows[rows.length - 1]
    expect(metricsRow).toHaveTextContent('Entrega de métricas')
    expect(metricsRow.querySelector('.tools-status__icon--informative')).toBeInTheDocument()
  })

  it('says the variable is unset, what is lost and that the backend has to be restarted', () => {
    render(<ToolsStatus tools={deliveryDisabled} />)

    expect(list()).toHaveTextContent('CT_HARVEST_BQ_TABLE')
    expect(list()).toHaveTextContent('no está configurada')
    expect(list()).toHaveTextContent('Los planes siguen funcionando')
    expect(list()).toHaveTextContent('no se enviarán a BigQuery')
    expect(list()).toHaveTextContent('no aparecerán en las comparativas de herramientas')
    expect(list()).toHaveTextContent('CT_HARVEST_BQ_TABLE=proyecto:dataset.tabla make run-backend')
    expect(list()).toHaveTextContent('hay que reiniciar el backend')
  })

  it('says delivery is active, names the destination table and says slices upload themselves', () => {
    render(<ToolsStatus tools={deliveryActive} />)

    expect(list()).toHaveTextContent('Entrega activa')
    expect(list()).toHaveTextContent('se suben automáticamente')
    expect(list()).toHaveTextContent(DESTINATION)
    expect(list()).not.toHaveTextContent('no está configurada')
  })

  it('says metrics cannot be delivered, reuses the bq fix and explains the retry and the kept worktree', () => {
    render(<ToolsStatus tools={deliveryBlocked} />)

    expect(list()).toHaveTextContent('No se pueden entregar las métricas')
    expect(list()).toHaveTextContent('necesita iniciar sesión')
    expect(list()).toHaveTextContent('gcloud auth login')
    expect(list()).toHaveTextContent(DESTINATION)
    expect(list()).toHaveTextContent('se reintenta en cada barrido')
    expect(list()).toHaveTextContent('el worktree del slice se conserva')
  })

  it('asserts no configuration value while the survey is still in flight', () => {
    render(<ToolsStatus tools={checking} />)

    expect(list()).toHaveTextContent('Consultando la configuración de entrega de métricas')
    expect(list()).not.toHaveTextContent('no está configurada')
    expect(list()).not.toHaveTextContent('Entrega activa')
  })

  it('says the configuration could not be read when the backend is unavailable', () => {
    render(<ToolsStatus tools={unknown} />)

    expect(list()).toHaveTextContent('no se ha podido leer si la entrega de métricas está configurada')
    expect(list()).not.toHaveTextContent('no está configurada, así que')
  })
})
