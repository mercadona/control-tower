const ImplementationStep = Object.freeze({
  STARTING: 'starting',
  IMPLEMENT: 'implement',
  CONTROLS: 'controls',
  JUDGE: 'judge',
  ADVISE: 'advise',
  COMMIT: 'commit',
  RECONCILE: 'reconcile',
  GLOBAL: 'global',
  SLICE_JUDGE: 'slice-judge',
  E2E: 'e2e',
  DELIVERED: 'delivered',
  IN_REVIEW: 'in-review',
  FIXING: 'fixing',
} as const)

type ImplementationStep = (typeof ImplementationStep)[keyof typeof ImplementationStep]

type PullRequest = {
  number: number
  url: string
}

type ImplementationProgressState = {
  step: ImplementationStep
  task: number | null
  totalTasks: number | null
  name: string | null
  attempt: number | null
  discards: number | null
  pullRequest: PullRequest | null
}

type ImplementProgressOutcome =
  | { kind: 'read'; state: ImplementationProgressState }
  | { kind: 'not-read' }
  | { kind: 'refused'; error: string }
  | { kind: 'backend-unreachable' }

const STEP_LABELS: Record<ImplementationStep, string> = {
  [ImplementationStep.STARTING]: 'Arrancando',
  [ImplementationStep.IMPLEMENT]: 'Implementando',
  [ImplementationStep.CONTROLS]: 'Revisando controles',
  [ImplementationStep.JUDGE]: 'Evaluando',
  [ImplementationStep.ADVISE]: 'Generando consejo',
  [ImplementationStep.COMMIT]: 'Guardando cambios',
  [ImplementationStep.RECONCILE]: 'Reconciliando',
  [ImplementationStep.GLOBAL]: 'Revisión global',
  [ImplementationStep.SLICE_JUDGE]: 'Evaluando el slice',
  [ImplementationStep.E2E]: 'Ejecutando pruebas end-to-end',
  [ImplementationStep.DELIVERED]: 'Entregado',
  [ImplementationStep.IN_REVIEW]: 'En revisión',
  [ImplementationStep.FIXING]: 'Corrigiendo lo pedido en la revisión',
}

export { ImplementationStep, STEP_LABELS }
export type { ImplementationProgressState, ImplementProgressOutcome, PullRequest }
