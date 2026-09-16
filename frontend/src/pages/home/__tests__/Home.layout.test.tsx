import { fireEvent, screen } from '@testing-library/react'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { backendRecovering, openHome, openRestored } from './helpers'

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
    await screen.findByText('Implementación iniciada automáticamente')
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))

    const side = document.querySelector('.home__side')
    const implementationHistory = screen.getByRole('complementary', { name: 'Progreso de la implementación' })
    expect(side).toContainElement(implementationHistory)
    expect(implementationHistory.closest('.home__columns')).toBe(document.querySelector('.home__columns'))
    expect(document.querySelector('.top-bar')?.closest('.home__columns')).toBeNull()
  })

  it('keeps the baseline notice of a started plan inside the work area beside the right column', async () => {
    openRestored({
      phase: 'ready',
      plan: { baseline: { outcome: 'rojo', command: 'make test', summary: 'exit 2 · 2 failed' } },
    })

    const notice = await screen.findByText('El repositorio ya estaba en rojo antes de empezar')
    expect(notice).toBeVisible()
    expect(notice.closest('main')).not.toBeNull()
    const columns = notice.closest('.home__columns')
    expect(columns).not.toBeNull()

    expect(notice.closest('.home__columns')).toBe(columns)
  })

  it('the coordinator remains writable during automatic progress', async () => {
    backendRecovering(HeadlessPlanMother.implementing())

    openHome()

    await screen.findByRole('heading', { name: 'Implementación' })
    fireEvent.click(screen.getByRole('button', { name: 'Desplegar el panel' }))
    expect(screen.getByText('Sesión coordinadora')).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Sesión coordinadora' })).not.toHaveAttribute('aria-disabled', 'true')
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
