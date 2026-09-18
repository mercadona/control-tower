import { useEffect, useState } from 'react'
import { LiveAsk } from 'app/coordinating-session/CoordinatingSession.types'
import { GroomSessionOutcome } from 'app/epic-groom/EpicGroom.types'

const useAskRead = (session: GroomSessionOutcome | null, liveAsk: LiveAsk | null): boolean => {
  const [readAsk, setReadAsk] = useState<GroomSessionOutcome | null>(null)

  useEffect(() => {
    if (session === null || session.kind !== 'typed' || liveAsk !== 'working') return
    setReadAsk(session)
  }, [session, liveAsk])

  return session !== null && readAsk === session
}

export { useAskRead }
