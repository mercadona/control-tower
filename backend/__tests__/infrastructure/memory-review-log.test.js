import { describe, it, expect } from 'vitest'
import { MemoryReviewLog } from '../../src/infrastructure/memory-review-log.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'

const REPOSITORY = new RepositoryName('jjponz/repo-pulse')
const OTHER = new RepositoryName('jjponz/other')

describe('MemoryReviewLog', () => {
  it('a_plan_nobody_asked_changes_for_has_no_date', () => {
    expect(new MemoryReviewLog().lastAskedAt({ issue: 54, repository: REPOSITORY })).toBeNull()
  })

  it('what_it_answers_is_the_newest_date_it_was_told_about_not_the_last_one', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T10:00:00Z' })
    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T09:00:00Z' })

    expect(log.lastAskedAt({ issue: 54, repository: REPOSITORY })).toBe('2026-09-09T10:00:00Z')
  })

  it('two_issues_of_the_same_repository_are_told_apart', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T10:00:00Z' })

    expect(log.lastAskedAt({ issue: 55, repository: REPOSITORY })).toBeNull()
  })

  it('two_repositories_with_the_same_issue_number_are_told_apart', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: '2026-09-09T10:00:00Z' })

    expect(log.lastAskedAt({ issue: 54, repository: OTHER })).toBeNull()
  })

  it('a_date_that_cannot_be_read_as_a_moment_is_not_noted', () => {
    const log = new MemoryReviewLog()

    log.noted({ issue: 54, repository: REPOSITORY, at: 'un rato' })

    expect(log.lastAskedAt({ issue: 54, repository: REPOSITORY })).toBeNull()
  })
})
