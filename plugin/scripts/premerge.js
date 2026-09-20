import { ChangedPackages } from './changed-packages.js'

// THE REHEARSAL, as rules rather than as a script. What a pull request would do
// on top of the `main` it will actually land on, and what two of them would do
// on top of each other — the second question being the one no CI asks, because
// whichever lands second sits on a tree its own run never saw.
export const PremergeVerdict = Object.freeze({
  GREEN: 'green',
  RED: 'red',
  FLAKE: 'flake',
  CONFLICT: 'conflict',
  UNMEASURED: 'unmeasured',
})

export class Premerge {
  static EXIT = Object.freeze({ CLEAN: 0, UNMEASURED: 1, REVIEW: 3 })
  static COMMANDS = Object.freeze({
    plugin: ['npm', 'test', '--prefix', 'plugin'],
    backend: ['npm', 'test', '--prefix', 'backend'],
    frontend: ['npm', 'test', '--prefix', 'frontend'],
  })

  static suitesFor(files) {
    return ChangedPackages.namesIn(ChangedPackages.of(files))
  }

  // Every unordered pair, because a merge order is not known in advance and
  // both orders land on the same tree.
  static pairsOf(numbers) {
    const sorted = [...new Set(numbers)].sort((one, other) => one - other)

    return sorted.flatMap((first, index) => sorted.slice(index + 1).map((second) => [first, second]))
  }

  // The `*-real-process` family times out under load, so a red is never
  // reported until it has been seen alone. Passing alone is not a pass: it is a
  // flake, and it is said, because a flake reported as green is how a real
  // failure gets explained away next time.
  static verdictOf({ first, alone = null }) {
    if (first === true) return PremergeVerdict.GREEN
    if (alone === null) return PremergeVerdict.RED

    return alone === true ? PremergeVerdict.FLAKE : PremergeVerdict.RED
  }

  static exitCodeFor(results) {
    const verdicts = results.map((result) => result.verdict)
    if (verdicts.includes(PremergeVerdict.UNMEASURED)) return Premerge.EXIT.UNMEASURED
    if (verdicts.some((verdict) => verdict === PremergeVerdict.RED || verdict === PremergeVerdict.CONFLICT)) {
      return Premerge.EXIT.REVIEW
    }

    return Premerge.EXIT.CLEAN
  }

  static lineFor(result) {
    return `${Premerge.#subjectOf(result)}: ${Premerge.#TAILS[result.verdict](result)}`
  }

  static report(results) {
    if (results.length === 0) return ['nothing open to rehearse']

    return results.map((result) => Premerge.lineFor(result))
  }

  static #subjectOf(result) {
    return Array.isArray(result.about) ? `#${result.about[0]} with #${result.about[1]}` : `#${result.about}`
  }

  static #suitesOf(result) {
    return (result.suites ?? []).join(', ') || 'no suite'
  }

  static #TAILS = Object.freeze({
    [PremergeVerdict.GREEN]: (result) => `holds on the current main (${Premerge.#suitesOf(result)})`,
    [PremergeVerdict.RED]: (result) => `WOULD BREAK — ${result.detail ?? Premerge.#suitesOf(result)}`,
    [PremergeVerdict.CONFLICT]: (result) => `does not rebase onto main: ${result.detail ?? 'conflict'}`,
    [PremergeVerdict.FLAKE]: (result) =>
      `holds, but ${result.detail ?? 'a suite'} failed first and passed alone — under load, not from the change`,
    [PremergeVerdict.UNMEASURED]: (result) => `COULD NOT BE MEASURED — ${result.detail ?? 'unknown'}`,
  })
}
