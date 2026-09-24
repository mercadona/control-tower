import { describe, it, expect } from 'vitest'
import { PlanRequest, PlanRequestOutcome } from '../../src/infrastructure/start-plan-route.ts'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.ts'
import { UserStoryUrl } from '../../src/domain/value-objects/user-story-url.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'

describe('PlanRequest', () => {
  it('every_outcome_is_distinct_so_no_two_refusals_answered_differently_collapse_into_one', () => {
    const members = Object.values(PlanRequestOutcome)

    expect(new Set(members).size).toBe(members.length)
  })

  it('a_malformed_id_is_reported_before_the_path_so_the_first_thing_wrong_is_what_gets_named', () => {
    expect(PlanRequest.from('{"id":"nope","path":"nope"}').outcome)
      .toBe(PlanRequestOutcome.MALFORMED_ID)
  })

  it('a_body_whose_id_is_not_a_story_key_comes_back_refused_rather_than_raising_at_the_boundary', () => {
    const refused = [
      '{"id":"abc-1","path":"/repo/checkout"}',
      '{"id":"../../etc/passwd","path":"/repo/checkout"}',
      '{"id":123,"path":"/repo/checkout"}',
      '{"id":"   ","path":"/repo/checkout"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(4).fill(PlanRequestOutcome.MALFORMED_ID))
  })

  it('the_unknown_fields_come_back_in_a_settled_order_so_the_answer_does_not_depend_on_the_sender', () => {
    expect(PlanRequest.from('{"id":"ABC-1","zulu":1,"alpha":2}').fields).toEqual(['alpha', 'zulu'])
  })

  it('a_repository_named_in_the_body_is_an_unknown_field_because_the_checkout_already_says_which_one_it_is', () => {
    const refused = PlanRequest.from('{"id":"ABC-1","repo":"owner/name","path":"/repo/checkout"}')

    expect(refused.outcome).toBe(PlanRequestOutcome.UNKNOWN_FIELD)
    expect(refused.fields).toEqual(['repo'])
    expect(refused.root).toBeNull()
  })

  it('the_retired_repo_list_field_is_an_unknown_field_like_any_other', () => {
    const refused = PlanRequest.from('{"id":"ABC-1","repo_list":[{"repo":"owner/name","path":"/repo/checkout"}]}')

    expect(refused.outcome).toBe(PlanRequestOutcome.UNKNOWN_FIELD)
    expect(refused.fields).toEqual(['repo_list'])
  })

  it('an_accepted_body_hands_back_the_story_as_a_domain_value_and_not_as_the_raw_string', () => {
    const accepted = PlanRequest.from('{"id":"MO_SHOP-42","path":"/repo/checkout"}')

    expect(accepted.story).toBeInstanceOf(UserStoryKey)
    expect(accepted.story!.text).toBe('MO_SHOP-42')
  })

  it('an_id_that_is_a_github_issue_url_is_accepted_and_hands_back_a_user_story_url', () => {
    const url = 'https://github.com/mercadona/control-tower/issues/141'
    const accepted = PlanRequest.from(`{"id":${JSON.stringify(url)},"path":"/repo/checkout"}`)

    expect(accepted.outcome).toBe(PlanRequestOutcome.ACCEPTED)
    expect(accepted.story).toBeInstanceOf(UserStoryUrl)
    expect(accepted.story!.text).toBe(url)
  })

  it('a_near_miss_of_a_github_issue_url_is_refused_as_a_malformed_id_and_not_silently_read_as_a_jira_key', () => {
    const refused = [
      '{"id":"http://github.com/owner/name/issues/1","path":"/repo/checkout"}',
      '{"id":"https://github.com/owner/name/pull/1","path":"/repo/checkout"}',
      '{"id":"https://github.com/owner/name/issues/0","path":"/repo/checkout"}',
      '{"id":"https://github.com/owner/name/issues/12x","path":"/repo/checkout"}',
      '{"id":"https://github.example.com/owner/name/issues/1","path":"/repo/checkout"}',
      '{"id":"https://github.com/owner/name/issues/1/","path":"/repo/checkout"}',
      '{"id":"https://github.com/owner/name/issues/1?tab=comments","path":"/repo/checkout"}',
      '{"id":"https://github.com/owner/../issues/1","path":"/repo/checkout"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(8).fill(PlanRequestOutcome.MALFORMED_ID))
  })

  it('a_body_whose_path_is_not_an_absolute_path_comes_back_refused_as_a_malformed_path', () => {
    const refused = [
      '{"id":"ABC-1","path":"repos/name"}',
      '{"id":"ABC-1","path":"~/repos/name"}',
      '{"id":"ABC-1","path":""}',
      '{"id":"ABC-1","path":123}',
      '{"id":"ABC-1"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(refused).toEqual(Array(5).fill(PlanRequestOutcome.MALFORMED_PATH))
  })

  it('a_trailing_slash_a_doubled_slash_or_a_trailing_newline_is_accepted_because_git_canonicalises_the_root_later', () => {
    const accepted = [
      '{"id":"ABC-1","path":"/repos/name/"}',
      '{"id":"ABC-1","path":"/repos//name"}',
      '{"id":"ABC-1","path":"/repos/name\\n"}',
    ].map((raw) => PlanRequest.from(raw).outcome)

    expect(accepted).toEqual(Array(3).fill(PlanRequestOutcome.ACCEPTED))
  })

  it('an_accepted_body_hands_back_the_root_as_a_domain_value_too', () => {
    const accepted = PlanRequest.from('{"id":"MO_SHOP-42","path":"/Users/someone/repos/ct-loop-sandbox"}')

    expect(accepted.root).toBeInstanceOf(CheckoutRoot)
    expect(accepted.root!.text).toBe('/Users/someone/repos/ct-loop-sandbox')
  })

  it('a_path_with_spaces_in_a_segment_is_still_well_formed_because_a_home_directory_can_carry_one', () => {
    expect(PlanRequest.from('{"id":"ABC-1","path":"/Users/some one/repos/name"}').outcome)
      .toBe(PlanRequestOutcome.ACCEPTED)
  })

  it('a_body_without_a_ticket_is_refused', () => {
    expect(PlanRequest.from('{"path":"/repo/checkout"}').outcome)
      .toBe(PlanRequestOutcome.NOTHING_TO_PLAN)
  })

  it.each([undefined, 'ABC-1'])('rejects the removed description field with ticket %s', (id) => {
    const refused = PlanRequest.from(JSON.stringify({
      id, user_comment: 'Plan the health endpoint', path: '/repo/checkout',
    }))

    expect(refused.outcome).toBe(PlanRequestOutcome.UNKNOWN_FIELD)
    expect(refused.fields).toEqual(['user_comment'])
    expect(refused.root).toBeNull()
  })

  it('the_refusal_about_a_field_carries_the_name_of_the_field_it_is_about', () => {
    expect(PlanRequest.from('{"id":"ABC-1"}').named).toBe('path')
    expect(PlanRequest.from('{"path":"/repo/checkout"}').named).toBeNull()
  })
})
