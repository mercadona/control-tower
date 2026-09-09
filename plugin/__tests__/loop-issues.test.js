import { describe, it, expect } from 'vitest'
import { loadIssues } from '../scripts/loop-issues.js'

describe('loadIssues', () => {
  it('flattens the pages, discards PRs and normalises state_reason to upper case', () => {
    const gh = (args) => {
      const abierto = args.includes('state=open')
      return JSON.stringify([[
        abierto
          ? { number: 1, body: 'x', labels: [] }
          : { number: 2, body: 'y', state_reason: 'completed', labels: [] },
        { number: 99, body: 'soy un PR', pull_request: { url: 'x' } },
      ]])
    }
    const { abiertos, cerrados } = loadIssues({ repo: 'o/r', gh })
    expect(abiertos.map((i) => i.number)).toEqual([1])
    expect(cerrados.map((i) => i.number)).toEqual([2])
    expect(cerrados[0].stateReason).toBe('COMPLETED')
  })

  it('never passes --limit: the pagination is real', () => {
    const vistos = []
    const gh = (args) => { vistos.push(args.join(' ')); return '[[]]' }
    loadIssues({ repo: 'o/r', gh })
    for (const c of vistos) {
      expect(c).toContain('--paginate')
      expect(c).not.toContain('--limit')
    }
  })

  it('returns the reason when a read fails, naming which one — it neither throws nor exits the process', () => {
    const gh = (args) => { if (args.includes('state=open')) throw new Error('rate limit'); return '[[]]' }
    const { motivos } = loadIssues({ repo: 'o/r', gh })
    expect(motivos).toHaveLength(1)
    expect(motivos[0]).toMatch(/open issues.*rate limit/s)
  })

  it('when the CLOSED ones fail, the open ones already read are NOT thrown away', () => {
    // Throwing when the second read failed discarded the first one, which was
    // already whole in memory: /ct-status printed an EMPTY report under «what
    // is above is only what it did manage to check», with nothing above.
    const gh = (args) => {
      if (args.includes('state=closed')) throw new Error('rate limit')
      return JSON.stringify([[{ number: 42, body: '', labels: [] }]])
    }
    const { abiertos, cerrados, motivos } = loadIssues({ repo: 'o/r', gh })
    expect(abiertos.map((i) => i.number)).toEqual([42])
    expect(cerrados).toEqual([])
    expect(motivos).toHaveLength(1)
    expect(motivos[0]).toMatch(/closed issues/)
  })

  it('when BOTH reads fail both are said, and neither degrades into "there are no issues"', () => {
    const gh = () => { throw new Error('sin red') }
    const { abiertos, cerrados, motivos } = loadIssues({ repo: 'o/r', gh })
    expect(abiertos).toEqual([])
    expect(cerrados).toEqual([])
    expect(motivos.map((m) => /open issues/.test(m) ? 'open' : 'closed')).toEqual(['open', 'closed'])
  })

  it('with both reads good, `motivos` comes back empty', () => {
    const { motivos } = loadIssues({ repo: 'o/r', gh: () => '[[]]' })
    expect(motivos).toEqual([])
  })
})
