import { ToolSessions } from '../domain/ports/tool-sessions.ts'
import { SessionState, ToolSession } from '../domain/value-objects/tool-session.ts'
import type { SessionStateValue } from '../domain/value-objects/tool-session.ts'
import type { ExternalTool } from './external-tool.ts'
import type { ProcessOutput } from './tool-runner.ts'

export type ProbeName = 'gh' | 'acli' | 'ssh' | 'gcloud'
export type ToolLookUp = (bin: string) => string | null
export type CmuxAnswers = () => boolean

type ToolRow = { tool: string, bin: string, fix: string }
type CredentialRow = ToolRow & { probe: ProbeName, argv: string[] }
type UnobservableRow = ToolRow & { probe: null, argv: null }
type ProbeRow = CredentialRow | UnobservableRow

export class ProbedToolSessions extends ToolSessions {
  static readonly PROBES: ProbeRow[] = [
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

  static readonly CMUX: ToolRow = {
    tool: 'cmux', bin: 'cmux',
    fix: 'update cmux and restart the app, then start this backend from a terminal inside cmux',
  }

  static readonly AUTHENTICATED = 'successfully authenticated'

  static readonly #READINGS: Record<ProbeName, (output: ProcessOutput) => SessionStateValue> = {
    gh: (output) => (output.failed ? SessionState.MISSING : SessionState.READY),
    acli: (output) => (output.failed ? SessionState.MISSING : SessionState.READY),
    ssh: (output) => (output.stderr.includes(ProbedToolSessions.AUTHENTICATED)
      ? SessionState.READY
      : SessionState.MISSING),
    gcloud: (output) => (!output.failed && output.stdout.trim() !== ''
      ? SessionState.READY
      : SessionState.MISSING),
  }

  readonly clients: Record<string, ExternalTool>
  readonly lookUp: ToolLookUp
  readonly cmuxAnswers: CmuxAnswers

  constructor({ clients, lookUp, cmuxAnswers }: {
    clients: Record<string, ExternalTool>,
    lookUp: ToolLookUp,
    cmuxAnswers: CmuxAnswers,
  }) {
    super()
    this.clients = clients
    this.lookUp = lookUp
    this.cmuxAnswers = cmuxAnswers
  }

  async all(): Promise<ToolSession[]> {
    const sessions: ToolSession[] = []
    for (const row of ProbedToolSessions.PROBES) sessions.push(await this.#sessionFor(row))
    sessions.push(this.#cmuxSession())

    return sessions
  }

  #cmuxSession(): ToolSession {
    const row = ProbedToolSessions.CMUX
    const installed = this.lookUp(row.bin) !== null
    const answered = installed && this.cmuxAnswers()

    return ProbedToolSessions.#sessionOf(row, installed, answered ? SessionState.READY : SessionState.MISSING)
  }

  async #sessionFor(row: ProbeRow): Promise<ToolSession> {
    const installed = this.lookUp(row.bin) !== null
    if (installed && row.probe !== null && row.probe !== row.bin && this.lookUp(row.probe) === null) {
      const asked = { ...row, fix: `install ${row.probe}, then ${row.fix}` }

      return ProbedToolSessions.#sessionOf(asked, installed, SessionState.UNKNOWN)
    }

    return ProbedToolSessions.#sessionOf(row, installed, await this.#resolvedState(row, installed))
  }

  static #sessionOf(row: ToolRow, installed: boolean, state: SessionStateValue): ToolSession {
    return new ToolSession({
      tool: row.tool,
      installed,
      state,
      fix: state === SessionState.READY ? null : row.fix,
    })
  }

  async #resolvedState(row: ProbeRow, installed: boolean): Promise<SessionStateValue> {
    if (row.probe === null) return SessionState.UNKNOWN
    if (!installed) return SessionState.MISSING

    return this.#stateFor(row)
  }

  async #stateFor(row: CredentialRow): Promise<SessionStateValue> {
    const output = await this.clients[row.probe].run(row.argv, { safeToRepeat: true })

    return ProbedToolSessions.#READINGS[row.probe](output)
  }
}
