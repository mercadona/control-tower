import { describe, it, expect } from 'vitest'
import { newRun, PHASES, STEPS, RUN_STATES } from '../scripts/run-machine.js'
import { ReopenedBrief, BriefLog } from '../scripts/reopened-brief.js'
import { RunClosure } from '../scripts/run-closure.js'

class ReopenedBriefMother {
  static INSTRUCTION = 'the parser import is wrong: import it from src/parse.js'
  static CONTROLS_LOG = '.agent/run-7/controls-2.log'
  static GLOBAL_LOG = '.agent/run-7/global.log'
  static CONTROLS_TEXT = '$ npm test\nFAIL parser.test.js\nexit 1\n'
  static GLOBAL_TEXT = '$ make build-plugin\nerror: dist is stale\n'
  static ADVICE = Object.freeze({ approach: 'rebuild dist from the sources instead of editing it', files_to_reconsider: ['plugin/dist/dispatch-guard.js'] })
  static GLOBAL_LOG_LINE = `The last log, at \`${ReopenedBriefMother.GLOBAL_LOG}\` (its last 200 lines):`
  static CONTROLS_LOG_LINE = `The last log, at \`${ReopenedBriefMother.CONTROLS_LOG}\` (its last 200 lines):`

  static controls(over = {}) {
    return ReopenedBrief.section({
      closure: RUN_STATES.BLOCKED_CONTROLS,
      instruction: ReopenedBriefMother.INSTRUCTION,
      log: new BriefLog({ path: ReopenedBriefMother.CONTROLS_LOG, text: ReopenedBriefMother.CONTROLS_TEXT }),
      ...over,
    })
  }

  static readLog(path) {
    const texts = {
      [ReopenedBriefMother.GLOBAL_LOG]: ReopenedBriefMother.GLOBAL_TEXT,
      [ReopenedBriefMother.CONTROLS_LOG]: ReopenedBriefMother.CONTROLS_TEXT,
    }
    return new BriefLog({ path, text: texts[path] ?? null })
  }

  static fixRound(over = {}) {
    return {
      ...newRun({ plan: 'p.md', issue: 7, baseSha: 'abc', tasksTotal: 3 }),
      task: 3, phase: PHASES.FIX, step: STEPS.IMPLEMENT,
      lastGlobalLog: ReopenedBriefMother.GLOBAL_LOG,
      lastFailure: null,
      ...over,
    }
  }

  static reopenedFixRound() {
    return RunClosure.reopen(ReopenedBriefMother.fixRound({
      phase: PHASES.SLICE, step: STEPS.GLOBAL, closed: RUN_STATES.BLOCKED_GLOBAL,
      lastFailure: { outcome: 'failed', command: 'make build-plugin', code: 2, log: ReopenedBriefMother.GLOBAL_LOG },
    }), ReopenedBriefMother.INSTRUCTION)
  }

  static briefOf(run) {
    return ReopenedBrief.fixRoundOf(run, ReopenedBriefMother.readLog).split('\n')
  }

  static numberedLog(count) {
    return Array.from({ length: count }, (_, index) => `log line ${index + 1}`).join('\n') + '\n'
  }
}

describe('the brief of a reopened controls closure', () => {
  it('the controls brief carries the instruction and the controls log', () => {
    const lines = ReopenedBriefMother.controls().split('\n')

    expect(lines).toContain('## Advice for this attempt')
    expect(lines).toContain(
      'The controls of this task stayed red, or could not be measured, and the run was closed. '
      + 'A person read the log and reopened it with an instruction of their own:',
    )
    expect(lines).toContain(ReopenedBriefMother.INSTRUCTION)
    expect(lines).toContain(ReopenedBriefMother.CONTROLS_LOG_LINE)
    expect(lines).toContain('FAIL parser.test.js')
    expect(lines).toContain('This does not widen the task: `**Files:**` above is still its scope.')
  })

  it('only the last 200 lines of the log reach the brief', () => {
    const lines = ReopenedBriefMother.controls({ log: new BriefLog({ path: ReopenedBriefMother.CONTROLS_LOG, text: ReopenedBriefMother.numberedLog(201) }) }).split('\n')

    expect(lines).not.toContain('log line 1')
    expect(lines).toContain('log line 2')
    expect(lines).toContain('log line 201')
    expect(lines.slice(lines.indexOf('```text') + 1, lines.lastIndexOf('```'))).toHaveLength(200)
  })

  it('a closure with no reopen has no brief', () => {
    expect(() => ReopenedBriefMother.controls({ closure: RUN_STATES.BLOCKED_SLICE_JUDGE })).toThrow(/blocked-slice-judge/)
    expect(() => ReopenedBriefMother.controls({ closure: RUN_STATES.BLOCKED_JUDGE })).toThrow(/blocked-judge/)
    expect(() => ReopenedBriefMother.controls({ closure: RUN_STATES.BLOCKED_GLOBAL })).toThrow(/blocked-global/)
  })
})

