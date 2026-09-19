import { parseStateSafe, readBlocked } from '../../../plugin/scripts/state.js'
import { SLICE_REL_PATH } from '../../../plugin/scripts/state-paths.js'
import { SliceEscalationNotRead, SliceEscalationNotUnderstood } from '../domain/exceptions.ts'
import { SliceEscalations } from '../domain/ports/slice-escalations.ts'
import { SliceEscalation } from '../domain/value-objects/slice-escalation.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { GitWorkspace } from './git-workspace.ts'

type BlockReading = {
  readonly state: string,
  readonly why?: string,
  readonly reason?: string,
  readonly unblock?: string,
  readonly notes?: readonly string[],
}

export class DiskSliceEscalations extends SliceEscalations {
  static readonly #UNREADABLE = 'unreadable'
  static readonly #NONE = 'none'
  static readonly #BLOCKED = 'blocked'
  static readonly #UNSAID = 'the reader did not say why'
  static readonly UNSEEDED = `either a plugin version older than the one that moved the slice's state seeded it, `
    + `or a \`git clean -x\` carried it off: ${SLICE_REL_PATH} is ignored by git`

  readonly read: (path: string) => Promise<string | null>
  readonly exists: (path: string) => Promise<boolean>

  constructor({ read, exists }: {
    read: (path: string) => Promise<string | null>,
    exists: (path: string) => Promise<boolean>,
  }) {
    super()
    this.read = read
    this.exists = exists
  }

  static worktreeFor(root: string, issue: number): string {
    return GitWorkspace.pathFor(root, { number: issue })
  }

  static stateFileFor(root: string, issue: number): string {
    return `${DiskSliceEscalations.worktreeFor(root, issue)}/${SLICE_REL_PATH}`
  }

  override async of({ root, issue }: { root: CheckoutRoot, issue: number }): Promise<SliceEscalation> {
    const worktree = DiskSliceEscalations.worktreeFor(root.text, issue)
    if (!(await this.exists(worktree))) return SliceEscalation.none()
    const path = DiskSliceEscalations.stateFileFor(root.text, issue)
    let markdown: string | null
    try {
      markdown = await this.read(path)
    } catch (cause) {
      throw new SliceEscalationNotRead(`${path} could not be read: ${DiskSliceEscalations.#messageOf(cause)}`)
    }
    if (markdown === null) return SliceEscalation.unchecked(`${path} is not there — ${DiskSliceEscalations.UNSEEDED}`)
    const parsed = parseStateSafe(markdown)
    if (parsed.error !== null) {
      throw new SliceEscalationNotUnderstood(`the frontmatter of ${path} is not valid YAML: ${parsed.error}`)
    }

    return DiskSliceEscalations.#escalationOf(readBlocked(parsed.meta, { stateRel: SLICE_REL_PATH }), path)
  }

  static #escalationOf(reading: BlockReading, path: string): SliceEscalation {
    switch (reading.state) {
      case DiskSliceEscalations.#UNREADABLE:
        throw new SliceEscalationNotUnderstood(
          `the frontmatter of ${path} cannot be interpreted: ${reading.why ?? DiskSliceEscalations.#UNSAID}`,
        )
      case DiskSliceEscalations.#NONE:
        return SliceEscalation.none()
      case DiskSliceEscalations.#BLOCKED:
        return SliceEscalation.raised({
          reason: reading.reason ?? '',
          unblock: reading.unblock ?? '',
          notes: reading.notes ?? [],
        })
    }
    throw new SliceEscalationNotUnderstood(
      `${path} reads as ${JSON.stringify(reading.state)}, which this backend does not know how to report`,
    )
  }

  static #messageOf(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }
}
