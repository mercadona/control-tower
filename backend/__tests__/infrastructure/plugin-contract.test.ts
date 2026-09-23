import { describe, it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BigQueryTable } from '../../../plugin/scripts/bigquery-load.js'
import { LOOP_STATUS_LABELS } from '../../../plugin/scripts/groom.js'
import { STATUS_LADDER } from '../../../plugin/scripts/harvest.js'
import {
  STEPS, RUN_STATES, OUTCOMES, DEFAULT_BUDGETS, newRun, after, deliveredRun,
} from '../../../plugin/scripts/run-machine.js'
import { StepSeal } from '../../../plugin/scripts/dispatch-gate.js'
import { extractTasks } from '../../../plugin/scripts/plan-tasks.js'
import { GhPlanIssues, PlanIssueBody } from '../../src/infrastructure/gh-plan-issues.ts'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { RunFileProgress } from '../../src/infrastructure/run-file-progress.ts'
import { UserStory } from '../../src/domain/value-objects/user-story.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { Invocation, InvocationOutcome } from '../../src/infrastructure/invocation.ts'
import { ImplementationStep } from '../../src/domain/value-objects/implementation-state.ts'
import { PlanIssueStatus } from '../../src/domain/value-objects/plan-issue-status.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import type { ImplementationProgress } from '../../src/domain/ports/implementation-progress.ts'

class PluginRunMachine {
  static stepped(...asked: Parameters<typeof after>): Exclude<ReturnType<typeof after>, void> {
    return after(...asked) as Exclude<ReturnType<typeof after>, void>
  }
}

describe('the status labels this backend writes and the plugin reads', () => {
  it('both_ends_of_the_claim_are_labels_the_loop_declares_instead_of_names_invented_here', () => {
    expect(LOOP_STATUS_LABELS).toContain(GhPlanIssues.IN_PROGRESS_LABEL)
    expect(LOOP_STATUS_LABELS).toContain(GhPlanIssues.READY_LABEL)
  })

  it('the_statuses_a_plan_issue_can_stand_at_are_the_rungs_of_the_loops_own_ladder', () => {
    const rungs = Object.values(PlanIssueStatus).filter((status) => status !== PlanIssueStatus.NONE)

    expect(rungs).toEqual(STATUS_LADDER)
  })

  it('standing_at_none_is_this_backends_own_member_and_not_a_rung_the_loop_declares', () => {
    expect(STATUS_LADDER).not.toContain(PlanIssueStatus.NONE)
  })

  it('the_prefix_this_backend_reads_a_status_by_is_the_one_every_label_of_the_ladder_wears', () => {
    for (const label of LOOP_STATUS_LABELS) {
      expect(label.startsWith(GhPlanIssues.STATUS_PREFIX)).toBe(true)
    }
  })
})

describe('the harvest table this backend hands the plugin', () => {
  const HOME = '/home/someone'
  const WELL_FORMED = ['p:d.t', 'my-project:control_tower.harvest', 'proj123:ds_1.tbl_1']

  const started = (given: string) => Invocation.from([], { [Invocation.HARVEST_TABLE_VARIABLE]: given }, HOME)

  it('every_table_this_backend_starts_with_is_one_the_plugin_parses_back_into_the_very_same_table', () => {
    const ours = WELL_FORMED.map((given) => started(given).harvestTable)
    const theirs = ours.map((table) => BigQueryTable.parse(table))

    expect(ours).toEqual(WELL_FORMED)
    expect(theirs.map((table) => table === null ? null : table.id)).toEqual(WELL_FORMED)
  })

  it('a_table_this_backend_refuses_never_becomes_an_argument_of_the_plugin_at_all', () => {
    const refused = started('not-a-table')

    expect(refused.outcome).toBe(InvocationOutcome.MALFORMED_HARVEST_TABLE)
    expect(refused.harvestTable).toBe(null)
  })
})

