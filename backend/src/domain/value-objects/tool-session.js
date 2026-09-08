export const SessionState = Object.freeze({ READY: 'ready', MISSING: 'missing', UNKNOWN: 'unknown' })

export class ToolSession {
  constructor({ tool, installed, state, fix }) {
    if (!Object.values(SessionState).includes(state)) {
      throw new Error(
        `a tool session state must be one of ${Object.values(SessionState).join(', ')}, got ${JSON.stringify(state)}`
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
