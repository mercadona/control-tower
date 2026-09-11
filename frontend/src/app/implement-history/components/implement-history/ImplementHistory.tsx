import classNames from 'classnames'
import { ComponentType, useState } from 'react'
import { ImplementationHistoryEntry } from 'app/implement-history/ImplementHistory.types'
import { useImplementHistory } from 'app/implement-history/useImplementHistory'
import { ImplementationStep, STEP_SHORT_LABELS } from 'app/implement-progress/ImplementProgress.types'
import { Banner } from 'system-ui/banner'
import { StatusIconProps, StatusInfoIcon, StatusKoIcon, StatusSuccessIcon } from 'system-ui/icons/StatusIcons'
import { Tag, TagVariant } from 'system-ui/tag'
import { WorkflowStep } from 'system-ui/workflow-step'
import './ImplementHistory.css'

const HEADING = 'Recorrido por tarea'
const EMPTY_MESSAGE = 'Todavía no ha terminado ningún paso'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
const CLOSING_HEADING = 'Cierre del slice'
const AGENT_SUMMARY_LABEL = 'Qué hizo el agente'
const ICON_SIZE = 16

const CLOSING_LABELS: Partial<Record<ImplementationStep, string>> = {
  [ImplementationStep.RECONCILE]: 'Reconciliar con main',
  [ImplementationStep.GLOBAL]: 'Verificación global',
  [ImplementationStep.SLICE_JUDGE]: 'Juez del slice',
}

type TaskGroup = {
  task: number
  taskName: string | null
  entries: ImplementationHistoryEntry[]
}

type ImplementHistoryProps = {
  issue: number
  root: string
  repo: string
}

const groupByTask = (entries: ImplementationHistoryEntry[]): TaskGroup[] => {
  const groups: TaskGroup[] = []
  const indexByTask = new Map<number, number>()
  for (const entry of entries) {
    if (entry.task === null) continue
    let index = indexByTask.get(entry.task)
    if (index === undefined) {
      index = groups.length
      indexByTask.set(entry.task, index)
      groups.push({ task: entry.task, taskName: entry.taskName, entries: [] })
    }
    groups[index].entries.push(entry)
  }
  return groups
}

const closingEntriesOf = (entries: ImplementationHistoryEntry[]): ImplementationHistoryEntry[] =>
  entries.filter((entry) => entry.task === null)

const isTaskDone = (group: TaskGroup): boolean =>
  group.entries.some((entry) => entry.step === ImplementationStep.JUDGE && entry.outcome === 'done')

const tasksTotalOf = (entries: ImplementationHistoryEntry[], groups: TaskGroup[]): number => {
  const declared = entries.reduce<number | null>(
    (max, entry) => (entry.tasksTotal !== null && (max === null || entry.tasksTotal > max) ? entry.tasksTotal : max),
    null,
  )
  return declared ?? groups.length
}

const countImplementRows = (entries: ImplementationHistoryEntry[]): number =>
  entries.filter((entry) => entry.step === ImplementationStep.IMPLEMENT).length

const countFailedRows = (entries: ImplementationHistoryEntry[]): number =>
  entries.filter((entry) => entry.outcome === 'failed').length

const sumTokens = (entries: ImplementationHistoryEntry[]): number =>
  entries.reduce((total, entry) => total + (entry.toolTotalTokens ?? 0), 0)

const sumFindings = (entries: ImplementationHistoryEntry[]): number =>
  entries.reduce((total, entry) => total + (entry.findingsTotal ?? 0), 0)

const formatMillions = (tokens: number): string => `${(tokens / 1_000_000).toFixed(1).replace('.', ',')} M`

const formatSeconds = (durationMs: number): string => `${(durationMs / 1000).toFixed(1).replace('.', ',')} s`

const formatLocalTime = (writtenAt: string): string =>
  new Date(writtenAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })

const iconFor = (outcome: string | null): ComponentType<StatusIconProps> => {
  if (outcome === 'done') return StatusSuccessIcon
  if (outcome === 'failed') return StatusKoIcon
  return StatusInfoIcon
}