describe('every brief of the fix round carries the Global verification log', () => {
  it('the global brief carries the instruction and the global log', () => {
    const lines = ReopenedBriefMother.briefOf(ReopenedBriefMother.reopenedFixRound())

    expect(lines).toContain('## Advice for this attempt')
    expect(lines).toContain(
      'The Global verification of the slice stayed red, or could not be measured, and the run was closed. '
      + 'A person opened this fix round: fix what the log shows, in any file of the slice. '
      + 'The program runs the Global verification again after your commit.',
    )
    expect(lines).toContain(ReopenedBriefMother.GLOBAL_LOG_LINE)
    expect(lines).toContain('error: dist is stale')
    expect(lines.indexOf('Their instruction:')).toBeGreaterThan(lines.indexOf('error: dist is stale'))
    expect(lines[lines.indexOf('Their instruction:') + 2]).toBe(ReopenedBriefMother.INSTRUCTION)
    expect(lines).not.toContain('This does not widen the task: `**Files:**` above is still its scope.')
  })

  it('the judge of the fix round reads the Global verification log after green controls cleared the failure', () => {
    const judged = { ...ReopenedBriefMother.reopenedFixRound(), step: STEPS.JUDGE, lastFailure: null }

    expect(ReopenedBriefMother.briefOf(judged)).toContain(ReopenedBriefMother.GLOBAL_LOG_LINE)
  })

  it('a vetoed fix round reopened by a person still carries the Global verification log', () => {
    const vetoed = { ...ReopenedBriefMother.reopenedFixRound(), step: STEPS.JUDGE, judgeRetries: 2, closed: RUN_STATES.BLOCKED_JUDGE }
    const lines = ReopenedBriefMother.briefOf(RunClosure.reopen(vetoed, 'keep the import and fix the build script instead'))

    expect(lines).toContain(ReopenedBriefMother.GLOBAL_LOG_LINE)
    expect(lines).toContain('error: dist is stale')
    expect(lines).toContain(ReopenedBrief.FIX_ROUND_JUDGE_LEAD)
    expect(lines[lines.indexOf(ReopenedBrief.FIX_ROUND_JUDGE_LEAD) + 2]).toBe('keep the import and fix the build script instead')
    expect(lines).not.toContain('Their instruction:')
  })

  it('the adviser attempt inside the fix round still carries the Global verification log', () => {
    const advised = { ...ReopenedBriefMother.reopenedFixRound(), lastAdvice: ReopenedBriefMother.ADVICE, reopenedFrom: null }
    const lines = ReopenedBriefMother.briefOf(advised)

    expect(lines).toContain(ReopenedBriefMother.GLOBAL_LOG_LINE)
    expect(lines).toContain('error: dist is stale')
    expect(lines).toContain(ReopenedBrief.FIX_ROUND_ADVISER_LEAD)
    expect(lines).toContain(ReopenedBriefMother.ADVICE.approach)
    expect(lines).toContain('- `plugin/dist/dispatch-guard.js`')
  })

  it('a controls reopen inside the fix round keeps the global log under the global lead and the controls log under its own', () => {
    const closedAtControls = {
      ...ReopenedBriefMother.reopenedFixRound(), step: STEPS.CONTROLS, controlRetries: 2, closed: RUN_STATES.BLOCKED_CONTROLS,
      lastFailure: { outcome: 'failed', command: 'npm test', code: 1, log: ReopenedBriefMother.CONTROLS_LOG },
    }
    const lines = ReopenedBriefMother.briefOf(RunClosure.reopen(closedAtControls, ReopenedBriefMother.INSTRUCTION))
    const order = [
      ReopenedBrief.GLOBAL_LEAD, ReopenedBriefMother.GLOBAL_LOG_LINE, 'error: dist is stale',
      ReopenedBrief.FIX_ROUND_CONTROLS_LEAD, ReopenedBriefMother.INSTRUCTION, ReopenedBriefMother.CONTROLS_LOG_LINE, 'FAIL parser.test.js',
    ].map((line) => lines.indexOf(line))

    expect(order.every((at) => at >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(lines).not.toContain('This does not widen the task: `**Files:**` above is still its scope.')
  })

  it('a fix round with no guidance left still carries the Global verification log and nothing else', () => {
    const lines = ReopenedBriefMother.briefOf(ReopenedBriefMother.fixRound({ lastAdvice: null, reopenedFrom: null }))

    expect(lines).toContain(ReopenedBriefMother.GLOBAL_LOG_LINE)
    expect(lines.at(-1)).toBe('')
    expect(lines.at(-2)).toBe('```')
  })

  it('an unreadable log is said, not left out', () => {
    const lines = ReopenedBriefMother.briefOf({ ...ReopenedBriefMother.reopenedFixRound(), lastGlobalLog: '.agent/run-7/gone.log' })

    expect(lines).toContain('The log could not be read.')
    expect(lines).not.toContain('```text')
    expect(lines).toContain(ReopenedBriefMother.INSTRUCTION)
  })

  it('a fix round reopened from a closure with no guidance throws instead of guessing one', () => {
    expect(() => ReopenedBriefMother.briefOf(ReopenedBriefMother.fixRound({ lastAdvice: 'x', reopenedFrom: RUN_STATES.BLOCKED_E2E })))
      .toThrow('a fix round reopened from a closure with no guidance: "blocked-e2e"')
  })
})
