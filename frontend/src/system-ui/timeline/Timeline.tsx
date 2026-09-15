import classNames from 'classnames'
import { HTMLAttributes, ReactNode } from 'react'
import './Timeline.css'

type TimelineItemStatus = 'past' | 'current'

interface TimelineItem {
  id: string
  label: ReactNode
  detail?: ReactNode
  timestamp?: ReactNode
  status: TimelineItemStatus
}

interface TimelineProps extends Omit<HTMLAttributes<HTMLOListElement>, 'children'> {
  items: readonly TimelineItem[]
}

const Timeline = ({ items, className, ...rest }: TimelineProps) => (
  <ol {...rest} className={classNames('timeline', className)}>
    {items.map((item) => (
      <li
        key={item.id}
        className={classNames('timeline__item', `timeline__item--${item.status}`)}
        aria-current={item.status === 'current' ? 'step' : undefined}
      >
        <span className="timeline__marker" aria-hidden="true" />
        <div className="timeline__content">
          <div className="timeline__heading">
            <span className="timeline__label lg-body-medium">{item.label}</span>
            {item.timestamp !== undefined && (
              <span className="timeline__timestamp lg-caption1-regular">{item.timestamp}</span>
            )}
          </div>
          {item.detail !== undefined && <p className="timeline__detail lg-caption1-regular">{item.detail}</p>}
        </div>
      </li>
    ))}
  </ol>
)

export { Timeline }
export type { TimelineItem, TimelineItemStatus, TimelineProps }
