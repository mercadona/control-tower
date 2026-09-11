import classNames from 'classnames'
import { HTMLAttributes, ReactNode } from 'react'
import './TopBar.css'

interface TopBarProps extends HTMLAttributes<HTMLElement> {
  productName?: ReactNode
  breadcrumbs?: ReactNode
  logo?: ReactNode
  actions?: ReactNode
}

const TopBar = ({ productName, breadcrumbs, logo, actions, className, ...rest }: TopBarProps) => {
  return (
    <header {...rest} className={classNames('top-bar', className)}>
      <div className="top-bar__content">
        {logo !== undefined && (
          <span className="top-bar__logo" aria-hidden="true">
            {logo}
          </span>
        )}
        {breadcrumbs}
        {productName !== undefined && <span className="top-bar__product-name lg-body-medium">{productName}</span>}
      </div>
      {actions !== undefined && <div className="top-bar__actions">{actions}</div>}
    </header>
  )
}

export { TopBar }
export type { TopBarProps }
