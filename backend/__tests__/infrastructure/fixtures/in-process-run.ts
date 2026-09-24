import * as fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderState } from '../../../../plugin/scripts/state.js'
import { DriveRun } from '../../../src/application/actions/drive-run.ts'
import { ExecuteRunInstruction } from '../../../src/application/actions/execute-run-instruction.ts'
import { DeliverHeldMessages } from '../../../src/application/actions/deliver-held-messages.ts'
import { ReadSliceEscalation } from '../../../src/application/queries/read-slice-escalation.ts'
import { PlanAgents } from '../../../src/domain/ports/plan-agents.ts'
import { PlanPublication } from '../../../src/domain/ports/plan-publication.ts'
import { SliceEscalations } from '../../../src/domain/ports/slice-escalations.ts'
import { SliceEscalation } from '../../../src/domain/value-objects/slice-escalation.ts'
import type { PlanWatch } from '../../../src/domain/value-objects/plan-watch.ts'
import { ClaudeCalls } from '../../../src/infrastructure/claude-calls.ts'
import { ClaudePlanCalls } from '../../../src/infrastructure/claude-plan-calls.ts'
import { ClaudeRunCalls } from '../../../src/infrastructure/claude-run-calls.ts'
import { ClaudeRunMeasurements } from '../../../src/infrastructure/claude-run-measurements.ts'
import { CtRunMachine } from '../../../src/infrastructure/ct-run-machine.ts'
import { DiskAgentMeasurements } from '../../../src/infrastructure/disk-agent-measurements.ts'
import { DiskPlanRecords } from '../../../src/infrastructure/disk-plan-records.ts'
import { HeadlessFiles } from '../../../src/infrastructure/headless-files.ts'
import { MeasuredAgentCalls } from '../../../src/infrastructure/measured-agent-calls.ts'
import { PlanAgentBrief } from '../../../src/infrastructure/plan-agent-brief.ts'
import { RunJournal } from '../../../src/infrastructure/run-journal.ts'
import { RunPlanAgents, SilentChangeAnnouncements } from '../../../src/infrastructure/run-plan-agents.ts'
import { ToolRunner } from '../../../src/infrastructure/tool-runner.ts'
import { CompletedRunDelivery } from '../../run-delivery-double.ts'
import { InProcessWorkers } from './in-process-workers.ts'
import { ScriptedClaude } from './scripted-claude.ts'
import { Capture, ScriptedConversation } from './scripted-conversation.ts'
import { ScriptedOracle, type ScriptedStep } from './scripted-oracle.ts'

class QuietEscalations extends SliceEscalations {
  static reader(): ReadSliceEscalation {
    return new ReadSliceEscalation({ escalations: new QuietEscalations() })
  }

  override async of(): Promise<SliceEscalation> {
    return SliceEscalation.none()
  }

  override async lift(): Promise<void> {
    return undefined
  }
}

class RecordingPublication extends PlanPublication {
  readonly published: PlanWatch[]

  constructor(published: PlanWatch[]) {
    super()
    this.published = published
  }

  override async publish(watch: PlanWatch): Promise<void> {
    this.published.push(watch)
  }
}

class Identities {
  #next = 1

  next(): string {
    const suffix = String(this.#next++).padStart(12, '0')
    return `33333333-3333-4333-8333-${suffix}`
  }
}

export class InProcessRun {
  static readonly ISSUE = 7
  static readonly REPOSITORY = 'acme/widget'
  static readonly PLAN = 'docs/superpowers/plans/2026-09-17-issue-7-driver.md'
  static readonly #WORKER = 'headless-call-worker.ts'
  static readonly #HERE = dirname(fileURLToPath(import.meta.url))
  static readonly #ROOT = join(InProcessRun.#HERE, '..', '..', '..', '..')
  static readonly #PLUGIN = join(InProcessRun.#ROOT, 'plugin')
  static readonly #CT_STEP = join(InProcessRun.#PLUGIN, 'scripts', 'ct-step.mjs')
  static readonly #DISPATCH_CHECK = join(InProcessRun.#PLUGIN, 'scripts', 'dispatch-check.mjs')

  readonly checkout: string
  readonly state: string
  readonly oracle: ScriptedOracle
  readonly claude: ScriptedClaude
  readonly workers: InProcessWorkers
  readonly delivery: CompletedRunDelivery
  readonly published: PlanWatch[]
  readonly #base: string
  readonly #identities: Identities
  readonly #files: HeadlessFiles
  readonly #journal: RunJournal
  readonly #machine: CtRunMachine

  private constructor(asked: {
    base: string,
    checkout: string,
    state: string,
    oracle: ScriptedOracle,
    claude: ScriptedClaude,
    workers: InProcessWorkers,
    delivery: CompletedRunDelivery,
    published: PlanWatch[],
    identities: Identities,
    files: HeadlessFiles,
    journal: RunJournal,
    machine: CtRunMachine,
  }) {
    this.#base = asked.base
    this.checkout = asked.checkout
    this.state = asked.state
    this.oracle = asked.oracle
    this.claude = asked.claude
    this.workers = asked.workers
    this.delivery = asked.delivery
    this.published = asked.published
    this.#identities = asked.identities
    this.#files = asked.files
    this.#journal = asked.journal
    this.#machine = asked.machine
  }

