import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { InspectProject, InspectProjectParams } from '../src/application/queries/inspect-project.js'
import { ShellProjectSetup } from '../src/infrastructure/shell-project-setup.js'
import { CommandOutput } from '../src/infrastructure/command-output.js'
import { ProjectNotRead, ProjectNotUnderstood } from '../src/domain/exceptions.js'

class Commands {
  constructor(git, docker) {
    this.answers = new Map([['git', git], ['docker', docker]])
    this.calls = []
  }

  async run(tool) {
    this.calls.push(tool)
    return this.answers.get(tool)
  }

  query() {
    return new InspectProject({ setup: new ShellProjectSetup({ run: this.run.bind(this), maxWorkers: 2, database: 'fixture-db', budgetMs: 1000 }) })
  }

  inspect() {
    return this.query().execute(new InspectProjectParams({ root: '/repo' }))
  }
}

describe('InspectProject', () => {
  it('accepts the worker limit with a healthy database', async () => {
    const commands = new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'healthy'))
    assert.equal((await commands.inspect()).report.status, 'ready')
  })

  it('requires changes above the limit without asking the database', async () => {
    const commands = new Commands(new CommandOutput(0, '3'), new CommandOutput(0, 'healthy'))
    assert.equal((await commands.inspect()).report.status, 'changes-required')
    assert.deepEqual(commands.calls, ['git'])
  })

  it('requires changes while the database is not healthy', async () => {
    assert.equal((await new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'starting')).inspect()).report.status, 'changes-required')
    assert.equal((await new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'unhealthy')).inspect()).report.status, 'changes-required')
  })

  it('preserves command failures', async () => {
    await assert.rejects(new Commands(new CommandOutput(1, ''), new CommandOutput(0, 'healthy')).inspect(), ProjectNotRead)
    await assert.rejects(new Commands(new CommandOutput(0, '2'), new CommandOutput(1, '')).inspect(), ProjectNotRead)
  })

  it('rejects unrecognized observations', async () => {
    await assert.rejects(new Commands(new CommandOutput(0, 'many'), new CommandOutput(0, 'healthy')).inspect(), ProjectNotUnderstood)
    await assert.rejects(new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'unknown')).inspect(), ProjectNotUnderstood)
  })
})