describe('the sections the errand sends the agent to read', () => {
  const body = () => PlanIssueBody.of({
    story: new UserStory({
      key: new UserStoryKey('XOP-4909'), summary: 'la métrica de los campeones', description: 'como analista quiero',
    }),
  })

  it('the_two_it_names_are_headings_the_plugin_really_renders_in_the_body_we_write', () => {
    const headings = body().split('\n').filter((line) => line.startsWith('## '))

    expect(headings).toContain(`## ${PlanAgentBrief.MILESTONE_CONTEXT}`)
    expect(headings).toContain(`## ${PlanAgentBrief.INHERITED_CONTEXT}`)
  })
})

class RunDouble {
  static ISSUE = 7
  static ROOT = new CheckoutRoot('/repo')
  static PLAN = 'docs/superpowers/plans/p.md'

  static worktree() {
    return RunFileProgress.worktreeFor(RunDouble.ROOT.text, RunDouble.ISSUE)
  }

  static path() {
    return RunFileProgress.runFileFor(RunDouble.ROOT.text, RunDouble.ISSUE)
  }

  static freshRun(overrides = {}) {
    return newRun({
      plan: RunDouble.PLAN, issue: RunDouble.ISSUE, baseSha: 'a'.repeat(40), tasksTotal: 3, e2eRuns: [],
      ...overrides,
    })
  }

  static bytesOf(run: unknown) {
    return JSON.stringify(run, null, 2) + '\n'
  }

  static async read(run: unknown, extraFiles: Record<string, string> = {}) {
    const files: Record<string, string> = { [RunDouble.path()]: RunDouble.bytesOf(run), ...extraFiles }
    const progress: ImplementationProgress = new RunFileProgress({
      exists: async (candidate: string) => candidate === RunDouble.worktree(),
      read: async (candidate: string) => (candidate in files ? files[candidate] : null),
    })

    return progress.of({ root: RunDouble.ROOT, issue: RunDouble.ISSUE })
  }
}

class StepsNoRunFileReports {
  static VALUES = Object.freeze([
    ImplementationStep.STARTING,
    ImplementationStep.PUBLISHING,
    ImplementationStep.DELIVERED,
    ImplementationStep.IN_REVIEW,
    ImplementationStep.FIXING,
  ])
}

