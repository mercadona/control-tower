import { RepositoryPreparationRequired } from '../../domain/exceptions.ts'
import type { RepositoryPreparations, PreparationTarget, PreparationWorkspace } from '../../domain/ports/repository-preparations.ts'
import type { PreparationAnnouncements } from '../../domain/ports/preparation-announcements.ts'
import type { RepositoryPreparation } from '../../domain/value-objects/repository-preparation.ts'

export class CheckRepositoryPreparation {
  readonly preparations: RepositoryPreparations
  readonly announcements: PreparationAnnouncements

  constructor(ports: { preparations: RepositoryPreparations, announcements: PreparationAnnouncements }) {
    this.preparations = ports.preparations
    this.announcements = ports.announcements
  }

  async execute(asked: PreparationTarget): Promise<RepositoryPreparation> {
    return this.#require(asked, await this.preparations.inspect(asked))
  }

  async prepare(asked: PreparationWorkspace): Promise<RepositoryPreparation> {
    return this.#require(asked, await this.preparations.prepare(asked))
  }

  async #require(asked: PreparationTarget, preparation: RepositoryPreparation): Promise<RepositoryPreparation> {
    await this.announcements.announce({ ...asked, preparation })
    if (!preparation.permitsDispatch()) {
      throw new RepositoryPreparationRequired(preparation.summary)
    }
    return preparation
  }

  current(asked: PreparationTarget): readonly RepositoryPreparation[] {
    return this.announcements.current(asked)
  }
}
