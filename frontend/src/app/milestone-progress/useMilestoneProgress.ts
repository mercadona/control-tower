import { useCallback, useEffect, useRef, useState } from 'react'
import { MilestoneProgressClient } from 'app/milestone-progress/client'
import { MilestonePolling } from 'app/milestone-progress/MilestonePolling'
import type { MilestoneProgressOutcome } from 'app/milestone-progress/MilestoneProgress.types'

type MilestoneProgressLifecycle = {
  read: MilestoneProgressOutcome | null
  reread: () => void
}

export const useMilestoneProgress = (enabled: boolean): MilestoneProgressLifecycle => {
  const [read, setRead] = useState<MilestoneProgressOutcome | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const generationRef = useRef(0)

  const poll = useCallback((generation: number) => {
    void MilestoneProgressClient.read().then((outcome) => {
      if (generationRef.current !== generation) return
      setRead(outcome)
      timerRef.current = window.setTimeout(() => poll(generation), MilestonePolling.intervalFor(outcome))
    })
  }, [])

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

  return { read, reread }
}
