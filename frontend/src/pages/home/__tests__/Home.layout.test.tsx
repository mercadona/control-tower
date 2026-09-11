import { screen, waitFor } from '@testing-library/react'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { backendAnswering, openHome, startPlan } from './helpers'

describe('Home · layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the navbar, the top bar and the right column as the three pieces of the shell', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Navegación principal' })).toBeInTheDocument())
    const columns = document.querySelector('.home__columns')
    expect(columns).not.toBeNull()
    expect(columns?.children).toHaveLength(2)
    expect(columns?.firstElementChild?.tagName).toBe('MAIN')
    expect(columns?.lastElementChild).toBe(screen.getByRole('complementary', { name: 'Progreso de la implementación' }))
    expect(document.querySelector('.top-bar')?.closest('.home__columns')).toBeNull()
  })

  it('keeps the baseline notice of a started plan inside the work area beside the right column', async () => {
    backendAnswering(StartPlanMother.startedOnARedRepository())
    const { user } = openHome()

    await startPlan(user)

    const notice = await screen.findByText('El repositorio ya estaba en rojo antes de empezar')
    expect(notice).toBeVisible()
    expect(notice.closest('main')).not.toBeNull()
    expect(notice.closest('.home__columns')).not.toBeNull()
    expect(screen.getByRole('complementary', { name: 'Progreso de la implementación' }).closest('.home__columns'))
      .toBe(notice.closest('.home__columns'))
  })

  it('never turns the right column into a dialog: it is a sibling of main from the first paint', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    const side = await screen.findByRole('complementary', { name: 'Progreso de la implementación' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(side.previousElementSibling?.tagName).toBe('MAIN')
    expect(screen.getByRole('heading', { name: 'Solicitud' })).toBeVisible()
  })
})
