import { afterEach, describe, expect, it } from 'vitest'
import { RealStepRepo } from './fixtures/real-step.js'

describe('the ct-step executable edge', () => {
  afterEach(() => RealStepRepo.clean())

  it('the supported executable reads its arguments and writes the task brief from a path with spaces', () => {
    const repo = RealStepRepo.prepared()
    const result = repo.executable('next')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('task 1/1 — do the work')
    expect(result.stdout).toContain('DISPATCH AN IMPLEMENTER')
    expect(repo.read('.agent/run-7/task-1-brief.md')).toContain('### Task 1 — do the work')
    expect(JSON.parse(repo.read('.agent/run-7.json')).nextSeal).toBe('1:implement:1')
  })
})
