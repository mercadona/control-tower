import { describe, it, expect } from 'vitest'
import { ReviewWatch } from '../../src/infrastructure/review-watch.ts'
import { MemoryReviewLog } from '../../src/infrastructure/memory-review-log.ts'
import { ChangeAsked } from '../../src/domain/value-objects/change-asked.ts'
import { PlanWatch } from '../../src/domain/value-objects/plan-watch.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PullRequestNotRead, PlanAgentNotResumed, SliceNotReopened } from '../../src/domain/exceptions.ts'
import type { ChangesAsked, Delivered } from '../../src/infrastructure/review-watch.ts'

type Sounding = ChangeAsked[] | Error

class WatchDouble {
  static LABEL = 'plan review watch'
  static AGENT = 'workspace:20'
  static NUMBER = 7
  static ISSUE = new PlanIssue({
    number: WatchDouble.NUMBER, url: 'https://github.com/josemerca/ct-loop-sandbox/issues/7',
  })
  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static SUBJECT = new PlanWatch({
    story: null,
    issue: WatchDouble.ISSUE,
    located: new WorkspaceLocation({ path: '/repo/.worktrees/7', branch: 'feat/7' }),
    repository: WatchDouble.REPOSITORY,
    agent: WatchDouble.AGENT,
  })

  static STOPPING = { issue: WatchDouble.NUMBER, repository: WatchDouble.REPOSITORY }

  readonly soundings: Sounding[]
  readonly refusingTheDelivery: Error | null
  refusalsLeft: number
  readonly stoppingOnDelivery: boolean
  readonly waits: number
  readonly label: string
  readonly asked: PlanWatch[]
  readonly reviewed: Delivered[]
  readonly warnings: string[]
  slept: number
  watch: ReviewWatch | null
  readonly log: MemoryReviewLog

  static A_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0GG',
    text: 'añade el caso de la issue sin descripción',
    askedAt: '2026-09-09T09:00:00Z',
  })

  static ANOTHER_CHANGE = new ChangeAsked({
    id: 'IC_kwDOT9lB5c8AAAABRCF0HH',
    text: WatchDouble.A_CHANGE.text,
    askedAt: '2026-09-09T10:00:00Z',
  })

  constructor(soundings: Sounding[], {
    refusingTheDelivery = null, waits = null, stoppingOnDelivery = false,
    label = WatchDouble.LABEL, refusalsLeft = Number.POSITIVE_INFINITY,
  }: {
    refusingTheDelivery?: Error | null,
    waits?: number | null,
    stoppingOnDelivery?: boolean,
    label?: string,
    refusalsLeft?: number,
  } = {}) {
    this.soundings = soundings
    this.refusingTheDelivery = refusingTheDelivery
    this.refusalsLeft = refusalsLeft
    this.stoppingOnDelivery = stoppingOnDelivery
    this.waits = waits ?? soundings.length
    this.label = label
    this.asked = []
    this.reviewed = []
    this.warnings = []
    this.slept = 0
    this.watch = null
    this.log = new MemoryReviewLog()
  }

  static answering(...soundings: Sounding[]): WatchDouble {
    return new WatchDouble(soundings)
  }

  static recovering(...soundings: Sounding[]): WatchDouble {
    return new WatchDouble(soundings, { waits: soundings.length - 1 })
  }

  static stoppedBeforeTheFirstWait(): WatchDouble {
    return new WatchDouble([[WatchDouble.A_CHANGE]], { waits: 0 })
  }

  static stoppedWhileDelivering(): WatchDouble {
    return new WatchDouble([[WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]], {
      stoppingOnDelivery: true,
    })
  }

  static refusingTheDelivery(cause: Error): WatchDouble {
    return new WatchDouble([[WatchDouble.A_CHANGE], [WatchDouble.A_CHANGE]], {
      refusingTheDelivery: cause,
    })
  }

  static refusingTheFirstDeliveryOnly(cause: Error): WatchDouble {
    return new WatchDouble([[WatchDouble.A_CHANGE], [WatchDouble.A_CHANGE]], {
      refusingTheDelivery: cause,
      refusalsLeft: 1,
    })
  }

  static labelled(label: string): WatchDouble {
    return new WatchDouble([new PullRequestNotRead('HTTP 502')], { label })
  }

  static watchingNothing(): WatchDouble {
    return new WatchDouble([])
  }

  #reviews(): ReviewWatch {
    return new ReviewWatch({
      asked: (watch) => {
        this.asked.push(watch)
        const answer = this.soundings[this.asked.length - 1]
        if (answer === undefined) {
          throw new Error(`nobody wrote an answer for sounding ${this.asked.length}`)
        }
        if (answer instanceof Error) return Promise.reject(answer)

        return Promise.resolve({ changes: answer })
      },
      review: (params) => {
        this.reviewed.push(params)
        if (this.stoppingOnDelivery) this.watch!.stop(WatchDouble.STOPPING)
        if (this.refusingTheDelivery !== null && this.refusalsLeft > 0) {
          this.refusalsLeft -= 1

          return Promise.reject(this.refusingTheDelivery)
        }

        return Promise.resolve()
      },
      sleep: () => {
        this.slept += 1
        if (this.slept <= this.waits) return Promise.resolve()
        this.watch!.stop(WatchDouble.STOPPING)

        return Promise.resolve()
      },
      stderr: (line) => this.warnings.push(line),
      label: this.label,
      log: this.log,
    })
  }

  async run(): Promise<void> {
    this.watch = this.#reviews()

    return this.watch.start(WatchDouble.SUBJECT)
  }

  async runRecovered(): Promise<void> {
    this.watch = this.#reviews()

    return this.watch.startRecovered(WatchDouble.SUBJECT)
  }
}

