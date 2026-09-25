import { SessionStage, SessionStep } from 'app/focused-session/SessionStage'
import { StepIndicator } from 'app/focused-session/components/step-indicator'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import './FocusedSessionHeader.css'

const TALK_LABEL = 'Hablar con la sesión'

type FocusedSessionHeaderProps = {
  step: SessionStep
  story: string
  repo: string
  closing: boolean
  closeError: string | null
  onCancel: () => void
  onTalk?: (() => void) | null
}

const FocusedSessionHeader = ({ step, story, repo, closing, closeError, onCancel, onTalk }: FocusedSessionHeaderProps) => (
  <header className="focused-session-header">
    <div className="focused-session-header__identity">
      <div className="focused-session-header__titles">
        <h1 className="focused-session-header__title lg-title3-semibold">{SessionStage.LABEL[step]}</h1>
        <p className="focused-session-header__story lg-body-regular">{story} · <code>{repo}</code></p>
      </div>
      {onTalk !== undefined && (
        <Button variant="secondary" disabled={onTalk === null} onClick={onTalk ?? undefined}>{TALK_LABEL}</Button>
      )}
      <Button variant="secondary" disabled={closing} onClick={onCancel}>
        {closing ? 'Cancelando…' : 'Cancelar la sesión'}
      </Button>
    </div>
    {closeError !== null && <Banner type="error" role="alert" title={closeError} />}
    <StepIndicator current={step} />
  </header>
)

export { FocusedSessionHeader }
export type { FocusedSessionHeaderProps }
