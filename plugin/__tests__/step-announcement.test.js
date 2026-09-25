import { describe, it, expect } from 'vitest'

import {
  RESPONSE_KINDS,
  RESPONSE_KIND_OF_STEP,
  INPUT_KINDS,
  AnnouncedResponse,
  AnnouncedInput,
  StepAnnouncement,
  MalformedAnnouncement,
} from '../scripts/step-announcement.js'
import { RoleBytes } from '../scripts/role-bytes.js'
import { STEPS, RUN_STATES, OUTCOMES } from '../scripts/run-machine.js'
import { RunClosure } from '../scripts/run-closure.js'

describe('the response channel each dispatch step answers through', () => {
  it('every dispatch step declares the channel its role answers through', () => {
    expect(Object.keys(RESPONSE_KIND_OF_STEP).sort()).toEqual([...RoleBytes.STEPS].sort())
    expect(RESPONSE_KIND_OF_STEP[STEPS.IMPLEMENT]).toBe(RESPONSE_KINDS.STRUCTURED)
    expect(RESPONSE_KIND_OF_STEP[STEPS.JUDGE]).toBe(RESPONSE_KINDS.FILE)
    expect(RESPONSE_KIND_OF_STEP[STEPS.ADVISE]).toBe(RESPONSE_KINDS.STRUCTURED)
    expect(RESPONSE_KIND_OF_STEP[STEPS.SLICE_JUDGE]).toBe(RESPONSE_KINDS.FILE)
    expect(RESPONSE_KIND_OF_STEP[STEPS.RECONCILE]).toBe(RESPONSE_KINDS.EDITS)
  })

  it('a step with no declared channel is malformed', () => {
    expect(() => AnnouncedResponse.of(STEPS.CONTROLS, 'some/path')).toThrow(MalformedAnnouncement)
  })

  it('a file response without a path is malformed', () => {
    expect(() => AnnouncedResponse.of(STEPS.JUDGE, '')).toThrow(MalformedAnnouncement)
  })

  it('an edits response with a path is malformed', () => {
    expect(() => AnnouncedResponse.of(STEPS.RECONCILE, 'some/path')).toThrow(MalformedAnnouncement)
  })

  it('an input with an undeclared role is malformed', () => {
    expect(() => new AnnouncedInput({ role: 'undeclared-role', kind: INPUT_KINDS.LITERAL, path: 'some/path' }))
      .toThrow(MalformedAnnouncement)
  })
})

