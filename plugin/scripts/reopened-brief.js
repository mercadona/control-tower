import { RUN_STATES } from './run-machine.js'

export class BriefLog {
  constructor({ path, text }) {
    this.path = path
    this.text = text
    Object.freeze(this)
  }
}

export class ReopenedBrief {
  static LOG_TAIL_LINES = 200

  static HEADING = '## Advice for this attempt'

  static SCOPE_LINE = 'This does not widen the task: `**Files:**` above is still its scope.'

  static UNREADABLE_LOG = 'The log could not be read.'

  static CONTROLS_LEAD = 'The controls of this task stayed red, or could not be measured, and the run was closed. '
    + 'A person read the log and reopened it with an instruction of their own:'

  static GLOBAL_LEAD = 'The Global verification of the slice stayed red, or could not be measured, and the run was closed. '
    + 'A person opened this fix round: fix what the log shows, in any file of the slice. '
    + 'The program runs the Global verification again after your commit.'

  static GLOBAL_INSTRUCTION_LEAD = 'Their instruction:'

  static FIX_ROUND_CONTROLS_LEAD = 'The controls of this fix round stayed red, or could not be measured, and the run was closed. '
    + 'A person read the log and reopened it with an instruction of their own:'

  static FIX_ROUND_JUDGE_LEAD = 'The judge vetoed the fix round three times and the run was closed. '
    + "A person read it and reopened it with an instruction of their own, instead of the adviser's:"

  static FIX_ROUND_ADVISER_LEAD = 'The judge vetoed the two previous attempts at this fix round. '
    + 'An adviser read both attempts and both verdicts and answered with the approach this one should take instead. '
    + 'The tree was reset to the last commit before you were dispatched, so nothing either of them wrote is still there: '
    + 'you are not continuing them.'

  static GUIDANCE = Object.freeze({
    NONE: 'none',
    GLOBAL_INSTRUCTION: 'global-instruction',
    CONTROLS_INSTRUCTION: 'controls-instruction',
    JUDGE_INSTRUCTION: 'judge-instruction',
    ADVISER: 'adviser',
  })

  static section({ closure, instruction, log }) {
    switch (closure) {
      case RUN_STATES.BLOCKED_CONTROLS:
        return [
          '',
          ReopenedBrief.HEADING,
          '',
          ReopenedBrief.CONTROLS_LEAD,
          '',
          instruction,
          '',
          ...ReopenedBrief.logLines(log),
          '',
          ReopenedBrief.SCOPE_LINE,
          '',
        ].join('\n')
      default:
        throw new Error(`a closure with no reopened brief: "${closure}"`)
    }
  }

  static fixRoundOf(run, readLog) {
    return ReopenedBrief.fixRound({
      globalLog: readLog(run.lastGlobalLog ?? null),
      reopenedFrom: run.reopenedFrom ?? null,
      advice: run.lastAdvice ?? null,
      controlsLog: readLog(run.lastFailure?.log ?? null),
    })
  }

  static fixRound({ globalLog, reopenedFrom, advice, controlsLog }) {
    return [
      '',
      ReopenedBrief.HEADING,
      '',
      ReopenedBrief.GLOBAL_LEAD,
      '',
      ...ReopenedBrief.logLines(globalLog),
      '',
      ...ReopenedBrief.guidanceLines(ReopenedBrief.guidanceOf({ reopenedFrom, advice }), { advice, controlsLog }),
    ].join('\n')
  }

  static guidanceOf({ reopenedFrom, advice }) {
    if (advice === null) return ReopenedBrief.GUIDANCE.NONE
    if (typeof advice === 'object') return ReopenedBrief.GUIDANCE.ADVISER
    switch (reopenedFrom) {
      case RUN_STATES.BLOCKED_GLOBAL:
        return ReopenedBrief.GUIDANCE.GLOBAL_INSTRUCTION
      case RUN_STATES.BLOCKED_CONTROLS:
        return ReopenedBrief.GUIDANCE.CONTROLS_INSTRUCTION
      case null:
        return ReopenedBrief.GUIDANCE.JUDGE_INSTRUCTION
      default:
        throw new Error(`a fix round reopened from a closure with no guidance: "${reopenedFrom}"`)
    }
  }

  static guidanceLines(guidance, { advice, controlsLog }) {
    switch (guidance) {
      case ReopenedBrief.GUIDANCE.NONE:
        return []
      case ReopenedBrief.GUIDANCE.GLOBAL_INSTRUCTION:
        return [ReopenedBrief.GLOBAL_INSTRUCTION_LEAD, '', advice, '']
      case ReopenedBrief.GUIDANCE.CONTROLS_INSTRUCTION:
        return [ReopenedBrief.FIX_ROUND_CONTROLS_LEAD, '', advice, '', ...ReopenedBrief.logLines(controlsLog), '']
      case ReopenedBrief.GUIDANCE.JUDGE_INSTRUCTION:
        return [ReopenedBrief.FIX_ROUND_JUDGE_LEAD, '', advice, '']
      case ReopenedBrief.GUIDANCE.ADVISER:
        return [
          ReopenedBrief.FIX_ROUND_ADVISER_LEAD,
          '',
          advice.approach,
          '',
          '**Files to reconsider before editing:**',
          '',
          ReopenedBrief.pathLines(advice.files_to_reconsider),
          '',
        ]
      default:
        throw new Error(`a fix round guidance this version does not know: "${guidance}"`)
    }
  }

  static pathLines(paths) {
    return paths.length ? paths.map((p) => `- \`${p}\``).join('\n') : '(none in particular)'
  }

  static logLines(log) {
    if (log.text === null) return [ReopenedBrief.UNREADABLE_LOG]
    return [
      `The last log, at \`${log.path}\` (its last ${ReopenedBrief.LOG_TAIL_LINES} lines):`,
      '',
      '```text',
      ...ReopenedBrief.tailOf(log.text),
      '```',
    ]
  }

  static tailOf(logText) {
    return logText.replace(/\n$/, '').split('\n').slice(-ReopenedBrief.LOG_TAIL_LINES)
  }
}
