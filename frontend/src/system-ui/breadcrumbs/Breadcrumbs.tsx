import classNames from 'classnames'
import { Fragment } from 'react'
import './Breadcrumbs.css'

interface Crumb {
  label: string
}

interface BreadcrumbsProps {
  items: Crumb[]
  className?: string
  'aria-label'?: string
}

const Breadcrumbs = ({ items, className, 'aria-label': ariaLabel = 'Ruta de navegación' }: BreadcrumbsProps) => (
  <nav className={classNames('breadcrumbs', className)} aria-label={ariaLabel}>
    <ol className="breadcrumbs__list">
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <Fragment key={item.label}>
            {index > 0 && (
              <li className="breadcrumbs__separator" aria-hidden="true">
                /
              </li>
            )}
            <li className="breadcrumbs__crumb">
              <span
                className={classNames(
                  'breadcrumbs__step',
                  isLast ? 'breadcrumbs__step--current lg-footnote-medium' : 'lg-footnote-regular',
                )}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            </li>
          </Fragment>
        )
      })}
    </ol>
  </nav>
)

export { Breadcrumbs }
export type { BreadcrumbsProps, Crumb }