describe('the announcement declares its whole shape', () => {
  it('a dispatch announcement prints version kind run and the response and nothing else', () => {
    const announcement = StepAnnouncement.dispatch({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      attempt: 1,
      response: AnnouncedResponse.of(STEPS.JUDGE, '.agent/verdict-42-1.json'),
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"step","run":{"issue":42,"task":1,"tasksTotal":5,"step":"judge","attempt":1},"dispatch":{"response":{"kind":"file","path":".agent/verdict-42-1.json"}}}\n'
    )
  })

  it('a dispatch announcement prints its consuming command as the last key of the object', () => {
    const announcement = StepAnnouncement.dispatch({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      attempt: 1,
      response: AnnouncedResponse.of(STEPS.JUDGE, '.agent/verdict-42-1.json'),
      consuming: { argv: ['verdict', '.agent/verdict-42-1.json', '--plan', 'plan.md', '--issue', '42'] },
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"step","run":{"issue":42,"task":1,"tasksTotal":5,"step":"judge","attempt":1},"dispatch":{"response":{"kind":"file","path":".agent/verdict-42-1.json"}},"consuming":{"argv":["verdict",".agent/verdict-42-1.json","--plan","plan.md","--issue","42"]}}\n'
    )
  })

  it('a program step prints its run and no dispatch key', () => {
    const announcement = StepAnnouncement.program({
      issue: 42,
      task: 2,
      tasksTotal: 5,
      step: STEPS.CONTROLS,
      attempt: 1,
      commands: ['npm test'],
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"step","run":{"issue":42,"task":2,"tasksTotal":5,"step":"controls","attempt":1},"commands":["npm test"]}\n'
    )
  })

  it('a transition prints its state outcome and exit', () => {
    const announcement = StepAnnouncement.transition({
      issue: 42,
      task: 5,
      tasksTotal: 5,
      step: STEPS.COMMIT,
      discards: 0,
      state: RUN_STATES.OPEN,
      outcome: OUTCOMES.DONE,
      exit: 0,
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"transition","state":"open","outcome":"done","exit":0,"run":{"issue":42,"task":5,"tasksTotal":5,"step":"commit","discards":0}}\n'
    )
  })

  it('a refusal prints its state outcome exit run and detail', () => {
    const announcement = StepAnnouncement.refusal({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      discards: 1,
      state: RUN_STATES.BLOCKED_JUDGE,
      outcome: OUTCOMES.FAILED,
      exit: 1,
      detail: 'the judge vetoed twice',
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,"run":{"issue":42,"task":1,"tasksTotal":5,"step":"judge","discards":1},"detail":"the judge vetoed twice"}\n'
    )
  })

  it('a refusal prints the findings and the verdict path after its detail', () => {
    const announcement = StepAnnouncement.refusal({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      discards: 1,
      state: RUN_STATES.BLOCKED_JUDGE,
      outcome: OUTCOMES.FAILED,
      exit: 1,
      detail: 'the judge vetoed three times',
      findings: '- [high] uno.txt:1: mal',
      verdict: '.agent/run-42/task-1-verdict-3.json',
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,'
      + '"run":{"issue":42,"task":1,"tasksTotal":5,"step":"judge","discards":1},'
      + '"detail":"the judge vetoed three times",'
      + '"findings":"- [high] uno.txt:1: mal","verdict":".agent/run-42/task-1-verdict-3.json"}\n'
    )
  })

  it('a refusal with nothing to say about the verdict prints neither key, because a stale reader must see what it always saw', () => {
    const announcement = StepAnnouncement.refusal({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      discards: 1,
      state: RUN_STATES.BLOCKED_JUDGE,
      outcome: OUTCOMES.FAILED,
      exit: 1,
      detail: 'the judge vetoed three times',
      findings: null,
      verdict: null,
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"refusal","state":"blocked-judge","outcome":"failed","exit":1,'
      + '"run":{"issue":42,"task":1,"tasksTotal":5,"step":"judge","discards":1},'
      + '"detail":"the judge vetoed three times"}\n'
    )
  })

  it('a refusal prints the failing command its exit and the log after its detail', () => {
    const run = {
      closed: RUN_STATES.BLOCKED_GLOBAL,
      lastFailure: { outcome: OUTCOMES.FAILED, command: 'npm test', code: 1, log: '.agent/run-42/global.log' },
    }
    const announcement = StepAnnouncement.refusal({
      issue: 42,
      task: 5,
      tasksTotal: 5,
      step: STEPS.GLOBAL,
      discards: 0,
      state: RUN_STATES.BLOCKED_GLOBAL,
      outcome: OUTCOMES.FAILED,
      exit: 11,
      detail: 'the Global verification is red',
      failure: RunClosure.failureOf(run),
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"refusal","state":"blocked-global","outcome":"failed","exit":11,'
      + '"run":{"issue":42,"task":5,"tasksTotal":5,"step":"global","discards":0},'
      + '"detail":"the Global verification is red",'
      + '"failure":{"command":"npm test","code":1,"log":".agent/run-42/global.log"}}\n'
    )
  })

  it('a refusal with no detail is malformed', () => {
    expect(() => StepAnnouncement.refusal({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      discards: 0,
      state: RUN_STATES.BLOCKED_JUDGE,
      outcome: OUTCOMES.FAILED,
      exit: 1,
    })).toThrow(MalformedAnnouncement)
  })

  it('a dispatch announcement with no response is malformed', () => {
    expect(() => StepAnnouncement.dispatch({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.JUDGE,
      attempt: 1,
    })).toThrow(MalformedAnnouncement)
  })

  it('a program step with no commands renders a line with no commands key', () => {
    const announcement = StepAnnouncement.program({
      issue: 42,
      task: 2,
      tasksTotal: 5,
      step: STEPS.CONTROLS,
      attempt: 1,
    })

    expect(announcement.text()).toBe(
      '{"version":1,"kind":"step","run":{"issue":42,"task":2,"tasksTotal":5,"step":"controls","attempt":1}}\n'
    )
  })

  it('an announcement of an undeclared state is malformed', () => {
    expect(() => StepAnnouncement.transition({
      issue: 42,
      task: 1,
      tasksTotal: 5,
      step: STEPS.COMMIT,
      discards: 0,
      state: 'made-up-state',
      outcome: OUTCOMES.DONE,
      exit: 0,
    })).toThrow(MalformedAnnouncement)
  })
})
