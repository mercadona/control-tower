import classNames from 'classnames'
import { HTMLAttributes, ReactNode, useId, useState } from 'react'
import { Button } from 'system-ui/button'
import { SidebarRightIcon } from 'system-ui/icons/SidebarIcons'
import './Drawer.css'

const TOGGLE_ICON_SIZE = 24

interface DrawerProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onToggle'> {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  defaultCollapsed?: boolean
  collapsed?: boolean
  onToggle?: (collapsed: boolean) => void
  toggleLabel?: string
}

const Drawer = ({
  title,
  subtitle,
  actions,
  children,
  defaultCollapsed = false,
  collapsed,
  onToggle,
  toggleLabel,
  className,
  ...rest
}: DrawerProps) => {
  const [ownCollapsed, setOwnCollapsed] = useState(defaultCollapsed)
  const isGoverned = collapsed !== undefined
  const isCollapsed = isGoverned ? collapsed : ownCollapsed
  const titleId = useId()
  const contentId = useId()
  const hasTitle = title !== undefined && title !== null

  const toggle = () => {
    const next = !isCollapsed
    onToggle?.(next)
    if (!isGoverned) setOwnCollapsed(next)
  }

  const label = toggleLabel ?? (isCollapsed ? 'Desplegar el panel' : 'Contraer el panel')

  return (
    <aside
      {...rest}
      className={classNames('drawer', { 'drawer--collapsed': isCollapsed }, className)}
      aria-labelledby={hasTitle ? titleId : undefined}
    >
      <div className="drawer__header">
        <Button
          className="drawer__toggle"
          variant="tertiary"
          size="desktop"
          iconStart={<SidebarRightIcon size={TOGGLE_ICON_SIZE} />}
          aria-label={label}
          aria-expanded={!isCollapsed}
          aria-controls={contentId}
          onClick={toggle}
        />
        {hasTitle && (
          <div className={classNames('drawer__header-text', { 'drawer__header-text--collapsed': isCollapsed })}>
            <h2 id={titleId} className="drawer__title lg-title4-semibold">{title}</h2>
            {subtitle !== undefined && subtitle !== null && !isCollapsed && (
              <p className="drawer__subtitle lg-body-regular">{subtitle}</p>
            )}
          </div>
        )}
        {!isCollapsed && actions !== undefined && actions !== null && (
          <div className="drawer__actions">{actions}</div>
        )}
      </div>
      <div id={contentId} className="drawer__content" hidden={isCollapsed}>
        {children}
      </div>
    </aside>
  )
}

export { Drawer }
export type { DrawerProps }
