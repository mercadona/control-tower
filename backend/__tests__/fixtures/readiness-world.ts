import { GitProjectRepository } from '../../src/infrastructure/git-project-repository.ts'
import { DockerProjectEnvironment } from '../../src/infrastructure/docker-project-environment.ts'
import { InspectionCommands } from '../../src/infrastructure/inspection-commands.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { InspectionBudget } from '../../src/domain/value-objects/inspection-budget.ts'
import { InspectProject, InspectProjectParams } from '../../src/application/queries/inspect-project.ts'
import { ProjectReadinessAssessment } from '../../src/domain/policies/project-readiness-assessment.ts'
import { PlanTarget } from '../../src/domain/value-objects/plan-target.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

export class ReadinessWorld {
  readonly commands: { bin: string, argv: string[], cwd: string, budgetMs: number }[] = []
  readonly files = new Map([
    ['AGENTS.md', '- build: `make build`\n- test: `make test`\n- lint: `make linting`'],
    ['.agent/conventions.md', '- `.claude/rules.md`'],
    ['.claude/rules.md', '# Rules\nUse dependency injection.'],
    ['Makefile', 'PYTEST_WORKERS ?= 2\ntest:\n\tdocker compose exec -T app env PYTEST_WORKERS=$(PYTEST_WORKERS) /app/scripts/test-command.sh'],
    ['scripts/test-command.sh', 'pytest -n "${PYTEST_WORKERS:-2}" -m "not eval"'],
    ['docker/docker-compose.yml', 'services:\n  app:\n    image: example'],
  ])
  drift = ''
  ignored = '.worktrees/__readiness__/probe\n.agent/SLICE.md\n.agent/run-1.json\n'
  remote = 'git@github.com:owner/project.git\n'
  baseExists = true
  dockerAvailable = true
  time = 0
  containerIds = 'abcdef123456\n'
  config: unknown = { name: 'example', services: {
    app: { image: 'example', cpus: 2, mem_limit: '4g', volumes: [{ type: 'bind', source: '/repo', target: '/app' }], depends_on: { db: { condition: 'service_healthy' } } },
    db: { image: 'postgres:17', cpus: 1, mem_limit: '1g', healthcheck: { test: ['CMD', 'pg_isready'] } },
  } }
  containers: unknown = [{ Name: '/example-app-1', Config: { Labels: { 'com.docker.compose.service': 'app' } },
    State: { Status: 'running' }, Mounts: [{ Type: 'bind', Source: '/repo', Destination: '/app' }],
  }]

  async run(bin: string, argv: string[], cwd: string, budgetMs: number): Promise<ProcessOutput> {
    this.commands.push({ bin, argv, cwd, budgetMs })
    const command = argv.join(' ')
    let stdout: string
    if (bin === 'git' && command === 'rev-parse --show-toplevel') stdout = '/repo\n'
    else if (bin === 'git' && command === 'remote get-url origin') stdout = this.remote
    else if (bin === 'git' && command === 'symbolic-ref refs/remotes/origin/HEAD') stdout = 'refs/remotes/origin/main\n'
    else if (bin === 'git' && command.startsWith('rev-parse --verify')) {
      if (!this.baseExists) return new ProcessOutput({ code: 1, stdout: '', stderr: 'missing ref' })
      stdout = 'a'.repeat(40)
    } else if (bin === 'git' && argv[0] === 'ls-tree') stdout = [...this.files.keys()].join('\n')
    else if (bin === 'git' && argv[0] === 'show') {
      const text = this.files.get(argv[1].slice(41))
      if (text === undefined) return new ProcessOutput({ code: 128, stdout: '', stderr: 'path does not exist' })
      stdout = text
    } else if (bin === 'git' && argv[0] === 'diff') stdout = this.drift
    else if (bin === 'git' && argv[0] === 'check-ignore') stdout = this.ignored
    else if (bin === 'docker' && argv[0] === 'info') {
      if (!this.dockerAvailable) return new ProcessOutput({ code: 1, stdout: '', stderr: 'SECRET: docker unavailable' })
      stdout = JSON.stringify({ NCPU: 6, MemTotal: 12 * 1024 ** 3 })
    } else if (bin === 'docker' && argv.includes('config')) stdout = JSON.stringify(this.config)
    else if (bin === 'docker' && argv[0] === 'ps') stdout = this.containerIds
    else if (bin === 'docker' && argv[0] === 'inspect') stdout = JSON.stringify(this.containers)
    else if (bin === 'docker' && argv[0] === 'image') stdout = JSON.stringify(`sha256:${'b'.repeat(64)}`)
    else throw new Error(`unexpected command: ${bin} ${command}`)
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }

  runner() { return new InspectionCommands({ run: this.run.bind(this), now: () => this.time }) }
  budget() { return new InspectionBudget(this.time, { budgetMs: 30_000, commandBudgetMs: 2_000, maxFiles: 20, maxContainers: 10 }) }
  repository() { return new GitProjectRepository(this.runner()) }
  environment() { return new DockerProjectEnvironment(this.runner()) }
  readRepository() { return this.repository().observe('/repo', this.budget()) }
  readEnvironment() { return this.environment().observe('/repo', 'docker/docker-compose.yml', this.budget()) }

  async inspect() {
    const useCase = new InspectProject({
      repository: this.repository(), environment: this.environment(), assessment: new ProjectReadinessAssessment(), now: () => this.time,
      limits: this.budget().limits,
    })
    return (await useCase.execute(new InspectProjectParams({
      target: new PlanTarget({ root: new CheckoutRoot('/repo'), repository: new RepositoryName('owner/project') }),
    }))).report
  }
}
