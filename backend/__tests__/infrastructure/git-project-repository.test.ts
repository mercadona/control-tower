import { describe, expect, it } from 'vitest'
import { ReadinessWorld } from '../fixtures/readiness-world.ts'
import { ProcessOutput, ToolRunner } from '../../src/infrastructure/tool-runner.ts'

describe('GitProjectRepository source interpretation', () => {
  it('reads_the_declared_remote_base_and_the_worker_expression', async () => {
    const world = new ReadinessWorld()
    const observed = await world.readRepository()
    expect(observed.baseRevision).toBe('a'.repeat(40))
    expect(observed.workerCount).toBe(2)
    expect(observed.workerEvidence).toEqual(['pytest -n 2'])
  })

  it('reads_automatic_worker_syntax_without_deciding_readiness', async () => {
    const world = new ReadinessWorld()
    world.files.set('scripts/test-command.sh', 'pytest -n auto --junit-xml=junit.xml')
    expect((await world.readRepository()).workerCount).toBe('automatic')
  })

  it.each([
    'custom-runner', 'pytest -n 2 && pytest -n auto', 'pytest -n 2 --numprocesses auto',
    'pytest -n 2 --numprocesses=auto', 'pytest -n 2 $(cat pytest.args)', 'pytest -n 2 $PYTEST_ARGS',
    'pytest -n 2 ${PYTEST_ARGS}', 'pytest -n 2 <(cat pytest.args)',
  ])('leaves_unsupported_command_syntax_uninterpreted: %s', async (command) => {
    const world = new ReadinessWorld()
    world.files.set('AGENTS.md', `- test: \`${command}\``)
    expect((await world.readRepository()).workerCount).toBeNull()
  })

  it.each([
    'test:\n\tpytest -n auto && ./scripts/test-command.sh',
    'DOCKER_EXEC := pytest -n auto && docker compose exec app\ntest:\n\t@$(DOCKER_EXEC) $(CONTAINER_FOLDER)/scripts/test-command.sh',
  ])('does_not_follow_an_unsupported_make_recipe: %s', async (makefile) => {
    const world = new ReadinessWorld()
    world.files.set('Makefile', makefile)
    world.files.set('scripts/test-command.sh', 'pytest -n 2')
    expect((await world.readRepository()).workerCount).toBeNull()
  })

  it('does_not_parse_a_commented_pytest_invocation', async () => {
    const world = new ReadinessWorld()
    world.files.set('scripts/test-command.sh', '# pytest -n 2\ncustom-runner')
    expect((await world.readRepository()).workerCount).toBeNull()
  })

  it('does_not_substitute_HEAD_for_a_missing_remote_base', async () => {
    const world = new ReadinessWorld()
    world.baseExists = false
    expect((await world.readRepository()).baseRevision).toBeNull()
    expect(world.commands.some(({ argv }) => argv.includes('HEAD'))).toBe(false)
  })

  it('preserves_unreadable_declarations_as_unavailable_observations', async () => {
    const world = new ReadinessWorld()
    const run = world.run.bind(world)
    world.run = async (...args) => args[1][0] === 'show' ? new ProcessOutput({ code: 124, stdout: '', stderr: 'timeout' }) : run(...args)
    expect((await world.readRepository()).commandsKnown).toBe(false)
  })

  it('does_not_turn_a_failed_ignore_command_into_an_empty_successful_read', async () => {
    const world = new ReadinessWorld()
    const run = world.run.bind(world)
    const missing = new ToolRunner({ bin: 'ct-missing-inspection-probe', budgetMs: 2_000, ownedProcessGroup: { maxBufferBytes: 128 } })
    world.run = async (...args) => args[1][0] === 'check-ignore' ? missing.run([]) : run(...args)
    expect((await world.readRepository()).ignoredPaths).toBeNull()
  })

  it('stops_launching_commands_when_the_shared_budget_expires', async () => {
    const world = new ReadinessWorld()
    const run = world.run.bind(world)
    world.run = async (...args) => { const result = await run(...args); world.time += 30_000; return result }
    expect((await world.repository().identify('/repo', world.budget())).name).toBeNull()
    expect(world.commands).toHaveLength(1)
  })

  it('discovers_configuration_without_reading_unconsumed_contents', async () => {
    const world = new ReadinessWorld()
    world.files.set('package.json', '{"scripts":{"test":"custom"}}')
    world.files.set('.gitignore', '.worktrees/')
    const observed = await world.readRepository()
    const reads = world.commands.filter(({ argv }) => argv[0] === 'show').map(({ argv }) => argv[1].slice(41))
    expect(reads).not.toContain('package.json')
    expect(reads).not.toContain('.gitignore')
    expect(reads).not.toContain('docker/docker-compose.yml')
    expect(observed.composeFiles).toEqual(['docker/docker-compose.yml'])
    expect(world.commands.find(({ argv }) => argv[0] === 'diff')?.argv).toContain('package.json')
  })
})
