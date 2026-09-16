import classNames from 'classnames'
import { ReactNode, useId, useState } from 'react'
import { Button } from 'system-ui/button'
import { SidebarRightIcon } from 'system-ui/icons/NavIcons'
import './Drawer.css'

const TOGGLE_ICON_SIZE = 24
const EXPAND_LABEL = 'Desplegar el panel'
const COLLAPSE_LABEL = 'Contraer el panel'

interface DrawerProps {
  title?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  defaultCollapsed?: boolean
  collapsed?: boolean
  onToggle?: (collapsed: boolean) => void
  toggleLabel?: string
  className?: string
}

const Drawer = ({
  title,
  actions,
  children,
  defaultCollapsed = false,
  collapsed,
  onToggle,
  toggleLabel,
  className,
}: DrawerProps) => {
  const [internalCollapsed, setInternalCollapsed] = useState(defaultCollapsed)
  const isControlled = collapsed != null
  const isCollapsed = isControlled ? collapsed : internalCollapsed
  const titleId = useId()
  const contentId = useId()
  const hasTitle = title != null

  const toggle = () => {
    const next = !isCollapsed
    onToggle?.(next)
    if (!isControlled) setInternalCollapsed(next)
  }

  const label = toggleLabel ?? (isCollapsed ? EXPAND_LABEL : COLLAPSE_LABEL)

  return (
    <aside
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
          </div>
        )}

        {!isCollapsed && actions != null && <div className="drawer__actions">{actions}</div>}
      </div>

      <div id={contentId} className="drawer__content" hidden={isCollapsed}>
        {children}
      </div>
    </aside>
  )
}

export { Drawer }
export type { DrawerProps }
