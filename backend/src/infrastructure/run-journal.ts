import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { RunNotAdvanced, RunNotUnderstood } from '../domain/exceptions.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import { HeadlessFiles } from './headless-files.ts'

type JournalReceipt =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present', readonly text: string }

type JournalPathKind = 'absent' | 'directory' | 'file' | 'other'

export class JournalEntry {
  readonly ticket: string
  readonly request: string
  readonly receipt: JournalReceipt

  constructor(asked: { ticket: string, request: string, receipt: JournalReceipt }) {
    this.ticket = asked.ticket
    this.request = asked.request
    this.receipt = Object.freeze({ ...asked.receipt })
    Object.freeze(this)
  }
}

export class RunJournal {
  static readonly #MANIFEST = 'manifest.json'
  static readonly #OPERATIONS = 'operations'
  static readonly #REQUEST = 'request.json'
  static readonly #RECEIPT = 'receipt.json'
  static readonly #MATERIAL = 'material.json'

  readonly files: HeadlessFiles
  readonly newId: () => string

  constructor(ports: { files: HeadlessFiles, newId: () => string }) {
    this.files = ports.files
    this.newId = ports.newId
  }

  async manifest(watch: PlanWatch): Promise<string | null> {
    return this.#readOptional(this.#manifestPath(watch))
  }

  async establish(watch: PlanWatch, text: string): Promise<void> {
    await this.#publish(this.#manifestPath(watch), text)
  }

