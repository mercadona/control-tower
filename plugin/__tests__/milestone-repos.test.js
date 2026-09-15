import { describe, it, expect } from 'vitest'
import { MilestoneRepos, RepoRefusal } from '../scripts/milestone-repos.js'

const HOME = 'o/home'

class Rows {
  static of(...cells) {
    return cells.map((cell, index) => ({ n: index + 1, repo: cell.repo ?? '', deps: cell.deps ?? [], depCell: cell.depCell ?? '–' }))
  }

  static home() {
    return Rows.of({ repo: '–' })
  }

  static homeAndOther() {
    return Rows.of({ repo: '–' }, { repo: 'o/other' })
  }
}

describe('MilestoneRepos.of — which repository a row lands in', () => {
  it('a row with no repository lands in the home repository and adds no target', () => {
    const answered = MilestoneRepos.of({ slices: Rows.home(), homeRepo: HOME })

    expect(answered.assignments.get(1)).toBe(HOME)
    expect(answered.targets).toEqual([HOME])
    expect(answered.refusals).toEqual([])
  })

  it('two repositories in one cell is refused and one is not', () => {
    const several = MilestoneRepos.of({ slices: Rows.of({ repo: 'o/a, o/b' }), homeRepo: HOME })
    const one = MilestoneRepos.of({ slices: Rows.of({ repo: 'o/a' }), homeRepo: HOME })

    expect(several.refusals).toEqual([{ n: 1, kind: RepoRefusal.SEVERAL, raw: 'o/a, o/b' }])
    expect(one.refusals).toEqual([])
    expect(one.assignments.get(1)).toBe('o/a')
  })

  it('a cell that is not owner/repo is refused as malformed naming the row', () => {
    const answered = MilestoneRepos.of({ slices: Rows.of({ repo: '`o/a`' }), homeRepo: HOME })

    expect(answered.refusals).toEqual([{ n: 1, kind: RepoRefusal.MALFORMED, raw: '`o/a`' }])
  })

  it('an empty cell and a no-value marker are the same answer: the home repository', () => {
    const answered = MilestoneRepos.of({ slices: Rows.of({ repo: '' }, { repo: '—' }), homeRepo: HOME })

    expect(answered.assignments.get(1)).toBe(HOME)
    expect(answered.assignments.get(2)).toBe(HOME)
    expect(answered.targets).toEqual([HOME])
  })

  it('targets are home first and then the order the table names them', () => {
    const slices = Rows.of({ repo: 'o/second' }, { repo: '–' }, { repo: 'o/first' }, { repo: 'o/second' })
    const answered = MilestoneRepos.of({ slices, homeRepo: HOME })

    expect(answered.targets).toEqual([HOME, 'o/second', 'o/first'])
  })

  it('a row naming the home repository in another case does not add a second target', () => {
    const answered = MilestoneRepos.of({ slices: Rows.of({ repo: 'O/Home' }), homeRepo: HOME })

    expect(answered.targets).toEqual([HOME])
    expect(answered.assignments.get(1)).toBe(HOME)
  })
})

describe('MilestoneRepos — a dependency names a slice of the same repository', () => {
  it('a dependency on a row of another repository is answered with both repositories', () => {
    const slices = Rows.of({ repo: '–' }, { repo: 'o/other', deps: [1], depCell: '#1' })
    const { assignments } = MilestoneRepos.of({ slices, homeRepo: HOME })

    expect(MilestoneRepos.crossRepoDeps({ slices, assignments }))
      .toEqual([{ n: 2, repo: 'o/other', dep: 1, depRepo: HOME }])
  })

  it('a dependency inside the same repository is not answered', () => {
    const slices = Rows.of({ repo: 'o/other' }, { repo: 'o/other', deps: [1], depCell: '#1' })
    const { assignments } = MilestoneRepos.of({ slices, homeRepo: HOME })

    expect(MilestoneRepos.crossRepoDeps({ slices, assignments })).toEqual([])
  })

  it('a dependency on a row that does not exist is left to the parser that already reports it', () => {
    const slices = Rows.of({ repo: '–', deps: [9], depCell: '#9' })
    const { assignments } = MilestoneRepos.of({ slices, homeRepo: HOME })

    expect(MilestoneRepos.crossRepoDeps({ slices, assignments })).toEqual([])
  })

  it('the owner/repo#N spelling is answered even though DEP_RE already took its number', () => {
    const slices = Rows.of({ repo: '–' }, { repo: '–', deps: [1], depCell: 'o/other#1' })

    expect(MilestoneRepos.namedRepoDeps(slices)).toEqual([{ n: 2, raw: 'o/other#1', repo: 'o/other' }])
  })

  it('a plain #N is not read as a spelling that names a repository', () => {
    const slices = Rows.of({ repo: '–' }, { repo: '–', deps: [1], depCell: '#1' })

    expect(MilestoneRepos.namedRepoDeps(slices)).toEqual([])
  })
})

describe('MilestoneRepos — the reach that survives the groom', () => {
  it('the reach marker renders home first and parses back to the same value', () => {
    const { targets } = MilestoneRepos.of({ slices: Rows.homeAndOther(), homeRepo: HOME })
    const marker = MilestoneRepos.reachMarkerFor({ home: HOME, targets })

    expect(marker).toBe('<!-- ct-repos:o/home,o/other -->')
    expect(MilestoneRepos.reachIn(marker)).toEqual({ home: HOME, targets: [HOME, 'o/other'] })
  })

  it('a description with no marker reads as no reach', () => {
    expect(MilestoneRepos.reachIn('Epic of the quarter')).toBe(null)
    expect(MilestoneRepos.reachIn(null)).toBe(null)
  })

  it('a milestone reaching only its home repository still renders a marker', () => {
    const marker = MilestoneRepos.reachMarkerFor({ home: HOME, targets: [HOME] })

    expect(marker).toBe('<!-- ct-repos:o/home -->')
    expect(MilestoneRepos.reachIn(marker)).toEqual({ home: HOME, targets: [HOME] })
  })

  it('a marker with a mangled entry keeps the entries it can read', () => {
    expect(MilestoneRepos.reachIn('<!-- ct-repos:o/home, not a repo ,o/other -->'))
      .toEqual({ home: HOME, targets: [HOME, 'o/other'] })
  })

  it('a marker with nothing readable inside reads as no reach', () => {
    expect(MilestoneRepos.reachIn('<!-- ct-repos: -->')).toBe(null)
  })

  it('the marker travels inside a description a human also writes in', () => {
    const description = `The quarter's epic.\n\n${MilestoneRepos.reachMarkerFor({ home: HOME, targets: [HOME, 'o/other'] })}\n`

    expect(MilestoneRepos.reachIn(description).targets).toEqual([HOME, 'o/other'])
    expect(MilestoneRepos.withReach(description, { home: HOME, targets: [HOME, 'o/other'] })).toBe(description)
  })

  it('a description without the marker gains it at the end and keeps what was written', () => {
    const grown = MilestoneRepos.withReach('Written by a human', { home: HOME, targets: [HOME] })

    expect(grown).toBe(`Written by a human\n\n<!-- ct-repos:o/home -->`)
    expect(MilestoneRepos.reachIn(grown)).toEqual({ home: HOME, targets: [HOME] })
  })

  it('a description whose marker is out of date is rewritten in place', () => {
    const before = `Top\n\n<!-- ct-repos:o/home -->\n\nBottom`
    const after = MilestoneRepos.withReach(before, { home: HOME, targets: [HOME, 'o/other'] })

    expect(after).toBe(`Top\n\n<!-- ct-repos:o/home,o/other -->\n\nBottom`)
  })
})
