import type { ImplementProgressRead } from 'app/implement-progress/ImplementProgress.types'
import type { WorkProgressRead } from './WorkProgress.types'

export class WorkProgressPresentation {
  static execution(read: WorkProgressRead): ImplementProgressRead {
    if (read.kind === 'connecting') return { phase: 'connecting' }
    if (read.kind === 'unavailable') return { phase: 'unreachable' }
    const progress = read.snapshot.progress
    if (progress.phase === 'planning') return { phase: 'waiting' }
    if (progress.phase === 'uncertain' && progress.execution.kind === 'unavailable') return { phase: 'waiting' }
    if (progress.execution.kind === 'unavailable') return { phase: 'failed', error: progress.execution.detail }
    return { phase: progress.execution.kind === 'partial' ? 'partial' : 'progress', ...progress.execution.value }
  }

  static observation(read: WorkProgressRead): ImplementProgressRead {
    if (read.kind !== 'read') return { phase: 'unreachable' }
    if (read.snapshot.progress.phase === 'uncertain') return { phase: 'failed', error: read.snapshot.progress.diagnostic }
    if (read.snapshot.progress.phase === 'implementing' && read.snapshot.progress.execution.kind === 'partial') {
      return { phase: 'failed', error: read.snapshot.progress.execution.detail }
    }
    return WorkProgressPresentation.execution(read)
  }
}
