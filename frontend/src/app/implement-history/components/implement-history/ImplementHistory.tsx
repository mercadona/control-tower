import { ImplementationHistoryEntry } from 'app/implement-history/ImplementHistory.types'
import { useImplementHistory } from 'app/implement-history/useImplementHistory'
import { STEP_LABELS } from 'app/implement-progress/ImplementProgress.types'
import { Banner } from 'system-ui/banner'
import './ImplementHistory.css'

const HEADING = 'Pasos completados'
const EMPTY_MESSAGE = 'Todavía no ha terminado ningún paso'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'

const OUTCOME_LABELS: Record<string, string> = {
  done: 'Hecho',
  failed: 'Fallido',
  'up-to-date': 'Al día',
}

const outcomeLabel = (outcome: string): string => OUTCOME_LABELS[outcome] ?? outcome

const durationLabel = (durationMs: number): string => `${Math.round(durationMs / 1000)} s`

type ImplementHistoryProps = {
  issue: number
  root: string
  repo: string
}

const rowOf = (entry: ImplementationHistoryEntry, index: number) => (
  <li className="implement-history__row lg-body-medium" role="listitem" key={index}>
    <span className="implement-history__step">{STEP_LABELS[entry.step]}</span>
    {entry.task !== null && <span className="implement-history__task">{`Tarea ${entry.task}`}</span>}
    {entry.outcome !== null && <span className="implement-history__outcome">{outcomeLabel(entry.outcome)}</span>}
    {entry.durationMs !== null && <span className="implement-history__duration">{durationLabel(entry.durationMs)}</span>}
    {entry.summary !== null && (
      <details className="implement-history__summary">
        <summary>Resumen</summary>
        <p>{entry.summary}</p>
      </details>
    )}
  </li>
)

const ImplementHistory = ({ issue, root, repo }: ImplementHistoryProps) => {
  const history = useImplementHistory(issue, root, repo)

  return (
    <section className="implement-history" aria-label={HEADING}>
      <h2 className="implement-history__heading lg-title4-semibold">{HEADING}</h2>
      {history.phase === 'read' && history.entries.length === 0 && (
        <p className="implement-history__state" role="status">{EMPTY_MESSAGE}</p>
      )}
      {history.phase === 'read' && history.entries.length > 0 && (
        <ul className="implement-history__list" role="list" aria-label={HEADING}>
          {history.entries.map(rowOf)}
        </ul>
      )}
      {history.phase === 'refused' && <Banner type="error" role="alert" title={history.error} />}
      {history.phase === 'unreachable' && (
        <p className="implement-history__state" role="status">{UNREACHABLE_MESSAGE}</p>
      )}
    </section>
  )
}

export { ImplementHistory }
export type { ImplementHistoryProps }
