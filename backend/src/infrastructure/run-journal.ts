import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { RunNotAdvanced, RunNotUnderstood } from '../domain/exceptions.ts'
import { SliceMessages } from '../domain/ports/slice-messages.ts'
import { ConversationId } from '../domain/value-objects/conversation-id.ts'
import { HeldMessage } from '../domain/value-objects/held-message.ts'
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

export class RunJournal extends SliceMessages {
  static readonly #ADMISSION = 'admission.json'
  static readonly #MANIFEST = 'manifest.json'
  static readonly #OPERATIONS = 'operations'
  static readonly #REQUEST = 'request.json'
  static readonly #RECEIPT = 'receipt.json'
  static readonly #MATERIAL = 'material.json'
  static readonly #MESSAGES = 'messages'
  static readonly #MESSAGE = 'message.json'
  static readonly #DELIVERY = 'delivery.json'
  static readonly #MESSAGE_FIELDS: readonly string[] = Object.freeze(['askedAt', 'text', 'version'])
  static readonly #VERSION = 1

  readonly files: HeadlessFiles
  readonly newId: () => string
  readonly now: () => string

  constructor(ports: { files: HeadlessFiles, newId: () => string, now: () => string }) {
    super()
    this.files = ports.files
    this.newId = ports.newId
    this.now = ports.now
  }

  override async hold(watch: PlanWatch, text: string): Promise<string> {
    const ticket = this.#ticket(this.newId())
    await this.#publish(
      join(this.#messagesPath(watch), ticket, RunJournal.#MESSAGE),
      `${JSON.stringify({ version: RunJournal.#VERSION, askedAt: this.now(), text })}\n`,
    )
    return ticket
  }

  override async pending(watch: PlanWatch): Promise<readonly HeldMessage[]> {
    const messages = this.#messagesPath(watch)
    const kind = await this.#kindOf(messages)
    if (kind === 'absent') return Object.freeze([])
    if (kind !== 'directory') throw new RunNotUnderstood(`${messages} is not a messages directory`)
    const held: HeldMessage[] = []
    for (const name of await this.#list(messages)) {
      const ticket = this.#ticket(name)
      const directory = join(messages, ticket)
      if (await this.#readOptional(join(directory, RunJournal.#DELIVERY)) !== null) continue
      held.push(RunJournal.#heldFrom(ticket, await this.#readRequired(join(directory, RunJournal.#MESSAGE))))
    }
    held.sort((left, right) => (left.askedAt === right.askedAt
      ? left.ticket.localeCompare(right.ticket)
      : left.askedAt.localeCompare(right.askedAt)))
    return Object.freeze(held)
  }

  override async settle(watch: PlanWatch, ticket: string, call: string): Promise<void> {
    await this.#publish(
      join(this.#messagesPath(watch), this.#ticket(ticket), RunJournal.#DELIVERY),
      `${JSON.stringify({ version: RunJournal.#VERSION, call })}\n`,
    )
  }

  static #heldFrom(ticket: string, text: string): HeldMessage {
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (cause) {
      throw new RunNotUnderstood(`the held change ${ticket} is not valid JSON: ${String(cause)}`)
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new RunNotUnderstood(`the held change ${ticket} is not an object: ${text}`)
    }
    const record: Record<string, unknown> = { ...value }
    const keys = Object.keys(record).sort()
    if (keys.length !== RunJournal.#MESSAGE_FIELDS.length
      || keys.some((key, index) => key !== RunJournal.#MESSAGE_FIELDS[index])) {
      throw new RunNotUnderstood(`the held change ${ticket} has unexpected keys: ${text}`)
    }
    if (record.version !== RunJournal.#VERSION) {
      throw new RunNotUnderstood(`the held change ${ticket} has an unknown version: ${text}`)
    }
    try {
      return new HeldMessage({
        ticket,
        askedAt: record.askedAt as string,
        text: record.text as string,
      })
    } catch (cause) {
      throw new RunNotUnderstood(`the held change ${ticket} is malformed: ${String(cause)}`)
    }
  }

  async admitted(watch: PlanWatch): Promise<boolean> {
    const text = await this.#readOptional(this.#admissionPath(watch))
    if (text === null) return false
    let value: unknown
    try {
      value = JSON.parse(text)
    } catch (cause) {
      throw new RunNotUnderstood(`the run admission is not valid JSON: ${String(cause)}`)
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new RunNotUnderstood(`the run admission is not an object: ${text}`)
    }
    const keys = Object.keys(value).sort()
    if (keys.length !== 2 || keys[0] !== 'conversation' || keys[1] !== 'version') {
      throw new RunNotUnderstood(`the run admission has unexpected keys: ${text}`)
    }
    const version = Object.getOwnPropertyDescriptor(value, 'version')?.value
    const conversation = Object.getOwnPropertyDescriptor(value, 'conversation')?.value
    if (version !== 1 || conversation !== this.#conversation(watch)) {
      throw new RunNotUnderstood(`the run admission does not identify this plan watch: ${text}`)
    }
    return true
  }

  async admit(watch: PlanWatch): Promise<void> {
    await this.#publish(this.#admissionPath(watch), `${JSON.stringify({
      version: 1,
      conversation: this.#conversation(watch),
    })}\n`)
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

  async operationsPresent(watch: PlanWatch): Promise<boolean> {
    const operations = this.#operationsPath(watch)
    const kind = await this.#kindOf(operations)
    if (kind === 'absent') return false
    if (kind !== 'directory') throw new RunNotUnderstood(`${operations} is not an operations directory`)
    return true
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

  #admissionPath(watch: PlanWatch): string {
    return join(this.#runPath(watch), RunJournal.#ADMISSION)
  }

  #operationsPath(watch: PlanWatch): string {
    return join(this.#runPath(watch), RunJournal.#OPERATIONS)
  }

  #messagesPath(watch: PlanWatch): string {
    return join(this.#runPath(watch), RunJournal.#MESSAGES)
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
