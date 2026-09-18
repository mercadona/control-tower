import classNames from 'classnames'
import { createElement, CSSProperties, HTMLAttributes, ReactNode, useId, useState } from 'react'
import { Button } from 'system-ui/button'
import './CollapsableCard.css'

type CollapsableCardHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

interface CollapsableCardProps extends Omit<HTMLAttributes<HTMLElement>, 'onToggle'> {
  heading: string
  level?: CollapsableCardHeadingLevel
  subtitle?: ReactNode
  defaultExpanded?: boolean
  expanded?: boolean
  onToggle?: (expanded: boolean) => void
  children?: ReactNode
  contentId?: string
}

const COLLAPSE = 'Colapsar'
const EXPAND = 'Expandir'
const NO_ROOM: CSSProperties = { display: 'none' }

const ChevronIcon = ({ isExpanded }: { isExpanded: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    className={classNames('collapsable-card__chevron', { 'collapsable-card__chevron--open': isExpanded })}
    aria-hidden="true"
    focusable="false"
  >
    <path d="m3 6 5 5 5-5" />
  </svg>
)

const CollapsableCard = ({
  heading,
  level = 2,
  subtitle,
  defaultExpanded = false,
  expanded,
  onToggle,
  children,
  contentId,
  className,
  hidden,
  style,
  ...rest
}: CollapsableCardProps) => {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const isControlled = expanded !== undefined
  const isExpanded = isControlled ? expanded : internalExpanded
  const generatedId = useId()
  const titleId = `${generatedId}-title`
  const resolvedContentId = contentId ?? `${generatedId}-content`
  const hasBody = children !== undefined

  const toggle = () => {
    const next = !isExpanded
    onToggle?.(next)
    if (!isControlled) setInternalExpanded(next)
  }

  const headingElement = createElement(
    `h${level}`,
    { id: titleId, className: 'collapsable-card__title lg-body-medium' },
    heading,
  )

  return (
    <section
      {...rest}
      hidden={hidden}
      style={hidden === true ? { ...style, ...NO_ROOM } : style}
      className={classNames('collapsable-card', className)}
    >
      <div className="collapsable-card__header">
        {headingElement}
        <Button
          variant="secondary"
          aria-label={isExpanded ? COLLAPSE : EXPAND}
          aria-expanded={isExpanded}
          aria-controls={hasBody ? resolvedContentId : undefined}
          onClick={toggle}
          iconStart={<ChevronIcon isExpanded={isExpanded} />}
        />
      </div>
      {subtitle !== undefined && (
        <p
          className={classNames('collapsable-card__subtitle', 'lg-footnote-regular', {
            'collapsable-card__subtitle--clamped': !isExpanded,
          })}
        >
          {subtitle}
        </p>
      )}
      {hasBody && (
        <div
          className={classNames('collapsable-card__content-wrap', {
            'collapsable-card__content-wrap--open': isExpanded,
          })}
          aria-hidden={!isExpanded}
        >
          <div className="collapsable-card__content-clip">
            <div id={resolvedContentId} className="collapsable-card__content-body" role="region" aria-labelledby={titleId}>
              {children}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export { CollapsableCard }
export type { CollapsableCardHeadingLevel, CollapsableCardProps }
