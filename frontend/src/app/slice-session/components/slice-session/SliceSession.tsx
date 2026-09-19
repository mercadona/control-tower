import { useRef, useState } from 'react'
import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import { useImplementProgress } from 'app/implement-progress/useImplementProgress'
import { SliceSessionClient } from 'app/slice-session/client'
import type { SlicePhase } from 'app/slice-session/SliceSession.types'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { TextArea } from 'system-ui/text-area'
import './SliceSession.css'

const FIELD_LABEL = 'Pedir un cambio a esta conversación'
const SEND_LABEL = 'Enviar'
const DELIVERED_MESSAGE = 'Cambio entregado a la conversación del slice'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const textFieldId = (issue: number) => `slice-session-text-${issue}`

type SliceSessionProps = { issue: number; root: string; repo: string; agent: string; phase: SlicePhase }

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'delivered' }
  | { phase: 'refused'; error: string }
  | { phase: 'unreachable' }

const IDLE: SendState = { phase: 'idle' }

const SliceSession = ({ issue, root, repo, agent, phase }: SliceSessionProps) => {
  const [text, setText] = useState('')
  const [state, setState] = useState<SendState>(IDLE)
  const isSendingRef = useRef(false)
  const progress = useImplementProgress(issue, root, repo)
  const offersMessage = phase === 'implementing'

  const send = async () => {
    if (isSendingRef.current || text.length === 0) return
    isSendingRef.current = true
    setState({ phase: 'sending' })
    const outcome = await SliceSessionClient.send({ issue, repo, agent, text })
    isSendingRef.current = false
    if (outcome.kind === 'delivered') {
      setText('')
      setState({ phase: 'delivered' })
      return
    }
    if (outcome.kind === 'backend-unreachable') {
      setState({ phase: 'unreachable' })
      return
    }
    setState({ phase: 'refused', error: outcome.error })
  }

  return (
    <section className="slice-session" aria-label={`Slice #${issue}`}>
      <h2 className="slice-session__title lg-body-medium">{`Slice #${issue}`}</h2>
      <ImplementProgress progress={progress} />
      {offersMessage && (
        <div className="slice-session__message">
          <label className="slice-session__label lg-caption1-regular" htmlFor={textFieldId(issue)}>
            {FIELD_LABEL}
          </label>
          <TextArea
            id={textFieldId(issue)}
            value={text}
            onChange={(event) => {
              setText(event.target.value)
              setState(IDLE)
            }}
          />
          <Button
            type="button"
            onClick={() => void send()}
            disabled={text.length === 0 || state.phase === 'sending'}
          >
            {SEND_LABEL}
          </Button>
          {state.phase === 'delivered' && (
            <p className="slice-session__success lg-caption1-regular" role="status">{DELIVERED_MESSAGE}</p>
          )}
          {state.phase === 'unreachable' && <Banner type="error" role="alert" title={UNREACHABLE_MESSAGE} />}
          {state.phase === 'refused' && <Banner type="error" role="alert" title={state.error} />}
        </div>
      )}
    </section>
  )
}

export { SliceSession }
export type { SliceSessionProps }
