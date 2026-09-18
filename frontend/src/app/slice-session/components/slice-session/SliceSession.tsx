import { useRef, useState } from 'react'
import { ImplementProgress } from 'app/implement-progress/components/implement-progress'
import { SliceSessionClient } from 'app/slice-session/client'
import { Banner } from 'system-ui/banner'
import { Button } from 'system-ui/button'
import { TextArea } from 'system-ui/text-area'
import './SliceSession.css'

const FIELD_LABEL = 'Pedir un cambio a esta conversación'
const SEND_LABEL = 'Enviar'
const DELIVERED_MESSAGE = 'Cambio entregado a la conversación del slice'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const TEXT_FIELD_ID = 'slice-session-text'

type SliceSessionProps = { issue: number; root: string; repo: string; agent: string }

type SendState =
  | { phase: 'idle' }
  | { phase: 'sending' }
  | { phase: 'delivered' }
  | { phase: 'refused'; error: string }
  | { phase: 'unreachable' }

const IDLE: SendState = { phase: 'idle' }

const SliceSession = ({ issue, root, repo, agent }: SliceSessionProps) => {
  const [text, setText] = useState('')
  const [state, setState] = useState<SendState>(IDLE)
  const isSendingRef = useRef(false)

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
      <ImplementProgress issue={issue} root={root} repo={repo} />
      <div className="slice-session__message">
        <label className="slice-session__label lg-caption1-regular" htmlFor={TEXT_FIELD_ID}>
          {FIELD_LABEL}
        </label>
        <TextArea
          id={TEXT_FIELD_ID}
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
    </section>
  )
}

export { SliceSession }
export type { SliceSessionProps }
