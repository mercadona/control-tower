import { ProjectSetup } from '../domain/ports/project-setup.js'
import { ProjectReadiness, ReadinessStatus } from '../domain/value-objects/project-readiness.js'
import { ProjectNotRead, ProjectNotUnderstood } from '../domain/exceptions.js'

export class ShellProjectSetup extends ProjectSetup {
  constructor({ run, maxWorkers, database, budgetMs }) {
    super()
    this.run = run
    this.maxWorkers = maxWorkers
    this.database = database
    this.budgetMs = budgetMs
  }

  async inspect(root) {
    const workers = await this.run('git', ['config', '--get', 'test.workers'], { cwd: root, budgetMs: this.budgetMs })
    if (workers.code !== 0) throw new ProjectNotRead('git worker configuration could not be read')
    const count = workers.stdout.trim()
    if (!/^\d+$/.test(count)) throw new ProjectNotUnderstood('git worker configuration is not a count')
    if (Number(count) > this.maxWorkers) return new ProjectReadiness(ReadinessStatus.CHANGES_REQUIRED)
    const database = await this.run('docker', ['inspect', '--format', '{{.State.Health.Status}}', this.database], { cwd: root, budgetMs: this.budgetMs })
    if (database.code !== 0) throw new ProjectNotRead('database health could not be read')
    const health = database.stdout.trim()
    if (!['healthy', 'unhealthy', 'starting'].includes(health)) throw new ProjectNotUnderstood('database health is not understood')
    return new ProjectReadiness(health === 'healthy' ? ReadinessStatus.READY : ReadinessStatus.CHANGES_REQUIRED)
  }
}
