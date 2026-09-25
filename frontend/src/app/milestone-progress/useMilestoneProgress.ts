import { useCallback, useEffect, useRef, useState } from 'react'
import { MilestoneProgressClient } from 'app/milestone-progress/client'
import { MilestonePolling } from 'app/milestone-progress/MilestonePolling'
import type { MilestoneProgressOutcome } from 'app/milestone-progress/MilestoneProgress.types'

type MilestoneProgressLifecycle = {
  read: MilestoneProgressOutcome | null
  unavailable: boolean
  reread: () => void
}

export const useMilestoneProgress = (enabled: boolean, target: string | null): MilestoneProgressLifecycle => {
  const [held, setHeld] = useState<{
    target: string | null; read: MilestoneProgressOutcome | null; unavailable: boolean
  }>({ target, read: null, unavailable: false })
  const timerRef = useRef<number | undefined>(undefined)
  const generationRef = useRef(0)

  const poll = useCallback((generation: number) => {
    void MilestoneProgressClient.read().then((outcome) => {
      if (generationRef.current !== generation) return
      const read: MilestoneProgressOutcome = 'target' in outcome && outcome.target !== target ? { kind: 'none' } : outcome
      setHeld((previous) => read.kind === 'unavailable' && previous.target === target
        ? { ...previous, unavailable: true }
        : { target, read, unavailable: read.kind === 'unavailable' })
      timerRef.current = window.setTimeout(() => poll(generation), MilestonePolling.intervalFor(outcome))
    })
  }, [target])

  useEffect(() => {
    if (!enabled) return undefined
    generationRef.current += 1
    const generation = generationRef.current
    timerRef.current = window.setTimeout(() => poll(generation), 0)

    return () => {
      generationRef.current += 1
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    }
  }, [enabled, poll])

  const reread = useCallback(() => {
    if (!enabled) return
    generationRef.current += 1
    const generation = generationRef.current
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => poll(generation), 0)
  }, [enabled, poll])

  return {
    read: enabled && held.target === target ? held.read : null,
    unavailable: enabled && held.target === target && held.unavailable,
    reread,
  }
}