describe('ReviewWatch', () => {
  it('a_change_asked_for_is_handed_to_the_agent_that_wrote_that_plan', async () => {
    const watched = WatchDouble.answering([WatchDouble.A_CHANGE])

    await watched.run()

    expect(watched.reviewed).toEqual([{
      agent: WatchDouble.AGENT,
      issue: WatchDouble.NUMBER,
      repository: WatchDouble.REPOSITORY,
      changes: WatchDouble.A_CHANGE.text,
    }])
  })

  it('the_same_change_is_never_handed_over_twice_however_long_the_issue_keeps_it', async () => {
    const watched = WatchDouble.answering(
      [WatchDouble.A_CHANGE],
      [WatchDouble.A_CHANGE],
      [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.run()

    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([
      WatchDouble.A_CHANGE.text, WatchDouble.ANOTHER_CHANGE.text,
    ])
  })

  it('it_asks_the_issue_only_after_the_first_wait_so_a_brand_new_issue_is_not_read', async () => {
    const watched = WatchDouble.stoppedBeforeTheFirstWait()

    await watched.run()

    expect(watched.asked).toEqual([])
    expect(watched.reviewed).toEqual([])
  })

  it('the_issue_it_sounds_is_the_one_it_was_told_to_watch', async () => {
    const watched = WatchDouble.answering([])

    await watched.run()

    expect(watched.asked).toEqual([WatchDouble.SUBJECT])
  })

  it('a_sounding_that_failed_is_written_to_stderr_and_the_watch_lives_on', async () => {
    const watched = WatchDouble.answering(
      new PullRequestNotRead('gh pr view failed: gh: not authenticated'),
      [WatchDouble.A_CHANGE]
    )

    await watched.run()

    expect(watched.warnings).toHaveLength(1)
    expect(watched.warnings[0]).toContain('gh: not authenticated')
    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.A_CHANGE.text])
  })

  it('a_change_that_could_not_be_typed_into_the_agent_is_tried_again_instead_of_being_lost', async () => {
    const watched = WatchDouble.refusingTheDelivery(new PlanAgentNotResumed('no such workspace'))

    await watched.run()

    expect(watched.reviewed).toHaveLength(2)
    expect(watched.warnings).toHaveLength(2)
    expect(watched.warnings[0]).toContain('no such workspace')
  })

  it('a_change_that_failed_once_reaches_the_agent_on_the_next_round_and_is_not_handed_over_again', async () => {
    const watched = WatchDouble.refusingTheFirstDeliveryOnly(new PlanAgentNotResumed('no such workspace'))

    await watched.run()

    expect(watched.reviewed).toHaveLength(2)
    expect(watched.warnings).toHaveLength(1)
    expect(watched.reviewed.map(({ changes }) => changes))
      .toEqual([WatchDouble.A_CHANGE.text, WatchDouble.A_CHANGE.text])
  })

  it('a_watch_it_was_told_to_stop_asks_the_issue_nothing_else', async () => {
    const watched = WatchDouble.answering([WatchDouble.A_CHANGE])

    await watched.run()

    expect(watched.asked).toHaveLength(1)
    expect(watched.slept).toBe(2)
  })

  it('a_defect_of_ours_ends_that_watch_instead_of_taking_the_whole_api_down', async () => {
    const watched = WatchDouble.answering(
      new TypeError('changes is not iterable'), [WatchDouble.A_CHANGE]
    )

    await watched.run()

    expect(watched.warnings).toHaveLength(1)
    expect(watched.warnings[0]).toContain('changes is not iterable')
    expect(watched.asked).toHaveLength(1)
  })

  it('a_change_asked_for_twice_in_the_same_words_is_handed_over_twice_because_the_id_is_what_counts', async () => {
    const watched = WatchDouble.answering(
      [WatchDouble.A_CHANGE], [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.run()

    expect(watched.reviewed).toHaveLength(2)
  })

  it('a_delivery_that_blew_up_on_a_defect_of_ours_ends_that_watch_instead_of_repeating_it', async () => {
    const watched = WatchDouble.refusingTheDelivery(new TypeError('agent is not a string'))

    await watched.run()

    expect(watched.reviewed).toHaveLength(1)
    expect(watched.asked).toHaveLength(1)
    expect(watched.warnings[0]).toContain('agent is not a string')
  })

  it('a_watch_that_died_is_no_longer_listed_as_live_so_the_map_cannot_promise_a_loop_that_is_gone', async () => {
    const watched = WatchDouble.answering(
      new TypeError('changes is not iterable'), [WatchDouble.A_CHANGE]
    )

    await watched.run()

    expect(watched.watch!.live.size).toBe(0)
  })

  it('a_stop_in_the_middle_of_a_round_is_honoured_before_the_next_change_is_typed', async () => {
    const watched = WatchDouble.stoppedWhileDelivering()

    await watched.run()

    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.A_CHANGE.text])
  })

  it('a_stop_for_an_issue_nobody_is_watching_answers_the_same_as_one_that_was', async () => {
    const watched = WatchDouble.answering([])

    await watched.run()

    expect(() => watched.watch!.stop(WatchDouble.STOPPING)).not.toThrow()
  })

  it('the_label_it_was_given_prefixes_what_it_writes_so_two_watches_can_be_told_apart', async () => {
    const watched = WatchDouble.labelled('pull request review watch')

    await watched.run()

    expect(watched.warnings.join('')).toContain('pull request review watch: josemerca/ct-loop-sandbox#7')
  })

  it('the_watch_of_the_plan_keeps_saying_which_one_it_is', async () => {
    const watched = WatchDouble.answering(new PullRequestNotRead('HTTP 502'))

    await watched.run()

    expect(watched.warnings.join('')).toContain('plan review watch:')
  })

  it('a_recovered_watch_reads_its_baseline_before_the_first_wait', async () => {
    const watched = WatchDouble.recovering([WatchDouble.A_CHANGE])

    await watched.runRecovered()

    expect(watched.asked).toEqual([WatchDouble.SUBJECT])
    expect(watched.reviewed).toEqual([])
  })

  it('a_recovered_watch_delivers_changes_that_arrive_after_its_baseline', async () => {
    const watched = WatchDouble.recovering(
      [WatchDouble.A_CHANGE], [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.runRecovered()

    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.ANOTHER_CHANGE.text])
  })

  it('a_recovered_watch_retries_a_failed_baseline_without_delivering_historical_changes', async () => {
    const watched = WatchDouble.recovering(
      new PullRequestNotRead('gh pr view failed: gh: not authenticated'),
      [WatchDouble.A_CHANGE],
      [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE]
    )

    await watched.runRecovered()

    expect(watched.warnings).toHaveLength(1)
    expect(watched.reviewed.map(({ changes }) => changes)).toEqual([WatchDouble.ANOTHER_CHANGE.text])
  })

  it('stopping_a_recovered_watch_during_its_baseline_does_not_start_its_live_loop', async () => {
    let readBaseline!: (read: ChangesAsked) => void
    const baseline = new Promise<ChangesAsked>((resolve) => { readBaseline = resolve })
    let slept = 0
    let reviewed = 0
    const watch = new ReviewWatch({
      asked: () => baseline,
      review: () => { reviewed += 1; return Promise.resolve() },
      sleep: () => { slept += 1; return Promise.resolve() },
      stderr: () => {},
      label: WatchDouble.LABEL,
      log: new MemoryReviewLog(),
    })

    const following = watch.startRecovered(WatchDouble.SUBJECT)
    watch.stop(WatchDouble.STOPPING)
    readBaseline({ changes: [WatchDouble.A_CHANGE] })
    await following

    expect(slept).toBe(0)
    expect(reviewed).toBe(0)
    expect(watch.live.size).toBe(0)
  })
})

