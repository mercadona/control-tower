import type { ActivePlan, RecoveryAction, RecoveryOutcome } from 'app/active-plans/ActivePlan.types'
import { ActivePlansClient } from 'app/active-plans/client'

export class SliceRecovery {
  static readonly NOT_FOUND = 'El backend ya no informa de este trabajo.'
  static readonly UNAVAILABLE = 'No se ha podido consultar el trabajo. Reintenta cuando vuelva la conexión.'
  static readonly LABELS: Readonly<Record<RecoveryAction, string>> = {
    observe: 'Recuperar trabajo',
    continue: 'Recuperar trabajo',
    cleanup: 'Limpiar arranque fallido',
    inspect: 'Reintentar recuperación',
  }

  static async run(asked: { repo: string; issue: number; action: RecoveryAction }): Promise<RecoveryOutcome> {
    const outcome = await ActivePlansClient.get()
    if (outcome.kind !== 'loaded') {
      return { kind: 'refused', code: 'slice-recovery-unavailable', detail: SliceRecovery.UNAVAILABLE }
    }
    const plan = outcome.plans.find((candidate) => SliceRecovery.#matches(candidate, asked))

    if (plan === undefined || plan.phase !== 'uncertain') {
      return { kind: 'refused', code: 'slice-recovery-not-found', detail: SliceRecovery.NOT_FOUND }
    }

    if (plan.recovery.action !== asked.action) {
      return {
        kind: 'refused', code: 'slice-recovery-changed',
        detail: 'El estado del trabajo ha cambiado. Revisa la acción actual antes de continuar.',
      }
    }

    return asked.action === 'cleanup' ? ActivePlansClient.cleanup(plan) : ActivePlansClient.recover(plan)
  }

  static #matches(plan: ActivePlan, asked: { repo: string; issue: number }): boolean {
    return plan.phase === 'uncertain' && plan.plan.repo === asked.repo && plan.plan.issue.number === asked.issue
  }
}
