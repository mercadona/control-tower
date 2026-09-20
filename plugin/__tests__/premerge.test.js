import { describe, expect, it } from 'vitest'
import { Premerge, PremergeVerdict } from '../scripts/premerge.js'

class Rehearsed {
  static green(about, suites = ['backend']) { return { about, suites, verdict: PremergeVerdict.GREEN } }
  static red(about, detail = 'backend') { return { about, suites: ['backend'], verdict: PremergeVerdict.RED, detail } }
  static conflict(about, detail = 'CONFLICT in README.md') {
    return { about, suites: [], verdict: PremergeVerdict.CONFLICT, detail }
  }
  static flake(about, detail = 'ct-api-real-process') {
    return { about, suites: ['backend'], verdict: PremergeVerdict.FLAKE, detail }
  }
  static unmeasured(about, detail = 'npm ci failed') {
    return { about, suites: [], verdict: PremergeVerdict.UNMEASURED, detail }
  }
}

describe('which suites the rehearsal runs', () => {
  it('asks_the_same_object_the_workflow_asks_instead_of_deciding_again', () => {
    expect(Premerge.suitesFor(['backend/src/a.ts'])).toEqual(['backend'])
    expect(Premerge.suitesFor(['plugin/scripts/a.js'])).toEqual(['plugin', 'backend'])
    expect(Premerge.suitesFor(['README.md'])).toEqual(['plugin', 'backend', 'frontend'])
  })

  it('names_a_command_for_every_package_it_can_name', () => {
    for (const suite of Premerge.suitesFor(['README.md'])) {
      expect(Premerge.COMMANDS[suite]).toBeDefined()
    }
  })
})

describe('which combinations it rehearses', () => {
  it('every_unordered_pair_because_the_merge_order_is_not_known_in_advance', () => {
    expect(Premerge.pairsOf([473, 472, 474])).toEqual([[472, 473], [472, 474], [473, 474]])
  })

  it('one_open_pull_request_has_nothing_to_be_combined_with', () => {
    expect(Premerge.pairsOf([472])).toEqual([])
    expect(Premerge.pairsOf([])).toEqual([])
  })

  it('the_same_number_twice_is_one_pull_request', () => {
    expect(Premerge.pairsOf([472, 472])).toEqual([])
  })
})

describe('a red is not reported until it has been seen alone', () => {
  it('a_suite_that_passes_first_time_is_green_and_is_never_re_run', () => {
    expect(Premerge.verdictOf({ first: true })).toBe(PremergeVerdict.GREEN)
  })

  it('a_suite_that_fails_and_fails_again_alone_is_a_red', () => {
    expect(Premerge.verdictOf({ first: false, alone: false })).toBe(PremergeVerdict.RED)
  })

  it('a_suite_that_fails_and_passes_alone_is_said_to_be_a_flake_rather_than_hidden_as_a_pass', () => {
    expect(Premerge.verdictOf({ first: false, alone: true })).toBe(PremergeVerdict.FLAKE)
  })

  it('a_failure_nobody_re_ran_stays_a_red_rather_than_being_excused', () => {
    expect(Premerge.verdictOf({ first: false })).toBe(PremergeVerdict.RED)
  })
})

describe('what the rehearsal answers with', () => {
  it('the_1_never_degrades_to_a_3_and_the_3_never_to_a_0', () => {
    expect(Premerge.exitCodeFor([Rehearsed.green(472)])).toBe(0)
    expect(Premerge.exitCodeFor([Rehearsed.green(472), Rehearsed.flake(473)])).toBe(0)
    expect(Premerge.exitCodeFor([Rehearsed.green(472), Rehearsed.red(473)])).toBe(3)
    expect(Premerge.exitCodeFor([Rehearsed.green(472), Rehearsed.conflict(473)])).toBe(3)
    expect(Premerge.exitCodeFor([Rehearsed.red(473), Rehearsed.unmeasured(474)])).toBe(1)
  })

  it('names_the_pull_request_and_what_happened_to_it', () => {
    expect(Premerge.lineFor(Rehearsed.green(472))).toContain('#472')
    expect(Premerge.lineFor(Rehearsed.green(472))).toContain('holds on the current main')
    expect(Premerge.lineFor(Rehearsed.red(473, 'backend'))).toContain('WOULD BREAK')
    expect(Premerge.lineFor(Rehearsed.conflict(474))).toContain('does not rebase onto main')
  })

  it('a_pair_is_named_as_a_pair_so_nobody_reads_it_as_one_of_the_two', () => {
    expect(Premerge.lineFor(Rehearsed.green([472, 473]))).toContain('#472 with #473')
  })

  it('a_flake_says_it_held_and_still_names_what_failed_first', () => {
    const line = Premerge.lineFor(Rehearsed.flake(473, 'ct-api-real-process'))

    expect(line).toContain('holds')
    expect(line).toContain('ct-api-real-process')
    expect(line).toContain('under load, not from the change')
  })

  it('something_it_could_not_measure_is_never_printed_as_a_pass', () => {
    expect(Premerge.lineFor(Rehearsed.unmeasured(474))).toContain('COULD NOT BE MEASURED')
    expect(Premerge.report([])).toEqual(['nothing open to rehearse'])
  })
})
