import { isNoValueCell } from './cells.js'
import { parseRepoSlug } from './dispatch.js'

export const RepoRefusal = Object.freeze({
  SEVERAL: 'several',
  MALFORMED: 'malformed',
})

export class MilestoneRepos {
  static MARKER_OPEN = '<!-- ct-repos:'
  static MARKER_CLOSE = ' -->'
  static MARKER = /<!-- ct-repos:([^>]*)-->/
  static SEPARATOR = ','
  static #PIECES = /[\s,]+/
  static #NAMED_DEP = /([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)#\d+/g

  static of({ slices, homeRepo }) {
    const assignments = new Map()
    const targets = [homeRepo]
    const refusals = []
    for (const slice of slices || []) {
      const named = MilestoneRepos.#repoOfCell(slice.repo)
      if (named.kind !== undefined) {
        refusals.push({ n: slice.n, kind: named.kind, raw: named.raw })
        continue
      }
      const repo = named.repo === null ? homeRepo : MilestoneRepos.#knownAs(named.repo, targets)
      assignments.set(slice.n, repo)
      if (!MilestoneRepos.#includes(targets, repo)) targets.push(repo)
    }

    return { assignments, targets, refusals }
  }

  static crossRepoDeps({ slices, assignments }) {
    const crossing = []
    for (const slice of slices || []) {
      const repo = assignments.get(slice.n)
      if (repo === undefined) continue
      for (const dep of slice.deps || []) {
        const depRepo = assignments.get(dep)
        if (depRepo === undefined || MilestoneRepos.#same(repo, depRepo)) continue
        crossing.push({ n: slice.n, repo, dep, depRepo })
      }
    }

    return crossing
  }

  static namedRepoDeps(slices) {
    const named = []
    for (const slice of slices || []) {
      const cell = (slice.depCell || '').trim()
      if (!cell) continue
      MilestoneRepos.#NAMED_DEP.lastIndex = 0
      let found
      while ((found = MilestoneRepos.#NAMED_DEP.exec(cell)) !== null) {
        named.push({ n: slice.n, raw: found[0], repo: found[1] })
      }
    }

    return named
  }

  static reachMarkerFor({ home, targets }) {
    const reach = [home, ...(targets || []).filter((target) => !MilestoneRepos.#same(target, home))]

    return `${MilestoneRepos.MARKER_OPEN}${reach.join(MilestoneRepos.SEPARATOR)}${MilestoneRepos.MARKER_CLOSE}`
  }

  static reachIn(description) {
    const found = MilestoneRepos.MARKER.exec(description || '')
    if (found === null) return null
    const reach = found[1]
      .split(MilestoneRepos.SEPARATOR)
      .map((piece) => piece.trim())
      .filter((piece) => parseRepoSlug(piece) !== null)
    if (reach.length === 0) return null

    return { home: reach[0], targets: reach }
  }

  static withReach(description, { home, targets }) {
    const marker = MilestoneRepos.reachMarkerFor({ home, targets })
    const written = description || ''
    if (MilestoneRepos.MARKER.test(written)) {
      return written.replace(MilestoneRepos.MARKER, marker)
    }

    return written.trim() === '' ? marker : `${written}\n\n${marker}`
  }

  static #repoOfCell(cell) {
    const raw = (cell || '').trim()
    if (!raw || isNoValueCell(raw)) return { repo: null }
    const pieces = raw.split(MilestoneRepos.#PIECES).filter(Boolean)
    if (pieces.length > 1) return { kind: RepoRefusal.SEVERAL, raw }
    if (parseRepoSlug(pieces[0]) === null) return { kind: RepoRefusal.MALFORMED, raw }

    return { repo: pieces[0] }
  }

  static #knownAs(repo, targets) {
    const seen = targets.find((target) => MilestoneRepos.#same(target, repo))

    return seen === undefined ? repo : seen
  }

  static #includes(targets, repo) {
    return targets.some((target) => MilestoneRepos.#same(target, repo))
  }

  static #same(one, other) {
    return String(one).toLowerCase() === String(other).toLowerCase()
  }
}
