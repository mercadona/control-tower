import { describe, expect, it } from 'vitest'
import { ComposeRepositoryPreparations } from '../../src/infrastructure/compose-repository-preparations.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'

class SourceMother {
  static readonly REVISION = 'a'.repeat(40)
  static readonly TARGET = { root: new CheckoutRoot('/repo'), repository: new RepositoryName('owner/repo') }
  static readonly WORKTREE = '/repo/.worktrees/10'
  static readonly COMPOSE = 'name: playground\nservices:\n  app:\n    image: app\n  db:\n    image: postgres\n'

  static catalogMakefile(): string {
    return [
      'DOCKER_COMPOSE_FILE := $(ROOT_FOLDER)/docker/docker-compose.yml',
      'DOCKER_COMPOSE_OVERRIDE_FILE := $(ROOT_FOLDER)/docker/docker-compose.local.yml',
      'DOCKER_COMMAND := docker compose -f $(DOCKER_COMPOSE_FILE)',
      'ifneq ("$(wildcard $(DOCKER_COMPOSE_OVERRIDE_FILE))","")',
      'DOCKER_COMMAND := $(DOCKER_COMMAND) -f $(DOCKER_COMPOSE_OVERRIDE_FILE)',
      'endif',
    ].join('\n')
  }

  static oldPlaygroundMakefile(): string {
    return SourceMother.catalogMakefile().replace('docker compose -f', 'docker compose -p $(PROJECT_NAME) -f')
  }
}

class Environment {
  revision = SourceMother.REVISION
  makefile = SourceMother.catalogMakefile()
  compose = SourceMother.COMPOSE
  tree = 'Makefile\ndocker/docker-compose.yml\n'
  failure: string | null = null
  dockerOutput: string | null = null
  dockerCode = 0
  readonly gitCalls: string[][] = []
  readonly dockerCalls: string[][] = []
  readonly written: string[] = []
  readonly files = new Map<string, string>()

  async git(argv: string[]): Promise<ProcessOutput> {
    this.gitCalls.push(argv)
    const verb = argv[2]
    if (verb === this.failure) return new ProcessOutput({ code: 1, stdout: '', stderr: 'refused' })
    let stdout = ''
    switch (verb) {
      case 'ls-remote': stdout = `${this.revision}\tHEAD\n`; break
      case 'rev-parse': stdout = `${this.revision}\n`; break
      case 'ls-tree': stdout = this.tree; break
      case 'fetch': case 'diff': case 'check-ignore': break
      case 'show': stdout = argv[3].endsWith(':Makefile') ? this.makefile : this.compose; break
      default: throw new Error(`unexpected git call ${argv.join(' ')}`)
    }
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }

  async docker(argv: string[]): Promise<ProcessOutput> {
    this.dockerCalls.push(argv)
    const worktree = argv[2].replace(/\/docker\/docker-compose.yml$/, '')
    const override = this.files.get(argv[4]) ?? ''
    const name = override.match(/^name: (.+)$/m)?.[1]
    const stdout = this.dockerOutput ?? JSON.stringify({ name, services: { app: { volumes: [{ type: 'bind', source: worktree, target: '/app' }] } }, volumes: { pgdata: { name: `${name}_pgdata` } } })
    return new ProcessOutput({ code: this.dockerCode, stdout, stderr: '' })
  }

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path)
    if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    return value
  }

  async writeFile(path: string, text: string, options: { flag: string }): Promise<void> {
    expect(options.flag).toBe('wx')
    if (this.files.has(path)) throw new Error('file exists')
    this.files.set(path, text)
    this.written.push(text)
  }

  adapter(): ComposeRepositoryPreparations {
    return new ComposeRepositoryPreparations({ git: this.git.bind(this), docker: this.docker.bind(this), files: this })
  }

  prepare() {
    return this.adapter().prepare({ ...SourceMother.TARGET, path: SourceMother.WORKTREE })
  }
}

