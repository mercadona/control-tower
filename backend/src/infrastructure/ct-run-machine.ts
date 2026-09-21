import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { planFilesForIssue } from '../../../plugin/scripts/plan-contract.js'
import { RUN_STATES, STEPS } from '../../../plugin/scripts/run-machine.js'
import { ANNOUNCEMENT_KINDS, ANNOUNCEMENT_VERSION } from '../../../plugin/scripts/step-announcement.js'
import { DispatchProse, UnreadableStepProse } from '../../../plugin/scripts/step-prose.js'
import { RunNotAdvanced, RunNotUnderstood } from '../domain/exceptions.ts'
import {
  RunEstablishment, RunMachine, type RunEstablishmentValue,
} from '../domain/ports/run-machine.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { RunInstruction } from '../domain/value-objects/run-instruction.ts'
import { RunAnnouncement, type RunClosure } from './run-announcement.ts'
import { type JournalEntry, RunJournal } from './run-journal.ts'
import { RunConsumingCommand, RunDispatch } from './run-dispatch.ts'
import { ProcessOutput, type ToolRunner } from './tool-runner.ts'

type InspectionFact =
  | { readonly kind: 'absent' | 'delivered' | 'unstarted' }
  | { readonly kind: 'active', readonly instruction: RunInstruction }
  | { readonly kind: 'uncertain', readonly detail: string }

type OracleEffect =
  | { readonly kind: 'call', readonly ticket: string, readonly argv: readonly string[], readonly command: RunConsumingCommand | null }
  | { readonly kind: 'command', readonly ticket: string, readonly argv: readonly string[] }
  | { readonly kind: 'next' }
  | { readonly kind: 'delivered' }
  | { readonly kind: 'refused', readonly detail: string }

class OracleResult {
  readonly effect: OracleEffect

  private constructor(effect: OracleEffect) {
    this.effect = Object.freeze(effect)
    Object.freeze(this)
  }

  static call(ticket: string, argv: readonly string[], command: RunConsumingCommand | null = null): OracleResult {
    return new OracleResult({ kind: 'call', ticket, argv: Object.freeze([...argv]), command })
  }

  static command(ticket: string, argv: readonly string[]): OracleResult {
    return new OracleResult({ kind: 'command', ticket, argv: Object.freeze([...argv]) })
  }

  static next(): OracleResult {
    return new OracleResult({ kind: 'next' })
  }

  static delivered(): OracleResult {
    return new OracleResult({ kind: 'delivered' })
  }

  static refused(detail: string): OracleResult {
    return new OracleResult({ kind: 'refused', detail })
  }
}

class RunManifest {
  readonly conversation: string
  readonly repository: string
  readonly issue: number
  readonly plan: string
  readonly initialPlanSha256: string

  constructor(asked: {
    conversation: string,
    repository: string,
    issue: number,
    plan: string,
    initialPlanSha256: string,
  }) {
    this.conversation = asked.conversation
    this.repository = asked.repository
    this.issue = asked.issue
    this.plan = asked.plan
    this.initialPlanSha256 = asked.initialPlanSha256
    Object.freeze(this)
  }

  text(): string {
    return `${JSON.stringify({
      version: 1,
      conversation: this.conversation,
      repository: this.repository,
      issue: this.issue,
      plan: this.plan,
      initialPlanSha256: this.initialPlanSha256,
    })}\n`
  }

  static read(text: string, watch: PlanWatch): RunManifest {
    const value = new JsonContract(text, 'run manifest', [
      'version', 'conversation', 'repository', 'issue', 'plan', 'initialPlanSha256',
    ])
    const version = value.field('version')
    const conversation = value.field('conversation')
    const repository = value.field('repository')
    const issue = value.field('issue')
    const plan = value.field('plan')
    const initialPlanSha256 = value.field('initialPlanSha256')
    if (version !== 1
      || typeof conversation !== 'string'
      || typeof repository !== 'string'
      || typeof issue !== 'number'
      || !Number.isInteger(issue)
      || typeof plan !== 'string'
      || typeof initialPlanSha256 !== 'string'
      || !JsonContract.isSha256(initialPlanSha256)) {
      throw new RunNotUnderstood(`the run manifest has malformed values: ${text}`)
    }
    if (conversation !== watch.agent
      || repository !== watch.repository.text
      || issue !== watch.issue.number
      || planFilesForIssue(issue, [plan]).length !== 1) {
      throw new RunNotUnderstood(`the run manifest does not identify this plan watch: ${text}`)
    }
    return new RunManifest({
      conversation,
      repository,
      issue,
      plan,
      initialPlanSha256,
    })
  }
}

