import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProjectReadiness } from './ProjectReadiness'
import { ProjectReadinessMother } from '__scenarios__/ProjectReadinessMother'
import { StartPlanForm } from 'app/start-plan/components/start-plan-form'

describe('ProjectReadiness', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  it('inspects_only_on_request_and_shows_evidence_and_actions_without_creating_a_plan', async () => {
    const fetcher = vi.fn(async (_url: string, _options: RequestInit) => ProjectReadinessMother.response())
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<ProjectReadiness.View repository="owner/project" path="/repo" />)
    expect(fetcher).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Comprobar preparación' }))
    expect(await screen.findByText('Requiere cambios')).toBeInTheDocument()
    expect(screen.getByText('pytest -n auto')).toBeInTheDocument()
    expect(screen.getByText('Limita los procesos de tests y comprueba que el valor llega al contenedor.')).toBeInTheDocument()
    expect(screen.getByText('Sin verificar')).toBeInTheDocument()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/project-readiness')
  })

  it('allows_inspection_before_any_ticket_or_description_is_entered', async () => {
    const fetcher = vi.fn(async () => ProjectReadinessMother.response())
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<StartPlanForm isLocked={false} onInteraction={vi.fn()} onStarted={vi.fn()} onBackendUnreachable={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Comprobar preparación' })).toBeDisabled()
    await user.type(screen.getByRole('textbox', { name: 'Repositorio' }), 'owner/project')
    await user.type(screen.getByRole('textbox', { name: 'Ruta local' }), '/repo')
    await user.click(screen.getByRole('button', { name: 'Comprobar preparación' }))
    expect(await screen.findByText('pytest -n auto')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Arrancar plan' })).toBeDisabled()
  })

  it('discards_a_report_when_the_target_changes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ProjectReadinessMother.response()))
    const user = userEvent.setup()
    const { rerender } = render(<ProjectReadiness.View repository="owner/project" path="/repo" />)
    await user.click(screen.getByRole('button', { name: 'Comprobar preparación' }))
    await screen.findByText('pytest -n auto')
    rerender(<ProjectReadiness.View repository="owner/project" path="/other" />)
    expect(screen.queryByText('pytest -n auto')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Comprobar preparación' })).toBeEnabled()
  })

  it('aborts_a_late_request_for_a_previous_target', async () => {
    let finish: (response: Response) => void = () => {}
    const fetcher = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>((resolve) => { finish = resolve }))
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    const { rerender } = render(<ProjectReadiness.View repository="owner/project" path="/repo" />)
    await user.click(screen.getByRole('button', { name: 'Comprobar preparación' }))
    const signal = fetcher.mock.calls[0][1].signal
    rerender(<ProjectReadiness.View repository="owner/project" path="/other" />)
    await act(async () => finish(ProjectReadinessMother.response()))
    expect(signal?.aborted).toBe(true)
    expect(screen.queryByText('pytest -n auto')).not.toBeInTheDocument()
  })

  it('shows_an_unavailable_request_and_allows_retrying', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(ProjectReadinessMother.response())
    vi.stubGlobal('fetch', fetcher)
    const user = userEvent.setup()
    render(<ProjectReadiness.View repository="owner/project" path="/repo" />)
    await user.click(screen.getByRole('button', { name: 'Comprobar preparación' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar el diagnóstico')
    await user.click(screen.getByRole('button', { name: 'Comprobar preparación' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('pytest -n auto')).toBeInTheDocument()
  })

  it('aborts_an_inspection_that_exceeds_the_browser_deadline', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn((_url: string, _options: RequestInit) => new Promise<Response>(() => {}))
    vi.stubGlobal('fetch', fetcher)
    render(<ProjectReadiness.View repository="owner/project" path="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: 'Comprobar preparación' }))
    act(() => { vi.advanceTimersByTime(35_000) })
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo completar el diagnóstico')
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Comprobar preparación' })).toBeEnabled()
  })
})
