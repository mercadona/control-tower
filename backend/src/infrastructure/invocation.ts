import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { delimiter as pathDelimiter, isAbsolute, join } from 'node:path'

export const InvocationOutcome = Object.freeze({
  READY: 'ready',
  UNEXPECTED_ARGUMENT: 'unexpected-argument',
  MALFORMED_PORT: 'malformed-port',
  UNKNOWN_STATE_HOME: 'unknown-state-home',
  MALFORMED_HARVEST_TABLE: 'malformed-harvest-table',
} as const)

export type InvocationOutcomeValue = typeof InvocationOutcome[keyof typeof InvocationOutcome]

export class Invocation {
  static readonly DEFAULT_PORT = 8787
  static readonly PORT_VARIABLE = 'CT_API_PORT'
  static readonly CONFIG_VARIABLE = 'CLAUDE_CONFIG_DIR'
  static readonly STATE_DIRECTORY = 'control-tower'
  static readonly DEFAULT_CONFIG_DIRECTORY = '.claude'
  static readonly HOME_VARIABLE = 'HOME'
  static readonly CLAIM_PREFIX = 'CT_CLAIM_'
  static readonly CHILD_TIMEOUT_VARIABLE = 'CT_CLAIM_CHILD_TIMEOUT_MS'
  static readonly HARVEST_TABLE_VARIABLE = 'CT_HARVEST_BQ_TABLE'
  static readonly HARVEST_TABLE_SHAPE = 'project:dataset.table'
  static readonly #MAX_PORT = 65535
  static readonly #WHOLE_NUMBER = /^\d+$/
  static readonly #HARVEST_TABLE = /^[A-Za-z0-9][A-Za-z0-9-]*:[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/

  readonly outcome: InvocationOutcomeValue
  readonly port: number | null
  readonly stateRoot: string | null
  readonly harvestTable: string | null
  readonly reason: string | null

  constructor({ outcome, port, stateRoot, harvestTable, reason }: {
    outcome: InvocationOutcomeValue,
    port: number | null,
    stateRoot: string | null,
    harvestTable: string | null,
    reason: string | null,
  }) {
    this.outcome = outcome
    this.port = port
    this.stateRoot = stateRoot
    this.harvestTable = harvestTable
    this.reason = reason
    Object.freeze(this)
  }

  static #refused(outcome: InvocationOutcomeValue, reason: string): Invocation {
    return new Invocation({ outcome, port: null, stateRoot: null, harvestTable: null, reason })
  }

  static #ready(port: number, stateRoot: string, harvestTable: string | null): Invocation {
    return new Invocation({ outcome: InvocationOutcome.READY, port, stateRoot, harvestTable, reason: null })
  }

  static configuredIn(environment: NodeJS.ProcessEnv, home: string): string {
    const asked = environment[Invocation.CONFIG_VARIABLE]

    return asked === undefined || asked === ''
      ? join(home, Invocation.DEFAULT_CONFIG_DIRECTORY)
      : asked
  }

  static stateRootIn(environment: NodeJS.ProcessEnv, home: string): string | null {
    const configured = Invocation.configuredIn(environment, home)

    return isAbsolute(configured) ? join(configured, Invocation.STATE_DIRECTORY) : null
  }

  static #port(environment: NodeJS.ProcessEnv): number | null {
    const given = environment[Invocation.PORT_VARIABLE]
    if (given === undefined) return Invocation.DEFAULT_PORT
    if (!Invocation.#WHOLE_NUMBER.test(given) || Number(given) > Invocation.#MAX_PORT) return null

    return Number(given)
  }

  static lookUp(name: string, environment: NodeJS.ProcessEnv): string | null {
    const raw = environment.PATH ?? ''
    for (const dir of raw.split(pathDelimiter)) {
      if (!dir) continue
      const candidate = join(dir, name)
      try {
        if (!statSync(candidate).isFile()) continue
        accessSync(candidate, fsConstants.X_OK)
        return candidate
      } catch {
        continue
      }
    }

    return null
  }

  static harvestEnvironment(
    environment: NodeJS.ProcessEnv,
    { ghTimeoutMs }: { ghTimeoutMs: number }
  ): NodeJS.ProcessEnv {
    const inherited = Object.entries(environment)
      .filter(([named]) => !named.startsWith(Invocation.CLAIM_PREFIX))

    return {
      ...Object.fromEntries(inherited),
      [Invocation.CHILD_TIMEOUT_VARIABLE]: String(ghTimeoutMs),
    }
  }

  static from(argv: string[], environment: NodeJS.ProcessEnv, home: string): Invocation {
    if (argv.length > 0) {
      return Invocation.#refused(
        InvocationOutcome.UNEXPECTED_ARGUMENT,
        `unexpected argument: ${JSON.stringify(argv[0])}`
      )
    }
    const port = Invocation.#port(environment)
    if (port === null) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_PORT,
        `${Invocation.PORT_VARIABLE} must be an integer between 0 and ${Invocation.#MAX_PORT}, got ${JSON.stringify(environment[Invocation.PORT_VARIABLE])}`
      )
    }
    const stateRoot = Invocation.stateRootIn(environment, home)
    if (stateRoot === null) {
      return Invocation.#refused(
        InvocationOutcome.UNKNOWN_STATE_HOME,
        `the home directory of whoever runs this could not be resolved, so there is no absolute path for the state Control Tower shares with its plugin: set ${Invocation.HOME_VARIABLE}, or ${Invocation.CONFIG_VARIABLE} to an absolute path`
      )
    }
    const harvestTable = environment[Invocation.HARVEST_TABLE_VARIABLE]
    if (harvestTable === undefined || harvestTable === '') {
      return Invocation.#ready(port, stateRoot, null)
    }
    if (!Invocation.#HARVEST_TABLE.test(harvestTable)) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_HARVEST_TABLE,
        `${Invocation.HARVEST_TABLE_VARIABLE} must look like ${Invocation.HARVEST_TABLE_SHAPE}, got ${JSON.stringify(harvestTable)}`
      )
    }

    return Invocation.#ready(port, stateRoot, harvestTable)
  }
}