class CommandRequest {
  readonly previous: string | null
  readonly argv: readonly string[]
  readonly cwd: string
  readonly planSha256: string

  constructor(asked: {
    previous: string | null,
    argv: readonly string[],
    cwd: string,
    planSha256: string,
  }) {
    this.previous = asked.previous
    this.argv = Object.freeze([...asked.argv])
    this.cwd = asked.cwd
    this.planSha256 = asked.planSha256
    Object.freeze(this)
  }

  text(): string {
    return `${JSON.stringify({
      version: 1,
      previous: this.previous,
      argv: this.argv,
      cwd: this.cwd,
      planSha256: this.planSha256,
    })}\n`
  }

  static read(text: string): CommandRequest {
    const value = new JsonContract(text, 'command request', [
      'version', 'previous', 'argv', 'cwd', 'planSha256',
    ])
    const version = value.field('version')
    const previous = value.field('previous')
    const argv = value.field('argv')
    const cwd = value.field('cwd')
    const planSha256 = value.field('planSha256')
    if (version !== 1
      || !(previous === null || typeof previous === 'string')
      || !Array.isArray(argv)
      || !argv.every((argument) => typeof argument === 'string')
      || argv.length === 0
      || typeof cwd !== 'string'
      || cwd.length === 0
      || typeof planSha256 !== 'string'
      || !JsonContract.isSha256(planSha256)) {
      throw new RunNotUnderstood(`a command request has malformed values: ${text}`)
    }
    return new CommandRequest({
      previous,
      argv,
      cwd,
      planSha256,
    })
  }
}

class CommandReceipt {
  readonly output: ProcessOutput
  readonly beforeRun: string | null
  readonly afterRun: string | null

  constructor(asked: { output: ProcessOutput, beforeRun: string | null, afterRun: string | null }) {
    this.output = asked.output
    this.beforeRun = asked.beforeRun
    this.afterRun = asked.afterRun
    Object.freeze(this)
  }

  text(): string {
    return `${JSON.stringify({
      version: 1,
      code: this.output.code,
      stdout: this.output.stdout,
      stderr: this.output.stderr,
      beforeRun: this.beforeRun,
      afterRun: this.afterRun,
    })}\n`
  }

  static read(text: string): CommandReceipt {
    const value = new JsonContract(text, 'command receipt', [
      'version', 'code', 'stdout', 'stderr', 'beforeRun', 'afterRun',
    ])
    const version = value.field('version')
    const code = value.field('code')
    const stdout = value.field('stdout')
    const stderr = value.field('stderr')
    const beforeRun = value.field('beforeRun')
    const afterRun = value.field('afterRun')
    if (version !== 1
      || typeof code !== 'number'
      || !Number.isInteger(code)
      || typeof stdout !== 'string'
      || typeof stderr !== 'string'
      || !(beforeRun === null || typeof beforeRun === 'string')
      || !(afterRun === null || typeof afterRun === 'string')) {
      throw new RunNotUnderstood(`a command receipt has malformed values: ${text}`)
    }
    return new CommandReceipt({
      output: new ProcessOutput({ code, stdout, stderr }),
      beforeRun,
      afterRun,
    })
  }
}

class JournalCommand {
  readonly ticket: string
  readonly request: CommandRequest
  readonly receipt: CommandReceipt | null

  constructor(asked: { ticket: string, request: CommandRequest, receipt: CommandReceipt | null }) {
    this.ticket = asked.ticket
    this.request = asked.request
    this.receipt = asked.receipt
    Object.freeze(this)
  }
}

class MachineState {
  readonly manifest: RunManifest | null
  readonly commands: readonly JournalCommand[]
  readonly run: string | null

  constructor(asked: {
    manifest: RunManifest | null,
    commands: readonly JournalCommand[],
    run: string | null,
  }) {
    this.manifest = asked.manifest
    this.commands = Object.freeze([...asked.commands])
    this.run = asked.run
    Object.freeze(this)
  }
}

class JsonContract {
  readonly value: object

