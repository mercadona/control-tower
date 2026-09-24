export type HarvestOutcomeValue = 'collected' | 'nothing-left' | 'waiting' | 'kept' | 'partial'

export class HarvestOutcome {
  static readonly COLLECTED = 'collected'
  static readonly NOTHING_LEFT = 'nothing-left'
  static readonly WAITING = 'waiting'
  static readonly KEPT = 'kept'
  static readonly PARTIAL = 'partial'

  static declared(): HarvestOutcomeValue[] {
    return Object.values(HarvestOutcome)
  }
}