describe('ReviewWatch telling two plans apart', () => {
  const watchFor = (repo: string, number: number) => new PlanWatch({
    story: null,
    issue: new PlanIssue({ number, url: `https://github.com/${repo}/issues/${number}` }),
    located: new WorkspaceLocation({ path: `/repo/${repo}/.worktrees/${number}`, branch: `feat/${number}` }),
    repository: new RepositoryName(repo),
    agent: `workspace:${number}`,
  })

  const ALPHA_7 = watchFor('owner/alpha', 7)
  const BETA_7 = watchFor('owner/beta', 7)
  const ALPHA_8 = watchFor('owner/alpha', 8)
  const ROUND_MS = 1
  const ROUNDS = 15
  const BUDGET = ROUNDS * 6

  class TwoPlans {
    sounded: string[]
    rounds: number
    readonly reviews: ReviewWatch

    constructor() {
      this.sounded = []
      this.rounds = 0
      this.reviews = new ReviewWatch({
        asked: (watch) => {
          this.rounds += 1
          if (this.rounds > BUDGET) {
            throw new Error(`the watches sounded ${this.rounds} times, past what this test allows`)
          }
          this.sounded.push(TwoPlans.#nameOf(watch))

          return Promise.resolve({ changes: [] })
        },
        review: () => Promise.resolve(),
        sleep: () => new Promise<void>((resolve) => { setTimeout(resolve, ROUND_MS) }),
        stderr: () => {},
        label: 'plan review watch',
        log: new MemoryReviewLog(),
      })
    }

    static #nameOf(watch: PlanWatch): string {
      return `${watch.repository.text}#${watch.issue.number}`
    }

    static #settling(): Promise<void> {
      return new Promise<void>((resolve) => { setTimeout(resolve, ROUND_MS * ROUNDS) })
    }

    static #stopping(watch: PlanWatch): { issue: number, repository: RepositoryName } {
      return { issue: watch.issue.number, repository: watch.repository }
    }

    async soundedAfterStopping(stopped: PlanWatch, kept: PlanWatch): Promise<string[]> {
      this.reviews.start(stopped)
      this.reviews.start(kept)
      await TwoPlans.#settling()
      this.reviews.stop(TwoPlans.#stopping(stopped))
      this.sounded = []
      await TwoPlans.#settling()
      this.reviews.stop(TwoPlans.#stopping(kept))

      return this.sounded
    }
  }

  it('two_plans_sharing_an_issue_number_in_different_repositories_are_watched_apart', async () => {
    const two = new TwoPlans()

    const sounded = await two.soundedAfterStopping(ALPHA_7, BETA_7)

    expect(sounded).not.toContain('owner/alpha#7')
    expect(sounded).toContain('owner/beta#7')
  })

  it('two_plans_of_the_same_repository_are_watched_apart_by_the_issue_they_plan', async () => {
    const two = new TwoPlans()

    const sounded = await two.soundedAfterStopping(ALPHA_8, ALPHA_7)

    expect(sounded).not.toContain('owner/alpha#8')
    expect(sounded).toContain('owner/alpha#7')
  })

  it('nothing_keeps_sounding_once_both_plans_have_been_stopped', async () => {
    const two = new TwoPlans()

    await two.soundedAfterStopping(ALPHA_7, BETA_7)
    two.sounded = []
    await new Promise((resolve) => setTimeout(resolve, ROUND_MS * ROUNDS))

    expect(two.sounded).toEqual([])
    expect(two.reviews.live.size).toBe(0)
  })
})

