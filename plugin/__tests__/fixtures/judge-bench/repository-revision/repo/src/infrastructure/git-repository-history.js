import { RepositoryHistory } from '../domain/ports/repository-history.js'
import { Revision } from '../domain/value-objects/revision.js'
import { RevisionNotRead, RevisionNotUnderstood } from '../domain/exceptions.js'

export class GitRepositoryHistory extends RepositoryHistory {
  constructor({ run, budgetMs }) {
    super()
    this.run = run
    this.budgetMs = budgetMs
  }

  async current(root) {
    const directory = await this.run(['rev-parse', '--show-toplevel'], { cwd: root, budgetMs: this.budgetMs })
    if (directory.code !== 0) throw new RevisionNotRead('git could not resolve the repository')
    const canonical = directory.stdout.trim()
    if (!canonical.startsWith('/')) throw new RevisionNotUnderstood('git returned no absolute repository root')
    const head = await this.run(['rev-parse', '--verify', 'HEAD'], { cwd: canonical, budgetMs: this.budgetMs })
    if (head.code !== 0) throw new RevisionNotRead('git could not read HEAD')
    const text = head.stdout.trim()
    if (!/^[a-f0-9]{40}$/.test(text)) throw new RevisionNotUnderstood('git returned no revision')
    return new Revision(text)
  }
}