describe('Compose preparation from repository configuration', () => {
  it('two worktrees receive different project names without changing each other', async () => {
    const env = new Environment()
    const adapter = env.adapter()
    expect((await adapter.prepare({ ...SourceMother.TARGET, path: SourceMother.WORKTREE })).state).toBe('compatible')
    expect((await adapter.prepare({ ...SourceMother.TARGET, path: '/repo/.worktrees/11' })).state).toBe('compatible')
    expect(env.written).toHaveLength(2)
    expect(env.written[0].split('\n')[0]).not.toBe(env.written[1].split('\n')[0])
    expect(env.files.get(`${SourceMother.WORKTREE}/docker/docker-compose.local.yml`)).toBe(env.written[0])
  })

  it('shared named resources are diagnosed on the remote base before cutting a worktree', async () => {
    const env = new Environment()
    env.compose += 'volumes:\n  pgdata:\n    external: true\n'
    const result = await env.adapter().inspect(SourceMother.TARGET)
    expect(result.state).toBe('required')
    expect(result.summary).toContain('volumes/pgdata')
    expect(env.written).toEqual([])
  })

  it('invalid Compose YAML is not mistaken for an absent Compose setup', async () => {
    const env = new Environment()
    env.compose = 'services: ['
    expect((await env.adapter().inspect(SourceMother.TARGET)).state).toBe('not-checked')
  })

  it('the old Playground invocation is refused before a file or container can be changed', async () => {
    const env = new Environment()
    env.makefile = SourceMother.oldPlaygroundMakefile()
    const result = await env.adapter().inspect(SourceMother.TARGET)
    expect(result.state).toBe('required')
    expect(result.revision).toBe(SourceMother.REVISION)
    expect(result.findings[0].path).toBe('Makefile')
    expect(result.summary).toContain('Remove -p/--project-name')
    expect(env.written).toEqual([])
    expect(env.dockerCalls).toEqual([])
  })

  it('rechecking fetches and inspects the corrected remote revision without switching the checkout', async () => {
    const env = new Environment()
    env.makefile = SourceMother.oldPlaygroundMakefile()
    const adapter = env.adapter()
    expect((await adapter.inspect(SourceMother.TARGET)).permitsDispatch()).toBe(false)
    env.makefile = SourceMother.catalogMakefile()
    env.revision = 'b'.repeat(40)
    const result = await adapter.inspect(SourceMother.TARGET)
    expect(result.state).toBe('compatible')
    expect(result.revision).toBe('b'.repeat(40))
    expect(env.gitCalls).toContainEqual(['-C', '/repo', 'fetch', '--quiet', '--no-tags', 'origin', 'b'.repeat(40)])
    expect(env.gitCalls.some((argv) => ['checkout', 'switch', 'pull'].includes(argv[2]))).toBe(false)
  })

  it('does not require Docker for a repository without Compose', async () => {
    const env = new Environment()
    env.tree = 'package.json\n'
    expect((await env.adapter().inspect(SourceMother.TARGET)).state).toBe('not-applicable')
    expect(env.dockerCalls).toEqual([])
  })

  it('a Compose example under tests is not the repository environment', async () => {
    const env = new Environment()
    env.tree = 'package.json\ntests/fixtures/docker-compose.yml\n'
    expect((await env.adapter().inspect(SourceMother.TARGET)).state).toBe('not-applicable')
    expect(env.dockerCalls).toEqual([])
  })

  it.each(['ls-remote', 'fetch', 'show', 'ls-tree'])('a failed %s read never authorizes dispatch', async (verb) => {
    const env = new Environment()
    env.failure = verb
    const result = await env.adapter().inspect(SourceMother.TARGET)
    expect(result.state).toBe('not-checked')
    expect(result.permitsDispatch()).toBe(false)
  })

  it('does not guess what an unfamiliar Compose wrapper will execute', async () => {
    const env = new Environment()
    env.makefile = 'test:\n\t./scripts/run-tests\n'
    expect((await env.adapter().inspect(SourceMother.TARGET)).state).toBe('not-checked')
  })

  it('prepares a unique local override and checks effective configuration without starting containers', async () => {
    const env = new Environment()
    expect((await env.prepare()).state).toBe('compatible')
    expect(env.written).toHaveLength(1)
    expect(env.written[0]).toMatch(/^name: ct-[a-f0-9]{16}\n/)
    expect(env.written[0]).toContain('"app":\n    ports: !reset []')
    expect(env.dockerCalls).toEqual([['compose', '-f', `${SourceMother.WORKTREE}/docker/docker-compose.yml`, '-f', `${SourceMother.WORKTREE}/docker/docker-compose.local.yml`, 'config', '--no-env-resolution', '--format', 'json']])
    expect(env.gitCalls).toContainEqual(['-C', SourceMother.WORKTREE, 'check-ignore', '--quiet', '--', 'docker/docker-compose.local.yml'])
  })

  it('preserves an existing override and reports its shared project name', async () => {
    const env = new Environment()
    const path = `${SourceMother.WORKTREE}/docker/docker-compose.local.yml`
    env.files.set(path, 'name: shared\nservices: {}\n')
    const result = await env.prepare()
    expect(result.state).toBe('required')
    expect(env.written).toEqual([])
    expect(env.files.get(path)).toBe('name: shared\nservices: {}\n')
    expect(result.summary).toContain('worktree-specific name reserved by Control Tower')
  })

  it('reports published ports, shared volumes and wrong application mounts', async () => {
    const env = new Environment()
    env.dockerOutput = JSON.stringify({ name: 'shared', services: { app: { ports: [{ published: '8000', target: 8000 }], volumes: [{ type: 'bind', source: '/sibling', target: '/app' }] } }, volumes: { db: { name: 'shared_db', external: true } } })
    const result = await env.prepare()
    expect(result.state).toBe('required')
    expect(result.summary).toContain('publishes host ports')
    expect(result.summary).toContain('mounts another checkout')
    expect(result.summary).toContain('shared with other projects')
  })

  it('does not create configuration when it would enter the slice diff', async () => {
    const env = new Environment()
    env.failure = 'check-ignore'
    expect((await env.prepare()).state).toBe('not-checked')
    expect(env.written).toEqual([])
  })

  it('a Docker refusal or malformed answer is never reported as compatible', async () => {
    const env = new Environment()
    env.dockerCode = 1
    expect((await env.prepare()).state).toBe('not-checked')
    env.dockerCode = 0
    env.dockerOutput = '{}'
    expect((await env.prepare()).state).toBe('not-checked')
  })
})
