import { describe, it, expect } from 'vitest'
import { loadIssues } from '../scripts/loop-issues.js'

const page = (nodes, pageInfo = { hasNextPage: false, endCursor: null }) => ({ data: { repository: { issues: { nodes, pageInfo } } } })
const answer = (...pages) => JSON.stringify(pages)
const asksFor = (args, states) => args.some((a) => a.includes(`states:[${states}]`))

describe('loadIssues', () => {
  it('asks GraphQL for the open and the closed issues in two calls, by owner and name, with real pagination', () => {
    const seen = []
    const gh = (args) => { seen.push(args); return answer(page([])) }
    loadIssues({ repo: 'o/r', gh })
    expect(seen).toHaveLength(2)
    expect(asksFor(seen[0], 'OPEN')).toBe(true)
    expect(asksFor(seen[1], 'CLOSED')).toBe(true)
    for (const args of seen) {
      expect(args.slice(0, 2)).toEqual(['api', 'graphql'])
      expect(args).toContain('--paginate')
      expect(args).toContain('--slurp')
      expect(args).toContain('owner=o')
      expect(args).toContain('name=r')
      expect(args.join(' ')).not.toContain('--limit')
    }
  })

  it('never touches the REST issues endpoint: that one ships every pull request of the repository too', () => {
    const seen = []
    const gh = (args) => { seen.push(args.join(' ')); return answer(page([])) }
    loadIssues({ repo: 'o/r', gh })
    for (const call of seen) expect(call).not.toMatch(/repos\/o\/r\/issues/)
  })

  it('keeps the shape the dispatcher reads: labels flattened, the milestone with its number, stateReason as GitHub spells it', () => {
    const gh = (args) => asksFor(args, 'OPEN')
      ? answer(page([{ number: 1, title: '#1 a', body: 'x', state: 'OPEN', stateReason: null, milestone: { number: 7, title: 'M', description: 'd' }, labels: { nodes: [{ name: 'status:ready' }] } }]))
      : answer(page([{ number: 2, title: '#2 b', body: 'y', state: 'CLOSED', stateReason: 'COMPLETED', milestone: null, labels: { nodes: [{ name: 'status:in-review' }] } }]))
    const { abiertos, cerrados } = loadIssues({ repo: 'o/r', gh })
    expect(abiertos).toEqual([
      { number: 1, title: '#1 a', body: 'x', state: 'open', stateReason: null, milestone: { number: 7, title: 'M', description: 'd' }, labels: [{ name: 'status:ready' }] },
    ])
    expect(cerrados).toEqual([
      { number: 2, body: 'y', milestone: null, labels: [{ name: 'status:in-review' }], stateReason: 'COMPLETED' },
    ])
  })

  it('a closed issue with no stateReason travels as null, never as undefined', () => {
    const gh = (args) => asksFor(args, 'OPEN')
      ? answer(page([]))
      : answer(page([{ number: 2, title: '#2', body: '', state: 'CLOSED', milestone: null, labels: { nodes: [] } }]))
    const { cerrados } = loadIssues({ repo: 'o/r', gh })
    expect(cerrados[0].stateReason).toBe(null)
  })

  it('TWO pages → the issues of both come back, in order, and none is lost', () => {
    const node = (n) => ({ number: n, title: `#${n}`, body: '', state: 'CLOSED', stateReason: 'COMPLETED', milestone: null, labels: { nodes: [] } })
    const gh = (args) => asksFor(args, 'OPEN')
      ? answer(page([]))
      : answer(page([node(1), node(2)], { hasNextPage: true, endCursor: 'a' }), page([node(3)]))
    const { cerrados } = loadIssues({ repo: 'o/r', gh })
    expect(cerrados.map((i) => i.number)).toEqual([1, 2, 3])
  })

  it('returns the reason when a read fails, naming which one — it neither throws nor exits the process', () => {
    const gh = (args) => { if (asksFor(args, 'OPEN')) throw new Error('rate limit'); return answer(page([])) }
    const { motivos } = loadIssues({ repo: 'o/r', gh })
    expect(motivos).toHaveLength(1)
    expect(motivos[0]).toMatch(/open issues.*rate limit/s)
  })

  it('when the CLOSED ones fail, the open ones already read are NOT thrown away', () => {
    const gh = (args) => {
      if (asksFor(args, 'CLOSED')) throw new Error('rate limit')
      return answer(page([{ number: 42, title: '#42', body: '', state: 'OPEN', stateReason: null, milestone: null, labels: { nodes: [] } }]))
    }
    const { abiertos, cerrados, motivos } = loadIssues({ repo: 'o/r', gh })
    expect(abiertos.map((i) => i.number)).toEqual([42])
    expect(cerrados).toEqual([])
    expect(motivos).toHaveLength(1)
    expect(motivos[0]).toMatch(/closed issues/)
  })

  it('when BOTH reads fail both are said, and neither degrades into "there are no issues"', () => {
    const gh = () => { throw new Error('no network') }
    const { abiertos, cerrados, motivos } = loadIssues({ repo: 'o/r', gh })
    expect(abiertos).toEqual([])
    expect(cerrados).toEqual([])
    expect(motivos.map((m) => /open issues/.test(m) ? 'open' : 'closed')).toEqual(['open', 'closed'])
  })

  it('with both reads good, `motivos` comes back empty', () => {
    const { motivos } = loadIssues({ repo: 'o/r', gh: () => answer(page([])) })
    expect(motivos).toEqual([])
  })
})
