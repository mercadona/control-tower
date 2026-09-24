import { WorkProgressContract } from './contract'
import type { WorkIdentity, WorkProgressOutcome } from './WorkProgress.types'

const NOT_FOUND = 'work-not-found'

export class WorkProgressClient {
  static async get(identity: WorkIdentity, signal: AbortSignal, timeoutMs: number): Promise<WorkProgressOutcome> {
    try {
      const response = await fetch(`/work-progress/${identity.issue}?repo=${encodeURIComponent(identity.repo)}`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      })
      const body: unknown = await response.json()
      if (!response.ok) {
        const refusal = WorkProgressContract.object(body, ['code', 'detail'])
        const code = WorkProgressContract.text(refusal.code)
        const detail = WorkProgressContract.text(refusal.detail)
        return code === NOT_FOUND ? { kind: 'not-found', detail } : { kind: 'unavailable', detail }
      }
      const snapshot = WorkProgressContract.read(body)
      if (snapshot.repo !== identity.repo || snapshot.issue !== identity.issue || snapshot.agent !== identity.agent) {
        return { kind: 'unavailable', detail: 'El trabajo ha cambiado. Esperando a confirmar su identidad.' }
      }
      return { kind: 'read', snapshot }
    } catch (cause) {
      return { kind: 'unavailable', detail: cause instanceof TypeError
        ? 'No se pudo contactar con el backend'
        : 'No se pudo leer el progreso del trabajo' }
    }
  }
}