  constructor(text: string, name: string, keys: readonly string[]) {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (cause) {
      throw new RunNotUnderstood(`${name} is not valid JSON: ${String(cause)}`)
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new RunNotUnderstood(`${name} is not an object: ${text}`)
    }
    const actual = Object.keys(value).sort()
    const expected = [...keys].sort()
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new RunNotUnderstood(`${name} has unexpected keys: ${text}`)
    }
    this.value = value
    Object.freeze(this)
  }

  field(name: string): unknown {
    return Object.getOwnPropertyDescriptor(this.value, name)?.value
  }

  static isSha256(value: string): boolean {
    return /^[a-f0-9]{64}$/.test(value)
  }
}

export class AnnouncedStep {
  readonly step: string
  readonly commands: readonly string[] | null
  readonly argv: readonly string[]
  readonly responseKind: string | null

  private constructor(asked: {
    step: string,
    commands: readonly string[] | null,
    argv: readonly string[],
    responseKind: string | null,
  }) {
    this.step = asked.step
    this.commands = asked.commands
    this.argv = asked.argv
    this.responseKind = asked.responseKind
    Object.freeze(this)
  }

  static read(stdout: string): AnnouncedStep | null {
    let value: unknown
    try {
      value = JSON.parse(stdout)
    } catch {
      return null
    }
    const announcement = AnnouncedStep.#object(value)
    if (announcement === undefined
      || announcement.version !== ANNOUNCEMENT_VERSION
      || announcement.kind !== ANNOUNCEMENT_KINDS.STEP) {
      return null
    }
    const step = AnnouncedStep.#object(announcement.run)?.step
    if (typeof step !== 'string') return null
    const commands = AnnouncedStep.#stringArray(announcement.commands)
    const argv = AnnouncedStep.#stringArray(AnnouncedStep.#object(announcement.consuming)?.argv) ?? Object.freeze([])
    const responseKindField = AnnouncedStep.#object(AnnouncedStep.#object(announcement.dispatch)?.response)?.kind
    return new AnnouncedStep({
      step,
      commands,
      argv,
      responseKind: typeof responseKindField === 'string' ? responseKindField : null,
    })
  }

  static #object(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  }

  static #stringArray(value: unknown): readonly string[] | null {
    return Array.isArray(value) ? Object.freeze([...value]) as readonly string[] : null
  }
}

class OracleBoundary {
  static read(command: JournalCommand, manifest: RunManifest): OracleResult {
    if (command.receipt === null) {
      return OracleResult.refused(`command ${command.ticket} has no receipt and cannot be replayed`)
    }
    const output = command.receipt.output
    let announcement: RunAnnouncement | null
    try {
      announcement = RunAnnouncement.of(output.stdout)
    } catch (cause) {
      if (cause instanceof RunNotUnderstood) return OracleResult.refused(cause.message)
      throw cause
    }
    if (announcement !== null && announcement.closure !== null) {
      return OracleBoundary.#closure(announcement, announcement.closure)
    }
    if (output.code !== 0) {
      return OracleResult.refused(
        `ct-step exited ${output.code} without announcing a run state; stdout: ${JSON.stringify(output.stdout)}; stderr: ${JSON.stringify(output.stderr)}`,
      )
    }
    if (output.stdout.includes("DISPATCH THE SLICE'S AGENT (it has Bash)")) {
      return OracleResult.refused(
        `ct-step requested unsupported slice-agent reconciliation: ${JSON.stringify(output.stdout)}`,
      )
    }
    const reconcileCommand = `When it comes back:  ct-step reconcile --plan ${manifest.plan} --issue ${manifest.issue}`
    if ((output.stdout.includes('DISPATCH ct-reconciler') || output.stdout.includes('REDISPATCH ct-reconciler'))
      && output.stdout.split('\n').some((line) => line.trim().startsWith(reconcileCommand))) {
      try {
        const consuming = RunConsumingCommand.edits({
          stdout: output.stdout,
          plan: manifest.plan,
          issue: manifest.issue,
        })
        return OracleResult.call(command.ticket, consuming.argv, consuming)
      } catch (cause) {
        if (cause instanceof RunNotUnderstood) return OracleResult.refused(cause.message)
        throw cause
      }
    }
    const step = AnnouncedStep.read(output.stdout)?.step
      ?? /^step: ([a-z0-9-]+) \(attempt \d+\)$/m.exec(output.stdout)?.[1]
    switch (step) {
      case STEPS.IMPLEMENT:
        return OracleBoundary.#fileCall(output.stdout, command.ticket, STEPS.IMPLEMENT)
      case STEPS.JUDGE:
        return OracleBoundary.#fileCall(output.stdout, command.ticket, STEPS.JUDGE)
      case STEPS.ADVISE:
        return OracleBoundary.#fileCall(output.stdout, command.ticket, STEPS.ADVISE)
      case STEPS.SLICE_JUDGE:
        return OracleBoundary.#fileCall(output.stdout, command.ticket, STEPS.SLICE_JUDGE)
      case STEPS.E2E:
        return OracleResult.call(command.ticket, [])
      case STEPS.CONTROLS:
        return OracleBoundary.#plainCommand(output.stdout, command.ticket, manifest, STEPS.CONTROLS, 'controls')
      case STEPS.COMMIT:
        return OracleBoundary.#plainCommand(output.stdout, command.ticket, manifest, STEPS.COMMIT, 'commit')
      case STEPS.RECONCILE:
        return OracleBoundary.#plainCommand(output.stdout, command.ticket, manifest, STEPS.RECONCILE, 'reconcile')
      case STEPS.GLOBAL:
        return OracleBoundary.#plainCommand(output.stdout, command.ticket, manifest, STEPS.GLOBAL, 'global')
      case undefined:
        break
      default:
        return OracleResult.refused(`ct-step output is not understood: ${JSON.stringify(output.stdout)}`)
    }
    return OracleResult.refused(`ct-step output is not understood: ${JSON.stringify(output.stdout)}`)
  }

