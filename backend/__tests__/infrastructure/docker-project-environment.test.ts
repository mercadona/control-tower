import { describe, expect, it } from 'vitest'
import { ReadinessWorld } from '../fixtures/readiness-world.ts'

describe('DockerProjectEnvironment source interpretation', () => {
  it('projects_resource_and_health_metadata_without_classifying_the_project', async () => {
    const observed = await new ReadinessWorld().readEnvironment()
    expect(observed.configuration?.services[0].cpuLimited).toBe(true)
    expect(observed.configuration?.services[0].memoryLimited).toBe(true)
    expect(observed.configuration?.services[0].healthDependencies).toEqual(['db'])
    expect(observed.configuration?.services[1].database).toBe('postgresql')
    expect(observed.configuration?.services[1].healthcheck).toBe(true)
  })

  it('does_not_return_raw_failure_diagnostics', async () => {
    const world = new ReadinessWorld()
    world.dockerAvailable = false
    const observed = await world.readEnvironment()
    expect(observed.hostEvidence).toBeNull()
    expect(JSON.stringify(observed)).not.toContain('SECRET')
  })

  it('keeps_health_waits_distinct_from_startup_only_dependencies', async () => {
    const world = new ReadinessWorld()
    world.config = { name: 'example', services: {
      app: { image: 'example', depends_on: { db: { condition: 'service_started' } } },
      worker: { image: 'example', depends_on: { db: { condition: 'service_healthy' } } },
      db: { image: 'postgres:17' },
    } }
    const services = (await world.readEnvironment()).configuration?.services
    expect(services?.find((service) => service.name === 'app')?.startupDependencies).toEqual(['db'])
    expect(services?.find((service) => service.name === 'app')?.healthDependencies).toEqual([])
    expect(services?.find((service) => service.name === 'worker')?.healthDependencies).toEqual(['db'])
    expect(services?.find((service) => service.name === 'worker')?.startupDependencies).toEqual([])
  })

  it('rejects_malformed_configuration_instead_of_inventing_observations', async () => {
    const world = new ReadinessWorld()
    world.config = { services: [] }
    expect((await world.readEnvironment()).configuration).toBeNull()
  })

  it('projects_absent_optional_configuration_as_absence', async () => {
    const world = new ReadinessWorld()
    world.config = { name: 'example', services: { app: { build: { context: '/repo' } } } }
    const observed = await world.readEnvironment()
    expect(observed.configuration?.services[0].image).toBeNull()
    expect(observed.configuration?.services[0].cpuLimited).toBe(false)
    expect(observed.configuration?.services[0].healthcheck).toBe(false)
    expect(world.commands.some(({ bin, argv }) => bin === 'docker' && argv[0] === 'image')).toBe(false)
  })

  it('rejects_malformed_mount_metadata', async () => {
    const world = new ReadinessWorld()
    world.containers = [{ Config: { Labels: { 'com.docker.compose.service': 'app' } }, State: { Status: 'running' }, Mounts: [{}] }]
    expect((await world.readEnvironment()).containers).toBeNull()
  })

  it('preserves_the_image_identity_of_every_returned_replica', async () => {
    const world = new ReadinessWorld()
    world.config = { name: 'example', services: { app: { image: 'example' } } }
    world.containerIds = 'abcdef123456\nabcdef123457\n'
    world.containers = ['b', 'a'].map((hex) => ({ Image: `sha256:${hex.repeat(64)}`, Config: { Labels: { 'com.docker.compose.service': 'app' } }, State: { Status: 'running' }, Mounts: [] }))
    const observed = await world.readEnvironment()
    expect(observed.containers?.map((container) => container.image)).toEqual([`sha256:${'b'.repeat(64)}`, `sha256:${'a'.repeat(64)}`])
    expect(observed.imageIdentity('example')).toBe(`sha256:${'b'.repeat(64)}`)
  })
})
