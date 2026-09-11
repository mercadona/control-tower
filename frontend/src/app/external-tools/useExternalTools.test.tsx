import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useExternalTools } from 'app/external-tools/useExternalTools'

const HookProbe = () => {
  const { tools, check } = useExternalTools()

  return (
    <>
      <output>{tools.phase}</output>
      <button type="button" onClick={() => void check()}>retry</button>
    </>
  )
}

const DISABLED = { enabled: false, variable: 'CT_HARVEST_BQ_TABLE', destination: null }
const ENABLED = {
  enabled: true, variable: 'CT_HARVEST_BQ_TABLE',
  destination: 'fixture-project:fixture_dataset.fixture_table',
}

describe('useExternalTools', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('surveys on mount and exposes unavailable when its request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }))

    render(<HookProbe />)

    expect(await screen.findByText('unknown')).toBeInTheDocument()
  })

  it('keeps the checking state until a retry survey resolves', async () => {
    let resolveRetry: (value: Response) => void = () => undefined
    const fetching = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ready: false,
        tools: [{ tool: 'gh', installed: true, session: 'missing', fix: 'gh auth login' }],
        metricsDelivery: DISABLED,
      })))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveRetry = resolve }))
    vi.stubGlobal('fetch', fetching)
    const user = userEvent.setup()

    render(<HookProbe />)
    await screen.findByText('attention')
    await user.click(screen.getByRole('button', { name: 'retry' }))

    expect(screen.getByText('checking')).toBeInTheDocument()
    resolveRetry(new Response(JSON.stringify({
      ready: true,
      tools: [{ tool: 'gh', installed: true, session: 'ready', fix: null }],
      metricsDelivery: DISABLED,
    })))
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
  })

  it('trusts the ready the backend answered instead of deriving it from the sessions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ready: true,
      tools: [
        { tool: 'gh', installed: true, session: 'ready', fix: null },
        { tool: 'bq', installed: false, session: 'missing', fix: 'install bq' },
        { tool: 'claude', installed: true, session: 'unknown', fix: 'claude, then /login' },
      ],
      metricsDelivery: DISABLED,
    }))))

    render(<HookProbe />)

    expect(await screen.findByText('ready')).toBeInTheDocument()
  })

  it('asks for attention when the backend says a configured metrics delivery has no usable bq', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      ready: false,
      tools: [{ tool: 'bq', installed: true, session: 'missing', fix: 'gcloud auth login' }],
      metricsDelivery: ENABLED,
    }))))

    render(<HookProbe />)

    expect(await screen.findByText('attention')).toBeInTheDocument()
  })
})
