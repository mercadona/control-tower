import { useEffect, useState } from 'react'
import { SessionsClient } from 'app/sessions/client'
import { LiveSession } from 'app/sessions/Sessions.types'

export type LiveSessionsState =
  | { status: 'loading' }
  | { status: 'loaded'; sessions: LiveSession[] }
  | { status: 'unavailable' }

const LOADING: LiveSessionsState = { status: 'loading' }

const useLiveSessions = (): LiveSessionsState => {
  const [state, setState] = useState<LiveSessionsState>(LOADING)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const outcome = await SessionsClient.list()
      if (cancelled) return
      setState(outcome.kind === 'loaded' ? { status: 'loaded', sessions: outcome.sessions } : { status: 'unavailable' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return state
}

export { useLiveSessions }
