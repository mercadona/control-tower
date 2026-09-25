import { MilestoneProgressMother } from '__scenarios__/MilestoneProgressMother'
import { MilestoneProgressClient } from 'app/milestone-progress/client'

const answerWith = (answer: { status: number; body: string }) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))

describe('MilestoneProgressClient, against the wire shape backend/API.md documents for GET /milestone-progress', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a milestone with a running issue into camelCase', async () => {
    answerWith(MilestoneProgressMother.answer([MilestoneProgressMother.running(592)]))

    const outcome = await MilestoneProgressClient.read()

    expect(outcome).toEqual({
      kind: 'milestone',
      target: MilestoneProgressMother.TARGET,
      milestone: MilestoneProgressMother.MILESTONE,
      delivered: 0,
      total: 1,
      issues: [{
        number: 592,
        url: 'https://github.com/owner/name/issues/592',
        title: 'Slice #592',
        state: 'running',
        step: 'implement',
        task: 2,
        totalTasks: 4,
        stepStartedAt: '2026-09-25T09:00:00.000Z',
        lastTool: { name: 'Edit', argument: 'src/a.ts' },
        lastText: 'ready',
        pullRequest: null,
        attention: null,
        baselineRed: false,
        tasks: [],
      }],
    })
  })

  it('an issue with an unknown state makes the read unavailable', async () => {
    answerWith(MilestoneProgressMother.answer([{ ...MilestoneProgressMother.pending(592), state: 'unknown-state' }]))

    const outcome = await MilestoneProgressClient.read()

    expect(outcome).toEqual({ kind: 'unavailable' })
  })

  it('reads none and no-milestone', async () => {
    answerWith(MilestoneProgressMother.none())

    expect(await MilestoneProgressClient.read()).toEqual({ kind: 'none' })

    answerWith({ status: 200, body: `{"status":"no-milestone","target":"${MilestoneProgressMother.TARGET}"}` })

    expect(await MilestoneProgressClient.read()).toEqual({ kind: 'no-milestone', target: MilestoneProgressMother.TARGET })
  })

  it('a refused read is unavailable', async () => {
    answerWith({ status: 400, body: '{"code":"milestone-progress-not-read","detail":"the spec could not be read"}' })

    expect(await MilestoneProgressClient.read()).toEqual({ kind: 'unavailable' })
  })

  it('a network failure is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))

    expect(await MilestoneProgressClient.read()).toEqual({ kind: 'unavailable' })
  })
})
