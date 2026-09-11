# Review package: task 1/1 of issue #1 (staged, not yet committed)
Review token: 87439c21c6b58c10b8c995bb6276f701f3537696a35145ced839ad2b55485004

## Files changed
 src/application/queries/inspect-project.js | 23 +++++++++++++++++++++++
 src/infrastructure/shell-project-setup.js  | 26 ++++++++++++++++++++++++++
 test/inspect-project.js                   | 54 ++++++++++++++++++++++++++++++++++++++++++++++++++++++
 3 files changed, 103 insertions(+)

## Rutas tocadas
- src/application/queries/inspect-project.js
- src/infrastructure/shell-project-setup.js
- test/inspect-project.js

## Diff
diff --git a/src/application/queries/inspect-project.js b/src/application/queries/inspect-project.js
new file mode 100644
index 0000000..26f8910
--- /dev/null
+++ b/src/application/queries/inspect-project.js
@@ -0,0 +1,23 @@
+export class InspectProjectParams {
+  constructor({ root }) {
+    this.root = root
+    Object.freeze(this)
+  }
+}
+
+export class InspectProjectResult {
+  constructor({ report }) {
+    this.report = report
+    Object.freeze(this)
+  }
+}
+
+export class InspectProject {
+  constructor({ setup }) {
+    this.setup = setup
+  }
+
+  async execute({ root }) {
+    return new InspectProjectResult({ report: await this.setup.inspect(root) })
+  }
+}
diff --git a/src/infrastructure/shell-project-setup.js b/src/infrastructure/shell-project-setup.js
new file mode 100644
index 0000000..493054f
--- /dev/null
+++ b/src/infrastructure/shell-project-setup.js
@@ -0,0 +1,26 @@
+import { ProjectSetup } from '../domain/ports/project-setup.js'
+import { ProjectReadiness, ReadinessStatus } from '../domain/value-objects/project-readiness.js'
+import { ProjectNotRead, ProjectNotUnderstood } from '../domain/exceptions.js'
+
+export class ShellProjectSetup extends ProjectSetup {
+  constructor({ run, maxWorkers, database, budgetMs }) {
+    super()
+    this.run = run
+    this.maxWorkers = maxWorkers
+    this.database = database
+    this.budgetMs = budgetMs
+  }
+
+  async inspect(root) {
+    const workers = await this.run('git', ['config', '--get', 'test.workers'], { cwd: root, budgetMs: this.budgetMs })
+    if (workers.code !== 0) throw new ProjectNotRead('git worker configuration could not be read')
+    const count = workers.stdout.trim()
+    if (!/^\d+$/.test(count)) throw new ProjectNotUnderstood('git worker configuration is not a count')
+    if (Number(count) > this.maxWorkers) return new ProjectReadiness(ReadinessStatus.CHANGES_REQUIRED)
+    const database = await this.run('docker', ['inspect', '--format', '{{.State.Health.Status}}', this.database], { cwd: root, budgetMs: this.budgetMs })
+    if (database.code !== 0) throw new ProjectNotRead('database health could not be read')
+    const health = database.stdout.trim()
+    if (!['healthy', 'unhealthy', 'starting'].includes(health)) throw new ProjectNotUnderstood('database health is not understood')
+    return new ProjectReadiness(health === 'healthy' ? ReadinessStatus.READY : ReadinessStatus.CHANGES_REQUIRED)
+  }
+}
diff --git a/test/inspect-project.js b/test/inspect-project.js
new file mode 100644
index 0000000..32c8305
--- /dev/null
+++ b/test/inspect-project.js
@@ -0,0 +1,54 @@
+import { describe, it } from 'node:test'
+import assert from 'node:assert/strict'
+import { InspectProject, InspectProjectParams } from '../src/application/queries/inspect-project.js'
+import { ShellProjectSetup } from '../src/infrastructure/shell-project-setup.js'
+import { CommandOutput } from '../src/infrastructure/command-output.js'
+import { ProjectNotRead, ProjectNotUnderstood } from '../src/domain/exceptions.js'
+
+class Commands {
+  constructor(git, docker) {
+    this.answers = new Map([['git', git], ['docker', docker]])
+    this.calls = []
+  }
+
+  async run(tool) {
+    this.calls.push(tool)
+    return this.answers.get(tool)
+  }
+
+  query() {
+    return new InspectProject({ setup: new ShellProjectSetup({ run: this.run.bind(this), maxWorkers: 2, database: 'fixture-db', budgetMs: 1000 }) })
+  }
+
+  inspect() {
+    return this.query().execute(new InspectProjectParams({ root: '/repo' }))
+  }
+}
+
+describe('InspectProject', () => {
+  it('accepts the worker limit with a healthy database', async () => {
+    const commands = new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'healthy'))
+    assert.equal((await commands.inspect()).report.status, 'ready')
+  })
+
+  it('requires changes above the limit without asking the database', async () => {
+    const commands = new Commands(new CommandOutput(0, '3'), new CommandOutput(0, 'healthy'))
+    assert.equal((await commands.inspect()).report.status, 'changes-required')
+    assert.deepEqual(commands.calls, ['git'])
+  })
+
+  it('requires changes while the database is not healthy', async () => {
+    assert.equal((await new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'starting')).inspect()).report.status, 'changes-required')
+    assert.equal((await new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'unhealthy')).inspect()).report.status, 'changes-required')
+  })
+
+  it('preserves command failures', async () => {
+    await assert.rejects(new Commands(new CommandOutput(1, ''), new CommandOutput(0, 'healthy')).inspect(), ProjectNotRead)
+    await assert.rejects(new Commands(new CommandOutput(0, '2'), new CommandOutput(1, '')).inspect(), ProjectNotRead)
+  })
+
+  it('rejects unrecognized observations', async () => {
+    await assert.rejects(new Commands(new CommandOutput(0, 'many'), new CommandOutput(0, 'healthy')).inspect(), ProjectNotUnderstood)
+    await assert.rejects(new Commands(new CommandOutput(0, '2'), new CommandOutput(0, 'unknown')).inspect(), ProjectNotUnderstood)
+  })
+})
