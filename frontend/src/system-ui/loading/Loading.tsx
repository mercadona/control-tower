import classNames from 'classnames'
import { HTMLAttributes } from 'react'
import './Loading.css'

type LoadingProps = Omit<HTMLAttributes<HTMLSpanElement>, 'role' | 'children'>

const Loading = ({ 'aria-label': ariaLabel = 'Cargando', className, ...rest }: LoadingProps) => (
  <span
    {...rest}
    className={classNames('loading', className)}
    role="status"
    aria-label={ariaLabel}
  >
    <span className="loading__dot" aria-hidden="true" />
    <span className="loading__dot" aria-hidden="true" />
    <span className="loading__dot" aria-hidden="true" />
  </span>
)

export { Loading }
export type { LoadingProps }