describe('ReviewWatch delivering while the gate can close underneath it', () => {
  class GateContention {
    busy: boolean
    tick: number
    readonly reviewed: string[]
    readonly warnings: string[]
    watch: ReviewWatch | null

    constructor() {
      this.busy = false
      this.tick = 0
      this.reviewed = []
      this.warnings = []
      this.watch = null
    }

    static racing(): GateContention {
      return new GateContention()
    }

    #asked(): Promise<{ changes: ChangeAsked[] }> {
      this.tick += 1
      if (this.tick === 1) {
        return Promise.resolve({ changes: [WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE] })
      }
      if (this.tick === 2) {
        this.busy = false
        return Promise.resolve({ changes: [WatchDouble.ANOTHER_CHANGE] })
      }
      this.watch!.stop(WatchDouble.STOPPING)
      return Promise.resolve({ changes: [] })
    }

    #review(): Promise<void> {
      if (this.busy) return Promise.reject(new SliceNotReopened('sigue en status:in-progress'))
      this.busy = true
      this.reviewed.push('delivered')

      return Promise.resolve()
    }

    async run(): Promise<void> {
      this.watch = new ReviewWatch({
        asked: () => this.#asked(),
        review: () => this.#review(),
        sleep: () => Promise.resolve(),
        stderr: (line) => this.warnings.push(line),
        label: WatchDouble.LABEL,
        log: new MemoryReviewLog(),
      })

      return this.watch.start(WatchDouble.SUBJECT)
    }
  }

  it('two_changes_read_in_the_same_tick_are_delivered_one_at_a_time_so_the_gate_closing_after_the_first_does_not_lose_the_second', async () => {
    const race = GateContention.racing()

    await race.run()

    expect(race.reviewed).toHaveLength(2)
    expect(race.warnings).toEqual([])
  })
})

