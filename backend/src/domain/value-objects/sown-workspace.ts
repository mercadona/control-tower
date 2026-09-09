import type { BaselineResult } from '../../../../plugin/scripts/baseline.js'
import type { WorkspaceLocation } from './workspace-location.ts'

export class SownWorkspace {
  readonly located: WorkspaceLocation
  readonly baseline: BaselineResult

  constructor({ located, baseline }: { located: WorkspaceLocation, baseline: BaselineResult }) {
    this.located = located
    this.baseline = baseline
    Object.freeze(this)
  }
}
