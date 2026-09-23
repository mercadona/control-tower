import { describe, it, expect } from 'vitest'
import { JudgedUnit, BriefLead, BriefAppendix, PromisedTests } from '../scripts/judged-unit.js'
import { newRun, JUDGING, PHASES } from '../scripts/run-machine.js'
import { commitMessage, reviewCommitMessage } from '../scripts/step-contracts.js'

const tasks = [
  { n: 1, name: 'the first task', commands: ['test -f uno.txt'], testsAdded: ['first test'], testsRemoved: [] },
  { n: 2, name: 'the second task', commands: ['test -f dos.txt', 'npm test'], testsAdded: [], testsRemoved: ['old test'] },
  { n: 3, name: 'the third task', commands: [], testsAdded: [], testsRemoved: [] },
]
const baseSha = 'abcdef0123456789abcdef0123456789abcdef01'
const run = (over) => ({
  ...newRun({ plan: 'p.md', issue: 7, baseSha, tasksTotal: 3, judging: JUDGING.FINAL }),
  ...over,
})
const unitOf = (over) => JudgedUnit.of({ run: run(over), tasks, issue: 7 })
const verdict = { ruling: 'PASS', findings: [] }

describe('the unit of a task', () => {
  const unit = unitOf({ task: 2, phase: PHASES.TASK })

  it('files its artefacts under the task number', () => {
    expect(unit.stem).toBe('task-2')
  })

  it('diffs the index against HEAD', () => {
    expect(unit.diffBase).toEqual([])
  })

  it("has controls measure the task's own commands", () => {
    expect(unit.commands).toEqual(['test -f dos.txt', 'npm test'])
  })

  it('checks the tests the task promised', () => {
    expect(unit.promisedTests).toBeInstanceOf(PromisedTests)
    expect(unit.promisedTests.testsAdded).toEqual([])
    expect(unit.promisedTests.testsRemoved).toEqual(['old test'])
  })

  it("writes its verdict under the task's name, naming the task", () => {
    expect(unit.verdictPath).toBe('docs/superpowers/verdicts/issue-7-task-2.json')
    expect(unit.verdictRecord(verdict)).toEqual({ issue: 7, task: 2, task_name: 'the second task', verdict })
  })

  it("commits with the task's message, as a task commit", () => {
    expect(unit.commitMessage()).toBe(commitMessage({ issue: 7, task: 2, tasksTotal: 3, name: 'the second task' }))
    expect(unit.commitsForTheSlice).toBe(false)
    expect(unit.committedLine('1234567890')).toBe('task 2/3 committed: 1234567')
  })

  it('heads its package as the staged task', () => {
    expect(unit.packageHeader).toBe('# Review package: task 2/3 of issue #7 (staged, not yet committed)')
  })

  it('briefs the task alone, with the plan context', () => {
    expect(unit.briefLead).toEqual(new BriefLead({ n: 2, withContext: true }))
    expect(unit.briefAppendices).toEqual([])
  })

  it('speaks of the task', () => {
    expect(unit.nextHeading).toBe('task 2/3 — the second task')
    expect(unit.sentBackLines).toEqual([])
    expect(unit.vetoedName).toBe('task 2')
    expect(unit.vetoedSelf).toBe('this task')
    expect(unit.reopenedAt).toBe('task 2')
    expect(unit.adviceLine).toMatch(/^The judge has vetoed this task twice\. .*for the task's paths/)
  })

  it('is still the last task in the slice phase', () => {
    const inTheSlice = unitOf({ task: 3, phase: PHASES.SLICE })
    expect(inTheSlice.stem).toBe('task-3')
    expect(inTheSlice.nextHeading).toBe('task 3/3 — the third task')
  })
})

describe('the unit of the review', () => {
  const unit = unitOf({ task: 3, phase: PHASES.REVIEW })

  it('files its artefacts under `review`, apart from the last task', () => {
    expect(unit.stem).toBe('review')
  })

  it('diffs the index against the run base', () => {
    expect(unit.diffBase).toEqual([baseSha])
  })

  it('has controls measure every task, in plan order', () => {
    expect(unit.commands).toEqual(['test -f uno.txt', 'test -f dos.txt', 'npm test'])
  })

  it('promises no test of its own', () => {
    expect(unit.promisedTests).toBe(PromisedTests.NONE)
    expect(unit.promisedTests.testsAdded).toEqual([])
    expect(unit.promisedTests.testsRemoved).toEqual([])
  })

  it('writes its verdict with the shape of the whole slice', () => {
    expect(unit.verdictPath).toBe('docs/superpowers/verdicts/issue-7-review.json')
    expect(unit.verdictRecord(verdict)).toEqual({ issue: 7, tasks_total: 3, verdict })
  })

  it("commits with the review's message, as a slice commit", () => {
    expect(unit.commitMessage()).toBe(reviewCommitMessage({ issue: 7, tasksTotal: 3 }))
    expect(unit.commitsForTheSlice).toBe(true)
    expect(unit.committedLine('1234567890')).toBe("the judge's review committed: 1234567")
  })

  it('heads its package as every task since the base', () => {
    expect(unit.packageHeader).toBe('# Review package: the 3 tasks of issue #7 (committed since abcdef0, fixes staged)')
  })

  it('briefs task 1 with the plan context and appends the rest under a heading each', () => {
    expect(unit.briefLead).toEqual(new BriefLead({ n: 1, withContext: true }))
    expect(unit.briefAppendices).toEqual([new BriefAppendix({ n: 2 }), new BriefAppendix({ n: 3 })])
    expect(unit.briefAppendices.map((a) => a.heading)).toEqual(['\n## Task 2 of the slice\n\n', '\n## Task 3 of the slice\n\n'])
  })

  it('appends nothing to the brief of a slice with one task', () => {
    const single = JudgedUnit.of({ run: run({ tasksTotal: 1, task: 1, phase: PHASES.REVIEW }), tasks: tasks.slice(0, 1), issue: 7 })
    expect(single.briefAppendices).toEqual([])
  })

  it('speaks of the review', () => {
    expect(unit.nextHeading).toBe('slice of issue 7 — the review of the 3 tasks')
    expect(unit.sentBackLines).toEqual(['The judge reviewed the whole slice: fix every finding, in any file of any task. The fixes land in one commit after the judge approves them.'])
    expect(unit.vetoedName).toBe('the review of the slice')
    expect(unit.vetoedSelf).toBe('the review of the slice')
    expect(unit.reopenedAt).toBe('the review')
    expect(unit.adviceLine).toMatch(/^The judge has vetoed the review of the slice twice\. .*for the paths of the fix rounds/)
  })
})

describe('the phase the unit is asked in', () => {
  it('a phase this version does not know throws instead of guessing a unit', () => {
    expect(() => unitOf({ phase: 'somewhere' })).toThrow(/"somewhere"/)
  })
})
