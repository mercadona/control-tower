import classNames from 'classnames'
import { createElement, HTMLAttributes, ReactNode, useId } from 'react'
import './WorkflowStep.css'

type WorkflowStepStatus = 'completed' | 'active' | 'pending'
type WorkflowStepHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

interface WorkflowStepProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  level?: WorkflowStepHeadingLevel
  subtitle?: ReactNode
  status: WorkflowStepStatus
  children: ReactNode
  isExpanded: boolean
  onExpandedChange: (isExpanded: boolean) => void
  canCollapse?: boolean
  contentId?: string
  isAvailable?: boolean
}

const STATUS_CLASS: Record<WorkflowStepStatus, string> = {
  completed: 'workflow-step--completed',
  active: 'workflow-step--active',
  pending: 'workflow-step--pending',
}

const STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  completed: 'Completado',
  active: 'Activo',
  pending: 'Pendiente',
}

const WorkflowStep = ({
  title,
  level = 2,
  subtitle,
  status,
  children,
  isExpanded,
  onExpandedChange,
  canCollapse = true,
  contentId,
  isAvailable = status !== 'pending',
  className,
  ...rest
}: WorkflowStepProps) => {
  const generatedId = useId()
  const headerId = `${generatedId}-header`
  const titleId = `${generatedId}-title`
  const resolvedContentId = contentId ?? `${generatedId}-content`
  const indicator = (
    <span className="workflow-step__indicator" aria-hidden="true">
      {status === 'completed' && (
        <svg viewBox="0 0 16 16" className="workflow-step__check" focusable="false">
          <path d="m3.5 8.25 2.75 2.75 6.25-6.25" />
        </svg>
      )}
    </span>
  )
  const statusLabel = <span className="workflow-step__status lg-caption1-regular">{STATUS_LABEL[status]}</span>
  const header = canCollapse ? (
    <button
      id={headerId}
      type="button"
      className="workflow-step__header"
      aria-expanded={isExpanded}
      aria-controls={resolvedContentId}
      disabled={!isAvailable}
      onClick={() => onExpandedChange(!isExpanded)}
    >
      {indicator}
      <span id={titleId} className="workflow-step__title lg-body-medium">
        {title}
        {subtitle !== undefined && <span className="workflow-step__subtitle lg-caption1-regular">{subtitle}</span>}
      </span>
      {statusLabel}
      <span className="workflow-step__chevron-cell">
        <svg viewBox="0 0 16 16" className="workflow-step__chevron" aria-hidden="true" focusable="false">
          <path d="m3 6 5 5 5-5" />
        </svg>
      </span>
    </button>
  ) : (
    <div id={headerId} className="workflow-step__header workflow-step__header--static">
      {indicator}
      <span className="workflow-step__title-group">
        {createElement(`h${level}`, { id: titleId, className: 'workflow-step__title lg-body-medium' }, title)}
        {subtitle !== undefined && <span className="workflow-step__subtitle lg-caption1-regular">{subtitle}</span>}
      </span>
      {statusLabel}
    </div>
  )
  return (
    <section {...rest} className={classNames('workflow-step', STATUS_CLASS[status], className)}>
      {header}
      <div
        className={classNames('workflow-step__content-wrap', { 'workflow-step__content-wrap--open': isExpanded })}
        aria-hidden={!isExpanded}
      >
        <div className="workflow-step__content-clip">
          <div id={resolvedContentId} className="workflow-step__content-body" role="region" aria-labelledby={titleId}>
            {children}
          </div>
        </div>
      </div>
    </section>
  )
}

export { WorkflowStep }
export type { WorkflowStepHeadingLevel, WorkflowStepProps, WorkflowStepStatus }
