import { screen, waitFor, within } from '@testing-library/react'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { FakeEventSource } from './FakeEventSource'
import {
  dropStream,
  openRestored,
  streamFrame,
} from './helpers'

describe('Home · plan events', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const planStarted = async () => {
    const opened = openRestored({ phase: 'planning' })
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))

    return opened
  }

  it('should watch the issue the backend opened', async () => {
    await planStarted()

    expect(FakeEventSource.last().url).toBe(PlanEventsMother.PATH)
  })

  it('keeps review current when reopening the completed request summary', async () => {
    const { user } = await planStarted()

    await user.click(screen.getByRole('button', { name: /Solicitud Completado/ }))

    expect(screen.getByRole('button', { name: /Solicitud Completado/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Revisar plan')
  })

  it('should say the plan is being written when the first frame arrives', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())

    expect(screen.getByRole('status')).toHaveTextContent('Escribiendo el plan…')
  })

  it('should keep a ready plan in review and keep listening in case a review reworks it', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.writing())
    await streamFrame(PlanEventsMother.ready())

    expect(screen.getByRole('heading', { name: 'Revisar plan' })).toBeInTheDocument()
    expect(screen.getByText('El plan está listo. La implementación continuará automáticamente cuando el backend la registre.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Implementar plan' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Flujo del plan' }).querySelector('[aria-current="step"]')).toHaveTextContent('Revisar plan')
    expect(FakeEventSource.last().closes).toBe(0)
  })

  it('should say the backend is unreachable when the stream fails before any frame', async () => {
    await planStarted()

    await dropStream()

    expect(within(screen.getByLabelText('Progreso del plan')).getByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should report the backend as unreachable if the connection drops once the plan is ready', async () => {
    await planStarted()

    await streamFrame(PlanEventsMother.ready())
    await dropStream()

    expect(screen.getByRole('heading', { name: 'Revisar plan' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo contactar con el backend')
    expect(FakeEventSource.last().closes).toBe(1)
  })

  it('should close the stream when the page goes away', async () => {
    const { unmount } = await planStarted()

    unmount()

    expect(FakeEventSource.last().closes).toBe(1)
  })
})
