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

  static text() {
    return readFileSync(Workflow.PATH, 'utf8')
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

  it('a_pull_request_and_main_keep_reporting_as_they_did', () => {
    expect(Workflow.triggers()).toEqual(['pull_request', 'push', 'merge_group'])
  })

  it('a_queue_build_measures_everything_because_it_has_no_pull_request_to_diff_against', () => {
    expect(Workflow.text()).toContain('"${{ github.event_name }}" != "pull_request"')
  })

  it('ci_stays_the_one_job_the_others_report_through', () => {
    expect(Workflow.text()).toContain('needs: [changes, dist, test, backend, frontend]')
  })
})
