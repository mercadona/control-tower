import { act, screen, within } from '@testing-library/react'
import { HeadlessPlanMother } from '__scenarios__/HeadlessPlanMother'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import { backendRecovering, openHome } from './helpers'

describe('Home · unified work progress', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows plan state and agent activity inside implementation from the same progress reading', async () => {
    const fetching = backendRecovering(HeadlessPlanMother.planning())
    const { user } = openHome()
    await screen.findByText('Escribiendo el plan…')
    const implementation = within(screen.getByLabelText('Implementación', { selector: 'section' }))
    expect(implementation.getByText('El agente está trabajando')).toBeVisible()
    expect(fetching.progressRequests).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: /Solicitud Completado/ }))
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Implementación')
    expect(screen.queryByText('Revisar plan')).toBeNull()
  })

  it('keeps a ready plan visible even when agent activity cannot be read', async () => {
    backendRecovering(HeadlessPlanMother.planning(), () => WorkProgressMother.planning('ready', PlanningProgressMother.notRead()))
    openHome()
    expect(await screen.findByText('Plan listo')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(PlanningProgressMother.NOT_READ_DETAIL)
    expect(screen.getByRole('link', { name: 'Abrir el plan en GitHub' })).toBeVisible()
  })

  it('a finished planning call does not pretend its plan is ready', async () => {
    backendRecovering(HeadlessPlanMother.planning(), () => WorkProgressMother.planning('writing', PlanningProgressMother.finished()))
    openHome()
    expect(await screen.findByText('El agente ha terminado')).toBeVisible()
    expect(screen.getByText('Escribiendo el plan…')).toBeVisible()
    expect(screen.queryByText('Plan listo')).toBeNull()
  })

  it('follows planning into execution without a second progress subscription or an implementation command', async () => {
    vi.useFakeTimers()
    let answer = WorkProgressMother.planning('ready')
    const fetching = backendRecovering(HeadlessPlanMother.planning(), () => answer)
    const { unmount } = openHome()
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(screen.getByText('Plan listo')).toBeVisible()
    answer = WorkProgressMother.implementing()
    await act(async () => vi.advanceTimersByTimeAsync(3000))
    expect(screen.getByText('Tarea 3 de 7')).toBeVisible()
    expect(screen.getByText('Implementación iniciada automáticamente')).toBeVisible()
    expect(fetching.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
    const reads = fetching.progressRequests.mock.calls.length
    unmount()
    await act(async () => vi.advanceTimersByTimeAsync(6000))
    expect(fetching.progressRequests).toHaveBeenCalledTimes(reads)
  })
})
