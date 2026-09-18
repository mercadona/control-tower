import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { glob, lstat, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { AgentDefinition } from '../../../plugin/scripts/judge-agent-definition.js'
import { RoleBytes } from '../../../plugin/scripts/role-bytes.js'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import {
  ADVICE_SCHEMA,
  ADVISOR_TOOLS,
  IMPLEMENTER_MODEL,
  IMPLEMENTER_TOOLS,
  JUDGE_TOOLS,
  RECONCILER_TOOLS,
  REPORT_SCHEMA,
  SLICE_JUDGE_TOOLS,
  SLICE_VERDICT_SCHEMA,
  VERDICT_SCHEMA,
} from '../../../plugin/scripts/step-contracts.js'
import { RunNotUnderstood } from '../domain/exceptions.ts'

type RunRole = 'implement' | 'judge' | 'advise' | 'slice-judge' | 'reconcile'
type RunResponse = { readonly kind: 'structured', readonly path: string } | { readonly kind: 'edits' }
type DispatchInput = { readonly kind: 'literal' | 'glob', readonly path: string }

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
  static readonly #PREFIX = 'When it comes back:  ct-step '

  readonly argv: readonly string[]
  readonly responsePath: string | null

  private constructor(argv: readonly string[], responsePath: string | null) {
    this.argv = Object.freeze([...argv])
    this.responsePath = responsePath
    Object.freeze(this)
  }

  static structured(asked: {
    stdout: string,
    plan: string,
    issue: number,
    step: string,
    verb: 'report' | 'verdict' | 'advice' | 'slice-verdict',
  }): RunConsumingCommand {
    const prefix = `${RunConsumingCommand.#PREFIX}${asked.verb} `
    const suffix = ` --plan ${asked.plan} --issue ${asked.issue}`
    const lines = RunConsumingCommand.#lines(asked.stdout)
    if (lines.length !== 1
      || !lines[0].startsWith(prefix)
      || !lines[0].endsWith(suffix)
      || !asked.stdout.includes(`step: ${asked.step} (`)) {
      throw new RunNotUnderstood(`ct-step output has no unique consuming command: ${JSON.stringify(asked.stdout)}`)
    }
    const responsePath = lines[0].slice(prefix.length, -suffix.length)
    if (responsePath.length === 0) {
      throw new RunNotUnderstood(`ct-step output has an empty response path: ${JSON.stringify(asked.stdout)}`)
    }
    return new RunConsumingCommand([
      asked.verb, responsePath, '--plan', asked.plan, '--issue', String(asked.issue),
    ], responsePath)
  }

  static edits(asked: { stdout: string, plan: string, issue: number }): RunConsumingCommand {
    const command = `${RunConsumingCommand.#PREFIX}reconcile --plan ${asked.plan} --issue ${asked.issue}`
    const lines = RunConsumingCommand.#lines(asked.stdout)
    if (lines.length !== 1 || !(lines[0] === command || lines[0].startsWith(`${command}  (`))) {
      throw new RunNotUnderstood(`ct-step output has no unique reconcile command: ${JSON.stringify(asked.stdout)}`)
    }
    return new RunConsumingCommand([
      'reconcile', '--plan', asked.plan, '--issue', String(asked.issue),
    ], null)
  }

  static #lines(stdout: string): readonly string[] {
    return Object.freeze(stdout.split('\n').filter((line) => line.startsWith(RunConsumingCommand.#PREFIX)))
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
    command: RunConsumingCommand,
    cwd: string,
    pluginRoot: string,
    sealed: string | null,
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
    if (asked.sealed !== null && asked.sealed !== seal) {
      throw new RunNotUnderstood(`dispatch material for ticket ${asked.ticket} conflicts with its immutable seal`)
    }
    return new RunDispatchResolution(dispatch, seal)
  }

  static #material(asked: {
    stdout: string,
    command: RunConsumingCommand,
    pluginRoot: string,
  }): DispatchMaterial {
    if (asked.stdout.includes('DISPATCH ct-reconciler') || asked.stdout.includes('REDISPATCH ct-reconciler')) {
      return RunDispatch.#edits(asked)
    }
    const step = /^step: ([a-z-]+) \(attempt \d+\)$/m.exec(asked.stdout)?.[1]
    switch (step) {
      case STEPS.IMPLEMENT:
        const rubric = RunDispatch.#literal(asked.stdout, '  - the rubric from ')
        const declaredRubric = join(asked.pluginRoot, RoleBytes.filesOf(step)[0])
        if (rubric.path !== declaredRubric) {
          throw new RunNotUnderstood(`the printed implementer rubric ${rubric.path} does not match ${declaredRubric}`)
        }
        return RunDispatch.#structured({
          role: 'implement',
          step,
          stdout: asked.stdout,
          command: asked.command,
          pluginRoot: asked.pluginRoot,
          announced: `DISPATCH AN IMPLEMENTER (subagent with model ${IMPLEMENTER_MODEL} — tools: ${IMPLEMENTER_TOOLS}) with:`,
          inputs: [rubric, RunDispatch.#literal(asked.stdout, "  - the task's brief: ")],
          responseLabel: '  - that it write its report to: ',
          argv: [
            '--tools', IMPLEMENTER_TOOLS,
            '--allowedTools', IMPLEMENTER_TOOLS,
            '--model', IMPLEMENTER_MODEL,
            '--json-schema', JSON.stringify(REPORT_SCHEMA),
          ],
        })
      case STEPS.JUDGE:
        return RunDispatch.#defined({
          role: 'judge',
          step,
          stdout: asked.stdout,
          command: asked.command,
          pluginRoot: asked.pluginRoot,
          tools: JUDGE_TOOLS,
          announced: `DISPATCH THE JUDGE (subagent ct-judge — declared WITHOUT Bash: ${JUDGE_TOOLS}) with:`,
          inputs: [
            RunDispatch.#literal(asked.stdout, '  - the review package: '),
            RunDispatch.#literal(asked.stdout, "  - the task's brief: "),
            ...RunDispatch.#optionalLiteral(asked.stdout, '  - the logs of the controls, ALREADY green, in case it wants them: ', '(none)'),
          ],
          responseLabel: '  - that it write its verdict to: ',
          schema: VERDICT_SCHEMA,
        })
      case STEPS.ADVISE:
        return RunDispatch.#defined({
          role: 'advise',
          step,
          stdout: asked.stdout,
          command: asked.command,
          pluginRoot: asked.pluginRoot,
          tools: ADVISOR_TOOLS,
          announced: `DISPATCH THE ADVISOR (subagent ct-advisor — declared with ${ADVISOR_TOOLS} only) with:`,
          inputs: [RunDispatch.#literal(asked.stdout, "  - the advisor's package: ")],
          responseLabel: '  - that it write its advice to: ',
          schema: ADVICE_SCHEMA,
        })
      case STEPS.SLICE_JUDGE:
        return RunDispatch.#defined({
          role: 'slice-judge',
          step,
          stdout: asked.stdout,
          command: asked.command,
          pluginRoot: asked.pluginRoot,
          tools: SLICE_JUDGE_TOOLS,
          announced: `DISPATCH THE SLICE JUDGE (subagent ct-slice-judge — declared WITHOUT Bash: ${SLICE_JUDGE_TOOLS}) with:`,
          inputs: [
            RunDispatch.#literal(asked.stdout, "  - the slice's review package: "),
            RunDispatch.#literal(asked.stdout, '  - the plan: '),
            ...RunDispatch.#optionalLiteral(asked.stdout, '  - the log of the Global verification, ALREADY green, in case it wants it: ', '(N/A declared)'),
            RunDispatch.#glob(asked.stdout, '  - the verdict of every task, already committed: '),
          ],
          responseLabel: '  - that it write its verdict to: ',
          schema: SLICE_VERDICT_SCHEMA,
        })
      case STEPS.E2E:
        throw new RunNotUnderstood('ct-step requested unsupported E2E material')
      case STEPS.RECONCILE:
        if (asked.stdout.includes("DISPATCH THE SLICE'S AGENT")) {
          throw new RunNotUnderstood('ct-step requested unsupported slice-agent reconciliation material')
        }
        if (!asked.stdout.includes(`DISPATCH ct-reconciler`) && !asked.stdout.includes('REDISPATCH ct-reconciler')) {
          throw new RunNotUnderstood(`ct-step output has no supported reconciliation material: ${JSON.stringify(asked.stdout)}`)
        }
        return RunDispatch.#edits(asked)
      case undefined:
        throw new RunNotUnderstood(`ct-step output has no dispatch role: ${JSON.stringify(asked.stdout)}`)
      default:
        throw new RunNotUnderstood(`ct-step requested unsupported ${step} material`)
    }
  }

  static #structured(asked: {
    role: 'implement',
    step: string,
    stdout: string,
    command: RunConsumingCommand,
    pluginRoot: string,
    announced: string,
    inputs: readonly DispatchInput[],
    responseLabel: string,
    argv: readonly string[],
  }): DispatchMaterial {
    RunDispatch.#requireAnnouncement(asked.stdout, asked.announced)
    const response = RunDispatch.#response(asked.stdout, asked.responseLabel, asked.command)
    return new DispatchMaterial({
      role: asked.role,
      inputs: RunDispatch.#withRoleFiles(asked.step, asked.pluginRoot, asked.inputs),
      argv: Object.freeze([...asked.argv]),
      response,
    })
  }

  static #defined(asked: {
    role: Exclude<RunRole, 'implement' | 'reconcile'>,
    step: string,
    stdout: string,
    command: RunConsumingCommand,
    pluginRoot: string,
    tools: string,
    announced: string,
    inputs: readonly DispatchInput[],
    responseLabel: string,
    schema: object,
  }): DispatchMaterial {
    RunDispatch.#requireAnnouncement(asked.stdout, asked.announced)
    const files = RoleBytes.filesOf(asked.step)
    const definition = RunDispatch.#definition(join(asked.pluginRoot, files[0]))
    const tools = definition.tools.join(', ')
    if (tools !== asked.tools) {
      throw new RunNotUnderstood(`the ${asked.role} definition tools do not match the plugin contract`)
    }
    return new DispatchMaterial({
      role: asked.role,
      inputs: RunDispatch.#withRoleFiles(asked.step, asked.pluginRoot, asked.inputs),
      argv: Object.freeze([
        '--tools', tools,
        '--allowedTools', tools,
        '--model', definition.model,
        '--agents', JSON.stringify(definition.toClaudeAgents()),
        '--agent', definition.name,
        '--json-schema', JSON.stringify(asked.schema),
      ]),
      response: RunDispatch.#response(asked.stdout, asked.responseLabel, asked.command),
    })
  }

  static #edits(asked: {
    stdout: string,
    command: RunConsumingCommand,
    pluginRoot: string,
  }): DispatchMaterial {
    if (asked.command.responsePath !== null || asked.command.argv[0] !== 'reconcile') {
      throw new RunNotUnderstood('reconciliation material has an incompatible consuming command')
    }
    const files = RoleBytes.filesOf(STEPS.RECONCILE)
    const definition = RunDispatch.#definition(join(asked.pluginRoot, files[0]))
    const tools = definition.tools.join(', ')
    if (tools !== RECONCILER_TOOLS) throw new RunNotUnderstood('the reconcile definition tools do not match the plugin contract')
    return new DispatchMaterial({
      role: 'reconcile',
      inputs: RunDispatch.#withRoleFiles(STEPS.RECONCILE, asked.pluginRoot, [
        RunDispatch.#literal(asked.stdout, '  - the reconciliation package: '),
      ]),
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

  static #literal(stdout: string, label: string): DispatchInput {
    return Object.freeze({ kind: 'literal', path: RunDispatch.#printed(stdout, label) })
  }

  static #glob(stdout: string, label: string): DispatchInput {
    return Object.freeze({ kind: 'glob', path: RunDispatch.#printed(stdout, label) })
  }

  static #optionalLiteral(stdout: string, label: string, absent: string): readonly DispatchInput[] {
    const path = RunDispatch.#printed(stdout, label)
    return path === absent ? Object.freeze([]) : Object.freeze([{ kind: 'literal', path }])
  }

  static #printed(stdout: string, label: string): string {
    const values = stdout.split('\n').filter((line) => line.startsWith(label)).map((line) => line.slice(label.length))
    if (values.length !== 1 || values[0].length === 0 || values[0].includes('\0')) {
      throw new RunNotUnderstood(`ct-step output has no unique ${JSON.stringify(label)} path: ${JSON.stringify(stdout)}`)
    }
    return values[0]
  }

  static #response(stdout: string, label: string, command: RunConsumingCommand): RunResponse {
    const announced = RunDispatch.#printed(stdout, label)
    if (command.responsePath === null || command.responsePath !== announced) {
      throw new RunNotUnderstood('the announced response path conflicts with the consuming command')
    }
    return Object.freeze({ kind: 'structured', path: announced })
  }

  static #requireAnnouncement(stdout: string, announcement: string): void {
    if (stdout.split('\n').filter((line) => line === announcement).length !== 1) {
      throw new RunNotUnderstood(`ct-step output has incompatible role material: ${JSON.stringify(stdout)}`)
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
