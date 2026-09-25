import { useState } from 'react'
import { OpenOutcome } from 'app/coordinating-session/CoordinatingSession.types'
import { SessionStep } from 'app/focused-session/SessionStage'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'

const TITLE = 'La sesión coordinadora se ha cerrado'
const IN_IMPLEMENTATION = 'Los slices siguen en marcha. Reábrela para volver a hablar con ellos; conserva lo que ya se habló.'
const BEFORE_IMPLEMENTATION = 'Reábrela para seguir; conserva lo que ya se habló.'
const REOPEN = 'Reabrir la sesión'
const IMPLEMENTATION_STEP = 'implementation'
const REOPEN_UNREACHABLE = 'No se ha podido confirmar la reapertura. Comprueba la conexión antes de reintentar.'

type SessionEndedNoticeProps = { step: SessionStep; busy: boolean; onReopen: () => Promise<OpenOutcome> }

const SessionEndedNotice = ({ step, busy, onReopen }: SessionEndedNoticeProps) => {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const description = step === IMPLEMENTATION_STEP ? IN_IMPLEMENTATION : BEFORE_IMPLEMENTATION

  const reopen = async () => {
    setPending(true)
    setError(null)
    const outcome = await onReopen()
    setPending(false)
    setError(outcome.kind === 'refused' ? outcome.error : outcome.kind === 'backend-unreachable' ? REOPEN_UNREACHABLE : null)
  }

  return (
    <>
      <Banner type="warning" role="alert" title={TITLE} description={(
        <>
          {description}
          <span className="focused-session__reopen">
            <Button disabled={busy || pending} onClick={() => void reopen()}>{REOPEN}</Button>
          </span>
        </>
      )} />
      {error !== null && <Banner type="error" role="alert" title={error} />}
    </>
  )
}

export { SessionEndedNotice }
export type { SessionEndedNoticeProps }
