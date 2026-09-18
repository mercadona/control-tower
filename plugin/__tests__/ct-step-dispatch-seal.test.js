import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { rmSyncBestEffort } from './fixtures/cleanup.js'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'
import { Dispatch, DispatchGate } from '../scripts/dispatch-gate.js'

let repo
const { ct, writeReport, writeVerdict, writeRaw, commits, runState, judgeTask } = makeHelpers(() => repo)

const CT_STEP_PATH = '/plugins/control-tower-loop/scripts/ct-step.mjs'

class Conducting {
  static aVetoFromTheJudge() {
    return writeVerdict('FAIL', [{ severity: 'high', what: 'mal', path: 'uno.txt', line: 1 }])
  }

  static dispatchNow() {
    return DispatchGate.verdictFor(runState(), CT_STEP_PATH).dispatch
  }
}

beforeEach(() => { repo = makeRepo() })
afterEach(() => { rmSyncBestEffort(repo) })

describe('what next writes down when it prepares a step', () => {
  it('next_on_implement_seals_the_task_the_step_and_the_attempt_it_wrote_the_brief_for', () => {
    ct('next')

    expect(runState().nextSeal).toBe('1:implement:1')
  })

  it('next_on_judge_seals_its_own_step_so_the_seal_of_implement_does_not_authorise_the_judge', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')

    ct('next')

    expect(runState().nextSeal).toBe('1:judge:1')
  })

  it('next_on_controls_seals_nothing_because_no_subagent_is_dispatched_on_that_step', () => {
    ct('next')
    ct('report', writeReport(['uno.txt']))

    ct('next')

    expect(runState().nextSeal).toBe('1:implement:1')
  })

  it('next_on_the_second_task_seals_that_task_so_the_brief_of_the_first_does_not_pass_for_it', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(writeVerdict('PASS'))
    ct('commit')

    ct('next')

    expect(runState().nextSeal).toBe('2:implement:1')
  })
})

describe('what the gate decides on the state ct-step actually wrote', () => {
  it('a_run_on_judge_that_never_asked_for_that_step_is_denied_its_dispatch', () => {
    ct('next')
    ct('report', writeReport(['uno.txt']))
    ct('controls')

    expect(runState().step).toBe('judge')
    expect(Conducting.dispatchNow()).toBe(Dispatch.DENIED)
  })

  it('a_run_that_just_asked_for_its_step_is_let_through', () => {
    ct('next')

    expect(Conducting.dispatchNow()).toBe(Dispatch.LET_THROUGH)
  })

  it('a_discarded_report_is_let_through_again_because_the_brief_it_was_given_is_still_on_disk', () => {
    ct('next')

    ct('report', writeRaw('esto no es json'))

    expect(runState().discards).toBe(1)
    expect(Conducting.dispatchNow()).toBe(Dispatch.LET_THROUGH)
  })

  it('a_vetoed_task_is_denied_until_it_asks_again_so_the_findings_of_the_veto_reach_the_implementer', () => {
    ct('next')
    ct('report', writeReport(['uno.txt']))
    ct('controls')

    judgeTask(Conducting.aVetoFromTheJudge())

    expect(runState().judgeRetries).toBe(1)
    expect(commits()).toBe(1)
    expect(Conducting.dispatchNow()).toBe(Dispatch.DENIED)
  })

  it('asking_again_after_a_veto_lifts_the_denial_so_the_step_that_prints_the_findings_is_the_one_that_unblocks', () => {
    ct('report', writeReport(['uno.txt']))
    ct('controls')
    judgeTask(Conducting.aVetoFromTheJudge())

    ct('next')

    expect(Conducting.dispatchNow()).toBe(Dispatch.LET_THROUGH)
  })
})