  static async create(steps: readonly ScriptedStep[]): Promise<InProcessRun> {
    const base = await fs.realpath(await mkdtemp(join(tmpdir(), 'ct-in-process-run-')))
    const checkout = join(base, 'checkout')
    const state = join(base, 'state')
    await mkdir(checkout, { recursive: true })
    await mkdir(state, { recursive: true })
    await mkdir(join(checkout, '.agent'), { recursive: true })
    await mkdir(dirname(join(checkout, InProcessRun.PLAN)), { recursive: true })

    const planText = Capture.read('git', 'show-plan').stdout
    await writeFile(join(checkout, 'AGENTS.md'), '# Fixture rules\n')
    await writeFile(join(checkout, 'work.txt'), 'fixture baseline\n')
    await writeFile(join(checkout, InProcessRun.PLAN), planText)
    await writeFile(join(checkout, '.agent', 'SLICE.md'), renderState({
      meta: { issue: InProcessRun.ISSUE, base: 'main', senal: 'fixture', e2e: [] },
      body: '# Fixture slice',
    }))

    const identities = new Identities()
    const files = new HeadlessFiles({ root: state, fs, newId: () => identities.next() })
    const claude = new ScriptedClaude(Capture.read('claude', 'result-success'))
    const workers = new InProcessWorkers({ files, claude, worker: InProcessRun.#WORKER })
    const journal = new RunJournal({
      files,
      newId: () => identities.next(),
      now: () => { throw new Error('the journal clock is not asked') },
    })
    const git = new ToolRunner({
      bin: 'git',
      budgetMs: 30_000,
      processes: new ScriptedConversation()
        .answering(
          { binary: 'git', argv: ['-C', checkout, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/superpowers/plans'] },
          Capture.read('git', 'ls-tree-plans'),
        )
        .answering(
          { binary: 'git', argv: ['-C', checkout, 'show', `HEAD:${InProcessRun.PLAN}`] },
          Capture.read('git', 'show-plan'),
        ),
      signal: () => {},
    })
    const oracle = new ScriptedOracle({
      checkout,
      plan: InProcessRun.PLAN,
      issue: InProcessRun.ISSUE,
      pluginRoot: InProcessRun.#PLUGIN,
      dispatchCheck: InProcessRun.#DISPATCH_CHECK,
      steps,
    })
    const machine = new CtRunMachine({
      journal,
      node: oracle.run,
      git: git.runWholeOutput.bind(git),
      read: async (path) => readFile(path, 'utf8').catch((cause: unknown) => {
        if (InProcessRun.#hasCode(cause, 'ENOENT')) return null
        throw cause
      }),
      ctStep: InProcessRun.#CT_STEP,
      dispatchCheck: InProcessRun.#DISPATCH_CHECK,
      pluginRoot: InProcessRun.#PLUGIN,
    })

    return new InProcessRun({
      base, checkout, state, oracle, claude, workers,
      delivery: new CompletedRunDelivery(), published: [],
      identities, files, journal, machine,
    })
  }

  agents(): RunPlanAgents {
    const transport = new MeasuredAgentCalls({
      executor: new ClaudeCalls({
        files: this.#files,
        binary: '/usr/local/bin/claude',
        worker: InProcessRun.#WORKER,
        spawn: this.workers.launch.bind(this.workers),
        env: {},
        newId: () => this.#identities.next(),
        now: () => new Date().toISOString(),
        budgetMs: 60_000,
        killGraceMs: 5_000,
        acceptanceMs: 5_000,
        pollMs: 10,
        sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
      }),
      reader: new ClaudeRunMeasurements({ files: this.#files }),
      store: new DiskAgentMeasurements({ files: this.#files }),
    })
    const records = new DiskPlanRecords({
      files: this.#files,
      newId: () => this.#identities.next(),
      now: () => new Date().toISOString(),
      exists: async (path) => existsSync(path),
    })
    const planCalls = new ClaudePlanCalls({
      calls: transport,
      brief: new PlanAgentBrief({
        dispatchCheck: InProcessRun.#DISPATCH_CHECK,
        conventions: join(InProcessRun.#PLUGIN, 'conventions'),
        ctStep: InProcessRun.#CT_STEP,
      }),
      pluginRoot: InProcessRun.#PLUGIN,
      resumable: async () => true,
      records,
      nowMs: Date.now,
    })
    const runCalls = new ClaudeRunCalls({
      calls: transport,
      machine: this.#machine,
      files: this.#files,
      pluginRoot: InProcessRun.#PLUGIN,
    })
    const driver = new DriveRun({
      calls: planCalls,
      publication: new RecordingPublication(this.published),
      machine: this.#machine,
      delivery: this.delivery,
      step: new ExecuteRunInstruction({ machine: this.#machine, calls: runCalls }),
      messages: new DeliverHeldMessages({
        messages: this.#journal,
        calls: planCalls,
        escalations: new QuietEscalations(),
      }),
      escalations: QuietEscalations.reader(),
    })
    return new RunPlanAgents({
      legacy: new PlanAgents(),
      records,
      calls: planCalls,
      transport,
      driver,
      machine: this.#machine,
      journal: this.#journal,
      delivery: this.delivery,
      announcements: new SilentChangeAnnouncements(),
      newId: () => this.#identities.next(),
      nowMs: Date.now,
      stderr: (line) => { throw new Error(line) },
    })
  }

  async remove(): Promise<void> {
    await this.workers.settled()
    await rm(this.#base, { recursive: true, force: true })
  }

  static #hasCode(cause: unknown, code: string): boolean {
    return cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === code
  }
}

export type { ScriptedStep }
