import classNames from 'classnames'
import { HTMLAttributes, ReactNode } from 'react'
import './Navbar.css'

interface NavbarProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  header: ReactNode
  children: ReactNode
  footer?: ReactNode
  onFooterClick?: () => void
  footerLabel?: string
  footerDisabled?: boolean
  collapsed?: boolean
}

const Navbar = ({
  header,
  children,
  footer,
  onFooterClick,
  footerLabel,
  footerDisabled = false,
  collapsed = false,
  className,
  ...rest
}: NavbarProps) => (
  <nav {...rest} className={classNames('navbar', { 'navbar--collapsed': collapsed }, className)}>
    <div className="navbar__body">
      <div>{header}</div>
      <div className="navbar__sections">{children}</div>
    </div>
    {footer !== undefined &&
      (onFooterClick !== undefined ? (
        <button
          type="button"
          className={classNames('navbar__footer', 'navbar__footer--pressable')}
          onClick={onFooterClick}
          disabled={footerDisabled}
          aria-label={collapsed ? footerLabel : undefined}
        >
          {footer}
        </button>
      ) : (
        <div className="navbar__footer">{footer}</div>
      ))}
  </nav>
)

export { Navbar }
export type { NavbarProps }
