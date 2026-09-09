export class SownWorkspace {
  constructor({ located, baseline }) {
    this.located = located
    this.baseline = baseline
    Object.freeze(this)
  }
}
