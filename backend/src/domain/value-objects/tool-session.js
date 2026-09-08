export const SessionState = Object.freeze({ READY: 'ready', MISSING: 'missing', UNKNOWN: 'unknown' })

export class ToolSession {
  constructor({ tool, installed, state, fix }) {
    if (!Object.values(SessionState).includes(state)) {
      throw new Error(
        `a tool session state must be one of ${Object.values(SessionState).join(', ')}, got ${JSON.stringify(state)}`
      )
    }
    if ((state === SessionState.READY) === (fix !== null)) {
      throw new Error(
        `a tool session's fix must be null exactly when its state is ready, got state ${JSON.stringify(state)} and fix ${JSON.stringify(fix)}`
      )
    }
    this.tool = tool
    this.installed = installed
    this.state = state
    this.fix = fix
    Object.freeze(this)
  }

  get blocks() {
    return !this.installed || this.state === SessionState.MISSING
  }
}
