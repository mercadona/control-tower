import { ToolSessions } from '../domain/ports/tool-sessions.js'
import { SessionState, ToolSession } from '../domain/value-objects/tool-session.js'

export class ProbedToolSessions extends ToolSessions {
  static PROBES = [
    { tool: 'gh', bin: 'gh', probe: 'gh', argv: ['auth', 'status'], fix: 'gh auth login' },
    {
      tool: 'acli', bin: 'acli', probe: 'acli', argv: ['jira', 'auth', 'status'],
      fix: 'acli jira auth login',
    },
    {
      tool: 'claude', bin: 'claude', probe: null, argv: null,
      fix: 'claude, then /login — not observable from this process',
    },
    {
      tool: 'git', bin: 'git', probe: 'ssh',
      argv: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', 'git@github.com'],
      fix: 'add an SSH key to your GitHub account',
    },
    {
      tool: 'bq', bin: 'bq', probe: 'gcloud',
      argv: ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
      fix: 'gcloud auth login && gcloud auth application-default login',
    },
  ]

  static CMUX = {
    tool: 'cmux', bin: 'cmux',
    fix: 'update cmux, and start this backend from a terminal inside cmux',
  }

  static AUTHENTICATED = 'successfully authenticated'

  constructor({ clients, lookUp, cmuxAnswers }) {
    super()
    this.clients = clients
    this.lookUp = lookUp
    this.cmuxAnswers = cmuxAnswers
  }

  async all() {
    const sessions = []
    for (const row of ProbedToolSessions.PROBES) sessions.push(await this.#sessionFor(row))
    sessions.push(this.#cmuxSession())

    return sessions
  }

  #cmuxSession() {
    const row = ProbedToolSessions.CMUX
    const installed = this.lookUp(row.bin) !== null
    const answered = installed && this.cmuxAnswers()

    return ProbedToolSessions.#sessionOf(row, installed, answered ? SessionState.READY : SessionState.MISSING)
  }

  async #sessionFor(row) {
    const installed = this.lookUp(row.bin) !== null

    return ProbedToolSessions.#sessionOf(row, installed, await this.#resolvedState(row, installed))
  }

  static #sessionOf(row, installed, state) {
    return new ToolSession({
      tool: row.tool,
      installed,
      state,
      fix: state === SessionState.READY ? null : row.fix,
    })
  }

  async #resolvedState(row, installed) {
    if (row.probe === null) return SessionState.UNKNOWN
    if (!installed) return SessionState.MISSING

    return this.#stateFor(row)
  }

  async #stateFor(row) {
    const output = await this.clients[row.probe].run(row.argv, { safeToRepeat: true })

    return ProbedToolSessions.#isReady(row, output) ? SessionState.READY : SessionState.MISSING
  }

  static #isReady(row, output) {
    if (row.probe === 'ssh') return output.stderr.includes(ProbedToolSessions.AUTHENTICATED)
    if (row.probe === 'gcloud') return !output.failed && output.stdout.trim() !== ''

    return !output.failed
  }
}
