import { screen } from '@testing-library/react'
import { openRestored } from './helpers'

describe('Home · the baseline the plan started on', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should tell whoever started the plan that the repository was already red', async () => {
    openRestored({
      phase: 'ready',
      plan: { baseline: { outcome: 'rojo', command: 'make test', summary: 'exit 2 · 2 failed' } },
    })

    expect(await screen.findByText('El repositorio ya estaba en rojo antes de empezar')).toBeVisible()
    expect(screen.getByText(/make test/)).toBeVisible()
  })

  it('should say nothing about the baseline when the repository was green', async () => {
    openRestored({ phase: 'ready' })

    await screen.findByRole('heading', { name: 'Implementación' })
    expect(screen.queryByText('El repositorio ya estaba en rojo antes de empezar')).toBeNull()
  })
})
