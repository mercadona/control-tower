import { describe, expect, it } from 'vitest'
import { GitDockerProjectSetup } from '../../src/infrastructure/git-docker-project-setup.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { PlanTarget } from '../../src/domain/value-objects/plan-target.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class InspectionWorld {
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
  config: unknown = {
    name: 'example',
    services: {
      app: { image: 'example', cpus: 2, mem_limit: '4g', volumes: [{ type: 'bind', source: '/repo', target: '/app' }], depends_on: { db: { condition: 'service_healthy' } } },
      db: { image: 'postgres:17', cpus: 1, mem_limit: '1g', healthcheck: { test: ['CMD', 'pg_isready'] } },
    },
  }
  containers: unknown = [{
    Name: '/example-app-1',
    Config: { Labels: { 'com.docker.compose.service': 'app' } },
    State: { Status: 'running' },
    Mounts: [{ Type: 'bind', Source: '/repo', Destination: '/app' }],
  }]

  static ready(): InspectionWorld { return new InspectionWorld() }

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
      const file = argv[1].slice(41)
      const text = this.files.get(file)
      if (text === undefined) return new ProcessOutput({ code: 128, stdout: '', stderr: 'path does not exist' })
      stdout = text
    } else if (bin === 'git' && argv[0] === 'diff') stdout = this.drift
    else if (bin === 'git' && argv[0] === 'check-ignore') stdout = this.ignored
    else if (bin === 'docker' && argv[0] === 'info') {
      if (!this.dockerAvailable) return new ProcessOutput({ code: 1, stdout: '', stderr: 'SECRET: docker unavailable' })
      stdout = JSON.stringify({ NCPU: 6, MemTotal: 12 * 1024 ** 3 })
    } else if (bin === 'docker' && argv.includes('config')) stdout = JSON.stringify(this.config)
    else if (bin === 'docker' && argv[0] === 'ps') stdout = 'abcdef123456\n'
    else if (bin === 'docker' && argv[0] === 'inspect') stdout = JSON.stringify(this.containers)
    else if (bin === 'docker' && argv[0] === 'image') stdout = JSON.stringify(`sha256:${'b'.repeat(64)}`)
    else throw new Error(`unexpected command: ${bin} ${command}`)
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }

  setup() {
    return new GitDockerProjectSetup({
      run: this.run.bind(this), now: () => this.time,
      budgetMs: 30_000, commandBudgetMs: 2_000, maxFiles: 20, maxContainers: 10,
    })
  }

  target() { return new PlanTarget({ root: new CheckoutRoot('/repo'), repository: new RepositoryName('owner/project') }) }

  async inspect() {
    return this.setup().inspect(this.target())
  }
}

