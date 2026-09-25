import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  INPUT_KINDS, INPUT_ROLES, MANDATORY_INPUT_ROLES_OF_STEP, StepAnnouncement,
} from '../../../../plugin/scripts/step-announcement.js'
import { OUTCOMES, RUN_STATES, STEPS } from '../../../../plugin/scripts/run-machine.js'
import { RoleBytes } from '../../../../plugin/scripts/role-bytes.js'
import type { CtRunMachine } from '../../../src/infrastructure/ct-run-machine.ts'
import { CONSUMING_VERB_BY_STEP, RESPONSE_KIND_BY_STEP } from '../../../src/infrastructure/run-announcement.ts'
import { ProcessOutput, type RunOptions } from '../../../src/infrastructure/tool-runner.ts'
import { UnscriptedRequest } from './scripted-conversation.ts'

export type ScriptedStep =
  | 'implement' | 'controls' | 'judge' | 'advise' | 'commit'
  | 'reconcile' | 'reconcile-clean' | 'global' | 'slice-judge' | 'e2e' | 'delivered' | 'refused'

type DispatchInputDraft = Readonly<{ role: string, kind: 'literal' | 'glob', path: string }>

const MANDATORY_ROLES: Readonly<Record<string, readonly string[]>> = MANDATORY_INPUT_ROLES_OF_STEP

const STEP_OF_CONSUMING_VERB: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(CONSUMING_VERB_BY_STEP).map(([step, verb]) => [verb, step])),
)

export class ScriptedOracle {
  static readonly REFUSAL = 'the scripted judge refused the task'

  readonly checkout: string
  readonly plan: string
  readonly issue: number
  readonly pluginRoot: string
  readonly dispatchCheck: string
  readonly asked: string[][] = []
  readonly run: CtRunMachine['node']

  readonly #ctStep: string
  #remaining: ScriptedStep[]

  constructor(asked: {
    checkout: string,
    plan: string,
    issue: number,
    pluginRoot: string,
    dispatchCheck: string,
    steps: readonly ScriptedStep[],
  }) {
    this.checkout = asked.checkout
    this.plan = asked.plan
    this.issue = asked.issue
    this.pluginRoot = asked.pluginRoot
    this.dispatchCheck = asked.dispatchCheck
    this.#ctStep = join(asked.pluginRoot, 'scripts', 'ct-step.mjs')
    this.#remaining = [...asked.steps]
    this.run = async (argv, options = {}) => this.#answer([...argv], options)
  }

