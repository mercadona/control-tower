import classNames from 'classnames'
import { ComponentPropsWithoutRef, KeyboardEvent, ReactNode, useRef, useState } from 'react'
import './Tabs.css'

interface TabOption {
  value: string
  label: ReactNode
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
}

interface TabsProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'role' | 'onChange'> {
  options: TabOption[]
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
}

const Tabs = ({ options, value, defaultValue, onChange, className, ...rest }: TabsProps) => {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const firstEnabled = options.find((option) => !option.disabled)
  const [internalValue, setInternalValue] = useState(defaultValue ?? firstEnabled?.value ?? options[0]?.value)

  const isControlled = value != null
  const activeValue = isControlled ? value : internalValue

  const selectTab = (next: string) => {
    if (!isControlled) setInternalValue(next)
    onChange?.(next)
  }

  const enabledOptions = options.filter((option) => !option.disabled)

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = enabledOptions.findIndex((option) => option.value === activeValue)
    if (currentIndex === -1) return

    const lastIndex = enabledOptions.length - 1
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1
    if (event.key === 'ArrowLeft') nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = lastIndex
    if (nextIndex === null) return

    event.preventDefault()
    const nextOption = enabledOptions[nextIndex]
    if (nextOption == null) return
    selectTab(nextOption.value)
    tabRefs.current[nextOption.value]?.focus()
  }

  return (
    <div {...rest} role="tablist" className={classNames('tabs', className)}>
      {options.map((option) => {
        const isActive = option.value === activeValue
        const hasIcon = option.icon != null
        const hasBadge = option.badge != null

        return (
          <button
            key={option.value}
            ref={(element) => {
              tabRefs.current[option.value] = element
            }}
            type="button"
            role="tab"
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            disabled={option.disabled}
            className={classNames('tabs__tab', { 'tabs__tab--active': isActive })}
            onClick={() => selectTab(option.value)}
            onKeyDown={handleKeyDown}
          >
            {hasIcon && (
              <span className="tabs__icon" aria-hidden="true">
                {option.icon}
              </span>
            )}
            <span className="tabs__label">
              <span className={classNames('tabs__label-ghost', 'lg-body-medium')} aria-hidden="true">
                {option.label}
              </span>
              <span className={classNames('tabs__label-text', isActive ? 'lg-body-medium' : 'lg-body-regular')}>
                {option.label}
              </span>
            </span>
            {hasBadge && <span className="tabs__badge">{option.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}

export { Tabs }
export type { TabOption, TabsProps }
