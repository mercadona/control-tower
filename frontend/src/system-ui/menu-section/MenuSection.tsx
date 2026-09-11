import classNames from 'classnames'
import { ReactNode } from 'react'
import './MenuSection.css'

interface MenuSectionProps {
  title: string
  children: ReactNode
  collapsed?: boolean
  className?: string
}

const MenuSection = ({ title, children, collapsed = false, className }: MenuSectionProps) => (
  <div className={classNames('menu-section', className)}>
    {collapsed ? (
      <span className="menu-section__rule" aria-hidden="true" />
    ) : (
      <span className="menu-section__title lg-caption1-medium-upp">{title}</span>
    )}
    <ul className="menu-section__items" aria-label={title}>
      {children}
    </ul>
  </div>
)

export { MenuSection }
export type { MenuSectionProps }
