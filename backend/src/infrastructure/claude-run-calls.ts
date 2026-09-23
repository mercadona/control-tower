import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { RunNotAdvanced } from '../domain/exceptions.ts'
import { RunCalls } from '../domain/ports/run-calls.ts'
import type { CompletedPlanCall, StartedPlanCall } from '../domain/value-objects/plan-call.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { RunInstruction } from '../domain/value-objects/run-instruction.ts'
import { CallDescriptor, CallInvocation } from './claude-calls.ts'
import type { AgentCalls } from '../domain/ports/agent-calls.ts'
import type { CtRunMachine } from './ct-run-machine.ts'
import type { HeadlessFiles } from './headless-files.ts'
import type { RunDispatch } from './run-dispatch.ts'

class StructuredResponse {
  static from(stream: string | null, conversation: string): string {
    if (stream === null) return 'null\n'
    const results: Record<string, unknown>[] = []
    for (const line of stream.split('\n').filter((candidate) => candidate.length > 0)) {
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        return 'null\n'
      }
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        && 'type' in parsed && parsed.type === 'result') {
        results.push(parsed)
      }
    }
    if (results.length !== 1 || results[0].session_id !== conversation
      || !Object.hasOwn(results[0], 'structured_output')) return 'null\n'
    return `${JSON.stringify(results[0].structured_output)}\n`
  }
}

export class ClaudeRunCalls extends RunCalls {
  static readonly RESPONSE = 'response.json'
  static readonly ERRAND_END = 'Complete this role. Return the CLI response. Do not run CT commands or dispatch another agent.'
  static readonly FILE_ERRAND_END = 'Complete this role. Write your answer to the path on the last line of this file. Do not run CT commands or dispatch another agent.'

  readonly calls: AgentCalls<CallInvocation, CallDescriptor>
  readonly machine: CtRunMachine
  readonly files: HeadlessFiles
  readonly pluginRoot: string

  constructor(ports: {
    calls: AgentCalls<CallInvocation, CallDescriptor>,
    machine: CtRunMachine,
    files: HeadlessFiles,
    pluginRoot: string,
  }) {
    super()
    this.calls = ports.calls
    this.machine = ports.machine
    this.files = ports.files
    this.pluginRoot = ports.pluginRoot
  }

  async perform(watch: PlanWatch, instruction: RunInstruction): Promise<void> {
    if (instruction.work.kind !== 'call') throw new TypeError('Claude run calls require a call instruction')
    const dispatch = await this.machine.dispatch(watch, instruction.work.ticket)
    const invocation = new CallInvocation({
      conversation: watch.agent,
      purpose: 'implementation',
      cwd: watch.located.path,
      argv: this.#argv(watch.agent, dispatch),
      prompt: ClaudeRunCalls.#prompt(watch, dispatch),
      requestId: `run:${dispatch.ticket}`,
      role: dispatch.role,
    })
    const recorded = await this.calls.startedFor(invocation)
    if (recorded === null && dispatch.response.kind === 'file') {
      await this.#discardStaleResponse(watch.located.path, dispatch.response.path)
    }
    const call = recorded ?? await this.calls.start(invocation)
    if (await this.calls.completed(call) === null && !this.calls.owns(call)) {
      throw new RunNotAdvanced(`recorded call ${call.id} is incomplete and is not owned by this API process`)
    }
    const completion = await this.calls.wait(call)
    if (!completion.succeeded) throw new RunNotAdvanced(ClaudeRunCalls.#failureOf(completion))
    switch (dispatch.response.kind) {
      case 'edits':
        return
      case 'file':
        await this.#requireWrittenResponse(watch.located.path, dispatch.role, dispatch.response.path)
        return
      case 'structured':
        await this.#installResponse(watch, call, dispatch.response.path)
        return
    }
    return dispatch.response satisfies never
  }

  async #discardStaleResponse(cwd: string, printed: string): Promise<void> {
    await this.files.fs.rm(ClaudeRunCalls.#destination(cwd, printed), { force: true })
  }

  async #requireWrittenResponse(cwd: string, role: RunDispatch['role'], printed: string): Promise<void> {
    if (await this.files.read(ClaudeRunCalls.#destination(cwd, printed)) !== null) return
    throw new RunNotAdvanced(`the ${role} completed without writing its response file: ${printed}`)
  }

  #argv(conversation: string, dispatch: RunDispatch): readonly string[] {
    return Object.freeze([
      '-p',
      '--output-format', 'stream-json',
      '--verbose',
      '--permission-mode', 'acceptEdits',
      '--plugin-dir', this.pluginRoot,
      '--resume', conversation,
      ...dispatch.argv,
    ])
  }

  async #installResponse(watch: PlanWatch, call: StartedPlanCall, printed: string): Promise<void> {
    const stream = await this.files.read(join(this.files.callDirectory(call), CallDescriptor.STREAM))
    const response = StructuredResponse.from(stream, call.conversation)
    const evidence = join(this.files.callDirectory(call), ClaudeRunCalls.RESPONSE)
    if (await this.files.writeOnceOrMatch(evidence, response) === 'conflict') {
      throw new Error(`${evidence} contains different bytes after immutable publication collided`)
    }
    const destination = ClaudeRunCalls.#destination(watch.located.path, printed)
    await this.files.fs.mkdir(dirname(destination), { recursive: true })
    const temporary = join(dirname(destination), `.${basename(destination)}.${this.files.newId()}.tmp`)
    let opened: import('node:fs/promises').FileHandle | null = await this.files.fs.open(temporary, 'wx')
    try {
      await opened.writeFile(response, 'utf8')
      await opened.sync()
      await opened.close()
      opened = null
      await this.files.fs.rename(temporary, destination)
    } finally {
      if (opened !== null) await opened.close()
      await this.files.fs.rm(temporary, { force: true })
    }
  }

  static #prompt(watch: PlanWatch, dispatch: RunDispatch): string {
    const listed = `Read the listed files.\n${dispatch.paths.join('\n')}\n`
    switch (dispatch.response.kind) {
      case 'edits':
      case 'structured':
        return `${listed}${ClaudeRunCalls.ERRAND_END}`
      case 'file': {
        const printed = ClaudeRunCalls.#contained(watch.located.path, dispatch.response.path)
        return `${listed}${ClaudeRunCalls.FILE_ERRAND_END}\n${printed}`
      }
    }
    return dispatch.response satisfies never
  }

  static #contained(cwd: string, printed: string): string {
    ClaudeRunCalls.#destination(cwd, printed)
    return printed
  }

  static #destination(cwd: string, printed: string): string {
    const root = resolve(cwd)
    const destination = isAbsolute(printed) ? resolve(printed) : resolve(root, printed)
    const relation = relative(root, destination)
    if (relation.length === 0 || relation.startsWith('..') || isAbsolute(relation)) {
      throw new RunNotAdvanced(`printed response path is outside the prepared workspace: ${printed}`)
    }
    return destination
  }

  static #failureOf(completion: CompletedPlanCall): string {
    switch (completion.execution.kind) {
      case 'error':
      case 'unavailable':
      case 'child-spawn-failed':
        return completion.execution.diagnostic
      case 'success':
        return `Claude completion was unsuccessful with code ${String(completion.code)} and signal ${String(completion.signal)}`
    }
    return completion.execution satisfies never
  }
}
