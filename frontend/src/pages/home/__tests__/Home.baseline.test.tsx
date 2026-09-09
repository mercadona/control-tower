import { screen } from '@testing-library/react'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { backendAnswering, openHome, startPlan } from './helpers'

describe('Home · the baseline the plan started on', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const planStartedWith = async (answer: { status: number; body: string }) => {
    backendAnswering(answer)
    const opened = openHome()
    await startPlan(opened.user)

    return opened
  }

  it('should tell whoever started the plan that the repository was already red', async () => {
    await planStartedWith(StartPlanMother.startedOnARedRepository())

    expect(await screen.findByText('El repositorio ya estaba en rojo antes de empezar')).toBeVisible()
    expect(screen.getByText(/make test/)).toBeVisible()
  })

  it('should say nothing about the baseline when the repository was green', async () => {
    await planStartedWith(StartPlanMother.started())

    expect(screen.queryByText('El repositorio ya estaba en rojo antes de empezar')).toBeNull()
  })
})
