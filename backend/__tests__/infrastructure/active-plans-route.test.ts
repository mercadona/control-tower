import { describe, expect, it } from 'vitest'
import { ActivePlans } from '../../src/infrastructure/active-plans-route.ts'
import { PlanSessions } from '../../src/infrastructure/plan-sessions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'

const watch = new PlanWatch({
  story: null,
  issue: new PlanIssue({ number: 7, url: 'https://github.com/owner/name/issues/7' }),
  located: new WorkspaceLocation({ root: '/repo', path: '/repo/.worktrees/7', branch: 'feat/7' }),
  repository: new RepositoryName('owner/name'),
  agent: '11111111-1111-4111-8111-111111111111',
})

describe('the JSON /active-plans sends for an uncertain plan', () => {
  it('an uncertain plan the judge closed carries what it found, so the page needs no second call', () => {
    const plans = new ActivePlans({ sessions: new PlanSessions() })
    plans.rememberUncertain(
      watch,
      'ct-step refused: the run is blocked-judge with outcome failed (exit 1)',
      { action: 'inspect', detail: 'ct-step refused' },
      {
        state: 'blocked-judge', outcome: 'failed', exit: 1, task: 2,
        findings: '- [high] uno.ts:1: mal', verdict: '.agent/run-7/task-2-verdict-3.json',
      },
    )

    const [projected] = plans.known()

    expect(projected!.refusal).toEqual({
      state: 'blocked-judge',
      outcome: 'failed',
      exit: 1,
      task: 2,
      findings: '- [high] uno.ts:1: mal',
      verdict: '.agent/run-7/task-2-verdict-3.json',
    })
  })
})
