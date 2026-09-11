import classNames from 'classnames'
import { ReactNode } from 'react'
import './MenuItem.css'

interface MenuItemProps {
  label: string
  detail?: string
  icon?: ReactNode
  active?: boolean
  collapsed?: boolean
  notifier?: ReactNode
  href?: string
  onClick?: () => void
  className?: string
}

const MenuItemContent = ({
  label,
  detail,
  icon,
  active,
  collapsed,
  notifier,
}: Required<Pick<MenuItemProps, 'active' | 'collapsed'>> & Pick<MenuItemProps, 'label' | 'detail' | 'icon' | 'notifier'>) => (
  <>
    {icon !== undefined && <span className="menu-item__icon">{icon}</span>}
    {!collapsed && (
      <span className="menu-item__text">
        <span className={classNames('menu-item__label', active ? 'lg-footnote-medium' : 'lg-footnote-regular')}>
          {label}
        </span>
        {detail !== undefined && <span className="menu-item__detail lg-caption1-regular">{detail}</span>}
      </span>
    )}
    {!collapsed && notifier !== undefined && <span className="menu-item__notifier">{notifier}</span>}
  </>
)

const MenuItem = ({
  label,
  detail,
  icon,
  active = false,
  collapsed = false,
  notifier,
  href,
  onClick,
  className,
}: MenuItemProps) => {
  const accessibleName = detail !== undefined ? `${label} — ${detail}` : label
  const controlClassName = classNames('menu-item__control', className, {
    'menu-item__control--collapsed': collapsed,
    'menu-item__control--active': active,
  })
  const content = (
    <MenuItemContent label={label} detail={detail} icon={icon} active={active} collapsed={collapsed} notifier={notifier} />
  )

  return (
    <li className="menu-item">
      {href !== undefined ? (
        <a
          className={controlClassName}
          href={href}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? accessibleName : undefined}
          aria-label={collapsed ? accessibleName : undefined}
          onClick={onClick}
        >
          {content}
        </a>
      ) : onClick !== undefined ? (
        <button
          type="button"
          className={controlClassName}
          aria-current={active ? 'page' : undefined}
          title={collapsed ? accessibleName : undefined}
          aria-label={collapsed ? accessibleName : undefined}
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        <div className={controlClassName} title={collapsed ? accessibleName : undefined} aria-label={collapsed ? accessibleName : undefined}>
          {content}
        </div>
      )}
    </li>
  )
}

export { MenuItem }
export type { MenuItemProps }
