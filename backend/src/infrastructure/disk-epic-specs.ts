import { join } from 'node:path'
import { EpicSpecs } from '../domain/ports/epic-specs.ts'
import { EpicSpecNotRead, EpicSpecNotUnderstood, EpicSpecNotWritten } from '../domain/exceptions.ts'
import { EpicSpec } from '../domain/value-objects/epic-spec.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'

type ListNames = (path: string) => Promise<string[] | null>
type ReadText = (path: string) => Promise<string | null>
type WriteText = (path: string, text: string) => Promise<void>

export class DiskEpicSpecs extends EpicSpecs {
  static readonly DIRECTORY = 'docs/superpowers/specs'
  static readonly SUFFIX = '-execution.md'

  readonly list: ListNames
  readonly read: ReadText
  readonly write: WriteText

  constructor({ list, read, write }: { list: ListNames, read: ReadText, write: WriteText }) {
    super()
    this.list = list
    this.read = read
    this.write = write
  }

  async mostRecent(root: CheckoutRoot): Promise<EpicSpec | null> {
    const directory = join(root.text, DiskEpicSpecs.DIRECTORY)
    const names = await this.#listed(directory)
    if (names === null) return null

    const named = DiskEpicSpecs.#newestOf(names)
    if (named === null) return null

    const relative = join(DiskEpicSpecs.DIRECTORY, named)

    return DiskEpicSpecs.#titled(new EpicSpec({
      path: relative, text: await this.#textOf(join(root.text, relative)),
    }))
  }

  async reread({ root, spec }: { root: CheckoutRoot, spec: EpicSpec }): Promise<EpicSpec | null> {
    const text = await this.#heldTextOf(join(root.text, spec.path))
    if (text === null) return null

    return DiskEpicSpecs.#titled(new EpicSpec({ path: spec.path, text }))
  }

  async rewrite({ root, spec, text }: { root: CheckoutRoot, spec: EpicSpec, text: string }): Promise<void> {
    const path = join(root.text, spec.path)
    try {
      await this.write(path, text)
    } catch (cause) {
      throw new EpicSpecNotWritten(`${path} could not be written: ${String(cause)}`)
    }
  }

  async #listed(directory: string): Promise<string[] | null> {
    try {
      return await this.list(directory)
    } catch (cause) {
      throw new EpicSpecNotRead(`${directory} could not be listed: ${String(cause)}`)
    }
  }

  async #heldTextOf(path: string): Promise<string | null> {
    try {
      return await this.read(path)
    } catch (cause) {
      throw new EpicSpecNotRead(`${path} could not be read: ${String(cause)}`)
    }
  }

  async #textOf(path: string): Promise<string> {
    const text = await this.#heldTextOf(path)
    if (text === null) {
      throw new EpicSpecNotRead(`${path} was listed but could not be read`)
    }

    return text
  }

  static #titled(spec: EpicSpec): EpicSpec {
    if (spec.title() === null) {
      throw new EpicSpecNotUnderstood(`${spec.path} carries no title, so it is not an execution spec`)
    }

    return spec
  }

  static #newestOf(names: string[]): string | null {
    const matching = names.filter((name) => name.endsWith(DiskEpicSpecs.SUFFIX))
    return matching.length === 0 ? null : matching.sort().at(-1)!
  }
}
