export type HarvestOutcomeValue = 'collected' | 'waiting' | 'kept' | 'partial'

export class HarvestOutcome {
  static readonly COLLECTED = 'collected'
  static readonly WAITING = 'waiting'
  static readonly KEPT = 'kept'
  static readonly PARTIAL = 'partial'

  static declared(): HarvestOutcomeValue[] {
    return Object.values(HarvestOutcome)
  }
}
