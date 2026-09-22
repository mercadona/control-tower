import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { STEPS } from '../../../plugin/scripts/run-machine.js'
import {
  AnnouncedInput, AnnouncedResponse, INPUT_KINDS, INPUT_ROLES, StepAnnouncement,
} from '../../../plugin/scripts/step-announcement.js'
import { RunNotUnderstood } from '../../src/domain/exceptions.ts'
import { RunEstablishment } from '../../src/domain/ports/run-machine.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { RunInstruction } from '../../src/domain/value-objects/run-instruction.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { CtRunMachine } from '../../src/infrastructure/ct-run-machine.ts'
import { HeadlessFiles } from '../../src/infrastructure/headless-files.ts'
import { AnnouncedStep } from '../../src/infrastructure/run-announcement.ts'
import { RunJournal } from '../../src/infrastructure/run-journal.ts'
import { ProcessOutput, type ToolRunner } from '../../src/infrastructure/tool-runner.ts'

type AskedCommand = Readonly<{ argv: readonly string[], cwd: string | null }>

class OracleMother {
  static readonly CONVERSATION = '11111111-1111-4111-8111-111111111111'
  static readonly TICKETS = [
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
  ] as const
  static readonly WORKTREE = '/repo/.worktrees/332'
  static readonly PLAN = 'docs/superpowers/plans/2026-09-17-issue-332-machine.md'
  static readonly PLAN_TEXT = '# Issue 332 machine plan\n'
  static readonly PLAN_SHA = createHash('sha256').update(OracleMother.PLAN_TEXT).digest('hex')
  static readonly CT_STEP = '/plugin/scripts/ct-step.mjs'
  static readonly DISPATCH_CHECK = '/plugin/scripts/dispatch-check.mjs'
  static readonly RUN_PATH = join(OracleMother.WORKTREE, '.agent', 'run-332.json')
  static readonly RUN_BYTES = '{"step":"controls","task":1}\n'
  static readonly FOREIGN_PATH = '/etc/hosts'

