import { describe, expect, it } from 'vitest'
import { InspectProject, InspectProjectParams } from '../../src/application/queries/inspect-project.ts'
import { ProjectRepository } from '../../src/domain/ports/project-repository.ts'
import { ProjectEnvironment } from '../../src/domain/ports/project-environment.ts'
import { ProjectReadinessAssessment } from '../../src/domain/policies/project-readiness-assessment.ts'
import { RepositoryIdentity } from '../../src/domain/value-objects/repository-identity.ts'
import { RepositoryObservations } from '../../src/domain/value-objects/repository-observations.ts'
import { EnvironmentObservations } from '../../src/domain/value-objects/environment-observations.ts'
import { EnvironmentConfiguration } from '../../src/domain/value-objects/environment-configuration.ts'
import { EnvironmentService } from '../../src/domain/value-objects/environment-service.ts'
import { EnvironmentContainer } from '../../src/domain/value-objects/environment-container.ts'
import { WorkspaceMount } from '../../src/domain/value-objects/workspace-mount.ts'
import type { InspectionBudget } from '../../src/domain/value-objects/inspection-budget.ts'
import type { ReadinessId } from '../../src/domain/value-objects/readiness-finding.ts'
import { PlanTarget } from '../../src/domain/value-objects/plan-target.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class Observations {
  static repository(overrides: Partial<ConstructorParameters<typeof RepositoryObservations>[0]> = {}) {
    return new RepositoryObservations({
      root: '/repo', base: { reference: 'origin/main', revision: 'a'.repeat(40) },
      commands: { build: 'build-command', test: 'test-command', lint: 'lint-command' },
      sources: [{ path: 'rules.md', state: 'read', body: 'Use dependency injection.' }], workerCount: 2, workerEvidence: ['two workers'],
      composeFiles: ['compose.yaml'], changedPaths: [],
      ignoredPaths: ['.worktrees/__readiness__/probe', '.agent/SLICE.md', '.agent/run-1.json'], ...overrides,
    })
  }

  static service(overrides: Partial<ConstructorParameters<typeof EnvironmentService>[0]> = {}) {
    return new EnvironmentService({
        name: 'app', image: 'app:latest', cpuLimited: false, memoryLimited: false, healthcheck: false,
        database: null, healthDependencies: [], startupDependencies: [], mounts: [],
        publishedPorts: false, fixedName: false, sharedVolumes: false, buildContext: '/repo', ...overrides,
    })
  }

  static container(overrides: Partial<ConstructorParameters<typeof EnvironmentContainer>[0]> = {}) {
    return new EnvironmentContainer({ name: '/project-app-1', service: 'app', running: true, mounts: [], image: `sha256:${'b'.repeat(64)}`, ...overrides })
  }

  static environment(overrides: Partial<ConstructorParameters<typeof EnvironmentObservations>[0]> = {}) {
    return new EnvironmentObservations({
      hostEvidence: ['6 processors'], containers: [Observations.container()], images: new Map([['app:latest', `sha256:${'b'.repeat(64)}`]]),
      configuration: new EnvironmentConfiguration('project', [Observations.service()]), ...overrides,
    })
  }
}

class RepositorySpy extends ProjectRepository {
  identity = new RepositoryIdentity({ root: '/repo', name: 'owner/project', evidence: ['/repo', 'owner/project'] })
  observations = Observations.repository()
  readonly calls: string[] = []
  readonly budgets: InspectionBudget[] = []

  async identify(root: string, budget: InspectionBudget) {
    this.calls.push(`identity:${root}`)
    this.budgets.push(budget)
    return this.identity
  }

  async observe(root: string, budget: InspectionBudget) {
    this.calls.push(`repository:${root}`)
    this.budgets.push(budget)
    return this.observations
  }
}

class EnvironmentSpy extends ProjectEnvironment {
  observations = Observations.environment()
  readonly calls: string[] = []
  readonly budgets: InspectionBudget[] = []

