import { act, renderHook, waitFor } from '@testing-library/react'
import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'
import { EpicGroomMother } from '__scenarios__/EpicGroomMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { useCoordinatingSession } from 'app/coordinating-session/useCoordinatingSession'

class Deferred<T> {
  readonly promise: Promise<T>
  resolve: (value: T) => void = () => undefined

  constructor() {
    this.promise = new Promise((resolve) => { this.resolve = resolve })
  }
}

const response = (answer: { status: number; body: string }) => new Response(answer.body, { status: answer.status })
const submission = () => ({
  id: StartPlanMother.TICKET,
  repo: StartPlanMother.REPO,
  path: StartPlanMother.PATH,
})
const closed = () => new Response(JSON.stringify({
  status: 'closed',
  conversation: CoordinatingSessionMother.CONVERSATION,
  target: CoordinatingSessionMother.TARGET,
}))

describe('useCoordinatingSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('blocks both opening entrances before the first authoritative read', async () => {
    const firstRead = new Deferred<Response>()
    const fetching = vi.fn(() => firstRead.promise)
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())

    expect(result.current.blocksOpening).toBe(true)
    await act(async () => {
      expect(await result.current.open(submission())).toMatchObject({ kind: 'refused' })
      expect(await result.current.openGroom(EpicGroomMother.KEY, EpicGroomMother.TARGET)).toMatchObject({ kind: 'refused' })
    })
    await vi.waitFor(() => expect(fetching).toHaveBeenCalledTimes(1))

    await act(async () => firstRead.resolve(response(CoordinatingSessionMother.none())))
    await waitFor(() => expect(result.current.blocksOpening).toBe(false))
  })

  it('keeps both opening entrances blocked when the initial lifecycle read fails', async () => {
    const fetching = vi.fn(async () => { throw new TypeError('offline') })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.read).toEqual({ phase: 'read', kind: 'unavailable' }))

    await act(async () => {
      expect(await result.current.open(submission())).toMatchObject({ kind: 'refused' })
      expect(await result.current.openGroom(EpicGroomMother.KEY, EpicGroomMother.TARGET)).toMatchObject({ kind: 'refused' })
    })

    expect(result.current.blocksOpening).toBe(true)
    expect(fetching).toHaveBeenCalledTimes(1)
  })

  it.each(['opening', 'recovering', 'closing'] as const)(
    'treats the authoritative %s operation as busy and blocks both opening handlers',
    async (operation) => {
      const answer = CoordinatingSessionMother.working()
      const busy = { ...answer, body: answer.body.replace('"operation":"idle"', `"operation":"${operation}"`) }
      const fetching = vi.fn(async () => response(busy))
      vi.stubGlobal('fetch', fetching)
      const { result } = renderHook(() => useCoordinatingSession())
      await waitFor(() => expect(result.current.operationBusy).toBe(true))

      await act(async () => {
        expect(await result.current.open(submission())).toMatchObject({ kind: 'refused' })
        expect(await result.current.openGroom(EpicGroomMother.KEY, EpicGroomMother.TARGET)).toMatchObject({ kind: 'refused' })
      })

      expect(fetching).toHaveBeenCalledTimes(1)
    },
  )

  it('failed closure keeps opening reserved while current-work operations remain eligible', async () => {
    const answer = CoordinatingSessionMother.working()
    answer.body = JSON.stringify({
      ...JSON.parse(answer.body),
      operation: 'close-failed',
      closureError: { code: 'session-ownership-unverifiable', detail: 'missing anchor' },
    })
    vi.stubGlobal('fetch', vi.fn(async () => response(answer)))
    const { result } = renderHook(() => useCoordinatingSession())

    await waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    expect(result.current.blocksOpening).toBe(true)
    expect(result.current.operationBusy).toBe(false)
    expect(result.current.closeError).toContain('No hay identidad original suficiente')
  })

  it('admits one groom replacement over an idle ended conversation and blocks competitors while it opens', async () => {
    const opening = new Deferred<Response>()
    let opened = false
    const groomLive = CoordinatingSessionMother.working().body
      .replace(CoordinatingSessionMother.TARGET, EpicGroomMother.GROOM_TARGET)
      .replace(CoordinatingSessionMother.CONVERSATION, EpicGroomMother.GROOM_CONVERSATION)
      .replace(CoordinatingSessionMother.SESSION.id, EpicGroomMother.GROOM_SESSION.id)
      .replace(CoordinatingSessionMother.SESSION.name, EpicGroomMother.GROOM_SESSION.name)
    const fetching = vi.fn((input: string | URL | Request) => {
      if (input === '/groom-session') return opening.promise
      return Promise.resolve(opened
        ? new Response(groomLive)
        : response(CoordinatingSessionMother.ended()))
    })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    let replacement!: Promise<unknown>
    act(() => { replacement = result.current.openGroom(EpicGroomMother.KEY, CoordinatingSessionMother.TARGET) })
    expect(result.current.blocksOpening).toBe(true)
    expect(result.current.operationBusy).toBe(true)
    await act(async () => {
      expect(await result.current.open(submission())).toMatchObject({ kind: 'refused' })
      opened = true
      opening.resolve(response(EpicGroomMother.groomSessionOpened()))
      await replacement
    })

    expect(result.current.target).toBe(EpicGroomMother.GROOM_TARGET)
    expect(result.current.opened?.session).toEqual(EpicGroomMother.GROOM_SESSION)
    expect(fetching.mock.calls.filter(([input]) => input === '/groom-session')).toHaveLength(1)
  })

  it('allows the form opening handler to replace an idle unresumable conversation', async () => {
    let opened = false
    const fetching = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/coordinating-session' && init !== undefined) {
        opened = true
        return Promise.resolve(response(CoordinatingSessionMother.opened()))
      }
      return Promise.resolve(response(opened ? CoordinatingSessionMother.working() : CoordinatingSessionMother.unresumable()))
    })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.read).toMatchObject({ kind: 'unresumable' }))

    await act(async () => expect(await result.current.open(submission())).toMatchObject({ kind: 'opened' }))

    expect(fetching.mock.calls.some(([input, init]) => input === '/coordinating-session' && init !== undefined)).toBe(true)
  })

  it('a known live session takes the groom ask itself while a second opening stays blocked', async () => {
    const fetching = vi.fn(async (input: string | URL | Request) => String(input) === '/groom-session'
      ? response(EpicGroomMother.groomAskTyped())
      : response(CoordinatingSessionMother.completed()))
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    await act(async () => {
      expect(await result.current.openGroom(EpicGroomMother.KEY, EpicGroomMother.TARGET)).toEqual({ kind: 'typed' })
    })

    expect(fetching).toHaveBeenCalledWith('/groom-session', {
      method: 'POST',
      headers: { 'x-gate-key': EpicGroomMother.KEY, 'x-coordinating-target': EpicGroomMother.TARGET },
    })
    expect(result.current.liveAsk).toBe('ready')
    expect(result.current.target).toBe(CoordinatingSessionMother.TARGET)
    expect(result.current.blocksOpening).toBe(true)
    expect(result.current.operationBusy).toBe(false)
  })

  it.each([
    ['a finished turn', CoordinatingSessionMother.completed, 'ready'],
    ['a running turn', CoordinatingSessionMother.working, 'working'],
    ['a permission prompt', CoordinatingSessionMother.waiting, 'awaiting-permission'],
    ['a permission prompt with no message', CoordinatingSessionMother.awaitingPermissionWithNoMessage, 'awaiting-permission'],
  ])('reads %s as the ask state the gate needs', async (_what, answer, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(answer())))
    const { result } = renderHook(() => useCoordinatingSession())

    await waitFor(() => expect(result.current.liveAsk).toBe(expected))
  })

  it('reports no ask state while no live session is held', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(CoordinatingSessionMother.ended())))
    const { result } = renderHook(() => useCoordinatingSession())

    await waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))
    expect(result.current.liveAsk).toBe(null)
  })

  it('adopts a successful opening immediately and starts fresh reconciliation', async () => {
    const reconciliation = new Deferred<Response>()
    let gets = 0
    const fetching = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/coordinating-session' && init === undefined) {
        gets += 1
        return gets === 1 ? Promise.resolve(response(CoordinatingSessionMother.none())) : reconciliation.promise
      }
      if (input === '/coordinating-session') return Promise.resolve(response(CoordinatingSessionMother.opened()))
      if (input === '/coordinating-session/close') {
        return Promise.resolve(new Response(JSON.stringify({ code: 'session-not-terminated', detail: 'still running' }), { status: 400 }))
      }
      throw new Error(`unexpected fetch to ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.blocksOpening).toBe(false))

    await act(async () => { await result.current.open(submission()) })

    expect(result.current.target).toBe(CoordinatingSessionMother.TARGET)
    expect(result.current.opened).toMatchObject({
      target: CoordinatingSessionMother.TARGET,
      repo: CoordinatingSessionMother.REPO,
      root: CoordinatingSessionMother.ROOT,
    })
    expect(gets).toBe(2)
    await act(async () => { await result.current.close() })
    expect(fetching).toHaveBeenCalledWith('/coordinating-session/close', expect.any(Object))
  })

  it('malformed opening JSON releases the mutation and reconciles before another opening', async () => {
    let posts = 0
    const fetching = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/coordinating-session' && init === undefined) return Promise.resolve(response(CoordinatingSessionMother.none()))
      posts += 1
      return Promise.resolve(posts === 1
        ? new Response('{', { status: 202 })
        : response(CoordinatingSessionMother.opened()))
    })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.blocksOpening).toBe(false))

    await act(async () => {
      expect(await result.current.open(submission())).toEqual({ kind: 'backend-unreachable' })
    })
    await waitFor(() => expect(result.current.blocksOpening).toBe(false))
    await act(async () => {
      expect(await result.current.open(submission())).toMatchObject({ kind: 'opened' })
    })

    expect(posts).toBe(2)
  })

  it('retains a closeable live snapshot across a failed poll', async () => {
    vi.useFakeTimers()
    let reads = 0
    const fetching = vi.fn((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') {
        return Promise.resolve(new Response(JSON.stringify({ code: 'session-not-terminated', detail: 'still running' }), { status: 400 }))
      }
      reads += 1
      return reads === 1 ? Promise.resolve(response(CoordinatingSessionMother.working())) : Promise.reject(new TypeError('offline'))
    })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    expect(result.current.read).toMatchObject({ kind: 'live', target: CoordinatingSessionMother.TARGET })
    await act(async () => { await result.current.close() })
    expect(result.current.closeError).toBe(
      'No se pudo inspeccionar o terminar la sesión. Vuelve a intentarlo; las sesiones nuevas seguirán bloqueadas hasta confirmar el cierre.'
    )
  })

  it('retires an externally closed live target when a fresh read authoritatively returns idle', async () => {
    vi.useFakeTimers()
    let reads = 0
    vi.stubGlobal('fetch', vi.fn(async () => response(
      ++reads === 1 ? CoordinatingSessionMother.working() : CoordinatingSessionMother.none(),
    )))
    const { result } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(result.current.target).toBeNull()
    expect(result.current.blocksOpening).toBe(false)
    expect(result.current.closedSessionIds).toContain(CoordinatingSessionMother.SESSION.id)
  })

  it('retires an externally closing target when the next fresh read returns idle', async () => {
    vi.useFakeTimers()
    let reads = 0
    const closingAnswer = CoordinatingSessionMother.working()
    closingAnswer.body = closingAnswer.body.replace('"operation":"idle"', '"operation":"closing"')
    vi.stubGlobal('fetch', vi.fn(async () => response([
      CoordinatingSessionMother.working(), closingAnswer, CoordinatingSessionMother.none(),
    ][reads++])))
    const { result } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))
    await act(async () => vi.advanceTimersByTimeAsync(2000))
    expect(result.current.operationBusy).toBe(true)

    await act(async () => vi.advanceTimersByTimeAsync(2000))

    expect(result.current.target).toBeNull()
    expect(result.current.operationBusy).toBe(false)
    expect(result.current.closedSessionIds).toContain(CoordinatingSessionMother.SESSION.id)
  })

  it('converges through fresh idle reconciliation when the local close acknowledgement is lost', async () => {
    let reads = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') return Promise.reject(new TypeError('lost response'))
      reads += 1
      return Promise.resolve(response(reads === 1 ? CoordinatingSessionMother.working() : CoordinatingSessionMother.none()))
    }))
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    await act(async () => { await result.current.close() })
    await waitFor(() => expect(result.current.target).toBeNull())

    expect(result.current.closeError).toBeNull()
    expect(result.current.blocksOpening).toBe(false)
    expect(result.current.closedSessionIds).toContain(CoordinatingSessionMother.SESSION.id)
  })

  it('ignores a pre-mutation stale none while fresh reconciliation confirms the adopted session', async () => {
    vi.useFakeTimers()
    const stale = new Deferred<Response>()
    let reads = 0
    const fetching = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      if (input === '/coordinating-session' && init !== undefined) {
        return Promise.resolve(response(CoordinatingSessionMother.opened()))
      }
      reads += 1
      if (reads === 1) return Promise.resolve(response(CoordinatingSessionMother.none()))
      if (reads === 2) return stale.promise
      return Promise.resolve(response(CoordinatingSessionMother.working()))
    })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(result.current.blocksOpening).toBe(false))
    await act(async () => vi.advanceTimersByTimeAsync(2000))

    await act(async () => { await result.current.open(submission()) })
    expect(result.current.target).toBe(CoordinatingSessionMother.TARGET)
    await act(async () => stale.resolve(response(CoordinatingSessionMother.none())))

    expect(result.current.target).toBe(CoordinatingSessionMother.TARGET)
    expect(result.current.opened?.session).toEqual(CoordinatingSessionMother.SESSION)
  })

  it('a read started before close cannot resurrect a confirmed target', async () => {
    vi.useFakeTimers()
    const stale = new Deferred<Response>()
    let reads = 0
    const fetching = vi.fn((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') return Promise.resolve(closed())
      reads += 1
      if (reads === 1) return Promise.resolve(response(CoordinatingSessionMother.working()))
      if (reads === 2) return stale.promise
      return Promise.resolve(response(CoordinatingSessionMother.none()))
    })
    vi.stubGlobal('fetch', fetching)
    const { result } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(reads).toBe(2)

    await act(async () => { await result.current.close() })
    expect(result.current.target).toBeNull()
    await act(async () => stale.resolve(response(CoordinatingSessionMother.working())))

    expect(result.current.target).toBeNull()
    expect(result.current.blocksOpening).toBe(false)
  })

  it('a stale poll and persisted diagnostic cannot replace the explicit close refusal', async () => {
    vi.useFakeTimers()
    const stale = new Deferred<Response>()
    const refusal = new Deferred<Response>()
    const persisted = CoordinatingSessionMother.endedCloseFailed()
    let reads = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') return refusal.promise
      reads += 1
      return reads === 2 ? stale.promise : Promise.resolve(response(persisted))
    }))
    const { result } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(result.current.closeError).toContain('El sistema no tiene permisos para verificar'))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    let closing!: Promise<unknown>
    act(() => { closing = result.current.close() })
    await act(async () => {
      refusal.resolve(new Response(JSON.stringify({
        code: 'session-ownership-unverifiable',
        detail: 'the original identity is unavailable',
      }), { status: 400 }))
      await closing
    })
    await act(async () => stale.resolve(response(persisted)))

    expect(result.current.closeError).toContain('No hay identidad original suficiente para terminar')
    expect(result.current.target).toBe(CoordinatingSessionMother.TARGET)
    expect(result.current.blocksOpening).toBe(true)
  })

  it('a close reply for a newer target cannot clear that target or its diagnostic', async () => {
    const newer = CoordinatingSessionMother.endedCloseFailed()
    newer.body = newer.body
      .replace(CoordinatingSessionMother.TARGET, EpicGroomMother.GROOM_TARGET)
      .replace(CoordinatingSessionMother.CONVERSATION, EpicGroomMother.GROOM_CONVERSATION)
    let reads = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') {
        return Promise.resolve(new Response(JSON.stringify({
          status: 'closed',
          conversation: EpicGroomMother.GROOM_CONVERSATION,
          target: EpicGroomMother.GROOM_TARGET,
        })))
      }
      reads += 1
      return Promise.resolve(response(reads === 1 ? CoordinatingSessionMother.working() : newer))
    }))
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    await act(async () => { await result.current.close() })
    await waitFor(() => expect(result.current.target).toBe(EpicGroomMother.GROOM_TARGET))

    expect(result.current.closeError).toContain('El sistema no tiene permisos para verificar')
    expect(result.current.blocksOpening).toBe(true)
  })

  it('a none read before close acknowledgement cannot strand cancellation', async () => {
    vi.useFakeTimers()
    const stale = new Deferred<Response>()
    const acknowledgement = new Deferred<Response>()
    let reads = 0
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') return acknowledgement.promise
      reads += 1
      if (reads === 1) return Promise.resolve(response(CoordinatingSessionMother.working()))
      if (reads === 2) return stale.promise
      return Promise.resolve(response(CoordinatingSessionMother.none()))
    }))
    const { result } = renderHook(() => useCoordinatingSession())
    await vi.waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })

    let closing!: Promise<unknown>
    act(() => { closing = result.current.close() })
    await act(async () => stale.resolve(response(CoordinatingSessionMother.none())))
    expect(result.current.closing).toBe(true)
    await act(async () => {
      acknowledgement.resolve(closed())
      await closing
    })

    expect(result.current.closing).toBe(false)
    expect(result.current.blocksOpening).toBe(false)
  })

  it('captures the terminal ID before close so ended transitions cannot defeat cleanup', async () => {
    const acknowledgement = new Deferred<Response>()
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request) => {
      if (input === '/coordinating-session/close') return acknowledgement.promise
      return Promise.resolve(response(CoordinatingSessionMother.working()))
    }))
    const { result } = renderHook(() => useCoordinatingSession())
    await waitFor(() => expect(result.current.target).toBe(CoordinatingSessionMother.TARGET))

    let closing!: Promise<unknown>
    act(() => { closing = result.current.close() })
    await waitFor(() => expect(result.current.closing).toBe(true))
    await act(async () => {
      acknowledgement.resolve(closed())
      await closing
    })

    expect(result.current.closedSessionIds).toContain(CoordinatingSessionMother.SESSION.id)
  })
})
