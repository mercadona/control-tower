import { accessSync, constants as fsConstants, statSync } from 'node:fs'
import { delimiter as pathDelimiter, isAbsolute, join } from 'node:path'
import { CmuxPlanAgents } from './cmux-plan-agents.js'
import { HeadlessPlanAgents } from './headless-plan-agents.js'

export const InvocationOutcome = Object.freeze({
  READY: 'ready',
  UNEXPECTED_ARGUMENT: 'unexpected-argument',
  MALFORMED_PORT: 'malformed-port',
  UNKNOWN_STATE_HOME: 'unknown-state-home',
  MALFORMED_HARVEST_TABLE: 'malformed-harvest-table',
  MALFORMED_TRANSPORT: 'malformed-transport',
  MALFORMED_MODEL: 'malformed-model',
})

export class Invocation {
  static DEFAULT_PORT = 8787
  static PORT_VARIABLE = 'CT_API_PORT'
  static CONFIG_VARIABLE = 'CLAUDE_CONFIG_DIR'
  static STATE_DIRECTORY = 'control-tower'
  static DEFAULT_CONFIG_DIRECTORY = '.claude'
  static HOME_VARIABLE = 'HOME'
  static CLAIM_PREFIX = 'CT_CLAIM_'
  static CHILD_TIMEOUT_VARIABLE = 'CT_CLAIM_CHILD_TIMEOUT_MS'
  static HARVEST_TABLE_VARIABLE = 'CT_HARVEST_BQ_TABLE'
  static HARVEST_TABLE_SHAPE = 'project:dataset.table'
  static TRANSPORT_VARIABLE = 'CT_PLAN_TRANSPORT'
  static MODEL_VARIABLE = 'CT_PLAN_MODEL'
  static DEFAULT_MODEL = 'opus'
  static #MAX_PORT = 65535
  static #WHOLE_NUMBER = /^\d+$/
  static #HARVEST_TABLE = /^[A-Za-z0-9][A-Za-z0-9-]*:[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/
  static #MODEL = /^[A-Za-z0-9][A-Za-z0-9.-]*$/

  constructor({ outcome, port, stateRoot, harvestTable, transport, model, reason }) {
    this.outcome = outcome
    this.port = port
    this.stateRoot = stateRoot
    this.harvestTable = harvestTable
    this.transport = transport
    this.model = model
    this.reason = reason
    Object.freeze(this)
  }

  static #refused(outcome, reason) {
    return new Invocation({
      outcome, port: null, stateRoot: null, harvestTable: null, transport: null, model: null, reason,
    })
  }

  static #ready(port, stateRoot, harvestTable, transport, model) {
    return new Invocation({
      outcome: InvocationOutcome.READY, port, stateRoot, harvestTable, transport, model, reason: null,
    })
  }

  static configuredIn(environment, home) {
    const asked = environment[Invocation.CONFIG_VARIABLE]

    return asked === undefined || asked === ''
      ? join(home, Invocation.DEFAULT_CONFIG_DIRECTORY)
      : asked
  }

  static stateRootIn(environment, home) {
    const configured = Invocation.configuredIn(environment, home)

    return isAbsolute(configured) ? join(configured, Invocation.STATE_DIRECTORY) : null
  }

  static #port(environment) {
    const given = environment[Invocation.PORT_VARIABLE]
    if (given === undefined) return Invocation.DEFAULT_PORT
    if (!Invocation.#WHOLE_NUMBER.test(given) || Number(given) > Invocation.#MAX_PORT) return null

    return Number(given)
  }

  static lookUp(name, environment) {
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

  static #transport(environment) {
    const given = environment[Invocation.TRANSPORT_VARIABLE]
    if (given === undefined || given === '') return CmuxPlanAgents.TRANSPORT
    if (given !== CmuxPlanAgents.TRANSPORT && given !== HeadlessPlanAgents.TRANSPORT) return null

    return given
  }

  static #model(environment) {
    const given = environment[Invocation.MODEL_VARIABLE]
    if (given === undefined || given === '') return Invocation.DEFAULT_MODEL
    if (!Invocation.#MODEL.test(given)) return null

    return given
  }

  static harvestEnvironment(environment, { ghTimeoutMs }) {
    const inherited = Object.entries(environment)
      .filter(([named]) => !named.startsWith(Invocation.CLAIM_PREFIX))

    return {
      ...Object.fromEntries(inherited),
      [Invocation.CHILD_TIMEOUT_VARIABLE]: String(ghTimeoutMs),
    }
  }

  static from(argv, environment, home) {
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
    const rawHarvestTable = environment[Invocation.HARVEST_TABLE_VARIABLE]
    const harvestTable = rawHarvestTable === undefined || rawHarvestTable === '' ? null : rawHarvestTable
    if (harvestTable !== null && !Invocation.#HARVEST_TABLE.test(harvestTable)) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_HARVEST_TABLE,
        `${Invocation.HARVEST_TABLE_VARIABLE} must look like ${Invocation.HARVEST_TABLE_SHAPE}, got ${JSON.stringify(harvestTable)}`
      )
    }
    const transport = Invocation.#transport(environment)
    if (transport === null) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_TRANSPORT,
        `${Invocation.TRANSPORT_VARIABLE} must be ${CmuxPlanAgents.TRANSPORT} or ${HeadlessPlanAgents.TRANSPORT}, got ${JSON.stringify(environment[Invocation.TRANSPORT_VARIABLE])}`
      )
    }
    const model = Invocation.#model(environment)
    if (model === null) {
      return Invocation.#refused(
        InvocationOutcome.MALFORMED_MODEL,
        `${Invocation.MODEL_VARIABLE} must not contain whitespace or start with '-', so it cannot be read as another argument, got ${JSON.stringify(environment[Invocation.MODEL_VARIABLE])}`
      )
    }

    return Invocation.#ready(port, stateRoot, harvestTable, transport, model)
  }
}
