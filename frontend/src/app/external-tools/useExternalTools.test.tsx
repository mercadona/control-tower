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
    })))
    await waitFor(() => expect(screen.getByText('ready')).toBeInTheDocument())
  })
})
