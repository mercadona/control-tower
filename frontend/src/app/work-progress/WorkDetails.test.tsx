import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkProgressMother } from '__scenarios__/WorkProgressMother'
import { WorkDetails } from './WorkDetails'

describe('WorkDetails', () => {
  it('keeps metadata hidden until requested and copies the selected work identity', async () => {
    const user = userEvent.setup()
    const write = vi.fn(async () => undefined)
    const plan = WorkProgressMother.active('implementing').plan
    render(<WorkDetails plan={plan} writeToClipboard={write} />)
    expect(screen.getByText('Solicitud:', { exact: false })).not.toBeVisible()
    expect(screen.getByRole('button', { name: 'Copiar datos del plan' })).not.toBeVisible()
    await user.click(screen.getByText('Detalles del agente y del entorno'))
    expect(screen.getByText(plan.worktree)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Copiar datos del plan' }))
    expect(write).toHaveBeenCalledWith(`Issue #${plan.issue.number}: ${plan.issue.url}\nRepositorio: ${plan.repo}\nAgente: ${plan.agent}\nRama: ${plan.branch}\nWorktree: ${plan.worktree}`)
    expect(await screen.findByText('Datos del plan copiados')).toBeVisible()
  })

  it('reports a failed copy while keeping the details available', async () => {
    const user = userEvent.setup()
    render(<WorkDetails plan={WorkProgressMother.active('planning').plan} writeToClipboard={async () => { throw new Error('denied') }} />)
    await user.click(screen.getByText('Detalles del agente y del entorno'))
    await user.click(screen.getByRole('button', { name: 'Copiar datos del plan' }))
    expect(await screen.findByText('No se pudieron copiar los datos del plan')).toBeVisible()
  })
})
