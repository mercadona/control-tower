import { screen, waitFor } from '@testing-library/react'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { backendAnswering, openHome, startPlan } from './helpers'

describe('Home · layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the top bar across the top and shares the row below it with the tools drawer', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    await waitFor(() => expect(screen.getByRole('complementary', { name: 'Estado' })).toBeInTheDocument())
    const workArea = document.querySelector('.home__work-area')
    expect(workArea).not.toBeNull()
    expect(workArea?.children).toHaveLength(2)
    expect(workArea?.firstElementChild?.tagName).toBe('MAIN')
    expect(workArea?.lastElementChild).toBe(screen.getByRole('complementary', { name: 'Estado' }))
    expect(document.querySelector('.top-bar')?.closest('.home__work-area')).toBeNull()
  })

  it('starts with the drawer folded to its rail so it takes no width on first load', async () => {
    backendAnswering({ status: 200, body: '{}' })
    openHome()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Desplegar el panel de estado/ })).toBeInTheDocument())
    expect(screen.getByRole('complementary', { name: 'Estado' })).toHaveClass('drawer--collapsed')
    expect(screen.queryByRole('button', { name: 'Ver detalles' })).toBeNull()
  })

  it('keeps the baseline notice of a started plan inside the work area beside the drawer', async () => {
    backendAnswering(StartPlanMother.startedOnARedRepository())
    const { user } = openHome()

    await startPlan(user)

    const notice = await screen.findByText('El repositorio ya estaba en rojo antes de empezar')
    expect(notice).toBeVisible()
    expect(notice.closest('main')).not.toBeNull()
    expect(notice.closest('.home__work-area')).not.toBeNull()
    expect(screen.getByRole('complementary', { name: 'Estado' }).closest('.home__work-area'))
      .toBe(notice.closest('.home__work-area'))
  })

  it('compresses the work area instead of covering it: the drawer is a sibling of main, never a dialog', async () => {
    backendAnswering({ status: 200, body: '{}' })
    const { user } = openHome()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^Desplegar el panel de estado/ })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /^Desplegar el panel de estado/ }))

    const drawer = screen.getByRole('complementary', { name: 'Estado' })
    expect(drawer).not.toHaveClass('drawer--collapsed')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(drawer.previousElementSibling?.tagName).toBe('MAIN')
    expect(screen.getByRole('heading', { name: 'Solicitud' })).toBeVisible()
  })
})