  static #closure(announcement: RunAnnouncement, closure: RunClosure): OracleResult {
    if (announcement.kind === ANNOUNCEMENT_KINDS.TRANSITION) {
      if (closure.state === RUN_STATES.OPEN) return OracleResult.next()
      if (closure.state === RUN_STATES.DELIVERED) return OracleResult.delivered()
    }
    return OracleResult.refused(announcement.diagnostic)
  }

  static #fileCall(
    stdout: string,
    ticket: string,
    step: string,
  ): OracleResult {
    try {
      const material = DispatchProse.read({ stdout, step })
      return OracleResult.call(ticket, [...material.consuming!.argv])
    } catch (cause) {
      if (cause instanceof UnreadableStepProse) return OracleResult.refused(cause.message)
      throw cause
    }
  }

  static #plainCommand(
    stdout: string,
    ticket: string,
    manifest: RunManifest,
    step: string,
    verb: string,
  ): OracleResult {
    const announced = AnnouncedStep.read(stdout)
    if (announced !== null) return OracleBoundary.#announcedCommand(stdout, announced, ticket, step, verb)
    const expected = `ct-step ${verb} --plan ${manifest.plan} --issue ${manifest.issue}`
    if (!stdout.split('\n').some((line) => line.trim() === expected || line === `Run it with:  ${expected}`)
      || !stdout.includes(`step: ${step} (`)) {
      return OracleResult.refused(`ct-step output is not understood: ${JSON.stringify(stdout)}`)
    }
    return OracleResult.command(ticket, [verb, '--plan', manifest.plan, '--issue', String(manifest.issue)])
  }

  static #announcedCommand(
    stdout: string, announced: AnnouncedStep, ticket: string, step: string, verb: string,
  ): OracleResult {
    if (announced.step !== step || announced.commands === null || announced.argv[0] !== verb) {
      return OracleResult.refused(`ct-step output is not understood: ${JSON.stringify(stdout)}`)
    }
    return OracleResult.command(ticket, announced.argv)
  }
}

export class RunInspection {
  readonly fact: InspectionFact

  constructor(fact: InspectionFact) {
    switch (fact.kind) {
      case 'absent':
      case 'delivered':
      case 'unstarted':
        this.fact = Object.freeze({ kind: fact.kind })
        break
      case 'active':
        this.fact = Object.freeze({ kind: fact.kind, instruction: fact.instruction })
        break
      case 'uncertain':
        this.fact = Object.freeze({ kind: fact.kind, detail: fact.detail })
        break
      default:
        this.fact = fact satisfies never
    }
    Object.freeze(this)
  }
}

export class CtRunMachine extends RunMachine {
  readonly journal: RunJournal
  readonly node: ToolRunner['runWholeOutput']
  readonly git: ToolRunner['runWholeOutput']
  readonly read: (path: string) => Promise<string | null>
  readonly ctStep: string
  readonly dispatchCheck: string
  readonly pluginRoot: string

