import { ReactNode } from 'react'
import './GateLayout.css'

type GateLayoutProps = {
  heading: string
  children?: ReactNode
  actions?: ReactNode
}

const GateLayout = ({ heading, children, actions }: GateLayoutProps) => (
  <div className="gate-layout">
    <div className="gate-layout__body">
      <p className="gate-layout__heading lg-body-medium">{heading}</p>
      {children}
    </div>
    {actions !== undefined && <div className="gate-layout__actions">{actions}</div>}
  </div>
)

const GateNotice = ({ children }: { children: ReactNode }) => (
  <p className="gate-layout__notice lg-footnote-regular">{children}</p>
)

const GateList = ({ children }: { children: ReactNode }) => (
  <ul className="gate-layout__list">{children}</ul>
)

const GateListItem = ({ children }: { children: ReactNode }) => (
  <li className="gate-layout__list-item lg-footnote-regular">{children}</li>
)

const GateLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <a className="gate-layout__link" href={href}>{children}</a>
)

export { GateLayout, GateLink, GateList, GateListItem, GateNotice }
export type { GateLayoutProps }
