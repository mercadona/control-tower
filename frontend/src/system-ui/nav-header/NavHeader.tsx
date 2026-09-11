import classNames from 'classnames'
import { ReactNode } from 'react'
import { Button } from 'system-ui/button'
import { MenuToggleIcon } from 'system-ui/icons/NavIcons'
import './NavHeader.css'

const TOGGLE_ICON_SIZE = 24

interface NavHeaderProps {
  productName: string
  logo: ReactNode
  collapsed?: boolean
  onToggle?: () => void
  className?: string
}

const NavHeader = ({ productName, logo, collapsed = false, onToggle, className }: NavHeaderProps) => (
  <div className={classNames('nav-header', { 'nav-header--collapsed': collapsed }, className)}>
    <span className="nav-header__product">
      <span className="nav-header__logo" aria-hidden="true">
        {logo}
      </span>
      {!collapsed && <span className="nav-header__name lg-headline-medium">{productName}</span>}
    </span>
    {onToggle !== undefined && (
      <Button
        className="nav-header__toggle"
        variant="tertiary"
        size="desktop"
        iconStart={<MenuToggleIcon size={TOGGLE_ICON_SIZE} />}
        aria-label={collapsed ? 'Expandir el menú' : 'Colapsar el menú'}
        aria-expanded={!collapsed}
        onClick={onToggle}
      />
    )}
  </div>
)

export { NavHeader }
export type { NavHeaderProps }
