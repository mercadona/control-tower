import { CheckRepositoryPreparation } from '../src/application/actions/check-repository-preparation.ts'
import { WorktreeEnvironments } from '../src/domain/ports/worktree-environments.ts'
import { PreparationReports } from '../src/domain/ports/preparation-reports.ts'
import { RepositoryPreparation, PreparationFinding, PreparationState } from '../src/domain/value-objects/repository-preparation.ts'

class Environments extends WorktreeEnvironments {
  answer: RepositoryPreparation

  constructor(answer: RepositoryPreparation) { super(); this.answer = answer }
  override async inspect(): Promise<RepositoryPreparation> { return this.answer }
  override async prepare(): Promise<RepositoryPreparation> { return this.answer }
}

class Reports extends PreparationReports {
  override async announce(): Promise<void> {}
}

export class PreparationMother {
  static compatible(): RepositoryPreparation {
    return new RepositoryPreparation({ revision: 'a'.repeat(40), state: PreparationState.COMPATIBLE, findings: [], summary: 'Configuration supports isolated worktrees.' })
  }

  static blocked(): RepositoryPreparation {
    return new RepositoryPreparation({ revision: 'b'.repeat(40), state: PreparationState.REQUIRED,
      findings: [new PreparationFinding({ path: 'Makefile', reason: 'Fixed project name.', correction: 'Remove -p.' })],
      summary: 'owner/repo at bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb: Makefile forces a shared project. Remove -p.',
    })
  }

  static check(answer = PreparationMother.compatible()): CheckRepositoryPreparation {
    return new CheckRepositoryPreparation({ environments: new Environments(answer), reports: new Reports() })
  }
}
