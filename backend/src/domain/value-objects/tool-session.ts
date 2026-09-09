export const SessionState = Object.freeze({ READY: 'ready', MISSING: 'missing', UNKNOWN: 'unknown' } as const)

export type SessionStateValue = (typeof SessionState)[keyof typeof SessionState]

export class ToolSession {
  readonly tool: string
  readonly installed: boolean
  readonly state: SessionStateValue
  readonly fix: string | null

  constructor({ tool, installed, state, fix }: {
    tool: string,
    installed: boolean,
    state: unknown,
    fix: string | null,
  }) {
    if (!ToolSession.#declares(state)) {
      throw new Error(
        `a tool session state must be one of ${Object.values<string>(SessionState).join(', ')}, got ${JSON.stringify(state)}`
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

  static #declares(state: unknown): state is SessionStateValue {
    return typeof state === 'string' && Object.values<string>(SessionState).includes(state)
  }

  get blocks(): boolean {
    return !this.installed || this.state === SessionState.MISSING
  }
}
