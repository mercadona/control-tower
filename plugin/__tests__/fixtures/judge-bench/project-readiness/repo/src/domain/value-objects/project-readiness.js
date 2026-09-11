export const ReadinessStatus = Object.freeze({ READY: 'ready', CHANGES_REQUIRED: 'changes-required' })

export class ProjectReadiness {
  constructor(status) {
    this.status = status
    Object.freeze(this)
  }
}
