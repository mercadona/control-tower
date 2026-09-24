import { join } from 'node:path'
import { EpicSpecs } from '../domain/ports/epic-specs.ts'
import { EpicSpecNotRead, EpicSpecNotUnderstood, EpicSpecNotWritten } from '../domain/exceptions.ts'
import { EpicSpec } from '../domain/value-objects/epic-spec.ts'
import { StoryDocuments } from '../domain/value-objects/story-documents.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { UserStoryKey } from '../domain/value-objects/user-story-key.ts'
import type { UserStoryUrl } from '../domain/value-objects/user-story-url.ts'

type ReadText = (path: string) => Promise<string | null>
type WriteText = (path: string, text: string) => Promise<void>

export class DiskEpicSpecs extends EpicSpecs {
  readonly read: ReadText
  readonly write: WriteText

  constructor({ read, write }: { read: ReadText, write: WriteText }) {
    super()
    this.read = read
    this.write = write
  }

  async of({ root, story }: { root: CheckoutRoot, story: UserStoryKey | UserStoryUrl }): Promise<EpicSpec | null> {
    const relative = new StoryDocuments(story).spec
    const path = join(root.text, relative)
    let text: string | null
    try {
      text = await this.read(path)
    } catch (cause) {
      throw new EpicSpecNotRead(`${path} could not be read: ${String(cause)}`)
    }
    if (text === null) return null

    const spec = new EpicSpec({ path: relative, text })
    if (spec.title() === null) {
      throw new EpicSpecNotUnderstood(`${spec.path} carries no title, so it is not an execution spec`)
    }

    return spec
  }

  async rewrite({ root, spec, text }: { root: CheckoutRoot, spec: EpicSpec, text: string }): Promise<void> {
    const path = join(root.text, spec.path)
    try {
      await this.write(path, text)
    } catch (cause) {
      throw new EpicSpecNotWritten(`${path} could not be written: ${String(cause)}`)
    }
  }
}