const tagVariantFor = (outcome: string | null): TagVariant => {
  if (outcome === 'done') return 'success'
  if (outcome === 'failed') return 'danger'
  return 'informative'
}

const closingTagText = (entry: ImplementationHistoryEntry): string | null => {
  if (entry.outcome === 'up-to-date') return 'al día'
  if (entry.ruling !== null) return entry.ruling
  return null
}

const failureNoteOf = (entry: ImplementationHistoryEntry): string => {
  const label = STEP_SHORT_LABELS[entry.step] ?? entry.step
  const time = entry.writtenAt !== null ? formatLocalTime(entry.writtenAt) : '--:--'
  const base = `Intento ${entry.attempt} · ${label} fallidos a las ${time}`
  return entry.durationMs !== null ? `${base} tras ${entry.durationMs} ms` : base
}

const StepperNode = ({ entry }: { entry: ImplementationHistoryEntry }) => {
  const Icon = iconFor(entry.outcome)
  const showJudgeRuling = entry.step === ImplementationStep.JUDGE && entry.ruling !== null

  return (
    <li
      className={classNames('implement-history__stepper-node', {
        'implement-history__stepper-node--danger-before': entry.outcome === 'failed',
      })}
    >
      <Icon size={ICON_SIZE} aria-hidden="true" />
      <span className="implement-history__stepper-label lg-footnote-medium">
        {STEP_SHORT_LABELS[entry.step] ?? entry.step}
      </span>
      {entry.durationMs !== null && (
        <span className="implement-history__stepper-duration lg-caption1-regular">{formatSeconds(entry.durationMs)}</span>
      )}
      {showJudgeRuling && <Tag variant={tagVariantFor(entry.outcome)}>{entry.ruling}</Tag>}
      {entry.findingsTotal !== null && entry.findingsTotal > 0 && (
        <Tag variant="warning">{`${entry.findingsTotal} hallazgo(s)`}</Tag>
      )}
    </li>
  )
}

const TaskAccordion = ({
  group,
  isExpanded,
  onExpandedChange,
}: {
  group: TaskGroup
  isExpanded: boolean
  onExpandedChange: (isExpanded: boolean) => void
}) => {
  const completed = isTaskDone(group)
  const failedEntry = group.entries.find((entry) => entry.outcome === 'failed')
  const lastSummaryEntry = [...group.entries].reverse().find(
    (entry) => entry.step === ImplementationStep.IMPLEMENT && entry.summary !== null,
  )

  return (
    <WorkflowStep
      title={`Tarea ${group.task}`}
      subtitle={completed ? group.taskName : `${group.taskName ?? ''} · en curso`}
      status={completed ? 'completed' : 'active'}
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
    >
      <ol className="implement-history__stepper" role="list">
        {group.entries.map((entry, index) => (
          <StepperNode entry={entry} key={index} />
        ))}
      </ol>
      {failedEntry !== undefined && (
        <p className="implement-history__failure-note lg-footnote-medium">{failureNoteOf(failedEntry)}</p>
      )}
      <dl className="implement-history__facts">
        <div className="implement-history__fact">
          <dt className="lg-caption1-regular">Intentos</dt>
          <dd className="lg-body-medium">{countImplementRows(group.entries)}</dd>
        </div>
        <div className="implement-history__fact">
          <dt className="lg-caption1-regular">Hallazgos del juez</dt>
          <dd className="lg-body-medium">{sumFindings(group.entries)}</dd>
        </div>
        <div className="implement-history__fact">
          <dt className="lg-caption1-regular">Tokens</dt>
          <dd className="lg-body-medium">{formatMillions(sumTokens(group.entries))}</dd>
        </div>
      </dl>
      {lastSummaryEntry !== undefined && (
        <details className="implement-history__agent-summary">
          <summary>{AGENT_SUMMARY_LABEL}</summary>
          <p>{lastSummaryEntry.summary}</p>
        </details>
      )}
    </WorkflowStep>
  )
}

