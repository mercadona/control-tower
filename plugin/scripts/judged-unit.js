import { PHASES } from './run-machine.js'
import { commitMessage, reviewCommitMessage, fixRoundCommitMessage } from './step-contracts.js'

export class BriefLead {
  constructor({ n, withContext }) {
    this.n = n
    this.withContext = withContext
    Object.freeze(this)
  }
}

export class BriefAppendix {
  constructor({ n }) {
    this.n = n
    this.heading = `\n## Task ${n} of the slice\n\n`
    Object.freeze(this)
  }
}

export class PromisedTests {
  static NONE = new PromisedTests({ testsAdded: [], testsRemoved: [] })

  constructor({ testsAdded, testsRemoved }) {
    this.testsAdded = Object.freeze([...testsAdded])
    this.testsRemoved = Object.freeze([...testsRemoved])
    Object.freeze(this)
  }
}

class JudgedTask {
  constructor({ run, task, issue }) {
    this.run = run
    this.task = task
    this.issue = issue
    this.stem = `task-${run.task}`
    Object.freeze(this)
  }

  get diffBase() { return [] }

  get commands() { return this.task.commands }

  get promisedTests() { return new PromisedTests(this.task) }

  get verdictPath() { return `docs/superpowers/verdicts/issue-${this.issue}-${this.stem}.json` }

  verdictRecord(verdict) {
    return { issue: this.issue, task: this.run.task, task_name: this.task?.name ?? null, verdict }
  }

  commitMessage() {
    return commitMessage({ issue: this.issue, task: this.run.task, tasksTotal: this.run.tasksTotal, name: this.task.name })
  }

  get commitsForTheSlice() { return false }

  committedLine(sha) { return `task ${this.run.task}/${this.run.tasksTotal} committed: ${sha.slice(0, 7)}` }

  get packageHeader() {
    return `# Review package: task ${this.run.task}/${this.run.tasksTotal} of issue #${this.issue} (staged, not yet committed)`
  }

  get briefLead() { return new BriefLead({ n: this.run.task, withContext: true }) }

  get briefAppendices() { return [] }

  get nextHeading() { return `task ${this.run.task}/${this.run.tasksTotal} — ${this.task.name}` }

  get sentBackLines() { return [] }

  get vetoedName() { return `task ${this.run.task}` }

  get vetoedSelf() { return 'this task' }

  get reopenedAt() { return `task ${this.run.task}` }

  get adviceLine() {
    return "The judge has vetoed this task twice. On accepting the advice, the program returns the tree to the last commit for the task's paths and the third attempt's brief carries inside it the approach the advisor dictates: do NOT dispatch an implementer now."
  }
}

class JudgedReview {
  constructor({ run, tasks, issue }) {
    this.run = run
    this.tasks = tasks
    this.issue = issue
    this.stem = 'review'
    Object.freeze(this)
  }

  get diffBase() { return [this.run.baseSha] }

  get commands() { return this.tasks.flatMap((t) => t.commands) }

  get promisedTests() { return PromisedTests.NONE }

  get verdictPath() { return `docs/superpowers/verdicts/issue-${this.issue}-${this.stem}.json` }

  verdictRecord(verdict) {
    return { issue: this.issue, tasks_total: this.run.tasksTotal, verdict }
  }

  commitMessage() {
    return reviewCommitMessage({ issue: this.issue, tasksTotal: this.run.tasksTotal })
  }

  get commitsForTheSlice() { return true }

  committedLine(sha) { return `the judge's review committed: ${sha.slice(0, 7)}` }

  get packageHeader() {
    return `# Review package: the ${this.run.tasksTotal} tasks of issue #${this.issue} (committed since ${this.run.baseSha.slice(0, 7)}, fixes staged)`
  }

  get briefLead() { return new BriefLead({ n: 1, withContext: true }) }

  get briefAppendices() {
    return Array.from({ length: Math.max(this.run.tasksTotal - 1, 0) }, (_, i) => new BriefAppendix({ n: i + 2 }))
  }

  get nextHeading() { return `slice of issue ${this.issue} — the review of the ${this.run.tasksTotal} tasks` }

  get sentBackLines() {
    return ['The judge reviewed the whole slice: fix every finding, in any file of any task. The fixes land in one commit after the judge approves them.']
  }

  get vetoedName() { return 'the review of the slice' }

  get vetoedSelf() { return 'the review of the slice' }

  get reopenedAt() { return 'the review' }

  get nothingToCommitWarning() {
    return "warning: nothing to commit of the judge's review (are the verdict and the telemetry gitignored?) — the run carries on."
  }

  get adviceLine() {
    return "The judge has vetoed the review of the slice twice. On accepting the advice, the program returns the tree to the last commit for the paths of the fix rounds and the third attempt's brief carries inside it the approach the advisor dictates: do NOT dispatch an implementer now."
  }
}

class FixRound {
  constructor({ run, tasks, issue }) {
    this.run = run
    this.tasks = tasks
    this.issue = issue
    this.stem = 'fix'
    Object.freeze(this)
  }

  get diffBase() { return [this.run.baseSha] }

  get commands() { return this.tasks.flatMap((t) => t.commands) }

  get promisedTests() { return PromisedTests.NONE }

  get verdictPath() { return `docs/superpowers/verdicts/issue-${this.issue}-${this.stem}.json` }

  commitMessage() {
    return fixRoundCommitMessage({ issue: this.issue, tasksTotal: this.run.tasksTotal })
  }

  get commitsForTheSlice() { return true }

  committedLine(sha) { return `the fix round committed: ${sha.slice(0, 7)}` }

  get briefLead() { return new BriefLead({ n: 1, withContext: true }) }

  get briefAppendices() {
    return Array.from({ length: Math.max(this.run.tasksTotal - 1, 0) }, (_, i) => new BriefAppendix({ n: i + 2 }))
  }

  get nextHeading() { return `slice of issue ${this.issue} — the fix round after the Global verification` }

  get sentBackLines() { return [] }

  get vetoedName() { return 'the fix round' }

  get reopenedAt() { return 'the fix round' }

  get nothingToCommitWarning() {
    return 'warning: nothing to commit of the fix round (are the fixes and the telemetry gitignored?) — the run carries on.'
  }
}

export class JudgedUnit {
  static of({ run, tasks, issue }) {
    switch (run.phase) {
      case PHASES.TASK:
      case PHASES.SLICE:
        return new JudgedTask({ run, task: tasks.find((t) => t.n === run.task), issue })
      case PHASES.REVIEW:
        return new JudgedReview({ run, tasks, issue })
      case PHASES.FIX:
        return new FixRound({ run, tasks, issue })
      default:
        throw new Error(`a run phase this version does not know: "${run.phase}"`)
    }
  }
}