  async entries(watch: PlanWatch): Promise<readonly JournalEntry[]> {
    const operations = this.#operationsPath(watch)
    const kind = await this.#kindOf(operations)
    if (kind === 'absent') return Object.freeze([])
    if (kind !== 'directory') throw new RunNotUnderstood(`${operations} is not an operations directory`)
    const tickets = await this.#list(operations)
    const entries: JournalEntry[] = []
    for (const name of tickets.sort()) entries.push(await this.#entryAt(operations, this.#ticket(name)))
    return Object.freeze(entries)
  }

  async begin(watch: PlanWatch, request: string): Promise<string> {
    const ticket = this.#ticket(this.newId())
    await this.#publish(join(this.#operationsPath(watch), ticket, RunJournal.#REQUEST), request)
    return ticket
  }

  async finish(watch: PlanWatch, ticket: string, receipt: string): Promise<void> {
    await this.#publish(
      join(this.#operationsPath(watch), this.#ticket(ticket), RunJournal.#RECEIPT),
      receipt,
    )
  }

  async material(watch: PlanWatch, ticket: string): Promise<string | null> {
    return this.#readOptional(
      join(this.#operationsPath(watch), this.#ticket(ticket), RunJournal.#MATERIAL),
    )
  }

  async seal(watch: PlanWatch, ticket: string, text: string): Promise<void> {
    await this.#publish(
      join(this.#operationsPath(watch), this.#ticket(ticket), RunJournal.#MATERIAL),
      text,
    )
  }

  async #entryAt(operations: string, ticket: string): Promise<JournalEntry> {
    const directory = join(operations, ticket)
    if (await this.#kindOf(directory) !== 'directory') {
      throw new RunNotUnderstood(`${directory} is not an operation directory`)
    }
    const names = await this.#list(directory)
    if (names.some((name) => name !== RunJournal.#REQUEST
      && name !== RunJournal.#RECEIPT
      && name !== RunJournal.#MATERIAL)) {
      throw new RunNotUnderstood(`${directory} contains an unexpected journal entry`)
    }
    if (!names.includes(RunJournal.#REQUEST)) {
      throw new RunNotUnderstood(`${directory} has no command request`)
    }
    const request = await this.#readRequired(join(directory, RunJournal.#REQUEST))
    const receipt = names.includes(RunJournal.#RECEIPT)
      ? Object.freeze({ kind: 'present' as const, text: await this.#readRequired(join(directory, RunJournal.#RECEIPT)) })
      : Object.freeze({ kind: 'absent' as const })
    return new JournalEntry({ ticket, request, receipt })
  }

  async #publish(path: string, text: string): Promise<void> {
    try {
      await this.#validateAncestors(path)
      await this.files.writeOnce(path, text)
    } catch (cause) {
      if (!RunJournal.#hasCode(cause, 'EEXIST')) {
        if (HeadlessFiles.isSystemFailure(cause)) {
          throw new RunNotAdvanced(`${path} could not be written: ${String(cause)}`)
        }
        throw cause
      }
      const existing = await this.#readOptional(path)
      if (existing !== text) throw new RunNotUnderstood(`${path} contains conflicting journal evidence`)
    }
  }

  async #readOptional(path: string): Promise<string | null> {
    await this.#validateAncestors(path)
    const kind = await this.#kindOf(path)
    if (kind === 'absent') return null
    if (kind !== 'file') throw new RunNotUnderstood(`${path} is not a regular journal file`)
    try {
      const text = await this.files.read(path)
      if (text === null) throw new RunNotUnderstood(`${path} disappeared while the journal was read`)
      return text
    } catch (cause) {
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new RunNotAdvanced(`${path} could not be read: ${String(cause)}`)
      }
      throw cause
    }
  }

  async #readRequired(path: string): Promise<string> {
    const text = await this.#readOptional(path)
    if (text === null) throw new RunNotUnderstood(`${path} is missing`)
    return text
  }

  async #list(path: string): Promise<string[]> {
    try {
      await this.#validateAncestors(path)
      return await this.files.list(path)
    } catch (cause) {
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new RunNotAdvanced(`${path} could not be listed: ${String(cause)}`)
      }
      throw cause
    }
  }

  async #kindOf(path: string): Promise<JournalPathKind> {
    await this.#validateAncestors(path)
    return this.#kindAt(path)
  }

  async #validateAncestors(path: string): Promise<void> {
    const parent = dirname(path)
    const belowRoot = relative(this.files.root, parent)
    if (belowRoot === '..' || belowRoot.startsWith(`..${sep}`) || isAbsolute(belowRoot)) {
      throw new RunNotUnderstood(`${path} is outside the journal state root`)
    }
    if (belowRoot === '') return
    let ancestor = this.files.root
    for (const name of belowRoot.split(sep)) {
      ancestor = join(ancestor, name)
      const kind = await this.#kindAt(ancestor)
      if (kind === 'absent') return
      if (kind !== 'directory') {
        throw new RunNotUnderstood(`${ancestor} is not a journal directory`)
      }
    }
  }

  async #kindAt(path: string): Promise<JournalPathKind> {
    try {
      const stat = await this.files.fs.lstat(path)
      if (stat.isDirectory()) return 'directory'
      if (stat.isFile()) return 'file'
      return 'other'
    } catch (cause) {
      if (RunJournal.#hasCode(cause, 'ENOENT')) return 'absent'
      if (HeadlessFiles.isSystemFailure(cause)) {
        throw new RunNotAdvanced(`${path} could not be inspected: ${String(cause)}`)
      }
      throw cause
    }
  }

  #manifestPath(watch: PlanWatch): string {
    return join(this.#runPath(watch), RunJournal.#MANIFEST)
  }

  #operationsPath(watch: PlanWatch): string {
    return join(this.#runPath(watch), RunJournal.#OPERATIONS)
  }

  #runPath(watch: PlanWatch): string {
    return join(this.files.root, 'harness', this.#conversation(watch), 'run')
  }

  #conversation(watch: PlanWatch): string {
    try {
      return new ConversationId(watch.agent).text
    } catch (cause) {
      throw new RunNotUnderstood(`the journal conversation is malformed: ${String(cause)}`)
    }
  }

  #ticket(ticket: string): string {
    try {
      return new ConversationId(ticket).text
    } catch (cause) {
      throw new RunNotUnderstood(`the journal ticket is malformed: ${String(cause)}`)
    }
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}