describe('GitDockerProjectSetup', () => {
  it('reports_observed_configuration_without_claiming_tests_or_worktrees_were_executed', async () => {
    const world = InspectionWorld.ready()
    const report = await world.inspect()
    expect(report.baseRevision).toBe('a'.repeat(40))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'ready' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'database-readiness', status: 'ready' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'execution', status: 'unverified' }))
    expect(report.status).toBe('unverified')
    expect(world.commands.every(({ bin }) => ['git', 'docker'].includes(bin))).toBe(true)
    expect(world.commands.some(({ argv }) => ['up', 'build', 'exec', 'fetch'].some((verb) => argv.includes(verb)))).toBe(false)
    expect(world.commands.every(({ budgetMs }) => budgetMs > 0 && budgetMs <= 2_000)).toBe(true)
  })

  it('detects_the_unbounded_reference_script', async () => {
    const world = InspectionWorld.ready()
    world.files.set('scripts/test-command.sh', 'pytest -n auto --junit-xml=junit.xml')
    const report = await world.inspect()
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'changes-required', action: 'limit-workers' }))
    expect(report.status).toBe('changes-required')
  })

  it('does_not_infer_a_bound_from_an_unrelated_or_commented_command', async () => {
    const world = InspectionWorld.ready()
    world.files.set('AGENTS.md', '- build: `make build`\n- test: `custom-runner`\n- lint: `make linting`')
    world.files.set('scripts/test-command.sh', '# pytest -n 2\ncustom-runner')
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'unverified' }))
  })

  it('identifies_missing_or_placeholder_commands_and_conventions', async () => {
    const world = InspectionWorld.ready()
    world.files.set('AGENTS.md', '- test: `<command>`')
    world.files.set('.agent/conventions.md', '# Conventions\nTODO')
    const report = await world.inspect()
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'commands', status: 'changes-required' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'conventions', status: 'changes-required' }))
  })

  it('checks_that_declared_convention_documents_have_content', async () => {
    const world = InspectionWorld.ready()
    world.files.delete('.claude/rules.md')
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'conventions', status: 'changes-required' }))
  })

  it('flags_setup_drift_from_the_revision_that_new_worktrees_will_use', async () => {
    const world = InspectionWorld.ready()
    world.drift = 'Makefile\n'
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'checkout-drift', status: 'changes-required' }))
  })

  it('does_not_treat_an_ignored_plan_as_usable_setup', async () => {
    const world = InspectionWorld.ready()
    world.ignored += 'docs/superpowers/plans/__readiness__.md\n'
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'git-ignore', status: 'changes-required' }))
  })

  it('stops_before_inspecting_a_different_repository', async () => {
    const world = InspectionWorld.ready()
    world.remote = 'git@github.com:other/project.git\n'
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'checkout', status: 'changes-required' }))
    expect(world.commands.some(({ bin }) => bin === 'docker')).toBe(false)
  })

  it('does_not_substitute_HEAD_when_the_declared_remote_base_is_missing', async () => {
    const world = InspectionWorld.ready()
    world.baseExists = false
    const report = await world.inspect()
    expect(report.baseRevision).toBeNull()
    expect(report.status).toBe('unverified')
  })

  it('keeps_unavailable_docker_unverified_and_does_not_return_raw_diagnostics', async () => {
    const world = InspectionWorld.ready()
    world.dockerAvailable = false
    const report = await world.inspect()
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'docker', status: 'unverified' }))
    expect(JSON.stringify(report)).not.toContain('SECRET')
  })

  it('rejects_malformed_compose_output_instead_of_reporting_missing_limits_as_fact', async () => {
    const world = InspectionWorld.ready()
    world.config = { services: [] }
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'compose', status: 'unverified' }))
  })

  it('flags_missing_resource_limits_and_database_health', async () => {
    const world = InspectionWorld.ready()
    world.config = { name: 'example', services: { app: { image: 'example' }, db: { image: 'postgres:17' } } }
    const report = await world.inspect()
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'container-resources', status: 'changes-required' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'database-readiness', status: 'changes-required' }))
  })

  it('detects_a_container_mounting_another_checkout', async () => {
    const world = InspectionWorld.ready()
    world.containers = [{ Name: '/example-app-1', Config: { Labels: { 'com.docker.compose.service': 'app' } }, State: { Status: 'running' }, Mounts: [{ Type: 'bind', Source: '/other', Destination: '/app' }] }]
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'container-mounts', status: 'changes-required' }))
  })

  it('reports_ambiguous_compose_layouts_instead_of_guessing_which_one_make_uses', async () => {
    const world = InspectionWorld.ready()
    world.files.set('compose.yaml', 'services: {}')
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'compose', status: 'unverified' }))
    expect(world.commands.some(({ argv }) => argv.includes('config'))).toBe(false)
  })

  it('does_not_start_more_commands_after_the_inspection_budget_is_exhausted', async () => {
    const world = InspectionWorld.ready()
    const original = world.run.bind(world)
    world.run = async (...args) => { const result = await original(...args); world.time += 30_000; return result }
    const report = await world.inspect()
    expect(report.status).toBe('unverified')
    expect(world.commands).toHaveLength(1)
  })

  it('does_not_describe_unreadable_declarations_as_missing', async () => {
    const world = InspectionWorld.ready()
    const original = world.run.bind(world)
    world.run = async (...args) => args[1][0] === 'show'
      ? new ProcessOutput({ code: 124, stdout: '', stderr: 'timed out' }) : original(...args)
    const report = await world.inspect()
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'commands', status: 'unverified' }))
    expect(report.findings).toContainEqual(expect.objectContaining({ id: 'conventions', status: 'unverified' }))
  })

  it('treats_malformed_mount_metadata_as_unverified_instead_of_a_confirmed_mismatch', async () => {
    const world = InspectionWorld.ready()
    world.containers = [{ Config: { Labels: { 'com.docker.compose.service': 'app' } }, State: { Status: 'running' }, Mounts: [{}] }]
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'container-mounts', status: 'unverified' }))
  })

  it('limits_concurrent_inspections_instead_of_multiplying_subprocesses', async () => {
    const world = InspectionWorld.ready()
    let release: () => void = () => {}
    const waiting = new Promise<void>((resolve) => { release = resolve })
    const original = world.run.bind(world)
    world.run = async (...args) => { await waiting; return original(...args) }
    const setup = world.setup()
    const first = setup.inspect(world.target())
    const second = setup.inspect(world.target())
    release()
    expect((await second).findings).toContainEqual(expect.objectContaining({ id: 'inspection', status: 'unverified', action: 'retry-inspection' }))
    await first
  })

  it('reports_build_inputs_outside_the_selected_checkout', async () => {
    const world = InspectionWorld.ready()
    world.config = { name: 'example', services: { app: { image: 'example', build: { context: '/other' } } } }
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'build-context', status: 'changes-required' }))
  })

  it('detects_a_container_still_using_the_previous_image_behind_a_mutable_tag', async () => {
    const world = InspectionWorld.ready()
    world.config = { name: 'example', services: { app: { image: 'example' } } }
    world.containers = [{ Image: `sha256:${'a'.repeat(64)}`, Config: { Labels: { 'com.docker.compose.service': 'app' } }, State: { Status: 'running' }, Mounts: [] }]
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'image-provenance', status: 'changes-required' }))
  })

  it('does_not_certify_a_chain_after_only_reading_its_first_pytest_command', async () => {
    const world = InspectionWorld.ready()
    world.files.set('AGENTS.md', '- build: `make build`\n- test: `pytest -n 2 && pytest -n auto`\n- lint: `make linting`')
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'unverified' }))
  })

  it('detects_bind_mounts_removed_from_compose_but_still_present_in_a_container', async () => {
    const world = InspectionWorld.ready()
    world.config = { name: 'example', services: { app: { image: 'example' } } }
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'container-mounts', status: 'changes-required' }))
  })

  it('checks_every_replica_image_instead_of_only_the_first_container', async () => {
    const world = InspectionWorld.ready()
    world.config = { name: 'example', services: { app: { image: 'example' } } }
    world.containers = [
      { Image: `sha256:${'b'.repeat(64)}`, Config: { Labels: { 'com.docker.compose.service': 'app' } }, State: { Status: 'running' }, Mounts: [] },
      { Image: `sha256:${'a'.repeat(64)}`, Config: { Labels: { 'com.docker.compose.service': 'app' } }, State: { Status: 'running' }, Mounts: [] },
    ]
    const original = world.run.bind(world)
    world.run = async (...args) => args[0] === 'docker' && args[1][0] === 'ps'
      ? new ProcessOutput({ code: 0, stdout: 'abcdef123456\nabcdef123457\n', stderr: '' }) : original(...args)
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'image-provenance', status: 'changes-required' }))
  })

  it('does_not_let_one_healthy_dependency_mask_another_consumer_that_only_waits_for_startup', async () => {
    const world = InspectionWorld.ready()
    world.config = { name: 'example', services: {
      app: { image: 'example', depends_on: { db: { condition: 'service_started' } } },
      worker: { image: 'example', depends_on: { db: { condition: 'service_healthy' } } },
      db: { image: 'postgres:17', healthcheck: { test: ['CMD', 'pg_isready'] } },
    } }
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'database-readiness', status: 'changes-required' }))
  })

  it('does_not_follow_a_script_reference_in_a_compound_make_recipe', async () => {
    const world = InspectionWorld.ready()
    world.files.set('Makefile', 'test:\n\tpytest -n auto && ./scripts/test-command.sh')
    world.files.set('scripts/test-command.sh', 'pytest -n 2')
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'unverified' }))
  })

  it.each(['pytest -n 2 --numprocesses auto', 'pytest -n 2 --numprocesses=auto'])('does_not_ignore_a_later_worker_override: %s', async (command) => {
    const world = InspectionWorld.ready()
    world.files.set('AGENTS.md', `- test: \`${command}\``)
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'unverified' }))
  })

  it('does_not_assume_an_arbitrary_docker_macro_is_only_container_execution', async () => {
    const world = InspectionWorld.ready()
    world.files.set('Makefile', 'DOCKER_EXEC := pytest -n auto && docker compose exec app\ntest:\n\t@$(DOCKER_EXEC) $(CONTAINER_FOLDER)/scripts/test-command.sh')
    world.files.set('scripts/test-command.sh', 'pytest -n 2')
    expect((await world.inspect()).findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'unverified' }))
  })
})
