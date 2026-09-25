import { useEffect, useState } from 'react'

const TICK_MS = 1000

export const useSecondTick = (): number => {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS)

    return () => window.clearInterval(timer)
  }, [])

  return now
}
