import { describe, expect, it } from 'vitest'
import { WorkProgressResponse } from '../../src/infrastructure/work-progress-route.ts'
import { ReadWorkProgressResult } from '../../src/application/queries/read-work-progress.ts'
import { WorkProgress } from '../../src/domain/value-objects/work-progress.ts'
import { WorkProgressMother as BackendWork } from '../work-progress-mother.ts'
const CONTRACT_PATH = new URL('../../../frontend/src/app/work-progress/contract.ts', import.meta.url).href
const { WorkProgressContract } = await import(CONTRACT_PATH)

describe('work progress boundary', () => {
  it('reads the real backend planning projection, including one unavailable reading', () => {
    const result = new ReadWorkProgressResult(new WorkProgress(BackendWork.watch(), {
      phase: 'planning', plan: { kind: 'unavailable', detail: 'plan unreadable' },
      activity: { kind: 'available', value: BackendWork.activity() },
    }))
    expect(WorkProgressContract.read(WorkProgressResponse.of(result))).toEqual({
      repo: 'owner/name', issue: 7, agent: 'conversation-7',
      progress: { phase: 'planning', plan: { kind: 'unavailable', detail: 'plan unreadable' }, activity: {
        kind: 'available', value: { state: 'running', runningMs: 3000, toolCalls: 2, lastTool: { name: 'Read', argument: 'src/main.ts' }, lastText: 'Reading conventions' },
      } },
    })
  })

  it('reads the real backend execution projection without a second model of its wire format', () => {
    const result = new ReadWorkProgressResult(new WorkProgress(BackendWork.watch(), {
      phase: 'implementing', execution: { kind: 'available', value: BackendWork.execution() },
    }))
    expect(WorkProgressContract.read(WorkProgressResponse.of(result)).progress).toEqual({
      phase: 'implementing', execution: { kind: 'available', value: { step: 'implement', task: 1, totalTasks: 3, name: 'Keep progress visible', attempt: 1, discards: 0, pullRequest: null } },
    })
  })

  it('keeps a partial delivery reading explicit when transferring known execution to the frontend', () => {
    const result = new ReadWorkProgressResult(new WorkProgress(BackendWork.watch(), {
      phase: 'implementing', execution: { kind: 'partial', value: BackendWork.execution(), detail: 'delivery unavailable' },
    }))
    expect(WorkProgressContract.read(WorkProgressResponse.of(result)).progress).toMatchObject({
      phase: 'implementing', execution: { kind: 'partial', value: { step: 'implement' }, detail: 'delivery unavailable' },
    })
  })

  it('carries local completion alongside attention without claiming verified publication', () => {
    const result = new ReadWorkProgressResult(new WorkProgress(BackendWork.watch(), {
      phase: 'uncertain', diagnostic: 'GitHub unavailable', recovery: { action: 'inspect', detail: 'Inspect publication' }, refusal: null,
      execution: { kind: 'partial', value: BackendWork.execution().underReview({ step: 'delivered', pullRequest: null }), detail: 'GitHub unavailable' },
    }))
    expect(WorkProgressContract.read(WorkProgressResponse.of(result)).progress).toMatchObject({
      phase: 'uncertain', recovery: { action: 'inspect' }, diagnostic: 'GitHub unavailable',
      execution: { kind: 'partial', value: { step: 'delivered', pullRequest: null }, detail: 'GitHub unavailable' },
    })
  })

  it.each([
    ['an unknown field', (body: any) => { body.extra = true }],
    ['an unknown phase', (body: any) => { body.progress.phase = 'invented' }],
    ['a missing identity', (body: any) => { delete body.agent }],
    ['an unreadable activity count', (body: any) => { body.progress.activity.value.tool_calls = -1 }],
  ])('rejects %s instead of silently assuming a healthy reading', (_name, corrupt) => {
    const body = JSON.parse(JSON.stringify(WorkProgressResponse.of(new ReadWorkProgressResult(new WorkProgress(BackendWork.watch(), {
      phase: 'planning', plan: { kind: 'available', value: 'ready' }, activity: { kind: 'available', value: BackendWork.activity() },
    })))))
    corrupt(body)
    expect(() => WorkProgressContract.read(body)).toThrow()
  })
})
