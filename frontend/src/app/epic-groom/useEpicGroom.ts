import { useEffect, useState } from 'react'
import { EpicGroomClient } from 'app/epic-groom/client'
import { EpicGroomOutcome } from 'app/epic-groom/EpicGroom.types'

type EpicGroomRead =
  | { phase: 'connecting' }
  | ({ phase: 'read' } & EpicGroomOutcome)

const CONNECTING: EpicGroomRead = { phase: 'connecting' }
const POLL_INTERVAL_MS = 10000
const RESTING_KINDS: readonly EpicGroomOutcome['kind'][] = [
  'groomable', 'partially-groomed', 'groomed', 'authorised',
]

const A_CONVERSATION_CAN_STILL_CHANGE: readonly EpicGroomOutcome['kind'][] = ['groomable', 'partially-groomed']

const NAMES_NO_CHECKOUT = Symbol('the read names no checkout')

const answeredFor = (outcome: EpicGroomOutcome): string | null | typeof NAMES_NO_CHECKOUT =>
  'target' in outcome ? outcome.target : NAMES_NO_CHECKOUT

type HeldRead = { target: string | null; read: EpicGroomRead }

const settledOver = (previous: HeldRead, target: string | null, read: EpicGroomRead): HeldRead =>
  read.phase === 'read' && read.kind === 'unavailable' && previous.target === target && previous.read.phase === 'read'
    ? previous
    : { target, read }

const restsAt = (outcome: EpicGroomOutcome): boolean => RESTING_KINDS.includes(outcome.kind)

const isWorthWatching = (outcome: EpicGroomOutcome): boolean =>
  A_CONVERSATION_CAN_STILL_CHANGE.includes(outcome.kind)

const useEpicGroom = (
  aConversationCanChangeIt = false, target: string | null = null, watchPreparation = false,
): EpicGroomRead => {
  const [held, setHeld] = useState<HeldRead>({ target, read: CONNECTING })

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined
    const setRead = (read: EpicGroomRead) => setHeld((previous) => settledOver(previous, target, read))

    const poll = async (): Promise<void> => {
      const outcome = await EpicGroomClient.read()
      if (cancelled) return
      const answered = answeredFor(outcome)
      if (answered !== NAMES_NO_CHECKOUT && answered !== target) {
        setRead({ phase: 'read', kind: 'none' })
        timer = window.setTimeout(poll, POLL_INTERVAL_MS)
        return
      }
      setRead({ phase: 'read', ...outcome })
      const preparationCanChange = watchPreparation && (outcome.kind === 'groomed' || outcome.kind === 'authorised')
      if (restsAt(outcome) && !preparationCanChange && !(aConversationCanChangeIt && isWorthWatching(outcome))) return
      timer = window.setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = window.setTimeout(poll, 0)

    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [aConversationCanChangeIt, target, watchPreparation])

  return held.target === target ? held.read : CONNECTING
}

export { useEpicGroom }
export type { EpicGroomRead }
