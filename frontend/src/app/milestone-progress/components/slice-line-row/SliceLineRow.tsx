import { useState } from 'react'
import type { RecoveryAction } from 'app/active-plans/ActivePlan.types'
import { ElapsedTime } from 'app/milestone-progress/ElapsedTime'
import type { SliceAttention, SliceLine } from 'app/milestone-progress/MilestoneProgress.types'
import { SliceRecovery } from 'app/milestone-progress/SliceRecovery'
import { Button } from 'system-ui/button'
import { StatusSuccessIcon, StatusWarningIcon } from 'system-ui/icons/StatusIcons'
import { SliceLineCopy } from './SliceLineCopy'
import './SliceLineRow.css'

const PENDING_LABEL = 'Pendiente'
const DELIVERED_LABEL = 'Entregada'
const EXPAND_LABEL = 'Ver tareas'
const COLLAPSE_LABEL = 'Ocultar tareas'
const TALK_LABEL = 'Hablar con la sesión'

type SliceLineRowProps = {
  line: SliceLine
  now: number
  onTalk: (() => void) | null
  repo: string
  onReread: () => void
}

type AttentionBlockProps = {
  attention: SliceAttention
  onTalk: (() => void) | null
  repo: string
  issue: number
  onReread: () => void
}

const AttentionBlock = ({ attention, onTalk, repo, issue, onReread }: AttentionBlockProps) => {
  const [pending, setPending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const copy = SliceLineCopy.attention(attention)

  const recover = async (action: RecoveryAction) => {
    setPending(true)
    setRefusal(null)
    const outcome = await SliceRecovery.run({ repo, issue, action })
    setPending(false)
    if (outcome.kind === 'refused') setRefusal(outcome.detail)
    onReread()
  }

  return (
    <div className="slice-line-row__attention">
      <p className="slice-line-row__attention-title">{copy.title}</p>
      {copy.findings !== null && (
        <p className="slice-line-row__attention-findings">{`Lo que encontró el juez: ${copy.findings}`}</p>
      )}
      <p className="slice-line-row__attention-detail">{copy.detail}</p>
      {attention.kind === 'uncertain' ? (
        <Button variant="secondary" disabled={pending} onClick={() => void recover(attention.action)}>
          {SliceRecovery.LABELS[attention.action]}
        </Button>
      ) : (
        <Button disabled={onTalk === null} onClick={onTalk ?? undefined}>{TALK_LABEL}</Button>
      )}
      {refusal !== null && <p className="slice-line-row__attention-refusal">{refusal}</p>}
    </div>
  )
}

const SliceLineRow = ({ line, now, onTalk, repo, onReread }: SliceLineRowProps) => {
  const [expanded, setExpanded] = useState(false)
  const canExpand = line.state === 'running'

  return (
    <div className={`slice-line-row${line.attention !== null ? ' slice-line-row--attention' : ''}`}>
      <div className="slice-line-row__summary">
        <span className={`slice-line-row__mark slice-line-row__mark--${line.attention !== null ? 'attention' : line.state}`} aria-hidden="true">
          {line.attention !== null ? <StatusWarningIcon size={20} /> : line.state === 'delivered' ? <StatusSuccessIcon size={20} /> : null}
        </span>
        <span className="slice-line-row__number">{`#${line.number}`}</span>
        <span className="slice-line-row__title">{line.title}</span>
        {line.state === 'pending' && <span className="slice-line-row__status">{PENDING_LABEL}</span>}
        {line.state === 'running' && <span className="slice-line-row__status">{SliceLineCopy.runningLabel(line, now)}</span>}
        {line.state === 'delivered' && (
          <span className="slice-line-row__status">
            {DELIVERED_LABEL}
          </span>
        )}
        {line.pullRequest !== null && (
          <a href={line.pullRequest.url} target="_blank" rel="noreferrer">
            {`Pull request #${line.pullRequest.number}`}
          </a>
        )}
        {canExpand && (
          <button
            type="button"
            className="slice-line-row__toggle"
            aria-expanded={expanded}
            aria-label={expanded ? COLLAPSE_LABEL : EXPAND_LABEL}
            onClick={() => setExpanded((current) => !current)}
          >
            <span className="slice-line-row__chevron" aria-hidden="true" />
          </button>
        )}
      </div>
      {line.attention !== null && (
        <AttentionBlock attention={line.attention} onTalk={onTalk} repo={repo} issue={line.number} onReread={onReread} />
      )}
      {canExpand && expanded && (
        <div className="slice-line-row__detail">
          <ul className="slice-line-row__tasks">
            {line.tasks.map((task) => (
              <li key={task.number} className="slice-line-row__task">
                <span className={`slice-line-row__task-mark slice-line-row__task-mark--${task.status}`} aria-hidden="true">
                  {task.status === 'done' && <StatusSuccessIcon size={14} />}
                </span>
                <span>{SliceLineCopy.taskTitle(task)}</span>
                <span>{SliceLineCopy.taskStatusLabel(task, line, now)}</span>
                {task.ruling !== null && <p className="slice-line-row__findings">{`Dictamen del juez: ${task.ruling}`}</p>}
                {task.findings !== null && (
                  <p className="slice-line-row__findings">{`Lo que encontró el juez: ${task.findings}`}</p>
                )}
              </li>
            ))}
          </ul>
          {line.stepStartedAt !== null && (
            <p className="slice-line-row__activity" role="status">
              {`El agente está trabajando · ${ElapsedTime.since(line.stepStartedAt, now)} en este paso`}
              {line.lastTool !== null && (
                <>
                  <br />
                  {`Última herramienta: ${line.lastTool.name}${line.lastTool.argument === null ? '' : ` · ${line.lastTool.argument}`}`}
                </>
              )}
              {line.lastText !== null && (
                <>
                  <br />
                  {`Último mensaje: «${line.lastText}»`}
                </>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export { SliceLineRow }
export type { SliceLineRowProps }
