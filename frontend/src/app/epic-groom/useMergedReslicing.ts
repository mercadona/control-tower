import { useEffect, useRef } from 'react'
import type { EpicGroomRead } from 'app/epic-groom/useEpicGroom'

const useMergedReslicing = ({ read, held, press }: {
  read: EpicGroomRead
  held: boolean
  press: (planFingerprint: string) => Promise<void>
}): void => {
  const pressed = useRef(false)

  useEffect(() => {
    if (held || read.phase !== 'read' || read.kind !== 'groomable') return
    if (read.reslicing === null || read.key === null || pressed.current) return
    pressed.current = true
    void press(read.planFingerprint)
  })
}

export { useMergedReslicing }
