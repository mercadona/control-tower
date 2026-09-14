import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { SpecFreezeClient } from 'app/spec-freeze/client'

const answerWith = (answer: { status: number; body: string }) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))

describe('SpecFreezeClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a draft with its key and every finding the backend named', async () => {
    answerWith(SpecFreezeMother.draftWithMarker())

    const outcome = await SpecFreezeClient.read()

    expect(outcome).toEqual({
      kind: 'draft',
      spec: SpecFreezeMother.SPEC,
      findings: [SpecFreezeMother.MARKER_FINDING, SpecFreezeMother.HYPOTHESIS_FINDING],
      key: SpecFreezeMother.KEY,
    })
  })

  it('reads a draft with no key as key null instead of unavailable', async () => {
    answerWith(SpecFreezeMother.draftWithoutKey())

    const outcome = await SpecFreezeClient.read()

    expect(outcome).toEqual({
      kind: 'draft',
      spec: SpecFreezeMother.SPEC,
      findings: [SpecFreezeMother.MARKER_FINDING, SpecFreezeMother.HYPOTHESIS_FINDING],
      key: null,
    })
  })

  it('the press sends the key in its header and reads the pull request back', async () => {
    const pressing = vi.fn(async () => new Response(SpecFreezeMother.frozen().body, { status: 200 }))
    vi.stubGlobal('fetch', pressing)

    const outcome = await SpecFreezeClient.freeze(SpecFreezeMother.KEY)

    expect(pressing).toHaveBeenCalledWith('/spec-freeze', {
      method: 'POST',
      headers: { 'x-gate-key': SpecFreezeMother.KEY },
    })
    expect(outcome).toEqual({
      kind: 'frozen',
      on: SpecFreezeMother.ON,
      pullRequest: SpecFreezeMother.PULL_REQUEST,
    })
  })

  it('a refusal is read as its code and its detail', async () => {
    answerWith(SpecFreezeMother.notFreezable())

    const outcome = await SpecFreezeClient.freeze(SpecFreezeMother.KEY)

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'spec-not-freezable',
      error: SpecFreezeMother.NOT_FREEZABLE_DETAIL,
    })
  })

  it('a backend that does not answer is read as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    const read = await SpecFreezeClient.read()
    const pressed = await SpecFreezeClient.freeze(SpecFreezeMother.KEY)

    expect(read).toEqual({ kind: 'unavailable' })
    expect(pressed).toEqual({ kind: 'backend-unreachable' })
  })
})