describe('the watch notes when changes were asked for, so the plan state can be read without asking GitHub', () => {
  it('the_newest_date_it_reads_is_noted_even_on_the_baseline_sweep_that_delivers_nothing', async () => {
    const watched = WatchDouble.recovering([WatchDouble.A_CHANGE, WatchDouble.ANOTHER_CHANGE])

    await watched.runRecovered()

    expect(watched.reviewed).toEqual([])
    expect(watched.log.lastAskedAt(WatchDouble.STOPPING)).toBe(WatchDouble.ANOTHER_CHANGE.askedAt)
  })

  it('a_sweep_that_delivers_a_change_notes_its_date_too', async () => {
    const watched = WatchDouble.answering([WatchDouble.A_CHANGE])

    await watched.run()

    expect(watched.reviewed).toHaveLength(1)
    expect(watched.log.lastAskedAt(WatchDouble.STOPPING)).toBe(WatchDouble.A_CHANGE.askedAt)
  })

  it('a_sweep_that_could_not_be_read_notes_nothing_instead_of_noting_a_gap', async () => {
    const watched = WatchDouble.answering(new PullRequestNotRead('HTTP 502'))

    await watched.run()

    expect(watched.log.lastAskedAt(WatchDouble.STOPPING)).toBeNull()
    expect(watched.warnings).toHaveLength(1)
  })
})
