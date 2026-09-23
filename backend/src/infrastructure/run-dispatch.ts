import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { glob, lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { AgentDefinition } from '../../../plugin/scripts/judge-agent-definition.js'
import { RoleBytes } from '../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import { INPUT_ROLES, RESPONSE_KINDS } from '../../../plugin/scripts/step-announcement.js'
import {
  ADVICE_SCHEMA,
  ADVISOR_TOOLS,
  IMPLEMENTER_MODEL,
  IMPLEMENTER_TOOLS,
  JUDGE_TOOLS,
  RECONCILER_TOOLS,
  REPORT_SCHEMA,
  SLICE_JUDGE_TOOLS,
} from '../../../plugin/scripts/step-contracts.js'
import { RunNotUnderstood } from '../domain/exceptions.ts'
import {
  AnnouncedStep, CONSUMING_VERB_BY_STEP, RESPONSE_KIND_BY_STEP, type AnnouncedInput,
} from './run-announcement.ts'

type RunRole = 'implement' | 'judge' | 'advise' | 'slice-judge' | 'reconcile'
type RunResponse =
  | { readonly kind: 'file', readonly path: string }
  | { readonly kind: 'structured', readonly path: string }
  | { readonly kind: 'edits' }
type DispatchInput = { readonly kind: 'literal' | 'glob', readonly path: string }
type DispatchRound = Pick<AnnouncedStep, 'inputs' | 'argv' | 'responsePath'>

class DispatchMaterial {
  readonly role: RunRole
  readonly inputs: readonly DispatchInput[]
  readonly argv: readonly string[]
  readonly response: RunResponse

  constructor(asked: {
    role: RunRole,
    inputs: readonly DispatchInput[],
    argv: readonly string[],
    response: RunResponse,
  }) {
    this.role = asked.role
    this.inputs = Object.freeze([...asked.inputs])
    this.argv = Object.freeze([...asked.argv])
    this.response = Object.freeze({ ...asked.response })
    Object.freeze(this)
  }
}

class RunDispatchResolution {
  readonly dispatch: RunDispatch
  readonly seal: string

  constructor(dispatch: RunDispatch, seal: string) {
    this.dispatch = dispatch
    this.seal = seal
    Object.freeze(this)
  }
}

export class RunConsumingCommand {
  readonly argv: readonly string[]
  readonly responsePath: string | null

  private constructor(argv: readonly string[], responsePath: string | null) {
    this.argv = Object.freeze([...argv])
    this.responsePath = responsePath
    Object.freeze(this)
  }

  static forEdits(argv: readonly string[]): RunConsumingCommand {
    if (argv[0] !== CONSUMING_VERB_BY_STEP[STEPS.RECONCILE]) {
      throw new RunNotUnderstood(`the announced consuming argv does not consume a reconciliation: ${JSON.stringify(argv)}`)
    }
    return new RunConsumingCommand(argv, null)
  }
}

export class RunDispatch {
  readonly ticket: string
  readonly role: RunRole
  readonly paths: readonly string[]
  readonly argv: readonly string[]
  readonly response: RunResponse

  constructor(asked: {
    ticket: string,
    role: RunDispatch['role'],
    paths: readonly string[],
    argv: readonly string[],
    response: RunDispatch['response'],
  }) {
    this.ticket = asked.ticket
    this.role = asked.role
    this.paths = Object.freeze([...asked.paths])
    this.argv = Object.freeze([...asked.argv])
    this.response = Object.freeze({ ...asked.response })
    Object.freeze(this)
  }

  static async resolve(asked: {
    ticket: string,
    stdout: string,
    command: RunConsumingCommand | null,
    cwd: string,
    pluginRoot: string,
  }): Promise<RunDispatchResolution> {
    const material = RunDispatch.#material(asked)
    const paths = Object.freeze(material.inputs.map((input) => input.path))
    const sha256: string[] = []
    for (const input of material.inputs) sha256.push(await RunDispatch.#hash(input, asked.cwd))
    const dispatch = new RunDispatch({
      ticket: asked.ticket,
      role: material.role,
      paths,
      argv: material.argv,
      response: material.response,
    })
    const seal = `${JSON.stringify({
      version: 1,
      paths: dispatch.paths,
      sha256,
      role: dispatch.role,
      argv: dispatch.argv,
      response: dispatch.response,
    })}\n`
    return new RunDispatchResolution(dispatch, seal)
  }

  static #material(asked: {
    stdout: string,
    command: RunConsumingCommand | null,
    pluginRoot: string,
  }): DispatchMaterial {
    const announced = AnnouncedStep.read(asked.stdout)
    if (RunDispatch.#consumesEdits(asked.command)) return RunDispatch.#edits(asked, announced)
    if (announced === null) {
      throw new RunNotUnderstood(`ct-step output has no dispatch role: ${JSON.stringify(asked.stdout)}`)
    }
    const step = announced.step
    switch (step) {
      case STEPS.IMPLEMENT: {
        const rubric = RunDispatch.#pathOf(announced, INPUT_ROLES.RUBRIC)
        const declaredRubric = join(asked.pluginRoot, RoleBytes.filesOf(step)[0])
        if (rubric !== declaredRubric) {
          throw new RunNotUnderstood(`the printed implementer rubric ${rubric} does not match ${declaredRubric}`)
        }
        return RunDispatch.#structured({
          role: 'implement',
          step,
          round: announced,
          pluginRoot: asked.pluginRoot,
          argv: [
            '--tools', IMPLEMENTER_TOOLS,
            '--allowedTools', IMPLEMENTER_TOOLS,
            '--model', IMPLEMENTER_MODEL,
            '--json-schema', JSON.stringify(REPORT_SCHEMA),
          ],
        })
      }
      case STEPS.JUDGE:
        return RunDispatch.#defined({
          role: 'judge',
          step,
          round: announced,
          pluginRoot: asked.pluginRoot,
          tools: JUDGE_TOOLS,
          schema: null,
        })
      case STEPS.ADVISE:
        return RunDispatch.#defined({
          role: 'advise',
          step,
          round: announced,
          pluginRoot: asked.pluginRoot,
          tools: ADVISOR_TOOLS,
          schema: ADVICE_SCHEMA,
        })
      case STEPS.SLICE_JUDGE:
        return RunDispatch.#defined({
          role: 'slice-judge',
          step,
          round: announced,
          pluginRoot: asked.pluginRoot,
          tools: SLICE_JUDGE_TOOLS,
          schema: null,
        })
      case STEPS.E2E:
        throw new RunNotUnderstood('ct-step requested unsupported E2E material')
      case STEPS.RECONCILE:
        throw new RunNotUnderstood('reconciliation material has an incompatible consuming command')
      default:
        throw new RunNotUnderstood(`ct-step requested unsupported ${step} material`)
    }
  }

  static #structured(asked: {
    role: 'implement',
    step: string,
    round: DispatchRound,
    pluginRoot: string,
    argv: readonly string[],
  }): DispatchMaterial {
    return new DispatchMaterial({
      role: asked.role,
      inputs: RunDispatch.#withRoleFiles(asked.step, asked.pluginRoot, RunDispatch.#inputsOf(asked.round.inputs)),
      argv: Object.freeze([...asked.argv]),
      response: RunDispatch.#response(asked.step, asked.round),
    })
  }

  static #defined(asked: {
    role: Exclude<RunRole, 'implement' | 'reconcile'>,
    step: string,
    round: DispatchRound,
    pluginRoot: string,
    tools: string,
    schema: object | null,
  }): DispatchMaterial {
    const files = RoleBytes.filesOf(asked.step)
    const definition = RunDispatch.#definition(join(asked.pluginRoot, files[0]))
    const tools = definition.tools.join(', ')
    if (tools !== asked.tools) {
      throw new RunNotUnderstood(`the ${asked.role} definition tools do not match the plugin contract`)
    }
    const argv = [
      '--tools', tools,
      '--allowedTools', tools,
      '--model', definition.model,
      '--agents', JSON.stringify(definition.toClaudeAgents()),
      '--agent', definition.name,
    ]
    if (asked.schema !== null) argv.push('--json-schema', JSON.stringify(asked.schema))
    return new DispatchMaterial({
      role: asked.role,
      inputs: RunDispatch.#withRoleFiles(asked.step, asked.pluginRoot, RunDispatch.#inputsOf(asked.round.inputs)),
      argv: Object.freeze(argv),
      response: RunDispatch.#response(asked.step, asked.round),
    })
  }

  static #consumesEdits(command: RunConsumingCommand | null): boolean {
    return command !== null
      && command.responsePath === null
      && command.argv[0] === CONSUMING_VERB_BY_STEP[STEPS.RECONCILE]
  }

  static #edits(asked: {
    stdout: string,
    pluginRoot: string,
  }, announced: AnnouncedStep | null): DispatchMaterial {
    const files = RoleBytes.filesOf(STEPS.RECONCILE)
    const definition = RunDispatch.#definition(join(asked.pluginRoot, files[0]))
    const tools = definition.tools.join(', ')
    if (tools !== RECONCILER_TOOLS) throw new RunNotUnderstood('the reconcile definition tools do not match the plugin contract')
    return new DispatchMaterial({
      role: 'reconcile',
      inputs: RunDispatch.#withRoleFiles(
        STEPS.RECONCILE,
        asked.pluginRoot,
        RunDispatch.#reconciliationInputs(asked.stdout, announced),
      ),
      argv: Object.freeze([
        '--tools', tools,
        '--allowedTools', tools,
        '--model', definition.model,
        '--agents', JSON.stringify(definition.toClaudeAgents()),
        '--agent', definition.name,
      ]),
      response: Object.freeze({ kind: 'edits' }),
    })
  }

  static #reconciliationInputs(stdout: string, announced: AnnouncedStep | null): readonly DispatchInput[] {
    const round = RunDispatch.#inputsOf(
      announced?.inputs.filter((input) => input.role === INPUT_ROLES.RECONCILIATION_PACKAGE) ?? [],
    )
    if (round.length === 0) {
      throw new RunNotUnderstood(
        `ct-step output has no supported reconciliation material: ${JSON.stringify(stdout)}`,
      )
    }
    return round
  }

  static #inputsOf(inputs: readonly AnnouncedInput[]): readonly DispatchInput[] {
    return Object.freeze(inputs.map((input): DispatchInput => Object.freeze({ kind: input.kind, path: input.path })))
  }

  static #pathOf(round: DispatchRound, role: string): string | null {
    const input = round.inputs.find((candidate) => candidate.role === role)
    return input === undefined ? null : input.path
  }

  static #withRoleFiles(step: string, pluginRoot: string, inputs: readonly DispatchInput[]): readonly DispatchInput[] {
    const material = [...inputs]
    for (const path of RoleBytes.filesOf(step)) {
      const roleInput: DispatchInput = Object.freeze({
        kind: 'literal',
        path: join(pluginRoot, path),
      })
      if (!material.some((input) => input.path === roleInput.path)) material.push(roleInput)
    }
    return Object.freeze(material)
  }

  static #response(step: string, round: DispatchRound): RunResponse {
    if (round.responsePath === null) {
      throw new RunNotUnderstood('the announced response path conflicts with the consuming command')
    }
    switch (RESPONSE_KIND_BY_STEP[step]) {
      case RESPONSE_KINDS.FILE:
        return Object.freeze({ kind: 'file', path: round.responsePath })
      case RESPONSE_KINDS.STRUCTURED:
        return Object.freeze({ kind: 'structured', path: round.responsePath })
      default:
        throw new RunNotUnderstood(`the step "${step}" does not answer through a printed response path`)
    }
  }

  static #definition(path: string): AgentDefinition {
    try {
      return AgentDefinition.parse(readFileSync(path, 'utf8'))
    } catch (cause) {
      throw new RunNotUnderstood(`the plugin agent definition ${path} could not be read: ${String(cause)}`)
    }
  }

  static async #hash(input: DispatchInput, cwd: string): Promise<string> {
    if (input.kind === 'literal') return RunDispatch.#hashFile(input.path, cwd)
    const matches: string[] = []
    for await (const match of glob(input.path, { cwd })) matches.push(match)
    matches.sort()
    if (matches.length === 0) throw new RunNotUnderstood(`dispatch input glob ${input.path} has no matches`)
    const digest = createHash('sha256')
    for (const match of matches) {
      const path = isAbsolute(match) ? match : join(cwd, match)
      digest.update(match).update('\0').update(await RunDispatch.#bytes(path, match)).update('\0')
    }
    return digest.digest('hex')
  }

  static async #hashFile(path: string, cwd: string): Promise<string> {
    const resolved = isAbsolute(path) ? path : join(cwd, path)
    return createHash('sha256').update(await RunDispatch.#bytes(resolved, path)).digest('hex')
  }

  static async #bytes(path: string, printed: string): Promise<Buffer> {
    try {
      const stat = await lstat(path)
      if (!stat.isFile()) throw new RunNotUnderstood(`dispatch input ${printed} is not a regular file`)
      return await readFile(path)
    } catch (cause) {
      if (cause instanceof RunNotUnderstood) throw cause
      throw new RunNotUnderstood(`dispatch input ${printed} could not be read: ${String(cause)}`)
    }
  }
}
