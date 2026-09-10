import { join } from 'node:path'
import { CheckoutRegistry } from '../domain/ports/checkout-registry.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'

type ReadText = (path: string) => string
type StatEntry = (path: string) => { isFile(): boolean }
type WriteText = (path: string, text: string) => void
type PrintLine = (line: string) => void

export class DiskCheckoutRegistry extends CheckoutRegistry {
  static readonly FILE = 'checkouts.json'
  static readonly #NOTHING_WRITTEN: unknown[] = []

  readonly read: ReadText
  readonly stat: StatEntry
  readonly write: WriteText
  readonly stderr: PrintLine
  readonly root: string

  constructor({ read, stat, write, stderr, root }: {
    read: ReadText,
    stat: StatEntry,
    write: WriteText,
    stderr: PrintLine,
    root: string,
  }) {
    super()
    this.read = read
    this.stat = stat
    this.write = write
    this.stderr = stderr
    this.root = root
  }

  static #pathFor(root: string): string {
    return join(root, DiskCheckoutRegistry.FILE)
  }

  static #contentFor(roots: CheckoutRoot[]): string {
    return `${JSON.stringify({ roots: roots.map((root) => root.text) }, null, 2)}\n`
  }

  static #isMissing(failure: unknown): boolean {
    const errno: NodeJS.ErrnoException | null = failure instanceof Error ? failure : null

    return errno?.code === 'ENOENT'
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }

  static #rootsIn(record: unknown): unknown[] | null {
    if (record === null || typeof record !== 'object') return null

    return 'roots' in record && Array.isArray(record.roots) ? record.roots : null
  }

  remember(root: CheckoutRoot): void {
    const known = this.known()
    if (known === null) {
      this.stderr(
        `checkout registry: ${DiskCheckoutRegistry.#pathFor(this.root)} cannot be read, so ${root.text} is not registered and nothing is overwritten\n`
      )

      return
    }
    if (known.some((seen) => seen.text === root.text)) return
    const path = DiskCheckoutRegistry.#pathFor(this.root)
    try {
      this.write(path, DiskCheckoutRegistry.#contentFor([...known, root]))
    } catch (failure) {
      this.stderr(
        `checkout registry: ${root.text} could not be written to ${path}, so the sweep will not survey it until it is: ${DiskCheckoutRegistry.#messageOf(failure)}\n`
      )
    }
  }

  known(): CheckoutRoot[] | null {
    const stored = this.#stored()
    if (stored === null) return null

    return stored
      .filter((text) => CheckoutRoot.isWellFormed(text))
      .map((text) => new CheckoutRoot(text))
  }

  #stored(): unknown[] | null {
    const path = DiskCheckoutRegistry.#pathFor(this.root)
    const seen = DiskCheckoutRegistry.#NOTHING_WRITTEN
    let found
    try {
      found = this.stat(path)
    } catch (failure) {
      return DiskCheckoutRegistry.#isMissing(failure) ? seen : null
    }
    if (!found.isFile()) return null
    try {
      const record: unknown = JSON.parse(this.read(path))

      return DiskCheckoutRegistry.#rootsIn(record)
    } catch {
      return null
    }
  }
}
