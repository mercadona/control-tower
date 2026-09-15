import { PublishedSpecs } from '../domain/ports/published-specs.ts'
import { PublishedSpecNotRead } from '../domain/exceptions.ts'
import { Gh } from './gh.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export class GhPublishedSpecs extends PublishedSpecs {
  readonly gh: Gh

  constructor({ gh }: { gh: Gh }) {
    super()
    this.gh = gh
  }

  static argvFor({ repository, path }: { repository: RepositoryName, path: string }): string[] {
    const encoded = path.split('/').map(encodeURIComponent).join('/')

    return ['api', `repos/${repository.text}/contents/${encoded}`]
  }

  async holds({ repository, path }: { repository: RepositoryName, path: string }): Promise<boolean> {
    const outcome = await this.gh.run(GhPublishedSpecs.argvFor({ repository, path }), { safeToRepeat: true })
    if (!outcome.failed) return true
    if (Gh.isNotFound(outcome.stderr)) return false

    throw new PublishedSpecNotRead(
      `${Gh.BIN} api repos/${repository.text}/contents/${path} failed: ${outcome.stderr.trim()}`
    )
  }
}
