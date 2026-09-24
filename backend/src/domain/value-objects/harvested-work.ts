import type { PlanWatch } from './plan-watch.ts'

export class HarvestedWork {
  readonly watch: PlanWatch
  readonly harvestedAt: string

  constructor(asked: { watch: PlanWatch, harvestedAt: string }) {
    const harvested = new Date(asked.harvestedAt)
    if (Number.isNaN(harvested.getTime()) || harvested.toISOString() !== asked.harvestedAt) {
      throw new TypeError(`harvestedAt must be an ISO timestamp, got ${JSON.stringify(asked.harvestedAt)}`)
    }
    this.watch = asked.watch
    this.harvestedAt = asked.harvestedAt
    Object.freeze(this)
  }
}
