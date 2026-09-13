import { useEffect, useState } from 'react'
import { CoordinatingSessionClient } from 'app/coordinating-session/client'
import { CoordinatingSessionOutcome } from 'app/coordinating-session/CoordinatingSession.types'

type CoordinatingSessionRead =
  | { phase: 'connecting' }
  | ({ phase: 'read' } & CoordinatingSessionOutcome)

const CONNECTING: CoordinatingSessionRead = { phase: 'connecting' }
const POLL_INTERVAL_MS = 2000

const useCoordinatingSession = (): CoordinatingSessionRead => {
  const [read, setRead] = useState<CoordinatingSessionRead>(CONNECTING)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const poll = async (): Promise<void> => {
      const outcome = await CoordinatingSessionClient.read()
      if (cancelled) return
      setRead({ phase: 'read', ...outcome })
      timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(poll, 0)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [])

  return read
}

export { useCoordinatingSession }
export type { CoordinatingSessionRead }
