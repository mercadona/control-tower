import type { ImplementProgressRead } from 'app/implement-progress/ImplementProgress.types'
import type { WorkProgressRead } from './WorkProgress.types'

export class WorkProgressPresentation {
  static execution(read: WorkProgressRead): ImplementProgressRead {
    if (read.kind === 'connecting') return { phase: 'connecting' }
    if (read.kind === 'unavailable') return { phase: 'unreachable' }
    const progress = read.snapshot.progress
    if (progress.phase !== 'implementing') return { phase: 'waiting' }
    return progress.execution.kind !== 'unavailable'
      ? { phase: 'progress', ...progress.execution.value }
      : { phase: 'failed', error: progress.execution.detail }
  }

  static observation(read: WorkProgressRead): ImplementProgressRead {
    if (read.kind !== 'read') return { phase: 'unreachable' }
    if (read.snapshot.progress.phase === 'implementing' && read.snapshot.progress.execution.kind === 'partial') {
      return { phase: 'failed', error: read.snapshot.progress.execution.detail }
    }
    return WorkProgressPresentation.execution(read)
  }
}
