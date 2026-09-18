import type { LiveSession } from '../value-objects/live-session.ts'

export const GroomReviewRefusal = Object.freeze({
  TARGET_CHANGED: 'target-changed',
  BUSY: 'busy',
  NOT_LIVE: 'not-live',
  AWAITING_PERMISSION: 'awaiting-permission',
  WORKING: 'working',
  TURN_NOT_FINISHED: 'turn-not-finished',
} as const)

export type GroomReviewRefusalValue = (typeof GroomReviewRefusal)[keyof typeof GroomReviewRefusal]

export class GroomReviewAdmission {
  refusalFor(_asked: { target: string, session: LiveSession }): GroomReviewRefusalValue | null {
    throw new Error(`${this.constructor.name} must implement refusalFor()`)
  }
}
