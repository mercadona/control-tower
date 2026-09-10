import classNames from 'classnames'
import { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'link' | 'danger' | 'danger-ghost'
type ButtonSize = 'desktop' | 'mobile'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  children?: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  type?: 'button' | 'submit' | 'reset'
  fullWidth?: boolean
  iconStart?: ReactNode
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'button--primary',
  secondary: 'button--secondary',
  tertiary: 'button--tertiary',
  link: 'button--link',
  danger: 'button--danger',
  'danger-ghost': 'button--danger-ghost',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  desktop: 'button--desktop',
  mobile: 'button--mobile',
}

const Button = ({
  children,
  variant = 'primary',
  size = 'desktop',
  type = 'button',
  fullWidth = false,
  iconStart,
  className,
  ...rest
}: ButtonProps) => {
  const hasLabel = children !== undefined && children !== null && children !== ''
  const isIconOnly = !hasLabel && iconStart !== undefined

  return (
    <button
      {...rest}
      type={type}
      className={classNames(
        'button',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        { 'button--full-width': fullWidth, 'button--icon-only': isIconOnly },
        className,
      )}
    >
      <span className="button__state-layer">
        {iconStart !== undefined && (
          <span className="button__icon-start" aria-hidden="true">{iconStart}</span>
        )}
        {hasLabel && <span className="button__label lg-footnote-medium">{children}</span>}
      </span>
    </button>
  )
}

export { Button }
export type { ButtonProps, ButtonSize, ButtonVariant }
