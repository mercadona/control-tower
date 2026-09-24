import { render, screen } from '@testing-library/react'
import { PlanningProgressMother } from '__scenarios__/PlanningProgressMother'
import { WorkProgressContract } from 'app/work-progress/contract'
import { PlanningProgress } from './PlanningProgress'

describe('PlanningProgress', () => {
  it('shows elapsed time, tool activity and agent text from the unified reading', () => {
    render(<PlanningProgress progress={{ kind: 'available', value: WorkProgressContract.activity(JSON.parse(PlanningProgressMother.running().body)) }} />)
    expect(screen.getByText('06:12 · 41 llamadas a herramientas')).toBeVisible()
    expect(screen.getByText('Última herramienta: Read — plugin/conventions/testing.md')).toBeVisible()
    expect(screen.getByText('Último mensaje: «Ahora escribo el plan»')).toBeVisible()
  })

  it('shows finished activity without claiming that the document is ready', () => {
    render(<PlanningProgress progress={{ kind: 'available', value: WorkProgressContract.activity(JSON.parse(PlanningProgressMother.finished().body)) }} />)
    expect(screen.getByText('El agente ha terminado')).toBeVisible()
    expect(screen.queryByText('Plan listo')).toBeNull()
  })

  it('keeps a failed activity read explicit instead of pretending the agent is still working', () => {
    render(<PlanningProgress progress={{ kind: 'unavailable', detail: PlanningProgressMother.NOT_READ_DETAIL }} />)
    expect(screen.getByRole('alert')).toHaveTextContent(PlanningProgressMother.NOT_READ_DETAIL)
  })
})