  static watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({
        number: 332,
        url: 'https://github.com/mercadona/control-tower-plugin/issues/332',
      }),
      located: new WorkspaceLocation({ root: '/repo', path: OracleMother.WORKTREE, branch: 'feat/332' }),
      repository: new RepositoryName('mercadona/control-tower-plugin'),
      agent: OracleMother.CONVERSATION,
    })
  }

  static manifest(): string {
    return `${JSON.stringify({
      version: 1,
      conversation: OracleMother.CONVERSATION,
      repository: 'mercadona/control-tower-plugin',
      issue: 332,
      plan: OracleMother.PLAN,
      initialPlanSha256: OracleMother.PLAN_SHA,
    })}\n`
  }

  static request(previous: string | null, argv: readonly string[]): string {
    return `${JSON.stringify({
      version: 1,
      previous,
      argv,
      cwd: OracleMother.WORKTREE,
      planSha256: OracleMother.PLAN_SHA,
    })}\n`
  }

  static receipt(output: ProcessOutput, beforeRun: string | null, afterRun: string | null): string {
    return `${JSON.stringify({
      version: 1,
      code: output.code,
      stdout: output.stdout,
      stderr: output.stderr,
      beforeRun,
      afterRun,
    })}\n`
  }

  static nextArgv(): readonly string[] {
    return [
      OracleMother.CT_STEP, 'next', '--plan', OracleMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
  }

  static controlsArgv(): readonly string[] {
    return [
      OracleMother.CT_STEP, 'controls', '--plan', OracleMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
  }

  static reopenArgv(instruction: string): readonly string[] {
    return [
      OracleMother.CT_STEP, 'reopen', '--plan', OracleMother.PLAN, '--issue', '332',
      '--instruction', instruction, '--output-format', 'json',
    ]
  }

  static consumingControlsArgv(): readonly string[] {
    return ['controls', '--plan', OracleMother.PLAN, '--issue', '332']
  }

  static reportArgv(): readonly string[] {
    return [
      OracleMother.CT_STEP, 'report', `${OracleMother.WORKTREE}/.agent/run-332/task-1-report.json`,
      '--plan', OracleMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
  }

  static reconcileArgv(): readonly string[] {
    return [
      OracleMother.CT_STEP, 'reconcile', '--plan', OracleMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ]
  }

  static planListArgv(): readonly string[] {
    return [
      '-C', OracleMother.WORKTREE, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'docs/superpowers/plans',
    ]
  }

  static planShowArgv(): readonly string[] {
    return ['-C', OracleMother.WORKTREE, 'show', `HEAD:${OracleMother.PLAN}`]
  }

  static planCheckArgv(): readonly string[] {
    return [
      OracleMother.DISPATCH_CHECK, '332', '--repo', 'mercadona/control-tower-plugin', '--check-plan',
    ]
  }

  static controlsAnnouncementJson(): string {
    return StepAnnouncement.program({
      issue: 332,
      task: 1,
      tasksTotal: 3,
      step: STEPS.CONTROLS,
      attempt: 1,
      commands: ['npm run lint', 'npm test'],
      consuming: { argv: OracleMother.consumingControlsArgv() },
    }).text()
  }

  static controlsRoundNamingAnotherPlanJson(): string {
    return StepAnnouncement.program({
      issue: 332,
      task: 1,
      tasksTotal: 3,
      step: STEPS.CONTROLS,
      attempt: 1,
      commands: ['npm run lint', 'npm test'],
      consuming: {
        argv: ['controls', '--plan', 'docs/superpowers/plans/2026-09-17-issue-332-driver.md', '--issue', '332'],
      },
    }).text()
  }

  static openTransition(): string {
    return '{"version":1,"kind":"transition","state":"open","outcome":"done","exit":0,'
      + '"run":{"issue":332,"task":1,"tasksTotal":3,"step":"implement","discards":0}}\n'
  }

  static deliveredTransition(): string {
    return '{"version":1,"kind":"transition","state":"delivered","outcome":"done","exit":0,'
      + '"run":{"issue":332,"task":3,"tasksTotal":3,"step":"slice-judge","discards":0}}\n'
  }

  static controlsRefusal(): string {
    return '{"version":1,"kind":"refusal","state":"blocked-controls","outcome":"failed","exit":4,'
      + '"run":{"issue":332,"task":1,"tasksTotal":3,"step":"controls","discards":0},'
      + '"detail":"run blocked-controls: task 1/3, 0 discard(s)"}\n'
  }

  static implementReportPath(): string {
    return `${OracleMother.WORKTREE}/.agent/run-332/task-1-report.json`
  }

  static implementAnnouncement(): string {
    return OracleMother.#implementRound(
      AnnouncedResponse.of(STEPS.IMPLEMENT, OracleMother.implementReportPath()),
      ['report', OracleMother.implementReportPath(), '--plan', OracleMother.PLAN, '--issue', '332'],
    )
  }

  static implementRoundAnnouncingTheJudgeVerbJson(): string {
    return OracleMother.#implementRound(
      AnnouncedResponse.of(STEPS.IMPLEMENT, OracleMother.implementReportPath()),
      ['verdict', OracleMother.implementReportPath(), '--plan', OracleMother.PLAN, '--issue', '332'],
    )
  }

  static judgeVerdictPath(): string {
    return `${OracleMother.WORKTREE}/.agent/run-332/task-1-verdict.json`
  }

  static judgeRoundJson(): string {
    return OracleMother.#judgeRound(OracleMother.#verdictArgv())
  }

  static judgeRoundNamingAnotherResponsePathJson(): string {
    return OracleMother.#judgeRound([
      'verdict', `${OracleMother.WORKTREE}/.agent/run-332/task-2-verdict.json`,
      '--plan', OracleMother.PLAN, '--issue', '332',
    ])
  }

  static judgeRoundCarryingAnUndeclaredPlanRoleJson(): string {
    return OracleMother.#judgeRound(OracleMother.#verdictArgv(), [
      ...OracleMother.#judgeInputs(),
      new AnnouncedInput({
        role: INPUT_ROLES.PLAN,
        kind: INPUT_KINDS.LITERAL,
        path: OracleMother.FOREIGN_PATH,
      }),
    ])
  }

  static judgeRoundCarryingTheBriefTwiceJson(): string {
    return OracleMother.#judgeRound(OracleMother.#verdictArgv(), [
      ...OracleMother.#judgeInputs(),
      new AnnouncedInput({
        role: INPUT_ROLES.BRIEF,
        kind: INPUT_KINDS.LITERAL,
        path: OracleMother.FOREIGN_PATH,
      }),
    ])
  }

  static #verdictArgv(): readonly string[] {
    return ['verdict', OracleMother.judgeVerdictPath(), '--plan', OracleMother.PLAN, '--issue', '332']
  }

  static judgeRoundAnnouncingNoInputJson(): string {
    return StepAnnouncement.dispatch({
      issue: 332,
      task: 1,
      tasksTotal: 3,
      step: STEPS.JUDGE,
      attempt: 1,
      agent: 'ct-judge',
      inputs: [],
      response: AnnouncedResponse.of(STEPS.JUDGE, OracleMother.judgeVerdictPath()),
      consuming: {
        argv: ['verdict', OracleMother.judgeVerdictPath(), '--plan', OracleMother.PLAN, '--issue', '332'],
      },
    }).text()
  }

  static #judgeInputs(): readonly AnnouncedInput[] {
    return [
      new AnnouncedInput({
        role: INPUT_ROLES.PACKAGE,
        kind: INPUT_KINDS.LITERAL,
        path: `${OracleMother.WORKTREE}/.agent/run-332/task-1-review.diff`,
      }),
      new AnnouncedInput({
        role: INPUT_ROLES.BRIEF,
        kind: INPUT_KINDS.LITERAL,
        path: `${OracleMother.WORKTREE}/.agent/run-332/task-1-judge-brief.md`,
      }),
    ]
  }

  static #judgeRound(
    argv: readonly string[],
    inputs: readonly AnnouncedInput[] = OracleMother.#judgeInputs(),
  ): string {
    return StepAnnouncement.dispatch({
      issue: 332,
      task: 1,
      tasksTotal: 3,
      step: STEPS.JUDGE,
      attempt: 1,
      agent: 'ct-judge',
      inputs,
      response: AnnouncedResponse.of(STEPS.JUDGE, OracleMother.judgeVerdictPath()),
      consuming: { argv },
    }).text()
  }

  static implementRoundOfAForeignResponseKindJson(): string {
    return OracleMother.#implementRound(
      new AnnouncedResponse({ kind: 'file', path: OracleMother.implementReportPath() }),
      ['report', OracleMother.implementReportPath(), '--plan', OracleMother.PLAN, '--issue', '332'],
    )
  }

  static #implementRound(response: AnnouncedResponse, argv: readonly string[]): string {
    return StepAnnouncement.dispatch({
      issue: 332,
      task: 1,
      tasksTotal: 3,
      step: STEPS.IMPLEMENT,
      attempt: 1,
      agent: undefined,
      inputs: [
        new AnnouncedInput({
          role: INPUT_ROLES.RUBRIC,
          kind: INPUT_KINDS.LITERAL,
          path: '/plugin/prompts/task-implementer.md',
        }),
        new AnnouncedInput({
          role: INPUT_ROLES.BRIEF,
          kind: INPUT_KINDS.LITERAL,
          path: `${OracleMother.WORKTREE}/.agent/run-332/task-1-brief.md`,
        }),
      ],
      response,
      consuming: { argv },
    }).text()
  }

  static sliceVerdictPath(): string {
    return `${OracleMother.WORKTREE}/.agent/run-332/slice-verdict.json`
  }

  static sliceJudgeAnnouncement(): string {
    return OracleMother.#sliceJudgeRound([
      'slice-verdict', OracleMother.sliceVerdictPath(), '--plan', OracleMother.PLAN, '--issue', '332',
    ])
  }

  static sliceJudgeRoundAnnouncingTheJudgeVerbJson(): string {
    return OracleMother.#sliceJudgeRound([
      'verdict', OracleMother.sliceVerdictPath(), '--plan', OracleMother.PLAN, '--issue', '332',
    ])
  }

  static sliceJudgeRoundNamingAnotherIssueJson(): string {
    return OracleMother.#sliceJudgeRound([
      'slice-verdict', OracleMother.sliceVerdictPath(), '--plan', OracleMother.PLAN, '--issue', '331',
    ])
  }

  static #sliceJudgeRound(argv: readonly string[]): string {
    return StepAnnouncement.dispatch({
      issue: 332,
      task: 3,
      tasksTotal: 3,
      step: STEPS.SLICE_JUDGE,
      attempt: 2,
      agent: 'ct-slice-judge',
      inputs: [
        new AnnouncedInput({
          role: INPUT_ROLES.PACKAGE,
          kind: INPUT_KINDS.LITERAL,
          path: `${OracleMother.WORKTREE}/.agent/slice-review-332.md`,
        }),
        new AnnouncedInput({
          role: INPUT_ROLES.PLAN,
          kind: INPUT_KINDS.LITERAL,
          path: OracleMother.PLAN,
        }),
        new AnnouncedInput({
          role: INPUT_ROLES.VERDICTS,
          kind: INPUT_KINDS.GLOB,
          path: 'docs/superpowers/verdicts/issue-332-task-*.json',
        }),
      ],
      response: AnnouncedResponse.of(STEPS.SLICE_JUDGE, OracleMother.sliceVerdictPath()),
      consuming: { argv },
    }).text()
  }

  static reconcileAnnouncement(): string {
    return StepAnnouncement.program({
      issue: 332,
      task: 3,
      tasksTotal: 3,
      step: STEPS.RECONCILE,
      attempt: 1,
      commands: [],
      consuming: { argv: ['reconcile', '--plan', OracleMother.PLAN, '--issue', '332'] },
    }).text()
  }

  static reconcilerRoundJson(): string {
    return OracleMother.#reconcilerRound(['reconcile', '--plan', OracleMother.PLAN, '--issue', '332'])
  }

  static foreignVerbRoundJson(): string {
    return OracleMother.#reconcilerRound(['commit', '--plan', OracleMother.PLAN, '--issue', '332'])
  }

  static reconcilerRoundNamingAnotherIssueJson(): string {
    return OracleMother.#reconcilerRound(['reconcile', '--plan', OracleMother.PLAN, '--issue', '331'])
  }

  static reconcilerRoundNamingAnotherPlanJson(): string {
    return OracleMother.#reconcilerRound([
      'reconcile', '--plan', 'docs/superpowers/plans/2026-09-17-issue-332-driver.md', '--issue', '332',
    ])
  }

  static #reconcilerRound(argv: readonly string[]): string {
    return StepAnnouncement.dispatch({
      issue: 332,
      task: 3,
      tasksTotal: 3,
      step: STEPS.RECONCILE,
      attempt: 1,
      agent: undefined,
      inputs: [new AnnouncedInput({
        role: INPUT_ROLES.RECONCILIATION_PACKAGE,
        kind: INPUT_KINDS.LITERAL,
        path: `${OracleMother.WORKTREE}/.agent/run-332/reconcile-package-1.md`,
      })],
      response: AnnouncedResponse.of(STEPS.RECONCILE, null),
      consuming: { argv },
    }).text()
  }

  static reconcileRefusal(): string {
    return '{"version":1,"kind":"refusal","state":"blocked-reconcile","outcome":"failed","exit":13,'
      + '"run":{"issue":332,"task":3,"tasksTotal":3,"step":"reconcile","discards":0},'
      + '"detail":"run blocked-reconcile: task 3/3, 0 discard(s)"}\n'
  }

  static discardRefusal(): string {
    return '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"discarded","exit":3,'
      + '"run":{"issue":332,"task":1,"tasksTotal":3,"step":"implement","discards":6},'
      + '"detail":"6 discards in this run: it stops instead of going on asking for answers that cannot be read"}\n'
  }

  static judgeRefusal(): string {
    return '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,'
      + '"run":{"issue":332,"task":1,"tasksTotal":3,"step":"judge","discards":0},'
      + '"detail":"run blocked-judge: task 1/3, 0 discard(s)"}\n'
  }

  static output(code: number, stdout: string, stderr = ''): ProcessOutput {
    return new ProcessOutput({ code, stdout, stderr })
  }
}

