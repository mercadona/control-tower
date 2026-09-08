import classNames from 'classnames'
import { TextareaHTMLAttributes } from 'react'
import './TextArea.css'

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  success?: boolean
}

const TextArea = ({ invalid = false, success = false, className, disabled, ...rest }: TextAreaProps) => (
  <div
    className={classNames(
      'text-area',
      {
        'text-area--error': invalid,
        'text-area--success': success && !invalid,
        'text-area--disabled': disabled,
      },
      className,
    )}
  >
    <textarea
      {...rest}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className="text-area__control lg-body-regular"
    />
  </div>
)

export { TextArea }
export type { TextAreaProps }
