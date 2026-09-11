import classNames from 'classnames'
import { HTMLAttributes, ReactNode } from 'react'
import './Navigation.css'

interface NavigationProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode
  navbar?: ReactNode
  topBar?: ReactNode
}

const Navigation = ({ children, navbar, topBar, className, ...rest }: NavigationProps) => (
  <div {...rest} className={classNames('navigation', className)}>
    {navbar}
    <div className="navigation__main">
      {topBar}
      <div className="navigation__content">{children}</div>
    </div>
  </div>
)

export { Navigation }
export type { NavigationProps }
