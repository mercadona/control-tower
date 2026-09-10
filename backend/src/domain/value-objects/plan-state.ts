export type PlanStateValue = 'writing' | 'ready' | 'reviewing'

export class PlanState {
  static readonly WRITING = 'writing'
  static readonly READY = 'ready'
  static readonly REVIEWING = 'reviewing'
}
