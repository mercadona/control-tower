import { describe, it, expect } from 'vitest'
import { StepScenario } from './fixtures/step-conversations.js'

class CapturedTools {
  static twoDistinctRequests() {
    return new StepScenario('fixture', null, { cuts: [], requests: {
      '["fixture","git",["status"],{}]': [{ output: { code: 0, stdout: 'status reply', stderr: '' } }],
      '["fixture","git",["show","a b"],{}]': [{ output: { code: 0, stdout: 'show reply', stderr: '' } }],
    } })
  }
}

describe('captured tool conversations', () => {
  it('answers by the literal request rather than the order in which different requests arrive', () => {
    const tools = CapturedTools.twoDistinctRequests()
    expect(tools.request('git', ['show', 'a b']).stdout).toBe('show reply')
    expect(tools.request('git', ['status']).stdout).toBe('status reply')
  })

  it('does not confuse one argument containing a space with two separate arguments', () => {
    const tools = CapturedTools.twoDistinctRequests()
    expect(() => tools.request('git', ['show', 'a', 'b'])).toThrow('No external answer declared')
    expect(tools.failures).toHaveLength(1)
  })

  it('rejects an extra request instead of repeating a consumed answer forever', () => {
    const tools = CapturedTools.twoDistinctRequests()
    tools.request('git', ['status'])
    expect(() => tools.request('git', ['status'])).toThrow('No external answer declared')
  })

  it('keeps an omitted necessary request visible to the completion assertion', () => {
    const tools = CapturedTools.twoDistinctRequests()
    tools.request('git', ['status'])
    expect([...tools.answers].filter(([, replies]) => replies.length).map(([key]) => key))
      .toEqual(['["fixture","git",["show","a b"],{}]'])
  })

  it('independent reads can change order but a status read cannot cross the reset that makes it authoritative', () => {
    const reset = '["command 1","git",["reset","-q"],{}]'
    const status = '["command 1","git",["status","--porcelain"],{}]'
    const head = '["command 1","git",["rev-parse","HEAD"],{}]'
    expect(StepScenario.cutPoints([reset, status, head])).toEqual(StepScenario.cutPoints([reset, head, status]))
    expect(StepScenario.cutPoints([status, reset, head])).not.toEqual(StepScenario.cutPoints([reset, status, head]))
  })

})
