import { SpecFreezeMother } from '__scenarios__/SpecFreezeMother'
import { SpecFreezeClient } from 'app/spec-freeze/client'

const answerWith = (answer: { status: number; body: string }) =>
  vi.stubGlobal('fetch', vi.fn(async () => new Response(answer.body, { status: answer.status })))

describe('SpecFreezeClient', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads a frozen spec whose target is null as frozen with no session, not as unavailable', async () => {
    answerWith(SpecFreezeMother.frozenWithoutSession())

    const outcome = await SpecFreezeClient.read()

    expect(outcome).toEqual({
      kind: 'frozen',
      target: null,
      spec: SpecFreezeMother.SPEC,
      on: SpecFreezeMother.ON,
      pullRequest: SpecFreezeMother.PULL_REQUEST,
    })
  })

  it('reads a draft with its key and every finding the backend named', async () => {
    answerWith(SpecFreezeMother.draftWithMarker())

    const outcome = await SpecFreezeClient.read()

    expect(outcome).toEqual({
      kind: 'draft',
      target: SpecFreezeMother.TARGET,
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
      target: SpecFreezeMother.TARGET,
      spec: SpecFreezeMother.SPEC,
      findings: [SpecFreezeMother.MARKER_FINDING, SpecFreezeMother.HYPOTHESIS_FINDING],
      key: null,
    })
  })

  it('the press sends the key in its header and reads the pull request back', async () => {
    const pressing = vi.fn(async () => new Response(SpecFreezeMother.frozen().body, { status: 200 }))
    vi.stubGlobal('fetch', pressing)

    const outcome = await SpecFreezeClient.freeze(SpecFreezeMother.KEY, SpecFreezeMother.TARGET)

    expect(pressing).toHaveBeenCalledWith('/spec-freeze', {
      method: 'POST',
      headers: {
        'x-gate-key': SpecFreezeMother.KEY,
        'x-coordinating-target': SpecFreezeMother.TARGET,
      },
    })
    expect(outcome).toEqual({
      kind: 'frozen',
      on: SpecFreezeMother.ON,
      pullRequest: SpecFreezeMother.PULL_REQUEST,
    })
  })

  it('a refusal is read as its code and its detail', async () => {
    answerWith(SpecFreezeMother.notFreezable())

    const outcome = await SpecFreezeClient.freeze(SpecFreezeMother.KEY, SpecFreezeMother.TARGET)

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'spec-not-freezable',
      error: 'El spec todavía no cumple las condiciones para congelarse.',
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
    const pressed = await SpecFreezeClient.freeze(SpecFreezeMother.KEY, SpecFreezeMother.TARGET)

    expect(read).toEqual({ kind: 'unavailable' })
    expect(pressed).toEqual({ kind: 'backend-unreachable' })
  })

  it('a read the backend refused is read as its code and detail, not as unavailable', async () => {
    answerWith(SpecFreezeMother.refusedRead())

    const outcome = await SpecFreezeClient.read()

    expect(outcome).toEqual({
      kind: 'refused',
      code: 'epic-spec-not-understood',
      error: 'No se ha podido interpretar el spec del epic.',
    })
  })
})
