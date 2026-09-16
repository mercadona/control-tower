import { useCallback, useEffect, useRef, useState } from 'react'
import { SessionsClient } from 'app/sessions/client'
import { LiveSession } from 'app/sessions/Sessions.types'

export type LiveSessionsState =
  | { status: 'loading' }
  | { status: 'loaded'; sessions: LiveSession[] }
  | { status: 'unavailable' }

export type LiveSessions = { state: LiveSessionsState; refresh: () => void }

const LOADING: LiveSessionsState = { status: 'loading' }
const POLL_INTERVAL_MS = 3000

const useLiveSessions = (): LiveSessions => {
  const [state, setState] = useState<LiveSessionsState>(LOADING)
  const mountedRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)

  const poll = useCallback(async (): Promise<void> => {
    const outcome = await SessionsClient.list()
    if (!mountedRef.current) return
    setState(outcome.kind === 'loaded' ? { status: 'loaded', sessions: outcome.sessions } : { status: 'unavailable' })
    timerRef.current = window.setTimeout(() => void poll(), POLL_INTERVAL_MS)
  }, [])

  useEffect(() => {
    mountedRef.current = true
    timerRef.current = window.setTimeout(() => void poll(), 0)
    return () => {
      mountedRef.current = false
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [poll])

  const refresh = useCallback(() => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    void poll()
  }, [poll])

  return { state, refresh }
}

export { useLiveSessions }
