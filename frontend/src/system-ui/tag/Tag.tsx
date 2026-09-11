import classNames from 'classnames'
import { HTMLAttributes, ReactNode } from 'react'
import './Tag.css'

type TagVariant = 'success' | 'danger' | 'warning' | 'informative' | 'neutral'

interface TagProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  children: ReactNode
  variant?: TagVariant
}

const VARIANT_CLASS: Record<TagVariant, string> = {
  success: 'tag--success',
  danger: 'tag--danger',
  warning: 'tag--warning',
  informative: 'tag--informative',
  neutral: 'tag--neutral',
}

const Tag = ({ children, variant = 'neutral', className, ...rest }: TagProps) => (
  <span {...rest} className={classNames('tag', 'lg-caption1-medium-upp', VARIANT_CLASS[variant], className)}>
    {children}
  </span>
)

export { Tag }
export type { TagProps, TagVariant }