  constructor(ports: {
    journal: RunJournal,
    node: ToolRunner['runWholeOutput'],
    git: ToolRunner['runWholeOutput'],
    read: (path: string) => Promise<string | null>,
    ctStep: string,
    dispatchCheck: string,
    pluginRoot: string,
  }) {
    super()
    this.journal = ports.journal
    this.node = ports.node
    this.git = ports.git
    this.read = ports.read
    this.ctStep = ports.ctStep
    this.dispatchCheck = ports.dispatchCheck
    this.pluginRoot = ports.pluginRoot
  }

  async establishment(watch: PlanWatch): Promise<RunEstablishmentValue> {
    const state = await this.#state(watch)
    if (state.manifest !== null) return RunEstablishment.ESTABLISHED
    if (state.commands.length > 0 || state.run !== null) {
      throw new RunNotUnderstood('machine evidence exists without a run manifest')
    }
    return RunEstablishment.ABSENT
  }

  async open(watch: PlanWatch): Promise<RunInstruction> {
    const state = await this.#state(watch)
    let manifest = state.manifest
    if (manifest === null) {
      if (state.commands.length > 0 || state.run !== null) {
        throw new RunNotUnderstood('machine evidence exists without a run manifest')
      }
      manifest = await this.#candidate(watch)
      await this.journal.establish(watch, manifest.text())
    }
    if (state.commands.length === 0) {
      if (state.run !== null) {
        throw new RunNotUnderstood('the established run has unexplained plugin activity before its first command')
      }
      return this.#execute(watch, manifest, null, this.#nextArgv(manifest))
    }
    return this.#instruction(state.commands[state.commands.length - 1], manifest)
  }

  async advance(watch: PlanWatch, instruction: RunInstruction): Promise<RunInstruction> {
    if (instruction.work.kind !== 'call' && instruction.work.kind !== 'command') return instruction
    const work = instruction.work
    const state = await this.#state(watch)
    if (state.manifest === null) throw new RunNotUnderstood('a run instruction has no manifest')
    const from = state.commands.findIndex((command) => command.ticket === work.ticket)
    if (from === -1) throw new RunNotUnderstood(`instruction ticket ${work.ticket} is not in the run journal`)
    const projected = this.#instruction(state.commands[from], state.manifest)
    if (projected.work.kind !== work.kind
      || (projected.work.kind !== 'call' && projected.work.kind !== 'command')
      || projected.work.ticket !== work.ticket) {
      throw new RunNotUnderstood(`instruction ticket ${work.ticket} does not carry the supplied work`)
    }
    return this.#advanceFrom(watch, state.manifest, state.commands, from)
  }

  async inspect(watch: PlanWatch): Promise<RunInspection> {
    const state = await this.#state(watch)
    if (state.manifest === null) {
      if (state.commands.length > 0 || state.run !== null) {
        throw new RunNotUnderstood('machine evidence exists without a run manifest')
      }
      return new RunInspection({ kind: 'absent' })
    }
    if (state.commands.length === 0) {
      return state.run === null
        ? new RunInspection({ kind: 'unstarted' })
        : new RunInspection({
          kind: 'uncertain',
          detail: 'the established run has unexplained plugin activity before its first command',
        })
    }
    const instruction = this.#instruction(state.commands[state.commands.length - 1], state.manifest)
    switch (instruction.work.kind) {
      case 'delivered':
        return new RunInspection({ kind: 'delivered' })
      case 'refused':
        return new RunInspection({ kind: 'uncertain', detail: instruction.work.detail })
      case 'call':
      case 'command':
        return new RunInspection({ kind: 'active', instruction })
    }
    return instruction.work satisfies never
  }

  async dispatch(watch: PlanWatch, ticket: string): Promise<RunDispatch> {
    const state = await this.#state(watch)
    if (state.manifest === null) throw new RunNotUnderstood('dispatch material has no run manifest')
    const command = state.commands.find((candidate) => candidate.ticket === ticket)
    if (command === undefined) throw new RunNotUnderstood(`dispatch ticket ${ticket} is not in the run journal`)
    if (command.receipt === null) throw new RunNotUnderstood(`dispatch ticket ${ticket} has no receipt`)
    if (command.receipt.output.code !== 0) {
      throw new RunNotUnderstood(`dispatch ticket ${ticket} did not record successful oracle output`)
    }
    if (command.receipt.output.stdout.includes("DISPATCH THE SLICE'S AGENT")) {
      throw new RunNotUnderstood('ct-step requested unsupported slice-agent reconciliation material')
    }
    const effect = OracleBoundary.read(command, state.manifest).effect
    if (effect.kind === 'refused') throw new RunNotUnderstood(effect.detail)
    if (effect.kind !== 'call') throw new RunNotUnderstood(`ticket ${ticket} does not carry dispatch material`)
    if (effect.argv.length === 0) throw new RunNotUnderstood('ct-step requested unsupported E2E material')
    const resolved = await RunDispatch.resolve({
      ticket,
      stdout: command.receipt.output.stdout,
      command: effect.command,
      cwd: command.request.cwd,
      pluginRoot: this.pluginRoot,
      sealed: await this.journal.material(watch, ticket),
    })
    await this.journal.seal(watch, ticket, resolved.seal)
    return resolved.dispatch
  }