  async observe(root: string, file: string, budget: InspectionBudget) {
    this.calls.push(`${root}:${file}`)
    this.budgets.push(budget)
    return this.observations
  }
}

class Inspection {
  readonly repository = new RepositorySpy()
  readonly environment = new EnvironmentSpy()
  readonly target = new PlanTarget({ repository: new RepositoryName('owner/project'), root: new CheckoutRoot('/repo') })
  readonly useCase = new InspectProject({
    repository: this.repository, environment: this.environment, assessment: new ProjectReadinessAssessment(), now: () => 0,
    limits: { budgetMs: 30_000, commandBudgetMs: 2_000, maxFiles: 24, maxContainers: 12 },
  })

  execute() { return this.useCase.execute(new InspectProjectParams({ target: this.target })) }
  async finding(id: ReadinessId) { return (await this.execute()).report.findings.find((finding) => finding.id === id) }
}

describe('InspectProject', () => {
  it('conducts_repository_then_environment_observation_and_applies_domain_criteria', async () => {
    const inspection = new Inspection()
    const result = await inspection.execute()
    expect(inspection.repository.calls).toEqual(['identity:/repo', 'repository:/repo'])
    expect(inspection.environment.calls).toEqual(['/repo:compose.yaml'])
    expect(inspection.environment.budgets[0]).toBe(inspection.repository.budgets[0])
    expect(result.report.findings).toContainEqual(expect.objectContaining({ id: 'container-resources', status: 'changes-required' }))
    expect(result.report.findings).toContainEqual(expect.objectContaining({ id: 'execution', status: 'unverified' }))
  })

  it('evaluates_worker_policy_without_a_shell_or_docker_format_in_the_input', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ workerCount: 'automatic' })
    expect((await inspection.execute()).report.findings).toContainEqual(expect.objectContaining({ id: 'test-workers', status: 'changes-required' }))
  })

  it('waits_for_repository_observations_before_asking_the_environment', async () => {
    const inspection = new Inspection()
    let release: (value: RepositoryObservations) => void = () => {}
    let entered: () => void = () => {}
    const observations = new Promise<RepositoryObservations>((resolve) => { release = resolve })
    const reached = new Promise<void>((resolve) => { entered = resolve })
    inspection.repository.observe = async () => { entered(); return observations }
    const running = inspection.execute()
    await reached
    try { expect(inspection.environment.calls).toEqual([]) }
    finally { release(Observations.repository()) }
    await running
    expect(inspection.environment.calls).toEqual(['/repo:compose.yaml'])
  })

  it('does_not_read_configuration_or_environment_for_a_different_repository', async () => {
    const inspection = new Inspection()
    inspection.repository.identity = new RepositoryIdentity({ root: '/repo', name: 'other/project', evidence: [] })
    const result = await inspection.execute()
    expect(inspection.repository.calls).toEqual(['identity:/repo'])
    expect(inspection.environment.calls).toEqual([])
    expect(result.report.findings[0].status).toBe('changes-required')
  })

  it('does_not_observe_an_environment_without_a_known_base', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ base: null })
    expect((await inspection.execute()).report.status).toBe('unverified')
    expect(inspection.environment.calls).toEqual([])
  })

  it('does_not_guess_an_environment_for_ambiguous_configuration', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ composeFiles: ['compose.yaml', 'docker-compose.yml'] })
    expect((await inspection.execute()).report.findings).toContainEqual(expect.objectContaining({ id: 'compose', status: 'unverified' }))
    expect(inspection.environment.calls).toEqual([])
  })

  it('releases_the_inspection_slot_after_an_unexpected_reader_failure', async () => {
    const inspection = new Inspection()
    const identify = inspection.repository.identify.bind(inspection.repository)
    inspection.repository.identify = async () => { throw new Error('reader defect') }
    await expect(inspection.execute()).rejects.toThrow('reader defect')
    inspection.repository.identify = identify
    expect((await inspection.execute()).report.findings[0].id).toBe('checkout')
  })

  it('keeps_a_second_inspection_out_of_the_source_ports_until_the_first_finishes', async () => {
    const inspection = new Inspection()
    const roots: string[] = []
    let release: (value: RepositoryIdentity) => void = () => {}
    const waiting = new Promise<RepositoryIdentity>((resolve) => { release = resolve })
    inspection.repository.identify = async (root) => { roots.push(root); return waiting }
    const first = inspection.execute()
    try {
      expect((await inspection.execute()).report.findings).toContainEqual(expect.objectContaining({ id: 'inspection', status: 'unverified', action: 'retry-inspection' }))
      expect(roots).toEqual(['/repo'])
    } finally { release(inspection.repository.identity) }
    await first
  })

  it('requires_concrete_commands_rather_than_placeholders', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ commands: { build: null, test: '<command>', lint: 'TODO' } })
    expect(await inspection.finding('commands')).toMatchObject({ status: 'changes-required', evidence: ['build', 'test', 'lint'] })
  })

  it('keeps_unreadable_declarations_distinct_from_missing_ones', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ commands: null, sources: null })
    const result = await inspection.execute()
    expect(result.report.findings).toContainEqual(expect.objectContaining({ id: 'commands', status: 'unverified' }))
    expect(result.report.findings).toContainEqual(expect.objectContaining({ id: 'conventions', status: 'unverified' }))
  })

  it.each(['TODO', 'TBD', '<rules>', '...', '', '   '])('does_not_accept_provisional_convention_content: %j', async (body) => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ sources: [{ path: 'rules.md', state: 'read', body }] })
    expect(await inspection.finding('conventions')).toMatchObject({ status: 'changes-required', action: 'declare-conventions' })
  })

  it.each(['missing', 'unreadable'] as const)('interprets_a_convention_source_that_is_%s', async (state) => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ sources: [{ path: 'rules.md', state }] })
    expect(await inspection.finding('conventions')).toMatchObject({ status: state === 'missing' ? 'changes-required' : 'unverified' })
  })

  it.each([
    { paths: [], status: 'ready' }, { paths: ['Makefile'], status: 'changes-required' }, { paths: null, status: 'unverified' },
  ])('classifies_observed_setup_drift: $status', async ({ paths, status }) => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ changedPaths: paths })
    expect(await inspection.finding('checkout-drift')).toMatchObject({ status })
  })

  it('requires_runtime_files_ignored_and_plans_committable', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ ignoredPaths: [
      '.worktrees/__readiness__/probe', '.agent/SLICE.md', '.agent/run-1.json', 'docs/superpowers/plans/__readiness__.md',
    ] })
    expect(await inspection.finding('git-ignore')).toMatchObject({ status: 'changes-required' })
  })

  it('does_not_prescribe_ignore_changes_when_the_observation_is_unavailable', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ ignoredPaths: null })
    expect(await inspection.finding('git-ignore')).toMatchObject({ status: 'unverified', action: 'retry-inspection' })
  })

  it('keeps_an_unrecognized_worker_configuration_unverified', async () => {
    const inspection = new Inspection()
    inspection.repository.observations = Observations.repository({ workerCount: null })
    expect(await inspection.finding('test-workers')).toMatchObject({ status: 'unverified' })
  })

  it('reports_an_unavailable_runtime_without_inventing_resource_observations', async () => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ hostEvidence: null })
    expect(await inspection.finding('docker')).toMatchObject({ status: 'unverified' })
  })

  it('reports_configuration_as_unverified_when_it_could_not_be_observed', async () => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ configuration: null })
    expect(await inspection.finding('compose')).toMatchObject({ status: 'unverified' })
  })

  it.each([
    { cpuLimited: false, memoryLimited: true, status: 'changes-required' },
    { cpuLimited: true, memoryLimited: false, status: 'changes-required' },
    { cpuLimited: true, memoryLimited: true, status: 'ready' },
  ])('requires_both_resource_bounds: $cpuLimited/$memoryLimited', async ({ cpuLimited, memoryLimited, status }) => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ configuration: new EnvironmentConfiguration('project', [Observations.service({ cpuLimited, memoryLimited })]) })
    expect(await inspection.finding('container-resources')).toMatchObject({ status })
  })

  it.each([
    { healthcheck: false, waits: true, unsafeConsumer: false, status: 'changes-required' },
    { healthcheck: true, waits: false, unsafeConsumer: false, status: 'changes-required' },
    { healthcheck: true, waits: true, unsafeConsumer: true, status: 'changes-required' },
    { healthcheck: true, waits: true, unsafeConsumer: false, status: 'ready' },
  ])('requires_health_and_waiting_consumers: $healthcheck/$waits/$unsafeConsumer', async ({ healthcheck, waits, unsafeConsumer, status }) => {
    const inspection = new Inspection()
    const services = [
      Observations.service({ healthDependencies: waits ? ['db'] : [] }),
      Observations.service({ name: 'db', image: 'db:latest', database: 'postgresql', healthcheck }),
    ]
    if (unsafeConsumer) services.push(Observations.service({ name: 'worker', startupDependencies: ['db'] }))
    inspection.environment.observations = Observations.environment({ configuration: new EnvironmentConfiguration('project', services) })
    expect(await inspection.finding('database-readiness')).toMatchObject({ status })
  })

  it.each(['publishedPorts', 'fixedName', 'sharedVolumes'] as const)('flags_shared_runtime_configuration: %s', async (field) => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ configuration: new EnvironmentConfiguration('project', [Observations.service({ [field]: true })]) })
    expect(await inspection.finding('worktree-config')).toMatchObject({ status: 'changes-required' })
  })

  it.each([
    { buildContext: '/other', status: 'changes-required' },
    { buildContext: '/repo/src', status: 'ready' },
    { buildContext: null, status: 'unverified' },
  ])('compares_build_provenance_with_the_requested_checkout: $buildContext', async ({ buildContext, status }) => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ configuration: new EnvironmentConfiguration('project', [Observations.service({ buildContext })]) })
    expect(await inspection.finding('build-context')).toMatchObject({ status })
  })

  it('detects_a_container_mounting_another_checkout', async () => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({
      configuration: new EnvironmentConfiguration('project', [Observations.service({ mounts: [new WorkspaceMount('/repo', '/app')] })]),
      containers: [Observations.container({ mounts: [new WorkspaceMount('/other', '/app')] })],
    })
    expect(await inspection.finding('container-mounts')).toMatchObject({ status: 'changes-required' })
  })

  it('detects_an_obsolete_bind_even_after_configuration_removed_it', async () => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ containers: [Observations.container({ mounts: [new WorkspaceMount('/repo', '/app')] })] })
    expect(await inspection.finding('container-mounts')).toMatchObject({ status: 'changes-required' })
  })

  it('leaves_incomplete_container_observations_unverified', async () => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ containers: [] })
    expect(await inspection.finding('container-mounts')).toMatchObject({ status: 'unverified' })
  })

  it('checks_every_replica_against_the_observed_image_identity', async () => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ containers: [
      Observations.container(), Observations.container({ name: '/project-app-2', image: `sha256:${'a'.repeat(64)}` }),
    ] })
    expect(await inspection.finding('image-provenance')).toMatchObject({ status: 'changes-required', evidence: [`/project-app-2:sha256:${'a'.repeat(64)}`] })
  })

  it('leaves_build_only_image_provenance_unverified', async () => {
    const inspection = new Inspection()
    inspection.environment.observations = Observations.environment({ configuration: new EnvironmentConfiguration('project', [Observations.service({ image: null })]) })
    expect(await inspection.finding('image-provenance')).toMatchObject({ status: 'unverified' })
  })
})