  async announce(step: ScriptedStep): Promise<string> {
    switch (step) {
      case 'implement': return (await this.#dispatch(STEPS.IMPLEMENT)).text()
      case 'judge': return (await this.#dispatch(STEPS.JUDGE)).text()
      case 'advise': return (await this.#dispatch(STEPS.ADVISE)).text()
      case 'slice-judge': return (await this.#dispatch(STEPS.SLICE_JUDGE)).text()
      case 'reconcile': return (await this.#reconcile()).text()
      case 'e2e': return (await this.#e2e()).text()
      case 'controls': return this.#program(STEPS.CONTROLS).text()
      case 'commit': return this.#program(STEPS.COMMIT).text()
      case 'global': return this.#program(STEPS.GLOBAL).text()
      case 'reconcile-clean': return this.#program(STEPS.RECONCILE).text()
      case 'delivered': return this.#delivered().text()
      case 'refused': return this.#refused().text()
      default: return step satisfies never
    }
  }

  async #answer(argv: string[], options: RunOptions): Promise<ProcessOutput> {
    this.asked.push([...argv])
    if (argv[0] === this.dispatchCheck) {
      if (argv.at(-1) === '--check-plan') return new ProcessOutput({ code: 0, stdout: '', stderr: '' })
      throw new UnscriptedRequest({ binary: argv[0], argv: argv.slice(1), cwd: options.cwd })
    }
    if (argv[0] !== this.#ctStep) throw new UnscriptedRequest({ binary: argv[0], argv: argv.slice(1), cwd: options.cwd })
    if (argv[1] === 'next') {
      const step = this.#remaining.shift()
      if (step === undefined) throw new UnscriptedRequest({ binary: argv[0], argv: argv.slice(1), cwd: options.cwd })
      return new ProcessOutput({ code: 0, stdout: await this.announce(step), stderr: '' })
    }
    const verb = argv[1]
    const step = STEP_OF_CONSUMING_VERB[verb]
    if (step === undefined) throw new UnscriptedRequest({ binary: argv[0], argv: argv.slice(1), cwd: options.cwd })
    return new ProcessOutput({
      code: 0,
      stdout: StepAnnouncement.transition({
        issue: this.issue, task: 1, tasksTotal: 1,
        step,
        discards: 0, state: RUN_STATES.OPEN, outcome: OUTCOMES.DONE, exit: 0,
      }).text(),
      stderr: '',
    })
  }

  async #dispatch(step: string): Promise<StepAnnouncement> {
    const inputs = await this.#inputsFor(step)
    const responsePath = this.#responsePath(step)
    return StepAnnouncement.dispatch({
      issue: this.issue, task: 1, tasksTotal: 1, step, attempt: 1, agent: undefined,
      inputs,
      response: { kind: RESPONSE_KIND_BY_STEP[step], path: responsePath },
      consuming: {
        argv: [CONSUMING_VERB_BY_STEP[step], responsePath, '--plan', this.plan, '--issue', String(this.issue)],
      },
    })
  }

  async #reconcile(): Promise<StepAnnouncement> {
    const path = await this.#roleFile(INPUT_ROLES.RECONCILIATION_PACKAGE)
    return StepAnnouncement.dispatch({
      issue: this.issue, task: 1, tasksTotal: 1, step: STEPS.RECONCILE, attempt: 1, agent: undefined,
      inputs: [{ role: INPUT_ROLES.RECONCILIATION_PACKAGE, kind: INPUT_KINDS.LITERAL, path }],
      response: { kind: 'edits' },
      consuming: { argv: [CONSUMING_VERB_BY_STEP[STEPS.RECONCILE], '--plan', this.plan, '--issue', String(this.issue)] },
    })
  }

  async #e2e(): Promise<StepAnnouncement> {
    const path = this.#responsePath(STEPS.E2E)
    return StepAnnouncement.dispatch({
      issue: this.issue, task: 1, tasksTotal: 1, step: STEPS.E2E, attempt: 1, agent: undefined,
      inputs: [],
      response: { kind: 'structured', path },
      consuming: { argv: [CONSUMING_VERB_BY_STEP[STEPS.E2E], path, '--plan', this.plan, '--issue', String(this.issue)] },
    })
  }

  #program(step: string): StepAnnouncement {
    const verb = CONSUMING_VERB_BY_STEP[step]
    return StepAnnouncement.program({
      issue: this.issue, task: 1, tasksTotal: 1, step, attempt: 1,
      commands: [`ct-step ${verb}`],
      consuming: { argv: [verb, '--plan', this.plan, '--issue', String(this.issue)] },
    })
  }

  #delivered(): StepAnnouncement {
    return StepAnnouncement.transition({
      issue: this.issue, task: 1, tasksTotal: 1, step: STEPS.SLICE_JUDGE, discards: 0,
      state: RUN_STATES.DELIVERED, outcome: OUTCOMES.DONE, exit: 0,
    })
  }

  #refused(): StepAnnouncement {
    return StepAnnouncement.refusal({
      issue: this.issue, task: 1, tasksTotal: 1, step: STEPS.JUDGE, discards: 0,
      state: RUN_STATES.BLOCKED_JUDGE, outcome: OUTCOMES.FAILED, exit: 1, detail: ScriptedOracle.REFUSAL,
      findings: undefined, verdict: undefined,
    })
  }

  async #inputsFor(step: string): Promise<DispatchInputDraft[]> {
    const roles = [...(MANDATORY_ROLES[step] ?? [])]
    if (step === STEPS.SLICE_JUDGE) roles.splice(roles.indexOf(INPUT_ROLES.VERDICTS), 0, INPUT_ROLES.GLOBAL_LOG)
    const inputs: DispatchInputDraft[] = []
    for (const role of roles) {
      if (step === STEPS.IMPLEMENT && role === INPUT_ROLES.RUBRIC) {
        inputs.push({ role, kind: INPUT_KINDS.LITERAL, path: join(this.pluginRoot, RoleBytes.filesOf(STEPS.IMPLEMENT)[0]) })
        continue
      }
      if (role === INPUT_ROLES.VERDICTS) {
        inputs.push({ role, kind: INPUT_KINDS.GLOB, path: await this.#verdictsGlob() })
        continue
      }
      inputs.push({ role, kind: INPUT_KINDS.LITERAL, path: await this.#roleFile(role) })
    }
    return inputs
  }

  async #roleFile(role: string): Promise<string> {
    const path = join(this.checkout, '.agent', `run-${this.issue}`, `${role}.md`)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `# ${role}\n`)
    return path
  }

  async #verdictsGlob(): Promise<string> {
    const file = join(this.checkout, 'docs', 'superpowers', 'verdicts', `issue-${this.issue}-task-1.json`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify({ ruling: 'PASS' })}\n`)
    return `docs/superpowers/verdicts/issue-${this.issue}-*.json`
  }

  #responsePath(step: string): string {
    return join(this.checkout, '.agent', `run-${this.issue}`, `${step}-response.json`)
  }
}
