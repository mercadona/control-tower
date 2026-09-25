import { useEffect, useState } from 'react'
import { SpecFreezeClient } from 'app/spec-freeze/client'
import { SpecFreezeOutcome } from 'app/spec-freeze/SpecFreeze.types'

type SpecFreezeRead =
  | { phase: 'connecting' }
  | ({ phase: 'read' } & SpecFreezeOutcome)

const CONNECTING: SpecFreezeRead = { phase: 'connecting' }
const NAMES_NO_CHECKOUT = Symbol('the read names no checkout')

const answeredFor = (outcome: SpecFreezeOutcome): string | null | typeof NAMES_NO_CHECKOUT =>
  'target' in outcome ? outcome.target : NAMES_NO_CHECKOUT

const POLL_INTERVAL_MS = 2000

type HeldRead = { target: string | null; read: SpecFreezeRead }

const settledOver = (previous: HeldRead, target: string | null, read: SpecFreezeRead): HeldRead =>
  read.phase === 'read' && read.kind === 'unavailable' && previous.target === target && previous.read.phase === 'read'
    ? previous
    : { target, read }

const useSpecFreeze = (target: string | null = null): SpecFreezeRead => {
  const [held, setHeld] = useState<HeldRead>({ target, read: CONNECTING })

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const setRead = (read: SpecFreezeRead) => setHeld((previous) => settledOver(previous, target, read))

    const poll = async (): Promise<void> => {
      const outcome = await SpecFreezeClient.read()
      if (cancelled) return
      const answered = answeredFor(outcome)
      if (answered !== NAMES_NO_CHECKOUT && answered !== target) {
        setRead({ phase: 'read', kind: 'none' })
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
        return
      }
      setRead({ phase: 'read', ...outcome })
      if (outcome.kind === 'frozen') return
      timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(poll, 0)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [target])

  return held.target === target ? held.read : CONNECTING
}

export { useSpecFreeze }
export type { SpecFreezeRead }
