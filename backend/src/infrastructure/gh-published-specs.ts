import { PublishedSpecs } from '../domain/ports/published-specs.ts'
import { PublishedSpecNotRead, PublishedSpecNotUnderstood } from '../domain/exceptions.ts'
import { Gh } from './gh.ts'
import type { EpicSpec } from '../domain/value-objects/epic-spec.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'
import type { SpecRevision } from '../domain/policies/spec-revision.ts'

export class GhPublishedSpecs extends PublishedSpecs {
  readonly gh: Gh
  readonly revisions: SpecRevision

  constructor({ gh, revisions }: { gh: Gh, revisions: SpecRevision }) {
    super()
    this.gh = gh
    this.revisions = revisions
  }

  static argvFor({ repository, path }: { repository: RepositoryName, path: string }): string[] {
    const encoded = path.split('/').map(encodeURIComponent).join('/')

    return ['api', `repos/${repository.text}/contents/${encoded}`]
  }

  async holds({ repository, spec }: { repository: RepositoryName, spec: EpicSpec }): Promise<boolean> {
    const outcome = await this.gh.run(
      GhPublishedSpecs.argvFor({ repository, path: spec.path }), { safeToRepeat: true }
    )
    if (outcome.failed) {
      if (Gh.isNotFound(outcome.stderr)) return false

      throw new PublishedSpecNotRead(
        `${Gh.BIN} api repos/${repository.text}/contents/${spec.path} failed: ${outcome.stderr.trim()}`
      )
    }

    return GhPublishedSpecs.#shaIn(outcome.stdout, { repository, spec }) === this.revisions.of(spec.text)
  }

  static #shaIn(printed: string, asked: { repository: RepositoryName, spec: EpicSpec }): string {
    let parsed: unknown
    try {
      parsed = JSON.parse(printed)
    } catch {
      throw GhPublishedSpecs.#unreadable(printed, asked)
    }
    const held = parsed as { sha?: unknown } | null
    if (held === null || typeof held !== 'object' || typeof held.sha !== 'string') {
      throw GhPublishedSpecs.#unreadable(printed, asked)
    }

    return held.sha
  }

  static #unreadable(
    printed: string, asked: { repository: RepositoryName, spec: EpicSpec }
  ): PublishedSpecNotUnderstood {
    return new PublishedSpecNotUnderstood(
      `${Gh.BIN} api repos/${asked.repository.text}/contents/${asked.spec.path} named no sha this reads, `
      + `it printed ${JSON.stringify(printed)}`
    )
  }
}
