import { screen } from '@testing-library/react'
import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { backendAnswering, openHome, startPlan, streamFrame } from './helpers'
import { FakeEventSource } from './FakeEventSource'

const ASK_BUTTON = { name: 'Pedir cambios' }
const READ_LINK = { name: 'Abrir el plan en GitHub' }

describe('Home · review plan', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const planStarted = async () => {
    backendAnswering(StartPlanMother.started())
    const opened = openHome()
    await startPlan(opened.user)
    await screen.findByRole('status')

    return opened
  }

  it('should offer to ask for changes only once the plan is ready, beside the link to read it', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())
    expect(screen.queryByRole('button', ASK_BUTTON)).toBeNull()

    await streamFrame(PlanEventsMother.ready())
    expect(screen.getByRole('button', ASK_BUTTON)).toBeInTheDocument()
    expect(screen.getByRole('link', READ_LINK)).toBeInTheDocument()
  })

  it('should stop offering to ask for changes once the plan is being implemented', async () => {
    const opened = await planStarted()
    await streamFrame(PlanEventsMother.ready())

    backendAnswering(ImplementPlanMother.implementing())
    await opened.user.click(screen.getByRole('button', { name: 'Implementar plan' }))

    expect(screen.queryByRole('button', ASK_BUTTON)).toBeNull()
  })

  it('should stop offering the go while the plan is being reworked', async () => {
    await planStarted()
    await streamFrame(PlanEventsMother.ready())
    expect(screen.getByRole('button', { name: 'Implementar plan' })).toBeInTheDocument()
    expect(FakeEventSource.last().closes).toBe(0)

    await streamFrame(PlanEventsMother.reviewing())

    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(screen.queryByRole('button', ASK_BUTTON)).toBeNull()
  })

  it('should offer the go again once the reworked plan is committed', async () => {
    await planStarted()
    await streamFrame(PlanEventsMother.ready())
    await streamFrame(PlanEventsMother.reviewing())

    await streamFrame(PlanEventsMother.ready())

    expect(screen.getByRole('button', { name: 'Implementar plan' })).toBeInTheDocument()
  })
})
