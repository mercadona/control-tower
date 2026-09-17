import type { BaselineResult } from '../../../../plugin/scripts/baseline.js'
import type { RootedWorkspaceLocation } from './rooted-workspace-location.ts'

export class SownWorkspace {
  readonly located: RootedWorkspaceLocation
  readonly baseline: BaselineResult

  constructor({ located, baseline }: { located: RootedWorkspaceLocation, baseline: BaselineResult }) {
    this.located = located
    this.baseline = baseline
    Object.freeze(this)
  }
}
