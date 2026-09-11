import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeHelpers, makeRepo } from './fixtures/ct-step-harness.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

class ResponsibilityRun {
  static TRACE = 'Responsibility trace: `Inspect.execute` orders the work; `Readiness.assess` decides; `GitSetup.read` supplies observations.'

  constructor() {
    this.root = makeRepo()
    this.origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: this.root, encoding: 'utf8' }).trim()
    this.helpers = makeHelpers(() => this.root)
    const path = join(this.root, 'plan.md')
    writeFileSync(path, readFileSync(path, 'utf8').replace('## 7. Tasks', `## 3. Reference patterns\n\n${ResponsibilityRun.TRACE}\n\n## 7. Tasks`))
  }

  close() {
    rmSyncBestEffort(this.root)
    rmSyncBestEffort(this.origin)
  }
}

describe('responsibility ownership reaches the executing session', () => {
  let run
  beforeEach(() => { run = new ResponsibilityRun() })
  afterEach(() => run.close())

  it('carries_the_plans_responsibility_trace_into_the_task_brief', () => {
    expect(run.helpers.ct('next').status).toBe(0)
    const brief = readFileSync(join(run.root, '.agent', 'run-7', 'task-1-brief.md'), 'utf8')
    expect(brief).toContain(ResponsibilityRun.TRACE)
  })

  it('tells_the_coordinator_to_stop_before_reporting_a_plan_convention_conflict_as_completion', () => {
    const next = run.helpers.ct('next')
    expect(next.status).toBe(0)
    expect(next.stdout).toContain('plan/convention conflict')
    expect(next.stdout).toContain('stop before `report`')
    expect(next.stdout).toContain('.agent/SLICE.md')
    expect(run.helpers.runState().step).toBe('implement')
  })
})
