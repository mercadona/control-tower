import * as fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { PlanIssue } from '../../../src/domain/value-objects/plan-issue.ts'
import { RetryBudget, RetryPolicy } from '../../../src/domain/policies/retry-policy.ts'
import { PlanWatch } from '../../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../../src/domain/value-objects/workspace-location.ts'
import { CheckedRunDelivery } from '../../../src/infrastructure/checked-run-delivery.ts'
import { CtRunMachine, RunInspection } from '../../../src/infrastructure/ct-run-machine.ts'
import { Gh } from '../../../src/infrastructure/gh.ts'
import { HeadlessFiles } from '../../../src/infrastructure/headless-files.ts'
import { RunJournal } from '../../../src/infrastructure/run-journal.ts'
import { ProcessOutput, ToolRunner } from '../../../src/infrastructure/tool-runner.ts'
import { SystemProcesses } from '../../../src/infrastructure/process-border.ts'

const processes = new SystemProcesses()

type HarnessConfig = {
  readonly root: string,
  readonly worktree: string,
  readonly state: string,
  readonly fakeGh: string,
  readonly dispatchCheck: string,
  readonly accountDirectory: string,
}

class DeliveredMachine extends CtRunMachine {
  override async inspect(): Promise<RunInspection> { return new RunInspection({ kind: 'delivered' }) }
}

const [configPath, outcomePath] = process.argv.slice(2)
const config = JSON.parse(await fs.readFile(configPath, 'utf8')) as HarnessConfig
const journal = new RunJournal({
  files: new HeadlessFiles({ root: config.state, fs, newId: randomUUID }),
  newId: randomUUID,
  now: () => new Date().toISOString(),
})
const watch = new PlanWatch({
  story: null,
  issue: new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' }),
  located: new WorkspaceLocation({ root: config.root, path: config.worktree, branch: 'feat/7' }),
  repository: new RepositoryName('owner/name'),
  agent: '11111111-1111-4111-8111-111111111111',
})
const machine = new DeliveredMachine({
  journal,
  node: async () => new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
  git: async () => new ProcessOutput({ code: 0, stdout: '', stderr: '' }),
  read: async () => null,
  ctStep: '/plugin/ct-step.mjs',
  dispatchCheck: config.dispatchCheck,
  pluginRoot: '/plugin',
})
const gitRunner = new ToolRunner({ bin: 'git', budgetMs: 30_000, processes })
const ghRunner = new ToolRunner({ bin: config.fakeGh, budgetMs: 30_000, env: process.env, processes })
const nodeRunner = new ToolRunner({ bin: process.execPath, budgetMs: 30_000, env: process.env, processes })
const gh = new Gh({
  launch: (argv) => ghRunner.runWholeOutput(argv),
  policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
  sleep: async () => {},
})
const delivery = new CheckedRunDelivery({
  journal,
  machine,
  git: (argv, options) => argv.slice(2).join(' ') === 'remote get-url --all origin'
      || argv.slice(2).join(' ') === 'remote get-url --push --all origin'
    ? Promise.resolve(new ProcessOutput({ code: 0, stdout: 'https://github.com/owner/name.git\n', stderr: '' }))
    : gitRunner.runWholeOutput(argv, options),
  node: nodeRunner.runWholeOutput.bind(nodeRunner),
  gh,
  read: async (path) => fs.readFile(path, 'utf8').catch(() => null),
  dispatchCheck: config.dispatchCheck,
  newId: randomUUID,
  now: () => new Date().toISOString(),
})

try {
  if (process.env.CLAUDE_CONFIG_DIR !== config.accountDirectory
    || !(await fs.stat(process.env.CLAUDE_CONFIG_DIR).catch(() => null))?.isDirectory()) {
    throw new Error('publisher account directory is not the fixture-owned directory')
  }
  await delivery.deliver(watch)
  await fs.writeFile(outcomePath, JSON.stringify({ delivered: true, inspection: await delivery.inspect(watch) }))
} catch (cause) {
  await fs.writeFile(outcomePath, JSON.stringify({ delivered: false, error: cause instanceof Error ? cause.message : String(cause) }))
  process.exitCode = 1
}
