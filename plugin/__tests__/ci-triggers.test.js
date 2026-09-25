import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// The merge queue builds each entry on top of the ones ahead of it and waits
// for `ci` to report THERE. Take the `merge_group` trigger away and every
// queued pull request waits forever for a check nobody runs — a failure whose
// symptom (nothing happens) says nothing about its cause. So the trigger is
// pinned, with the reason attached to the failure.
class Workflow {
  static PATH = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows', 'continuous-integration.yml',
  )

  static WARM_CACHES_PATH = join(
    dirname(fileURLToPath(import.meta.url)), '..', '..', '.github', 'workflows', 'warm-caches.yml',
  )

  static text() {
    return readFileSync(Workflow.PATH, 'utf8')
  }

  static warmCaches() {
    return readFileSync(Workflow.WARM_CACHES_PATH, 'utf8')
  }

  static triggers() {
    const header = Workflow.text().split('\nconcurrency:')[0]

    return ['pull_request', 'push', 'merge_group'].filter((event) => new RegExp(`^  ${event}:`, 'm').test(header))
  }
}

describe('the events the checks answer to', () => {
  it('the_queue_has_something_to_wait_for_or_every_entry_waits_forever', () => {
    expect(Workflow.triggers(), 'the merge queue stalls without a merge_group trigger').toContain('merge_group')
  })

  it('a_pull_request_and_the_queue_are_the_only_two_places_the_checks_report_from', () => {
    expect(Workflow.triggers()).toEqual(['pull_request', 'merge_group'])
  })

  it('a_merged_change_is_not_measured_a_second_time_on_main', () => {
    expect(
      Workflow.triggers(),
      'a push run on main measures the tree the queue build already measured',
    ).not.toContain('push')
  })

  it('every_pull_request_still_reads_a_warm_cache_written_on_main', () => {
    const text = Workflow.warmCaches()

    expect(text).toMatch(/push:\n\s+branches: \[main\]/)
    for (const lockfile of ['plugin/package-lock.json', 'backend/package-lock.json', 'frontend/package-lock.json']) {
      expect(text, `a change to ${lockfile} invalidates its cache, so it must warm it again`).toContain(lockfile)
    }
  })

  it('a_queue_build_measures_everything_because_it_has_no_pull_request_to_diff_against', () => {
    expect(Workflow.text()).toContain('"${{ github.event_name }}" != "pull_request"')
  })

  it('ci_stays_the_one_job_the_others_report_through', () => {
    expect(Workflow.text()).toContain('needs: [changes, dist, test, backend, frontend]')
  })
})