describe('the run machine and the run file this backend reads back', () => {
  it('every_step_the_machine_can_reach_is_a_step_our_vocabulary_declares', () => {
    expect(Object.values(STEPS).every((step) => Object.values(ImplementationStep).includes(step))).toBe(true)
  })

  it('the_only_steps_our_vocabulary_adds_are_the_ones_the_machine_never_reports', () => {
    const reported: string[] = Object.values(STEPS)
    const added = Object.values(ImplementationStep).filter((step) => !reported.includes(step))

    expect(added.sort()).toEqual([...StepsNoRunFileReports.VALUES].sort())
  })

  it('a_run_the_machine_parked_at_advise_is_read_back_as_a_step_of_the_task_it_advises_on', async () => {
    let run = RunDouble.freshRun()
    run = PluginRunMachine.stepped(
      { ...run, step: STEPS.JUDGE, judgeRetries: 1 }, OUTCOMES.FAILED, DEFAULT_BUDGETS
    ).run

    const state = await RunDouble.read(run)

    expect(state.step).toBe('advise')
    expect(state.task).toBe(1)
    expect(state.attempt).toBe(3)
  })

  it('a_run_the_machine_just_created_is_read_as_the_first_task_about_to_be_implemented', async () => {
    const state = await RunDouble.read(RunDouble.freshRun())

    expect(state.step).toBe('implement')
    expect(state.task).toBe(1)
    expect(state.totalTasks).toBe(3)
    expect(state.attempt).toBe(1)
  })

  it('our_attempt_is_the_one_the_dispatch_gate_counts', () => {
    let run = PluginRunMachine.stepped(RunDouble.freshRun(), OUTCOMES.DONE, DEFAULT_BUDGETS).run
    while (run.controlRetries + run.judgeRetries + run.correctionRetries === 0) {
      run = PluginRunMachine.stepped(run, OUTCOMES.FAILED, DEFAULT_BUDGETS).run
    }

    expect(RunFileProgress.attemptOf(run)).toBe(StepSeal.attemptOf(run))
  })

  it('the_two_formulas_still_agree_when_every_retry_counter_is_distinct_and_non_zero', () => {
    const run = {
      ...RunDouble.freshRun(), controlRetries: 1, judgeRetries: 2, correctionRetries: 3, reconcileRetries: 5,
    }

    expect(RunFileProgress.attemptOf(run)).toBe(StepSeal.attemptOf(run))
  })

  it.each([
    ['the machine closed it as delivered', { closed: RUN_STATES.DELIVERED }, true],
    ['it closed some other way', { closed: 'blocked-judge' }, false],
    ['it is still open', {}, false],
  ])(
    'the_two_readers_agree_on_whether_the_run_is_delivered: %s',
    async (_, closure, delivered) => {
      const run = { ...RunDouble.freshRun(), ...closure }
      const bytes = RunDouble.bytesOf(run)

      const theirs = deliveredRun(bytes, RunDouble.ISSUE)
      const ours = await RunDouble.read(run)

      expect(theirs.ok).toBe(delivered)
      expect(ours.step === 'delivered').toBe(delivered)
    },
  )

  it('the_task_names_we_read_are_the_ones_the_plugin_extracts', async () => {
    const planPath = join(
      dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
      'plugin', '__tests__', 'fixtures', 'plan-real-issue-5.md'
    )
    const planText = await readFile(planPath, 'utf8')
    const relativePlan = 'plugin/__tests__/fixtures/plan-real-issue-5.md'
    const extracted = extractTasks(planText)

    expect(extracted.tasks.length).toBeGreaterThan(0)

    for (const task of extracted.tasks) {
      const run = { ...RunDouble.freshRun({ plan: relativePlan, tasksTotal: extracted.tasks.length }), task: task.n }

      const state = await RunDouble.read(run, {
        [`${RunDouble.worktree()}/${relativePlan}`]: planText,
      })

      expect(state.name).toBe(task.name)
    }
  })
})

class ExecutionSpecTemplate {
  static readonly PATH = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '..',
    'plugin', 'templates', '_TEMPLATE-execution-spec.md'
  )

  static async read(): Promise<EpicSpec> {
    return new EpicSpec({ path: ExecutionSpecTemplate.PATH, text: await readFile(ExecutionSpecTemplate.PATH, 'utf8') })
  }
}

describe('the execution spec the plugin seeds, as this backend reads and freezes it', () => {
  it('the execution spec template the plugin seeds reads here as a draft that names its design document', async () => {
    const spec = await ExecutionSpecTemplate.read()

    expect(spec.isFrozen()).toBe(false)
    expect(spec.frozenOn()).toBe(null)
    expect(spec.title()).toBe('<Milestone name>')
    expect(spec.design()).toBe('docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md')
  })

  it('freezing that template rewrites the two header lines the plugin left blank and nothing else', async () => {
    const spec = await ExecutionSpecTemplate.read()

    const before = spec.text.split('\n')
    const after = spec.frozenAt('2026-09-14').split('\n')

    expect(after).toContain('**Estado:** CONGELADA')
    expect(after).toContain('**Fecha de congelación:** 2026-09-14')
    expect(after).not.toContain('**Estado:** DRAFT')
    expect(after).not.toContain('**Fecha de congelación:** —')
    expect(after.length).toBe(before.length)
    before.forEach((line, at) => {
      if (line.startsWith(EpicSpec.STATE_LINE) || line.startsWith(EpicSpec.DATE_LINE)) return
      expect(after[at]).toBe(line)
    })
  })
})
