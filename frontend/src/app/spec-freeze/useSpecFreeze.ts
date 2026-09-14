import { useEffect, useState } from 'react'
import { SpecFreezeClient } from 'app/spec-freeze/client'
import { SpecFreezeOutcome } from 'app/spec-freeze/SpecFreeze.types'

type SpecFreezeRead =
  | { phase: 'connecting' }
  | ({ phase: 'read' } & SpecFreezeOutcome)

const CONNECTING: SpecFreezeRead = { phase: 'connecting' }
const POLL_INTERVAL_MS = 2000

const useSpecFreeze = (): SpecFreezeRead => {
  const [read, setRead] = useState<SpecFreezeRead>(CONNECTING)

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const poll = async (): Promise<void> => {
      const outcome = await SpecFreezeClient.read()
      if (cancelled) return
      setRead({ phase: 'read', ...outcome })
      if (outcome.kind === 'frozen') return
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

export { useSpecFreeze }
export type { SpecFreezeRead }