class OracleFixture {
  readonly root: string
  readonly journal: RunJournal
  readonly asked: AskedCommand[]
  readonly gitAsked: AskedCommand[]
  readonly ids: string[]
  readonly answers: Map<string, () => Promise<ProcessOutput>>
  readonly gitAnswers: Map<string, () => Promise<ProcessOutput>>
  runBytes: string | null

  constructor(root: string) {
    this.root = root
    this.asked = []
    this.gitAsked = []
    this.ids = [...OracleMother.TICKETS]
    this.answers = new Map()
    this.gitAnswers = new Map()
    this.runBytes = OracleMother.RUN_BYTES
    this.journal = new RunJournal({
      files: new HeadlessFiles({ root, fs, newId: () => 'temporary-record' }),
      newId: () => {
        const id = this.ids.shift()
        if (id === undefined) throw new Error('no journal identity was arranged')
        return id
      },
      now: () => { throw new Error('the journal clock is not asked') },
    })
  }

  answerGit(
    argv: readonly string[],
    answer: ProcessOutput | (() => Promise<ProcessOutput> | ProcessOutput),
  ): void {
    this.gitAnswers.set(JSON.stringify(argv), async () => typeof answer === 'function' ? answer() : answer)
  }

  async establish(): Promise<void> {
    await this.journal.establish(OracleMother.watch(), OracleMother.manifest())
  }

  answer(
    argv: readonly string[],
    answer: ProcessOutput | (() => Promise<ProcessOutput> | ProcessOutput),
  ): void {
    this.answers.set(JSON.stringify(argv), async () => typeof answer === 'function' ? answer() : answer)
  }

  readonly node: ToolRunner['runWholeOutput'] = async (argv, options = {}) => {
    this.asked.push({ argv: [...argv], cwd: options.cwd ?? null })
    const answer = this.answers.get(JSON.stringify(argv))
    if (answer === undefined) throw new Error(`unlisted node request: ${JSON.stringify(argv)}`)
    return answer()
  }

  readonly git: ToolRunner['runWholeOutput'] = async (argv, options = {}) => {
    this.gitAsked.push({ argv: [...argv], cwd: options.cwd ?? null })
    const answer = this.gitAnswers.get(JSON.stringify(argv))
    if (answer === undefined) throw new Error(`unlisted git request: ${JSON.stringify(argv)}`)
    return answer()
  }

  readonly read = async (path: string): Promise<string | null> => {
    if (path === OracleMother.RUN_PATH) return this.runBytes
    if (path === join(OracleMother.WORKTREE, OracleMother.PLAN)) return OracleMother.PLAN_TEXT
    throw new Error(`unlisted read: ${JSON.stringify(path)}`)
  }

