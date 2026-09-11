import { screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { backendAnswering, openHome } from './helpers'

const OPEN_TOGGLE = { name: /^Desplegar el panel de estado/ }

const openStatusPanel = async () => {
  await waitFor(() => expect(screen.getByRole('button', OPEN_TOGGLE)).toBeInTheDocument())
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', OPEN_TOGGLE))

  return screen.getByRole('complementary', { name: 'Estado' })
}

describe('Home · status panel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('shows two sections in order: Progreso then Herramientas', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    const panel = await openStatusPanel()

    const headings = within(panel).getAllByRole('heading', { level: 2 })
    const sectionHeadings = headings.map((heading) => heading.textContent)
    expect(sectionHeadings.indexOf('Progreso')).toBeGreaterThanOrEqual(0)
    expect(sectionHeadings.indexOf('Herramientas')).toBeGreaterThan(sectionHeadings.indexOf('Progreso'))
  })

  it('says there is no implementation in progress when no plan is implementing', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    const panel = await openStatusPanel()

    expect(within(panel).getByText('No hay ninguna implementación en curso')).toHaveAttribute('role', 'status')
    expect(within(panel).queryByText('Pasos completados')).toBeNull()
  })

  it('renders a status icon on every tool row', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    const panel = await openStatusPanel()

    const rows = within(panel).getByRole('list').querySelectorAll('.tools-status__row')
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => expect(row.querySelector('.tools-status__icon')).not.toBeNull())
  })

  it('keeps the Reintentar comprobación button as the Herramientas section action', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    const panel = await openStatusPanel()

    const toolsHeading = within(panel).getByRole('heading', { level: 2, name: 'Herramientas' })
    const toolsSection = toolsHeading.closest('section')
    expect(toolsSection).not.toBeNull()
    expect(within(toolsSection as HTMLElement).getByRole('button', { name: 'Reintentar comprobación' })).toBeInTheDocument()
  })
})
