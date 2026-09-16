import { fireEvent, screen } from '@testing-library/react'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { backendAnswering, openHome, openRestored } from './helpers'

describe('Home · layout', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps only the work area and the right column at first paint, and folds the implementation history into the right column once implementation starts', async () => {
    const { unmount } = openHome()

    await screen.findByRole('navigation', { name: 'Navegación principal' })
    const columns = document.querySelector('.home__columns')
    expect(columns).not.toBeNull()
    expect(columns?.children).toHaveLength(3)
    expect(columns?.firstElementChild?.tagName).toBe('MAIN')
    expect(columns?.children[1]).toHaveClass('column-resizer')
    expect(columns?.lastElementChild).toHaveClass('home__side')
    expect(screen.queryByRole('complementary', { name: 'Progreso de la implementación' })).not.toBeInTheDocument()
    unmount()

    openRestored({ phase: 'implementing' })
    await screen.findByText('Agente asignado')
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))

    const side = document.querySelector('.home__side')
    expect(side).toContainElement(screen.getByRole('complementary', { name: 'Progreso de la implementación' }))
    expect(document.querySelector('.top-bar')?.closest('.home__columns')).toBeNull()
  })

  it('keeps the baseline notice of a started plan inside the work area beside the right column', async () => {
    const { user } = openRestored({
      phase: 'ready',
      plan: { baseline: { outcome: 'rojo', command: 'make test', summary: 'exit 2 · 2 failed' } },
    })

    const notice = await screen.findByText('El repositorio ya estaba en rojo antes de empezar')
    expect(notice).toBeVisible()
    expect(notice.closest('main')).not.toBeNull()
    const columns = notice.closest('.home__columns')
    expect(columns).not.toBeNull()

    await screen.findByRole('button', { name: 'Implementar plan' })
    backendAnswering(ImplementPlanMother.implementing())
    await user.click(screen.getByRole('button', { name: 'Implementar plan' }))
    await screen.findByText('Agente asignado')
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))

    expect(screen.getByRole('complementary', { name: 'Progreso de la implementación' }).closest('.home__columns'))
      .toBe(columns)
  })

  it('never turns the right column into a dialog: its home__side is a sibling of main once implementation starts', async () => {
    openRestored({ phase: 'implementing' })

    fireEvent.click(await screen.findByRole('button', { name: 'Desplegar el panel' }))
    await screen.findByRole('complementary', { name: 'Progreso de la implementación' })
    expect(screen.queryByRole('dialog')).toBeNull()
    const columns = document.querySelector('.home__columns')
    expect(columns?.children).toHaveLength(3)
    expect(columns?.firstElementChild?.tagName).toBe('MAIN')
    expect(columns?.lastElementChild).toHaveClass('home__side')
  })
})
