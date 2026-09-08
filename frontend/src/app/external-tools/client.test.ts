import { ExternalToolsClient } from 'app/external-tools/client'

describe('ExternalToolsClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads the external-tools survey from its dedicated endpoint', async () => {
    const fetching = vi.fn(async () => new Response(JSON.stringify({
      ready: true,
      tools: [{ tool: 'gh', installed: true, session: 'ready', fix: null }],
    })))
    vi.stubGlobal('fetch', fetching)

    await expect(ExternalToolsClient.get()).resolves.toEqual({
      kind: 'surveyed',
      tools: [{ tool: 'gh', installed: true, session: 'ready', fix: null }],
    })
    expect(fetching).toHaveBeenCalledWith('/external-tools')
  })

  it('treats an unreachable or malformed survey as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ready":true,"tools":[]}')))

    await expect(ExternalToolsClient.get()).resolves.toEqual({ kind: 'unavailable' })
  })
})
