import { join } from 'node:path'
import { CheckoutRegistry } from '../domain/ports/checkout-registry.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { RegisteredCheckout } from '../domain/value-objects/registered-checkout.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'

type ReadText = (path: string) => string
type StatEntry = (path: string) => { isFile(): boolean }
type WriteText = (path: string, text: string) => void
type PrintLine = (line: string) => void
type StoredPair = { readonly repo: string, readonly path: string }

export class DiskCheckoutRegistry extends CheckoutRegistry {
  static readonly FILE = 'checkouts.json'
  static readonly CHECKOUTS_KEY = 'checkouts'
  static readonly LEGACY_KEY = 'roots'
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

  static #contentFor(checkouts: RegisteredCheckout[]): string {
    const pairs = checkouts
      .filter((checkout) => checkout.repository !== null)
      .map((checkout) => ({ repo: checkout.repository?.text, path: checkout.root.text }))
    const legacy = checkouts
      .filter((checkout) => checkout.repository === null)
      .map((checkout) => checkout.root.text)
    const stored = legacy.length === 0
      ? { [DiskCheckoutRegistry.CHECKOUTS_KEY]: pairs }
      : { [DiskCheckoutRegistry.CHECKOUTS_KEY]: pairs, [DiskCheckoutRegistry.LEGACY_KEY]: legacy }

    return `${JSON.stringify(stored, null, 2)}\n`
  }

  static #isMissing(failure: unknown): boolean {
    const errno: NodeJS.ErrnoException | null = failure instanceof Error ? failure : null

    return errno?.code === 'ENOENT'
  }

  static #messageOf(failure: unknown): string {
    return failure instanceof Error ? failure.message : String(failure)
  }

  static #listIn(record: unknown, key: string): unknown[] | null {
    if (record === null || typeof record !== 'object') return null
    if (!(key in record)) return DiskCheckoutRegistry.#NOTHING_WRITTEN
    const held: unknown = (record as Record<string, unknown>)[key]

    return Array.isArray(held) ? held : null
  }

  static #isPair(entry: unknown): entry is StoredPair {
    if (entry === null || typeof entry !== 'object') return false
    const pair = entry as Record<string, unknown>

    return RepositoryName.isWellFormed(pair.repo) && CheckoutRoot.isWellFormed(pair.path)
  }

  remember(checkout: RegisteredCheckout): void {
    const known = this.known()
    if (known === null) {
      this.stderr(
        `checkout registry: ${DiskCheckoutRegistry.#pathFor(this.root)} cannot be read, so ${checkout.root.text} is not registered and nothing is overwritten\n`
      )

      return
    }
    if (known.some((seen) => seen.root.text === checkout.root.text && seen.repository !== null)) return
    const path = DiskCheckoutRegistry.#pathFor(this.root)
    const kept = known.filter((seen) => seen.root.text !== checkout.root.text)
    try {
      this.write(path, DiskCheckoutRegistry.#contentFor([...kept, checkout]))
    } catch (failure) {
      this.stderr(
        `checkout registry: ${checkout.root.text} could not be written to ${path}, so the sweep will not survey it until it is: ${DiskCheckoutRegistry.#messageOf(failure)}\n`
      )
    }
  }

  known(): RegisteredCheckout[] | null {
    const stored = this.#stored()
    if (stored === null) return null

    return [
      ...stored.pairs
        .filter((entry) => DiskCheckoutRegistry.#isPair(entry))
        .map((entry) => new RegisteredCheckout({
          repository: new RepositoryName(entry.repo),
          root: new CheckoutRoot(entry.path),
        })),
      ...stored.legacy
        .filter((text) => CheckoutRoot.isWellFormed(text))
        .map((text) => new RegisteredCheckout({ repository: null, root: new CheckoutRoot(text) })),
    ]
  }

  #stored(): { pairs: unknown[], legacy: unknown[] } | null {
    const path = DiskCheckoutRegistry.#pathFor(this.root)
    let found
    try {
      found = this.stat(path)
    } catch (failure) {
      return DiskCheckoutRegistry.#isMissing(failure)
        ? { pairs: DiskCheckoutRegistry.#NOTHING_WRITTEN, legacy: DiskCheckoutRegistry.#NOTHING_WRITTEN }
        : null
    }
    if (!found.isFile()) return null
    let record: unknown
    try {
      record = JSON.parse(this.read(path))
    } catch {
      return null
    }
    const pairs = DiskCheckoutRegistry.#listIn(record, DiskCheckoutRegistry.CHECKOUTS_KEY)
    const legacy = DiskCheckoutRegistry.#listIn(record, DiskCheckoutRegistry.LEGACY_KEY)
    if (pairs === null || legacy === null) return null

    return { pairs, legacy }
  }
}
