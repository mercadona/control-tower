import type { MilestoneProgressOutcome } from 'app/milestone-progress/MilestoneProgress.types'

export class MilestonePolling {
  static readonly INTERVAL_MS = 3000
  static readonly REVIEW_INTERVAL_MS = 15000
  static readonly REVIEW_STEPS: readonly string[] = ['delivered', 'in-review', 'fixing']

  static intervalFor(read: MilestoneProgressOutcome): number {
    if (read.kind !== 'milestone') return MilestonePolling.INTERVAL_MS

    return read.issues.some((issue) => issue.step !== null && MilestonePolling.REVIEW_STEPS.includes(issue.step))
      ? MilestonePolling.REVIEW_INTERVAL_MS
      : MilestonePolling.INTERVAL_MS
  }
}
