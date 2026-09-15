import { useEffect, useState } from 'react'
import { EpicGroomClient } from 'app/epic-groom/client'
import { EpicGroomOutcome } from 'app/epic-groom/EpicGroom.types'

type EpicGroomRead =
  | { phase: 'connecting' }
  | ({ phase: 'read' } & EpicGroomOutcome)

const CONNECTING: EpicGroomRead = { phase: 'connecting' }
const POLL_INTERVAL_MS = 10000
const RESTING_KINDS: readonly EpicGroomOutcome['kind'][] = ['groomable', 'groomed', 'authorised']

const restsAt = (outcome: EpicGroomOutcome): boolean => RESTING_KINDS.includes(outcome.kind)

const useEpicGroom = (): EpicGroomRead => {
  const [read, setRead] = useState<EpicGroomRead>(CONNECTING)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const poll = async (): Promise<void> => {
      const outcome = await EpicGroomClient.read()
      if (cancelled) return
      setRead({ phase: 'read', ...outcome })
      if (restsAt(outcome)) return
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

export { useEpicGroom }
export type { EpicGroomRead }
