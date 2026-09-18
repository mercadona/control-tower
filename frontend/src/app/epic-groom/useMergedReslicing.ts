import { useEffect, useRef } from 'react'
import type { EpicGroomRead } from 'app/epic-groom/useEpicGroom'

const useMergedReslicing = ({ read, operationBusy, press }: {
  read: EpicGroomRead
  operationBusy: boolean
  press: (planFingerprint: string) => Promise<void>
}): void => {
  const pressed = useRef(false)

  useEffect(() => {
    if (operationBusy || read.phase !== 'read' || read.kind !== 'groomable') return
    if (read.reslicing === null || read.key === null || pressed.current) return
    pressed.current = true
    void press(read.planFingerprint)
  })
}

export { useMergedReslicing }
