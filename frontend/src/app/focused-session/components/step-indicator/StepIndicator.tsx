import { SessionStage, SessionStep } from 'app/focused-session/SessionStage'
import './StepIndicator.css'

const STEPS_LABEL = 'Pasos de la sesión'

type StepStatus = 'completed' | 'active' | 'pending'

const CAPTION: Readonly<Record<StepStatus, string>> = {
  completed: 'Completado',
  active: 'En curso',
  pending: 'Pendiente',
}

type StepIndicatorProps = {
  current: SessionStep
}

const StepIndicator = ({ current }: StepIndicatorProps) => {
  const reached = SessionStage.STEPS.indexOf(current)

  return (
    <nav className="step-indicator" aria-label={STEPS_LABEL}>
      <ol className="step-indicator__steps">
        {SessionStage.STEPS.map((step, index) => {
          const status: StepStatus = index < reached ? 'completed' : index === reached ? 'active' : 'pending'

          return (
            <li
              key={step}
              className={`step-indicator__step step-indicator__step--${status}`}
              aria-current={status === 'active' ? 'step' : undefined}
            >
              <span className="step-indicator__number">{index + 1}</span>
              <span className="step-indicator__name">{SessionStage.LABEL[step]}</span>
              <span className="step-indicator__caption lg-caption1-regular">{CAPTION[status]}</span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export { StepIndicator }
export type { StepIndicatorProps }
