import { PHASES, RUN_STATES } from './run-machine.js'

export class ReopenedBrief {
  static LOG_TAIL_LINES = 200

  static HEADING = '## Advice for this attempt'

  static SCOPE_LINE = 'This does not widen the task: `**Files:**` above is still its scope.'

  static UNREADABLE_LOG = 'The log could not be read.'

  static section({ closure, phase, instruction, logPath, logText }) {
    const { lead, closing } = ReopenedBrief.framingOf(closure, phase)
    return [
      '',
      ReopenedBrief.HEADING,
      '',
      lead,
      '',
      instruction,
      '',
      ...ReopenedBrief.logLines(logPath, logText),
      '',
      ...closing,
    ].join('\n')
  }

  static framingOf(closure, phase) {
    switch (closure) {
      case RUN_STATES.BLOCKED_CONTROLS:
        return Object.freeze({
          lead: 'The controls of this task stayed red, or could not be measured, and the run was closed. '
            + 'A person read the log and reopened it with an instruction of their own:',
          closing: phase === PHASES.FIX ? [] : [ReopenedBrief.SCOPE_LINE, ''],
        })
      case RUN_STATES.BLOCKED_GLOBAL:
        return Object.freeze({
          lead: 'The Global verification of the slice stayed red, or could not be measured, and the run was closed. '
            + 'A person opened this fix round: fix what the log shows, in any file of the slice. '
            + 'The program runs the Global verification again after your commit. Their instruction:',
          closing: [],
        })
      default:
        throw new Error(`a closure with no reopened brief: "${closure}"`)
    }
  }

  static logLines(logPath, logText) {
    if (logText === null) return [ReopenedBrief.UNREADABLE_LOG]
    return [
      `The last log, at \`${logPath}\` (its last ${ReopenedBrief.LOG_TAIL_LINES} lines):`,
      '',
      '```text',
      ...ReopenedBrief.tailOf(logText),
      '```',
    ]
  }

  static tailOf(logText) {
    return logText.replace(/\n$/, '').split('\n').slice(-ReopenedBrief.LOG_TAIL_LINES)
  }
}
