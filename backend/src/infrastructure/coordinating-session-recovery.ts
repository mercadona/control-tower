import { RecoveredConversation } from '../application/actions/recover-coordinating-session.ts'
import type { CoordinatingSessionRecovered } from '../application/actions/recover-coordinating-session.ts'
import {
  SessionClosureNotRecorded,
  SessionOwnershipUnverifiable,
  SessionTerminationPermissionDenied,
} from '../domain/exceptions.ts'
import { SessionAttention } from '../domain/value-objects/session-attention.ts'
import {
  CoordinatingClosureError,
  CoordinatingSessions,
  HeldCoordinatingSession,
  CoordinatingSessionState,
} from './coordinating-sessions.ts'

export class CoordinatingSessionRecovery {
  static remember(
    recovered: CoordinatingSessionRecovered,
    coordinatingSessions: CoordinatingSessions,
    stderr: (line: string) => void
  ): void {
    switch (recovered.outcome) {
      case RecoveredConversation.NONE:
        coordinatingSessions.finishRecoveryWithoutSession()
        stderr('coordinating session: nothing recorded to recover\n')
        return
      case RecoveredConversation.UNRESUMABLE:
        coordinatingSessions.remember(new HeldCoordinatingSession({
          target: coordinatingSessions.mintTarget(),
          state: CoordinatingSessionState.UNRESUMABLE,
          conversation: recovered.conversation!,
          session: null,
          attention: null,
        }), recovered.timeline)
        stderr(`coordinating session ${recovered.conversation!.id.text}: claude code no longer holds it, nothing was resumed\n`)
        return
      case RecoveredConversation.INTERRUPTED:
        coordinatingSessions.rememberFailedClosure(new HeldCoordinatingSession({
          target: recovered.closure!.target,
          state: CoordinatingSessionState.ENDED,
          conversation: recovered.conversation!,
          session: null,
          attention: null,
        }), new CoordinatingClosureError({
          code: recovered.failure instanceof SessionClosureNotRecorded
            ? 'session-closure-not-recorded'
            : recovered.failure instanceof SessionOwnershipUnverifiable
              ? 'session-ownership-unverifiable'
              : recovered.failure instanceof SessionTerminationPermissionDenied
                ? 'session-termination-permission-denied'
                : 'session-termination-unconfirmed',
          detail: recovered.failure!.message,
        }))
        stderr(
          `coordinating session ${recovered.conversation!.id.text}: cancellation was interrupted; recovery remains reserved and nothing was resumed\n`
        )
        return
      case RecoveredConversation.LIVE:
        coordinatingSessions.remember(new HeldCoordinatingSession({
          target: coordinatingSessions.mintTarget(),
          state: CoordinatingSessionState.LIVE,
          conversation: recovered.conversation!,
          session: recovered.session!,
          attention: SessionAttention.working(),
        }), recovered.timeline)
        stderr(`coordinating session ${recovered.conversation!.id.text}: resumed\n`)
        return
      default: {
        const exhaustive: never = recovered.outcome
        throw new Error(`no coordinating session recovery declared for ${exhaustive}`)
      }
    }
  }
}