const ClosingSection = ({ entries }: { entries: ImplementationHistoryEntry[] }) => {
  if (entries.length === 0) return null

  return (
    <section className="implement-history__closing" aria-label={CLOSING_HEADING}>
      <h3 className="implement-history__closing-heading lg-body-medium">{CLOSING_HEADING}</h3>
      <ul className="implement-history__closing-list" role="list">
        {entries.map((entry, index) => {
          const Icon = iconFor(entry.outcome)
          const tagText = closingTagText(entry)
          return (
            <li className="implement-history__closing-row" role="listitem" key={index}>
              <Icon size={ICON_SIZE} aria-hidden="true" />
              <span className="lg-body-medium">{CLOSING_LABELS[entry.step] ?? entry.step}</span>
              {tagText !== null && <Tag variant={tagVariantFor(entry.outcome)}>{tagText}</Tag>}
              {tagText === null && entry.durationMs !== null && (
                <span className="implement-history__closing-duration lg-caption1-regular">{formatSeconds(entry.durationMs)}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const SummaryTiles = ({ entries, groups }: { entries: ImplementationHistoryEntry[]; groups: TaskGroup[] }) => {
  const tasksDone = groups.filter(isTaskDone).length
  const tasksTotal = tasksTotalOf(entries, groups)
  const attemptsCount = countImplementRows(entries)
  const failedCount = countFailedRows(entries)
  const tokensTotal = sumTokens(entries)

  return (
    <div className="implement-history__tiles">
      <div className="implement-history__tile">
        <span className="implement-history__tile-label lg-caption1-regular">Tareas</span>
        <span className="implement-history__tile-value lg-title4-semibold">{`${tasksDone} de ${tasksTotal}`}</span>
      </div>
      <div className="implement-history__tile">
        <span className="implement-history__tile-label lg-caption1-regular">Intentos</span>
        <span className="implement-history__tile-value lg-title4-semibold">{attemptsCount}</span>
        {failedCount > 0 && <span className="implement-history__tile-note lg-caption1-regular">{`${failedCount} fallido(s)`}</span>}
      </div>
      <div className="implement-history__tile">
        <span className="implement-history__tile-label lg-caption1-regular">Tokens</span>
        <span className="implement-history__tile-value lg-title4-semibold">{formatMillions(tokensTotal)}</span>
      </div>
    </div>
  )
}

const TaskJourney = ({ entries }: { entries: ImplementationHistoryEntry[] }) => {
  const groups = groupByTask(entries)
  const closing = closingEntriesOf(entries)
  const [expandedOverrides, setExpandedOverrides] = useState<Record<number, boolean>>({})
  const allTasksDone = groups.length > 0 && groups.every(isTaskDone)

  return (
    <>
      <SummaryTiles entries={entries} groups={groups} />
      {groups.map((group, index) => {
        const isLastTask = index === groups.length - 1
        const defaultExpanded = allTasksDone ? isLastTask : !isTaskDone(group)
        return (
          <TaskAccordion
            group={group}
            isExpanded={expandedOverrides[group.task] ?? defaultExpanded}
            onExpandedChange={(isExpanded) => setExpandedOverrides((previous) => ({ ...previous, [group.task]: isExpanded }))}
            key={group.task}
          />
        )
      })}
      <ClosingSection entries={closing} />
    </>
  )
}

const ImplementHistory = ({ issue, root, repo }: ImplementHistoryProps) => {
  const history = useImplementHistory(issue, root, repo)

  return (
    <section className="implement-history" aria-label={HEADING}>
      <h2 className="implement-history__heading lg-title4-semibold">{HEADING}</h2>
      {history.phase === 'read' && history.entries.length === 0 && (
        <p className="implement-history__state" role="status">{EMPTY_MESSAGE}</p>
      )}
      {history.phase === 'read' && history.entries.length > 0 && <TaskJourney entries={history.entries} />}
      {history.phase === 'refused' && <Banner type="error" role="alert" title={history.error} />}
      {history.phase === 'unreachable' && (
        <p className="implement-history__state" role="status">{UNREACHABLE_MESSAGE}</p>
      )}
    </section>
  )
}

export { ImplementHistory }
export type { ImplementHistoryProps }