  async #advanceFrom(
    watch: PlanWatch,
    manifest: RunManifest,
    commands: readonly JournalCommand[],
    from: number,
  ): Promise<RunInstruction> {
    let index = from
    for (;;) {
      const command = commands[index]
      const effect = OracleBoundary.read(command, manifest).effect
      if (effect.kind === 'delivered' || effect.kind === 'refused') {
        return CtRunMachine.#instructionOf(effect)
      }
      const argv = effect.kind === 'next' ? this.#nextArgv(manifest) : this.#runnerArgv(effect.argv)
      const successor = commands[index + 1]
      if (successor === undefined) return this.#execute(watch, manifest, command.ticket, argv)
      if (successor.request.previous !== command.ticket
        || successor.request.cwd !== watch.located.path
        || !CtRunMachine.#same(successor.request.argv, argv)) {
        throw new RunNotUnderstood(`command ${successor.ticket} is not the recorded successor of ${command.ticket}`)
      }
      const successorEffect = OracleBoundary.read(successor, manifest).effect
      if (successorEffect.kind !== 'next') return CtRunMachine.#instructionOf(successorEffect)
      index += 1
    }
  }

  async #execute(
    watch: PlanWatch,
    manifest: RunManifest,
    previous: string | null,
    argv: readonly string[],
  ): Promise<RunInstruction> {
    if (argv.length === 0) {
      return new RunInstruction({ kind: 'refused', detail: 'ct-step did not print an executable consuming verb' })
    }
    const plan = await this.read(join(watch.located.path, manifest.plan))
    if (plan === null) throw new RunNotAdvanced(`the run plan ${manifest.plan} could not be read`)
    const request = new CommandRequest({
      previous,
      argv,
      cwd: watch.located.path,
      planSha256: CtRunMachine.#digest(plan),
    })
    const ticket = await this.journal.begin(watch, request.text())
    const beforeRun = await this.read(this.#runPath(watch))
    const output = await this.node([...argv], { cwd: watch.located.path })
    const afterRun = await this.read(this.#runPath(watch))
    const receipt = new CommandReceipt({ output, beforeRun, afterRun })
    await this.journal.finish(watch, ticket, receipt.text())
    const command = new JournalCommand({ ticket, request, receipt })
    const effect = OracleBoundary.read(command, manifest).effect
    if (effect.kind !== 'next') return CtRunMachine.#instructionOf(effect)
    return this.#execute(watch, manifest, ticket, this.#nextArgv(manifest))
  }

  #instruction(command: JournalCommand, manifest: RunManifest): RunInstruction {
    const effect = OracleBoundary.read(command, manifest).effect
    return effect.kind === 'next'
      ? new RunInstruction({ kind: 'command', ticket: command.ticket })
      : CtRunMachine.#instructionOf(effect)
  }

  async #state(watch: PlanWatch): Promise<MachineState> {
    const manifestText = await this.journal.manifest(watch)
    const entries = await this.journal.entries(watch)
    const manifest = manifestText === null ? null : RunManifest.read(manifestText, watch)
    const commands = CtRunMachine.#chain(entries, watch)
    const run = await this.read(this.#runPath(watch))
    return new MachineState({ manifest, commands, run })
  }

  async #candidate(watch: PlanWatch): Promise<RunManifest> {
    const listed = await this.git([
      '-C', watch.located.path, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/superpowers/plans',
    ])
    CtRunMachine.#requireSuccess(listed, 'git ls-tree could not list the committed plans')
    const plans = planFilesForIssue(watch.issue.number, listed.stdout.split('\n').filter(Boolean))
    if (plans.length !== 1) {
      throw new RunNotUnderstood(
        `expected exactly one committed plan for ${watch.issue}, found ${plans.length}: ${plans.join(', ')}`,
      )
    }
    const shown = await this.git(['-C', watch.located.path, 'show', `HEAD:${plans[0]}`])
    CtRunMachine.#requireSuccess(shown, `git show could not read the committed plan ${plans[0]}`)
    const checked = await this.node([
      this.dispatchCheck, String(watch.issue.number), '--repo', watch.repository.text, '--check-plan',
    ], { cwd: watch.located.path })
    CtRunMachine.#requireSuccess(checked, 'dispatch-check could not validate the committed plan')
    return new RunManifest({
      conversation: watch.agent,
      repository: watch.repository.text,
      issue: watch.issue.number,
      plan: plans[0],
      initialPlanSha256: CtRunMachine.#digest(shown.stdout),
    })
  }

  #nextArgv(manifest: RunManifest): readonly string[] {
    return Object.freeze([
      this.ctStep, 'next', '--plan', manifest.plan, '--issue', String(manifest.issue),
    ])
  }

  #runnerArgv(argv: readonly string[]): readonly string[] {
    return Object.freeze([this.ctStep, ...argv, '--output-format', 'json'])
  }

  #runPath(watch: PlanWatch): string {
    return join(watch.located.path, '.agent', `run-${watch.issue.number}.json`)
  }

  static #chain(entries: readonly JournalEntry[], watch: PlanWatch): readonly JournalCommand[] {
    const commands = entries.map((entry) => new JournalCommand({
      ticket: entry.ticket,
      request: CommandRequest.read(entry.request),
      receipt: entry.receipt.kind === 'absent' ? null : CommandReceipt.read(entry.receipt.text),
    }))
    for (const command of commands) {
      if (command.request.cwd !== watch.located.path) {
        throw new RunNotUnderstood(`command ${command.ticket} was recorded for another working directory`)
      }
    }
    if (commands.length === 0) return Object.freeze([])
    const roots = commands.filter((command) => command.request.previous === null)
    if (roots.length !== 1) throw new RunNotUnderstood(`the command journal has ${roots.length} roots`)
    const byPrevious = new Map<string, JournalCommand[]>()
    const tickets = new Set(commands.map((command) => command.ticket))
    for (const command of commands) {
      if (command.request.previous === null) continue
      if (!tickets.has(command.request.previous)) {
        throw new RunNotUnderstood(`command ${command.ticket} has a dangling previous ticket`)
      }
      const successors = byPrevious.get(command.request.previous) ?? []
      successors.push(command)
      byPrevious.set(command.request.previous, successors)
    }
    const ordered: JournalCommand[] = []
    const visited = new Set<string>()
    let command: JournalCommand | undefined = roots[0]
    while (command !== undefined) {
      if (visited.has(command.ticket)) throw new RunNotUnderstood(`the command journal cycles at ${command.ticket}`)
      visited.add(command.ticket)
      ordered.push(command)
      const successors: JournalCommand[] = byPrevious.get(command.ticket) ?? []
      if (successors.length > 1) throw new RunNotUnderstood(`command ${command.ticket} has a forked successor`)
      if (command.receipt === null && successors.length > 0) {
        throw new RunNotUnderstood(`pending command ${command.ticket} has a successor`)
      }
      command = successors[0]
    }
    if (visited.size !== commands.length) throw new RunNotUnderstood('the command journal contains a cycle')
    return Object.freeze(ordered)
  }

  static #requireSuccess(output: ProcessOutput, action: string): void {
    if (output.code !== 0) {
      throw new RunNotAdvanced(
        `${action}, it exited ${output.code}; stdout: ${JSON.stringify(output.stdout)}; stderr: ${JSON.stringify(output.stderr)}`,
      )
    }
  }

  static #same(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index])
  }

  static #instructionOf(effect: Exclude<OracleEffect, { readonly kind: 'next' }>): RunInstruction {
    switch (effect.kind) {
      case 'call':
      case 'command':
        return new RunInstruction({ kind: effect.kind, ticket: effect.ticket })
      case 'delivered':
        return new RunInstruction({ kind: effect.kind })
      case 'refused':
        return new RunInstruction({ kind: effect.kind, detail: effect.detail })
    }
    return effect satisfies never
  }

  static #digest(text: string): string {
    return createHash('sha256').update(text).digest('hex')
  }
}
