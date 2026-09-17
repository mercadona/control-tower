import type { PlanWatch } from './plan-watch.ts'

export class UnusedWorkspace {
  readonly watch: PlanWatch
  readonly baseSha: string
  readonly checkedAt: string

  constructor(asked: { watch: PlanWatch, baseSha: string, checkedAt: string }) {
    if (!/^[0-9a-f]{40}$/.test(asked.baseSha)) {
      throw new TypeError(`baseSha must be a 40-character lowercase hexadecimal commit, got ${JSON.stringify(asked.baseSha)}`)
    }
    const checked = new Date(asked.checkedAt)
    if (Number.isNaN(checked.getTime()) || checked.toISOString() !== asked.checkedAt) {
      throw new TypeError(`checkedAt must be an ISO timestamp, got ${JSON.stringify(asked.checkedAt)}`)
    }
    this.watch = asked.watch
    this.baseSha = asked.baseSha
    this.checkedAt = asked.checkedAt
    Object.freeze(this)
  }
}
