import { SliceLine, SliceLineState } from './slice-line.ts'

export class MilestoneProgress {
  readonly milestone: string
  readonly lines: readonly SliceLine[]

  constructor(asked: { milestone: string, lines: readonly SliceLine[] }) {
    this.milestone = asked.milestone
    this.lines = Object.freeze([...asked.lines])
    Object.freeze(this)
  }

  delivered(): number {
    return this.lines.filter((line) => line.state === SliceLineState.DELIVERED).length
  }
}
