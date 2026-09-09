import { describe, it, expect } from 'vitest'
import { GhUserStories } from '../../src/infrastructure/gh-user-stories.js'
import { UserStoryUrl } from '../../src/domain/value-objects/user-story-url.ts'
import { UserStoryNotRead, UserStoryNotUnderstood, UserStoryFailure } from '../../src/domain/exceptions.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'
import { ExternalTool } from '../../src/infrastructure/external-tool.js'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.js'
import { SleepDouble } from '../sleep-double.js'

const URL = 'https://github.com/mercadona/control-tower/issues/141'

class GhDouble {
  constructor(printed) {
    this.printed = printed
    this.calls = []
    this.sleeping = new SleepDouble()
  }

  static answering(fields) {
    return new GhDouble(JSON.stringify(fields))
  }

  static refusing(said) {
    return new GhDouble(new ProcessOutput({ code: 1, stdout: '', stderr: said }))
  }

  userStories() {
    return new GhUserStories({
      gh: new ExternalTool({
        launch: (argv) => {
          this.calls.push(argv)
          if (this.printed instanceof ProcessOutput) return Promise.resolve(this.printed)
          return Promise.resolve(new ProcessOutput({ code: 0, stdout: this.printed, stderr: '' }))
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 3, waitSeconds: 2 }) }),
        sleep: (seconds) => this.sleeping.sleep(seconds),
      }),
    })
  }

  async detailFor(url = URL) {
    return this.userStories().detail(new UserStoryUrl(url))
  }

  async refusalFor(url = URL) {
    return this.detailFor(url).catch((cause) => cause)
  }
}

describe('GhUserStories', () => {
  it('the_call_it_makes_asks_for_the_issue_by_url_and_only_for_the_fields_it_consumes', async () => {
    const gh = GhDouble.answering({ title: 'a title', body: '', comments: [] })

    await gh.detailFor(URL)

    expect(gh.calls).toEqual([['issue', 'view', URL, '--json', 'title,body,comments']])
  })

  it('what_gh_says_comes_back_as_a_story_named_by_the_url_it_was_asked_for', async () => {
    const gh = GhDouble.answering({ title: 'Be able to pass a comment along with a GH issue', body: 'the body', comments: [] })

    const story = await gh.detailFor()

    expect(story.key.text).toBe(URL)
    expect(story.summary).toBe('Be able to pass a comment along with a GH issue')
    expect(story.description).toBe('the body')
  })

  it('a_title_padded_with_whitespace_is_trimmed', async () => {
    const gh = GhDouble.answering({ title: '  padded  ', body: '', comments: [] })

    expect((await gh.detailFor()).summary).toBe('padded')
  })

  it('the_comments_fold_into_the_description_one_quoted_block_per_author_in_the_order_gh_printed_them', async () => {
    const gh = GhDouble.answering({
      title: 'a title',
      body: 'the issue body',
      comments: [
        { author: { login: 'alcaptar' }, body: 'Cerrado sin trabajar, por lo mismo que #157.' },
        { author: { login: 'elreplicante' }, body: 'La causa raíz sigue siendo la misma.' },
      ],
    })

    expect((await gh.detailFor()).description).toBe(
      'the issue body\n\n> @alcaptar: Cerrado sin trabajar, por lo mismo que #157.\n\n' +
        '> @elreplicante: La causa raíz sigue siendo la misma.'
    )
  })

  it('a_blank_comment_body_is_dropped_instead_of_leaving_an_empty_quoted_block', async () => {
    const gh = GhDouble.answering({
      title: 'a title',
      body: 'the issue body',
      comments: [
        { author: { login: 'alcaptar' }, body: '   ' },
        { author: { login: 'elreplicante' }, body: 'a real comment' },
      ],
    })

    expect((await gh.detailFor()).description).toBe('the issue body\n\n> @elreplicante: a real comment')
  })

  it('an_issue_with_no_body_and_no_comments_gives_an_empty_description_instead_of_the_word_undefined', async () => {
    const gh = GhDouble.answering({ title: 'a title', body: '', comments: [] })

    const story = await gh.detailFor()

    expect(story.description).toBe('')
    expect(story.hasDescription()).toBe(false)
  })

  it('an_issue_with_no_body_but_comments_reads_only_from_the_comments', async () => {
    const gh = GhDouble.answering({
      title: 'a title',
      body: '',
      comments: [{ author: { login: 'alcaptar' }, body: 'only a comment' }],
    })

    expect((await gh.detailFor()).description).toBe('> @alcaptar: only a comment')
  })

  it('an_issue_with_no_title_is_refused_quoting_what_gh_printed_so_the_answer_can_be_looked_at', async () => {
    const gh = GhDouble.answering({ title: '   ', body: '', comments: [] })

    const refusal = await gh.refusalFor()

    expect(refusal).toBeInstanceOf(UserStoryNotUnderstood)
    expect(refusal.message).toContain('carries no title')
    expect(refusal.message).toContain(JSON.stringify(gh.printed))
  })

  it('a_title_that_is_the_marker_for_nothing_is_refused_by_the_same_criterion_the_plugin_reads_cells_with', async () => {
    for (const written of ['—', '-', '`–`', '**--**']) {
      const refusal = await GhDouble.answering({ title: written, body: '', comments: [] }).refusalFor()

      expect(refusal, written).toBeInstanceOf(UserStoryNotUnderstood)
    }
  })

  it('a_gh_that_refuses_the_call_arrives_typed_so_the_caller_can_tell_it_from_a_crash', async () => {
    const refusal = await GhDouble.refusing('could not resolve to an Issue').refusalFor()

    expect(refusal).toBeInstanceOf(UserStoryNotRead)
    expect(refusal.message).toContain('could not resolve to an Issue')
  })

  it('a_blip_reading_gh_is_retried_because_asking_for_the_same_issue_twice_reads_the_same_issue', async () => {
    const gh = GhDouble.refusing('dial tcp: i/o timeout')

    const refusal = await gh.refusalFor()

    expect(gh.calls).toHaveLength(4)
    expect(gh.sleeping.slept).toEqual([2, 2, 2])
    expect(refusal).toBeInstanceOf(UserStoryNotRead)
  })

  it('gh_answering_something_unreadable_is_told_apart_from_gh_refusing_the_call', async () => {
    const unreadable = await new GhDouble('not json at all').refusalFor()
    const refused = await GhDouble.refusing('boom').refusalFor()

    expect(unreadable).toBeInstanceOf(UserStoryNotUnderstood)
    expect(refused).toBeInstanceOf(UserStoryNotRead)
    expect(unreadable).not.toBeInstanceOf(UserStoryNotRead)
  })

  it('an_answer_that_is_not_an_object_is_refused_instead_of_becoming_an_empty_story', async () => {
    const refusal = await new GhDouble('[]').refusalFor()

    expect(refusal).toBeInstanceOf(UserStoryNotUnderstood)
    expect(refusal.message).toContain('without the fields')
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await new GhDouble('not json at all').refusalFor()
    const refused = await GhDouble.refusing('boom').refusalFor()

    expect(unreadable).toBeInstanceOf(UserStoryFailure)
    expect(refused).toBeInstanceOf(UserStoryFailure)
  })
})
