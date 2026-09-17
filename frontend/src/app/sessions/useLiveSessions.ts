import { useCallback, useEffect, useRef, useState } from 'react'
import { SessionsClient } from 'app/sessions/client'
import { LiveSession } from 'app/sessions/Sessions.types'

export type LiveSessionsState =
  | { status: 'loading'; sessions: LiveSession[] }
  | { status: 'loaded'; sessions: LiveSession[] }
  | { status: 'unavailable'; sessions: LiveSession[] }

export type LiveSessions = { state: LiveSessionsState; refresh: () => void }

const LOADING: LiveSessionsState = { status: 'loading', sessions: [] }
const POLL_INTERVAL_MS = 3000
const NO_REMOVED_SESSIONS: readonly string[] = []

const useLiveSessions = ({
  adopted = null,
  removedSessionIds = NO_REMOVED_SESSIONS,
}: {
  adopted?: LiveSession | null
  removedSessionIds?: readonly string[]
} = {}): LiveSessions => {
  const [state, setState] = useState<LiveSessionsState>(LOADING)
  const mountedRef = useRef(false)
  const timerRef = useRef<number | undefined>(undefined)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const queuedRef = useRef(false)
  const pendingAdoptionsRef = useRef(new Map<string, LiveSession>())
  const removedRef = useRef(new Set<string>())
  const pollRef = useRef<() => Promise<void>>(async () => {})

  const schedule = useCallback(() => {
    if (!mountedRef.current || timerRef.current !== undefined || inFlightRef.current !== null) return
    timerRef.current = window.setTimeout(() => {
      timerRef.current = undefined
      void pollRef.current()
    }, POLL_INTERVAL_MS)
  }, [])

  const poll = useCallback((): Promise<void> => {
    if (inFlightRef.current !== null) {
      queuedRef.current = true
      return inFlightRef.current
    }
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = undefined
    const request = SessionsClient.list().then((outcome) => {
      if (!mountedRef.current) return
      if (outcome.kind === 'loaded') {
        for (const session of outcome.sessions) pendingAdoptionsRef.current.delete(session.id)
        const listed = outcome.sessions.filter((session) => !removedRef.current.has(session.id))
        const pending = [...pendingAdoptionsRef.current.values()].filter((session) => !removedRef.current.has(session.id))
        const known = new Set(listed.map((session) => session.id))
        setState({ status: 'loaded', sessions: [...listed, ...pending.filter((session) => !known.has(session.id))] })
      } else {
        setState((current) => ({ status: 'unavailable', sessions: current.sessions }))
      }
    }).finally(() => {
      if (inFlightRef.current !== request) return
      inFlightRef.current = null
      if (queuedRef.current) {
        queuedRef.current = false
        void pollRef.current()
      } else schedule()
    })
    inFlightRef.current = request
    return request
  }, [schedule])
  pollRef.current = poll

  useEffect(() => {
    mountedRef.current = true
    void poll()
    return () => {
      mountedRef.current = false
      queuedRef.current = false
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [poll])

  useEffect(() => {
    if (adopted === null || removedRef.current.has(adopted.id)) return
    pendingAdoptionsRef.current.set(adopted.id, adopted)
    setState((current) => current.sessions.some((session) => session.id === adopted.id)
      ? current
      : { status: current.status === 'loading' ? 'loaded' : current.status, sessions: [...current.sessions, adopted] })
  }, [adopted])

  useEffect(() => {
    for (const id of removedSessionIds) {
      removedRef.current.add(id)
      pendingAdoptionsRef.current.delete(id)
    }
    setState((current) => ({
      ...current,
      sessions: current.sessions.filter((session) => !removedRef.current.has(session.id)),
    }))
  }, [removedSessionIds])

  const refresh = useCallback(() => {
    void poll()
  }, [poll])

  return { state, refresh }
}

export { useLiveSessions }
