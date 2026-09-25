import { describe, it, expect } from 'vitest'
import { PHASES, RUN_STATES } from '../scripts/run-machine.js'
import { ReopenedBrief } from '../scripts/reopened-brief.js'

class ReopenedBriefMother {
  static INSTRUCTION = 'the parser import is wrong: import it from src/parse.js'
  static CONTROLS_LOG = '.agent/run-7/controls-2.log'
  static GLOBAL_LOG = '.agent/run-7/global.log'

  static controls(over = {}) {
    return ReopenedBrief.section({
      closure: RUN_STATES.BLOCKED_CONTROLS,
      phase: PHASES.TASK,
      instruction: ReopenedBriefMother.INSTRUCTION,
      logPath: ReopenedBriefMother.CONTROLS_LOG,
      logText: '$ npm test\nFAIL parser.test.js\nexit 1\n',
      ...over,
    })
  }

  static global(over = {}) {
    return ReopenedBrief.section({
      closure: RUN_STATES.BLOCKED_GLOBAL,
      phase: PHASES.FIX,
      instruction: ReopenedBriefMother.INSTRUCTION,
      logPath: ReopenedBriefMother.GLOBAL_LOG,
      logText: '$ make build-plugin\nerror: dist is stale\n',
      ...over,
    })
  }

  static numberedLog(count) {
    return Array.from({ length: count }, (_, index) => `log line ${index + 1}`).join('\n') + '\n'
  }
}

describe('the brief of a reopened closure', () => {
  it('the controls brief carries the instruction and the controls log', () => {
    const section = ReopenedBriefMother.controls()
    const lines = section.split('\n')

    expect(lines).toContain('## Advice for this attempt')
    expect(lines).toContain(
      'The controls of this task stayed red, or could not be measured, and the run was closed. '
      + 'A person read the log and reopened it with an instruction of their own:',
    )
    expect(lines).toContain(ReopenedBriefMother.INSTRUCTION)
    expect(lines).toContain(`The last log, at \`${ReopenedBriefMother.CONTROLS_LOG}\` (its last 200 lines):`)
    expect(lines).toContain('FAIL parser.test.js')
    expect(lines).toContain('This does not widen the task: `**Files:**` above is still its scope.')
  })

  it('the global brief carries the instruction and the global log', () => {
    const section = ReopenedBriefMother.global()
    const lines = section.split('\n')

    expect(lines).toContain('## Advice for this attempt')
    expect(lines).toContain(
      'The Global verification of the slice stayed red, or could not be measured, and the run was closed. '
      + 'A person opened this fix round: fix what the log shows, in any file of the slice. '
      + 'The program runs the Global verification again after your commit. Their instruction:',
    )
    expect(lines).toContain(ReopenedBriefMother.INSTRUCTION)
    expect(lines).toContain(`The last log, at \`${ReopenedBriefMother.GLOBAL_LOG}\` (its last 200 lines):`)
    expect(lines).toContain('error: dist is stale')
    expect(lines).not.toContain('This does not widen the task: `**Files:**` above is still its scope.')
  })

  it('a controls reopen inside the fix round does not narrow the scope to one task', () => {
    const lines = ReopenedBriefMother.controls({ phase: PHASES.FIX }).split('\n')

    expect(lines).toContain(ReopenedBriefMother.INSTRUCTION)
    expect(lines).not.toContain('This does not widen the task: `**Files:**` above is still its scope.')
  })

  it('only the last 200 lines of the log reach the brief', () => {
    const lines = ReopenedBriefMother.controls({ logText: ReopenedBriefMother.numberedLog(201) }).split('\n')

    expect(lines).not.toContain('log line 1')
    expect(lines).toContain('log line 2')
    expect(lines).toContain('log line 201')
    expect(lines.slice(lines.indexOf('```text') + 1, lines.lastIndexOf('```'))).toHaveLength(200)
  })

  it('an unreadable log is said, not left out', () => {
    const lines = ReopenedBriefMother.global({ logText: null }).split('\n')

    expect(lines).toContain('The log could not be read.')
    expect(lines).not.toContain('```text')
    expect(lines).toContain(ReopenedBriefMother.INSTRUCTION)
  })

  it('a closure with no reopen has no brief', () => {
    expect(() => ReopenedBriefMother.controls({ closure: RUN_STATES.BLOCKED_SLICE_JUDGE })).toThrow(/blocked-slice-judge/)
    expect(() => ReopenedBriefMother.controls({ closure: RUN_STATES.BLOCKED_JUDGE })).toThrow(/blocked-judge/)
  })
})