  machine(overrides: Partial<{
    node: ToolRunner['runWholeOutput'],
    git: ToolRunner['runWholeOutput'],
    read: (path: string) => Promise<string | null>,
  }> = {}): CtRunMachine {
    return new CtRunMachine({
      journal: this.journal,
      node: overrides.node ?? this.node,
      git: overrides.git ?? this.git,
      read: overrides.read ?? this.read,
      ctStep: OracleMother.CT_STEP,
      dispatchCheck: OracleMother.DISPATCH_CHECK,
      pluginRoot: '/plugin',
    })
  }

  operation(ticket: string, name: 'request.json' | 'receipt.json'): string {
    return join(this.root, 'harness', OracleMother.CONVERSATION, 'run', 'operations', ticket, name)
  }
}

describe('CtRunMachine', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('a transition that leaves the run open asks for the next step', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-open-')))
    roots.push(fixture.root)
    await fixture.establish()
    const asked = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), asked,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES,
      ),
    )
    const measured = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(asked, OracleMother.controlsArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), measured,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.openTransition()), OracleMother.RUN_BYTES, OracleMother.RUN_BYTES,
      ),
    )
    const dispatched = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(measured, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), dispatched,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.implementAnnouncement()), OracleMother.RUN_BYTES, OracleMother.RUN_BYTES,
      ),
    )
    const machine = fixture.machine()

    const instruction = await machine.advance(
      OracleMother.watch(), new RunInstruction({ kind: 'command', ticket: asked }),
    )

    expect(instruction).toEqual(new RunInstruction({ kind: 'call', ticket: dispatched }))
    expect(fixture.asked).toEqual([])
  })

  it('a transition of delivered closes the run', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-delivered-transition-')))
    roots.push(fixture.root)
    await fixture.establish()
    const asked = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), asked,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES,
      ),
    )
    fixture.answer(OracleMother.controlsArgv(), OracleMother.output(0, OracleMother.deliveredTransition()))
    const machine = fixture.machine()

    const closed = await machine.advance(OracleMother.watch(), await machine.open(OracleMother.watch()))

    expect(closed.work).toEqual({ kind: 'delivered' })
    expect((await machine.inspect(OracleMother.watch())).fact).toEqual({ kind: 'delivered' })
    expect(fixture.asked).toEqual([{ argv: OracleMother.controlsArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('a refusal reaches the instruction as its own diagnostic', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-refusal-')))
    roots.push(fixture.root)
    await fixture.establish()
    const asked = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), asked,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES,
      ),
    )
    fixture.answer(OracleMother.controlsArgv(), OracleMother.output(
      4, OracleMother.controlsRefusal(), 'npm run lint exited 1\n',
    ))
    const machine = fixture.machine()

    const refused = await machine.advance(OracleMother.watch(), await machine.open(OracleMother.watch()))

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: 'ct-step refused: the run is blocked-controls with outcome failed (exit 4)'
        + ' — run blocked-controls: task 1/3, 0 discard(s)',
      closure: { state: 'blocked-controls', outcome: 'failed', exit: 4, task: 1, findings: null, verdict: null },
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.controlsArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('an announced refusal carries its state outcome and exit to the inspection', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-classified-')))
    roots.push(fixture.root)
    await fixture.establish()
    const dispatched = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), dispatched,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.implementAnnouncement()), null, OracleMother.RUN_BYTES,
      ),
    )
    const consumed = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(dispatched, OracleMother.reportArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), consumed,
      OracleMother.receipt(
        OracleMother.output(3, OracleMother.discardRefusal()), OracleMother.RUN_BYTES, OracleMother.RUN_BYTES,
      ),
    )

    const inspection = await fixture.machine().inspect(OracleMother.watch())

    expect(inspection.fact).toEqual({
      kind: 'uncertain',
      detail: 'ct-step refused: the run is blocked-judge with outcome discarded (exit 3)'
        + ' — 6 discards in this run: it stops instead of going on asking for answers that cannot be read',
      closure: { state: 'blocked-judge', outcome: 'discarded', exit: 3, task: 1, findings: null, verdict: null },
    })
    expect(fixture.asked).toEqual([])
  })

  it('a refusal with no announcement carries a null closure', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-unclassified-')))
    roots.push(fixture.root)
    await fixture.establish()
    const asked = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), asked,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES,
      ),
    )
    const measured = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(asked, OracleMother.controlsArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), measured,
      OracleMother.receipt(
        OracleMother.output(4, 'controls: 2 of 3 commands failed\n', 'npm run lint exited 1\n'),
        OracleMother.RUN_BYTES,
        OracleMother.RUN_BYTES,
      ),
    )

    const inspection = await fixture.machine().inspect(OracleMother.watch())

    expect(inspection.fact).toEqual({
      kind: 'uncertain',
      detail: 'ct-step exited 4 without announcing a run state;'
        + ' stdout: "controls: 2 of 3 commands failed\\n"; stderr: "npm run lint exited 1\\n"',
      closure: null,
    })
    expect(fixture.asked).toEqual([])
  })

  it('a non-zero exit with no announcement says so', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-unannounced-')))
    roots.push(fixture.root)
    await fixture.establish()
    const asked = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), asked,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES,
      ),
    )
    const measured = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(asked, OracleMother.controlsArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), measured,
      OracleMother.receipt(
        OracleMother.output(4, 'controls: 2 of 3 commands failed\n', 'npm run lint exited 1\n'),
        OracleMother.RUN_BYTES,
        OracleMother.RUN_BYTES,
      ),
    )

    const instruction = await fixture.machine().open(OracleMother.watch())

    expect(instruction.work).toEqual({
      kind: 'refused',
      detail: 'ct-step exited 4 without announcing a run state;'
        + ' stdout: "controls: 2 of 3 commands failed\\n"; stderr: "npm run lint exited 1\\n"',
      closure: null,
    })
    expect(fixture.asked).toEqual([])
  })

  it('the consuming argv asks for the announcement', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-flagged-argv-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.controlsAnnouncementJson())
    })
    fixture.answer(OracleMother.controlsArgv(), OracleMother.output(0, OracleMother.deliveredTransition()))
    const machine = fixture.machine()

    await machine.advance(OracleMother.watch(), await machine.open(OracleMother.watch()))

    expect(fixture.asked).toEqual([
      {
        argv: [
          OracleMother.CT_STEP, 'next', '--plan', OracleMother.PLAN, '--issue', '332',
          '--output-format', 'json',
        ],
        cwd: OracleMother.WORKTREE,
      },
      {
        argv: [
          OracleMother.CT_STEP, 'controls', '--plan', OracleMother.PLAN, '--issue', '332',
          '--output-format', 'json',
        ],
        cwd: OracleMother.WORKTREE,
      },
    ])
    expect(await readFile(fixture.operation(OracleMother.TICKETS[1], 'request.json'), 'utf8')).toBe(
      OracleMother.request(OracleMother.TICKETS[0], [
        OracleMother.CT_STEP, 'controls', '--plan', OracleMother.PLAN, '--issue', '332',
        '--output-format', 'json',
      ]),
    )
  })

  it('the machine asks the next verb with the output format of the contract', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-next-format-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.controlsAnnouncementJson())
    })
    fixture.answer(OracleMother.controlsArgv(), OracleMother.output(0, OracleMother.deliveredTransition()))
    const machine = fixture.machine()

    await machine.advance(OracleMother.watch(), await machine.open(OracleMother.watch()))

    expect(fixture.asked[0].argv).toEqual([
      OracleMother.CT_STEP, 'next', '--plan', OracleMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ])
    expect(fixture.asked[1].argv).toEqual([
      OracleMother.CT_STEP, 'controls', '--plan', OracleMother.PLAN, '--issue', '332',
      '--output-format', 'json',
    ])
  })

  it('oracle exit nine survives the adapter unchanged', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-nine-')))
    roots.push(fixture.root)
    await fixture.establish()
    const announced = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), announced,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()),
        null,
        OracleMother.RUN_BYTES,
      ),
    )
    fixture.runBytes = '{"step":"implement","task":1,"tasksTotal":3}\n'
    fixture.answer(OracleMother.controlsArgv(), OracleMother.output(
      9,
      '',
      '"controls" is not the step that is due: the run is at "implement" (task 1/3). Ask with "ct-step next".\n',
    ))
    const machine = fixture.machine()
    const instruction = await machine.open(OracleMother.watch())

    const refusal = await machine.advance(OracleMother.watch(), instruction)

    expect(refusal.work).toEqual({
      kind: 'refused',
      detail: 'ct-step exited 9 without announcing a run state; stdout: ""; stderr: "\\\"controls\\\" is not the step that is due: the run is at \\"implement\\" (task 1/3). Ask with \\"ct-step next\\".\\n"',
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.controlsArgv(), cwd: OracleMother.WORKTREE }])
    const entries = await fixture.journal.entries(OracleMother.watch())
    expect(entries).toHaveLength(2)
    expect(JSON.parse(entries[1].receipt.kind === 'present' ? entries[1].receipt.text : '{}')).toEqual({
      version: 1,
      code: 9,
      stdout: '',
      stderr: '"controls" is not the step that is due: the run is at "implement" (task 1/3). Ask with "ct-step next".\n',
      beforeRun: fixture.runBytes,
      afterRun: fixture.runBytes,
    })
  })

  it('a command request precedes execution and its receipt precedes the next effect', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-order-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.controlsAnnouncementJson())
    })
    const machine = fixture.machine()
    const first = await machine.open(OracleMother.watch())
    expect(first).toEqual(new RunInstruction({ kind: 'command', ticket: OracleMother.TICKETS[0] }))
    fixture.answer(OracleMother.controlsArgv(), async () => {
      expect(await readFile(fixture.operation(OracleMother.TICKETS[1], 'request.json'), 'utf8')).toBe(
        OracleMother.request(OracleMother.TICKETS[0], OracleMother.controlsArgv()),
      )
      await expect(readFile(fixture.operation(OracleMother.TICKETS[1], 'receipt.json'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' })
      fixture.runBytes = '{"step":"implement","task":1}\n'
      return OracleMother.output(0, OracleMother.openTransition())
    })
    fixture.answer(OracleMother.nextArgv(), async () => {
      expect(await readFile(fixture.operation(OracleMother.TICKETS[1], 'receipt.json'), 'utf8')).toBe(
        OracleMother.receipt(
          OracleMother.output(0, OracleMother.openTransition()),
          OracleMother.RUN_BYTES,
          '{"step":"implement","task":1}\n',
        ),
      )
      return OracleMother.output(0, OracleMother.implementAnnouncement())
    })

    const next = await machine.advance(OracleMother.watch(), first)

    expect(next).toEqual(new RunInstruction({ kind: 'call', ticket: OracleMother.TICKETS[2] }))
    expect(fixture.asked).toEqual([
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.controlsArgv(), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
    ])

    const effects = fixture.asked.length
    expect(await machine.advance(OracleMother.watch(), first)).toEqual(next)
    expect(fixture.asked).toHaveLength(effects)
  })

  it('the announced controls step hands over the argv it published', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-announced-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.controlsAnnouncementJson())
    })
    const machine = fixture.machine()
    const first = await machine.open(OracleMother.watch())
    expect(first).toEqual(new RunInstruction({ kind: 'command', ticket: OracleMother.TICKETS[0] }))
    fixture.answer(OracleMother.controlsArgv(), OracleMother.output(0, OracleMother.openTransition()))

    await machine.advance(OracleMother.watch(), first)

    expect(await readFile(fixture.operation(OracleMother.TICKETS[1], 'request.json'), 'utf8')).toBe(
      OracleMother.request(OracleMother.TICKETS[0], OracleMother.controlsArgv()),
    )
  })

  it('an announced step with no consuming argv is refused instead of run', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-announced-no-argv-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = StepAnnouncement.program({
      issue: 332,
      task: 1,
      tasksTotal: 3,
      step: STEPS.CONTROLS,
      attempt: 1,
      commands: ['npm run lint', 'npm test'],
      consuming: undefined,
    }).text()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })
    const machine = fixture.machine()

    const first = await machine.open(OracleMother.watch())

    expect(first.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('absent establishment defers plan gates until open after publication', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-absent-')))
    roots.push(fixture.root)
    fixture.runBytes = null
    const machine = fixture.machine()

    expect(await machine.establishment(OracleMother.watch())).toBe(RunEstablishment.ABSENT)
    expect(fixture.gitAsked).toEqual([])
    expect(fixture.asked).toEqual([])

    fixture.answerGit(OracleMother.planListArgv(), OracleMother.output(0, `${OracleMother.PLAN}\n`))
    fixture.answerGit(OracleMother.planShowArgv(), OracleMother.output(0, OracleMother.PLAN_TEXT))
    fixture.answer(OracleMother.planCheckArgv(), OracleMother.output(0, ''))
    fixture.answer(OracleMother.nextArgv(), OracleMother.output(0, OracleMother.implementAnnouncement()))

    expect(await machine.open(OracleMother.watch())).toEqual(
      new RunInstruction({ kind: 'call', ticket: OracleMother.TICKETS[0] }),
    )
    expect(fixture.gitAsked).toEqual([
      { argv: OracleMother.planListArgv(), cwd: null },
      { argv: OracleMother.planShowArgv(), cwd: null },
    ])
    expect(fixture.asked).toEqual([
      { argv: OracleMother.planCheckArgv(), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
    ])
    expect(await fixture.journal.manifest(OracleMother.watch())).toBe(OracleMother.manifest())
  })

  it('untouched establishment differs from unrecorded machine activity', async () => {
    const untouched = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-unstarted-')))
    roots.push(untouched.root)
    untouched.runBytes = null
    await untouched.establish()

    const inspection = await untouched.machine().inspect(OracleMother.watch())

    expect(inspection.fact).toEqual({ kind: 'unstarted' })
    expect(untouched.asked).toEqual([])
    expect(await untouched.journal.entries(OracleMother.watch())).toEqual([])

    const unexplained = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-unrecorded-')))
    roots.push(unexplained.root)
    await unexplained.establish()
    const uncertain = await unexplained.machine().inspect(OracleMother.watch())
    expect(uncertain.fact).toEqual({
      kind: 'uncertain',
      detail: 'the established run has unexplained plugin activity before its first command',
      closure: null,
    })
    await expect(unexplained.machine().open(OracleMother.watch())).rejects.toThrow(
      'the established run has unexplained plugin activity before its first command',
    )
    expect(unexplained.asked).toEqual([])

    const orphaned = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-orphaned-')))
    roots.push(orphaned.root)
    orphaned.runBytes = null
    await orphaned.journal.begin(OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()))
    await expect(orphaned.machine().inspect(OracleMother.watch())).rejects.toBeInstanceOf(RunNotUnderstood)
    expect(orphaned.asked).toEqual([])
  })

  it('unsupported slice-agent reconciliation refuses before another next', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-slice-agent-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.reconcileAnnouncement())
    })
    fixture.answer(OracleMother.reconcileArgv(), OracleMother.output(13, OracleMother.reconcileRefusal()))
    const machine = fixture.machine()
    const reconcile = await machine.open(OracleMother.watch())

    expect(await machine.advance(OracleMother.watch(), reconcile)).toEqual(new RunInstruction({
      kind: 'refused',
      detail: 'ct-step refused: the run is blocked-reconcile with outcome failed (exit 13)'
        + ' — run blocked-reconcile: task 3/3, 0 discard(s)',
      closure: { state: 'blocked-reconcile', outcome: 'failed', exit: 13, task: 3, findings: null, verdict: null },
    }))
    expect(fixture.asked).toEqual([
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.reconcileArgv(), cwd: OracleMother.WORKTREE },
    ])
  })

  it('the announced reconciler round answers with a call and not with a command', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-announced-reconciler-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.reconcileAnnouncement())
    })
    fixture.answer(OracleMother.reconcileArgv(), OracleMother.output(0, OracleMother.reconcilerRoundJson()))
    const machine = fixture.machine()
    const reconcile = await machine.open(OracleMother.watch())

    expect(await machine.advance(OracleMother.watch(), reconcile)).toEqual(
      new RunInstruction({ kind: 'call', ticket: OracleMother.TICKETS[1] }),
    )
    expect(fixture.asked).toEqual([
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.reconcileArgv(), cwd: OracleMother.WORKTREE },
    ])
  })

  it('the announced round publishes the reconcile argv and the edits channel', () => {
    const announced = AnnouncedStep.read(OracleMother.reconcilerRoundJson())

    expect(announced?.responseKind).toBe('edits')
    expect(announced?.argv).toEqual(['reconcile', '--plan', OracleMother.PLAN, '--issue', '332'])
  })

  it('an edits round whose first argument is a foreign verb is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-foreign-edits-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const foreign = OracleMother.foreignVerbRoundJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.reconcileAnnouncement())
    })
    fixture.answer(OracleMother.reconcileArgv(), OracleMother.output(0, foreign))
    const machine = fixture.machine()
    const reconcile = await machine.open(OracleMother.watch())

    expect(await machine.advance(OracleMother.watch(), reconcile)).toEqual(new RunInstruction({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(foreign)}`,
      closure: null,
    }))
  })

  it('an announced reconciler round that names another issue is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-reconciler-foreign-issue-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.reconcilerRoundNamingAnotherIssueJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.reconcileAnnouncement())
    })
    fixture.answer(OracleMother.reconcileArgv(), OracleMother.output(0, announced))
    const machine = fixture.machine()
    const reconcile = await machine.open(OracleMother.watch())

    expect(await machine.advance(OracleMother.watch(), reconcile)).toEqual(new RunInstruction({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    }))
    expect(fixture.asked).toEqual([
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.reconcileArgv(), cwd: OracleMother.WORKTREE },
    ])
  })

  it('an announced reconciler round that names another plan is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-reconciler-foreign-plan-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.reconcilerRoundNamingAnotherPlanJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.reconcileAnnouncement())
    })
    fixture.answer(OracleMother.reconcileArgv(), OracleMother.output(0, announced))
    const machine = fixture.machine()
    const reconcile = await machine.open(OracleMother.watch())

    expect(await machine.advance(OracleMother.watch(), reconcile)).toEqual(new RunInstruction({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    }))
    expect(fixture.asked).toEqual([
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.reconcileArgv(), cwd: OracleMother.WORKTREE },
    ])
  })

  it('an announced judge round hands over the consuming argv the announcement carries', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-announced-judge-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, OracleMother.judgeRoundJson())
    })
    fixture.answer([
      OracleMother.CT_STEP, 'verdict', OracleMother.judgeVerdictPath(),
      '--plan', OracleMother.PLAN, '--issue', '332', '--output-format', 'json',
    ], OracleMother.output(0, OracleMother.deliveredTransition()))
    const machine = fixture.machine()

    const judge = await machine.open(OracleMother.watch())

    expect(judge).toEqual(new RunInstruction({ kind: 'call', ticket: OracleMother.TICKETS[0] }))
    expect((await machine.advance(OracleMother.watch(), judge)).work).toEqual({ kind: 'delivered' })
    expect(fixture.asked).toEqual([
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
      {
        argv: [
          OracleMother.CT_STEP, 'verdict',
          '/repo/.worktrees/332/.agent/run-332/task-1-verdict.json',
          '--plan', OracleMother.PLAN, '--issue', '332', '--output-format', 'json',
        ],
        cwd: OracleMother.WORKTREE,
      },
    ])
  })

  it('an announced judge round whose consuming argv does not name its response path is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-announced-judge-foreign-path-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.judgeRoundNamingAnotherResponsePathJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('a judge round that announces no input is refused instead of dispatched', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-judge-without-inputs-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.judgeRoundAnnouncingNoInputJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('a judge round carrying a role the judge step does not declare is refused instead of dispatched', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-judge-undeclared-role-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.judgeRoundCarryingAnUndeclaredPlanRoleJson()
    expect(announced).toContain('{"role":"plan","kind":"literal","path":"/etc/hosts"}')
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('a judge round carrying the brief twice is refused instead of dispatched', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-judge-duplicated-brief-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.judgeRoundCarryingTheBriefTwiceJson()
    expect(announced).toContain('{"role":"brief","kind":"literal","path":"/etc/hosts"}')
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('an announced implement round whose response kind is not its own is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-announced-foreign-kind-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.implementRoundOfAForeignResponseKindJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('an implement round that announces the judge verb is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-implement-judge-verb-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.implementRoundAnnouncingTheJudgeVerbJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('a slice-judge round that announces the judge verb is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-slice-judge-judge-verb-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.sliceJudgeRoundAnnouncingTheJudgeVerbJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('an announced slice-judge round that names another issue is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-slice-judge-foreign-issue-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.sliceJudgeRoundNamingAnotherIssueJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('an announced controls round that names another plan is refused', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-controls-foreign-plan-')))
    roots.push(fixture.root)
    await fixture.establish()
    fixture.runBytes = null
    const announced = OracleMother.controlsRoundNamingAnotherPlanJson()
    fixture.answer(OracleMother.nextArgv(), () => {
      fixture.runBytes = OracleMother.RUN_BYTES
      return OracleMother.output(0, announced)
    })

    const refused = await fixture.machine().open(OracleMother.watch())

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: `ct-step output is not understood: ${JSON.stringify(announced)}`,
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
  })

  it('a pending forked or malformed command chain cannot resume', async () => {
    const pending = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-pending-')))
    roots.push(pending.root)
    await pending.establish()
    pending.runBytes = null
    const interrupted = new TypeError('oracle runner interrupted after request publication')
    pending.answer(OracleMother.nextArgv(), () => { throw interrupted })
    await expect(pending.machine().open(OracleMother.watch())).rejects.toBe(interrupted)
    expect(await readFile(pending.operation(OracleMother.TICKETS[0], 'request.json'), 'utf8')).toBe(
      OracleMother.request(null, OracleMother.nextArgv()),
    )
    await expect(readFile(pending.operation(OracleMother.TICKETS[0], 'receipt.json'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
    const pendingInspection = await pending.machine().inspect(OracleMother.watch())
    expect(pendingInspection.fact).toEqual({
      kind: 'uncertain',
      detail: `command ${OracleMother.TICKETS[0]} has no receipt and cannot be replayed`,
      closure: null,
    })
    expect(Object.isFrozen(pendingInspection)).toBe(true)
    expect(Object.isFrozen(pendingInspection.fact)).toBe(true)
    expect((await pending.machine().open(OracleMother.watch())).work).toEqual({
      kind: 'refused',
      detail: `command ${OracleMother.TICKETS[0]} has no receipt and cannot be replayed`,
      closure: null,
    })
    expect(pending.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])

    const forked = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-forked-')))
    roots.push(forked.root)
    await forked.establish()
    const rootTicket = await forked.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await forked.journal.finish(
      OracleMother.watch(), rootTicket,
      OracleMother.receipt(OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES),
    )
    await forked.journal.begin(
      OracleMother.watch(), OracleMother.request(rootTicket, OracleMother.controlsArgv()),
    )
    await forked.journal.begin(
      OracleMother.watch(), OracleMother.request(rootTicket, OracleMother.controlsArgv()),
    )
    await expect(forked.machine().open(OracleMother.watch())).rejects.toBeInstanceOf(RunNotUnderstood)
    expect(forked.asked).toEqual([])

    const malformed = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-malformed-')))
    roots.push(malformed.root)
    await malformed.establish()
    await malformed.journal.begin(OracleMother.watch(), '{"version":1,"previous":')
    await expect(malformed.machine().inspect(OracleMother.watch())).rejects.toBeInstanceOf(RunNotUnderstood)
    expect(malformed.asked).toEqual([])
  })

  it('a delivered oracle ends the driver without another model call', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-delivered-')))
    roots.push(fixture.root)
    await fixture.establish()
    const asked = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), asked,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES,
      ),
    )
    const ticket = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(asked, OracleMother.controlsArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), ticket,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.deliveredTransition()), OracleMother.RUN_BYTES, OracleMother.RUN_BYTES,
      ),
    )

    const machine = fixture.machine()
    const instruction = await machine.open(OracleMother.watch())
    const inspection = await machine.inspect(OracleMother.watch())

    expect(instruction.work).toEqual({ kind: 'delivered' })
    expect(inspection.fact).toEqual({ kind: 'delivered' })
    expect(fixture.asked).toEqual([])
  })

  it('established open never repeats current-tree plan validation', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-established-')))
    roots.push(fixture.root)
    await fixture.establish()
    const ticket = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), ticket,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.implementAnnouncement()),
        null,
        OracleMother.RUN_BYTES,
      ),
    )
    const forbidden = async (...asked: unknown[]): Promise<ProcessOutput> => {
      throw new Error(`current-tree validation repeated: ${JSON.stringify(asked)}`)
    }
    const machine = fixture.machine({ git: forbidden, node: forbidden })

    expect(await machine.establishment(OracleMother.watch())).toBe(RunEstablishment.ESTABLISHED)
    expect(await machine.open(OracleMother.watch())).toEqual(
      new RunInstruction({ kind: 'call', ticket: OracleMother.TICKETS[0] }),
    )
    expect(fixture.asked).toEqual([])
  })

  it('an announced slice-judge round answers with a call', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-announced-slice-judge-')))
    roots.push(fixture.root)
    await fixture.establish()
    const ticket = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), ticket,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.sliceJudgeAnnouncement()), null, OracleMother.RUN_BYTES,
      ),
    )

    const instruction = await fixture.machine().open(OracleMother.watch())

    expect(instruction).toEqual(new RunInstruction({ kind: 'call', ticket }))
  })
})

describe('CtRunMachine after a refusal (#504)', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const refusedJournal = async (fixture: OracleFixture): Promise<string> => {
    await fixture.establish()
    const asked = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), asked,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.controlsAnnouncementJson()), null, OracleMother.RUN_BYTES,
      ),
    )
    const refused = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(asked, OracleMother.controlsArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), refused,
      OracleMother.receipt(
        OracleMother.output(4, OracleMother.controlsRefusal()), OracleMother.RUN_BYTES, OracleMother.RUN_BYTES,
      ),
    )
    return refused
  }

  it('open asks ct-step again after a refusal, and the fresh answer is the run instruction', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-resumed-')))
    roots.push(fixture.root)
    const refused = await refusedJournal(fixture)
    fixture.answer(OracleMother.nextArgv(), OracleMother.output(0, OracleMother.implementAnnouncement()))

    const instruction = await fixture.machine().open(OracleMother.watch())

    expect(instruction.work.kind).toBe('call')
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
    const entries = await fixture.journal.entries(OracleMother.watch())
    expect(entries).toHaveLength(3)
    expect(JSON.parse(entries[2].request)).toMatchObject({ previous: refused, argv: OracleMother.nextArgv() })
  })

  it('open confirms a refusal ct-step repeats, with a receipt of its own', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-confirmed-')))
    roots.push(fixture.root)
    await refusedJournal(fixture)
    fixture.answer(OracleMother.nextArgv(), OracleMother.output(4, OracleMother.controlsRefusal()))

    const instruction = await fixture.machine().open(OracleMother.watch())

    expect(instruction.work).toEqual({
      kind: 'refused',
      detail: 'ct-step refused: the run is blocked-controls with outcome failed (exit 4)'
        + ' — run blocked-controls: task 1/3, 0 discard(s)',
      closure: { state: 'blocked-controls', outcome: 'failed', exit: 4, task: 1, findings: null, verdict: null },
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE }])
    expect(await fixture.journal.entries(OracleMother.watch())).toHaveLength(3)
  })
})

describe('CtRunMachine grants another round (#521)', () => {
  const roots: string[] = []
  const INSTRUCTION = 'keep the diff to the failing assertion this time'

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const vetoedJournal = async (fixture: OracleFixture): Promise<string> => {
    await fixture.establish()
    const dispatched = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(null, OracleMother.nextArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), dispatched,
      OracleMother.receipt(
        OracleMother.output(0, OracleMother.implementAnnouncement()), null, OracleMother.RUN_BYTES,
      ),
    )
    const vetoed = await fixture.journal.begin(
      OracleMother.watch(), OracleMother.request(dispatched, OracleMother.reportArgv()),
    )
    await fixture.journal.finish(
      OracleMother.watch(), vetoed,
      OracleMother.receipt(
        OracleMother.output(1, OracleMother.judgeRefusal()), OracleMother.RUN_BYTES, OracleMother.RUN_BYTES,
      ),
    )
    return vetoed
  }

  it('the grant runs the reopen verb as the successor of the last command', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-grant-')))
    roots.push(fixture.root)
    const vetoed = await vetoedJournal(fixture)
    fixture.answer(OracleMother.reopenArgv(INSTRUCTION), OracleMother.output(0, OracleMother.openTransition()))
    fixture.answer(OracleMother.nextArgv(), OracleMother.output(0, OracleMother.implementAnnouncement()))

    const granted = await fixture.machine().anotherRound(OracleMother.watch(), INSTRUCTION)

    expect(granted.work.kind).toBe('call')
    expect(fixture.asked).toEqual([
      { argv: OracleMother.reopenArgv(INSTRUCTION), cwd: OracleMother.WORKTREE },
      { argv: OracleMother.nextArgv(), cwd: OracleMother.WORKTREE },
    ])
    const entries = await fixture.journal.entries(OracleMother.watch())
    expect(entries).toHaveLength(4)
    expect(JSON.parse(entries[2].request)).toMatchObject({
      previous: vetoed, argv: OracleMother.reopenArgv(INSTRUCTION),
    })
  })

  it('a reopen the plugin does not know leaves a refusal the grant can hang off', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-grant-unread-')))
    roots.push(fixture.root)
    await vetoedJournal(fixture)
    fixture.answer(
      OracleMother.reopenArgv(INSTRUCTION),
      OracleMother.output(2, 'error: unknown option \'--instruction\'\n', 'ct-step: usage error\n'),
    )

    const refused = await fixture.machine().anotherRound(OracleMother.watch(), INSTRUCTION)

    expect(refused.work).toEqual({
      kind: 'refused',
      detail: 'ct-step exited 2 without announcing a run state;'
        + ' stdout: "error: unknown option \'--instruction\'\\n"; stderr: "ct-step: usage error\\n"',
      closure: null,
    })
    expect(fixture.asked).toEqual([{ argv: OracleMother.reopenArgv(INSTRUCTION), cwd: OracleMother.WORKTREE }])
  })

  it('a run with no command at all refuses the grant instead of forking the chain', async () => {
    const fixture = new OracleFixture(await mkdtemp(join(tmpdir(), 'ct-run-machine-grant-no-command-')))
    roots.push(fixture.root)
    await fixture.establish()

    await expect(fixture.machine().anotherRound(OracleMother.watch(), INSTRUCTION)).rejects.toThrow(
      'another round has no command to grant from',
    )

    expect(fixture.asked).toEqual([])
  })
})
