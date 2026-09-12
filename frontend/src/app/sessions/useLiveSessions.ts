import { useCallback, useEffect, useRef, useState } from 'react'
import { SessionsClient } from 'app/sessions/client'
import { LiveSession } from 'app/sessions/Sessions.types'

export type LiveSessionsState =
  | { status: 'loading' }
  | { status: 'loaded'; sessions: LiveSession[] }
  | { status: 'unavailable' }

export type LiveSessions = { state: LiveSessionsState; refresh: () => void }

const LOADING: LiveSessionsState = { status: 'loading' }

const useLiveSessions = (): LiveSessions => {
  const [state, setState] = useState<LiveSessionsState>(LOADING)
  const mountedRef = useRef(false)

  const load = useCallback(async (): Promise<void> => {
    const outcome = await SessionsClient.list()
    if (!mountedRef.current) return
    setState(outcome.kind === 'loaded' ? { status: 'loaded', sessions: outcome.sessions } : { status: 'unavailable' })
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void load()
    return () => {
      mountedRef.current = false
    }
  }, [load])

  const refresh = useCallback(() => void load(), [load])

  return { state, refresh }
}

export { useLiveSessions }
