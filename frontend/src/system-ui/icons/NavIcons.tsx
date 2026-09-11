import { SVGProps } from 'react'

interface NavIconProps extends SVGProps<SVGSVGElement> {
  size: number
}

const MenuToggleIcon = ({ size, ...rest }: NavIconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" {...rest}>
    <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
)

const RetryIcon = ({ size, ...rest }: NavIconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" {...rest}>
    <path
      d="M4 12a8 8 0 1 1 2.343 5.657M4 12V7M4 12h5"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </svg>
)

export { MenuToggleIcon, RetryIcon }
export type { NavIconProps }
