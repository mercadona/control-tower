import { describe, it, expect } from 'vitest'
import { ReferredUserStories } from '../../src/infrastructure/referred-user-stories.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { UserStoryUrl } from '../../src/domain/value-objects/user-story-url.js'
import { UserStory } from '../../src/domain/value-objects/user-story.js'

class UserStoriesDouble {
  constructor(name) {
    this.name = name
    this.asked = []
  }

  async detail(reference) {
    this.asked.push(reference)

    return new UserStory({ key: reference, summary: `answered by ${this.name}`, description: '' })
  }
}

class RefusingUserStoriesDouble {
  constructor(failure) {
    this.failure = failure
  }

  async detail() {
    throw this.failure
  }
}

describe('ReferredUserStories', () => {
  it('a_jira_key_is_asked_to_the_jira_adapter_and_never_reaches_the_github_one', async () => {
    const jira = new UserStoriesDouble('jira')
    const github = new UserStoriesDouble('github')
    const key = new UserStoryKey('MO_SHOP-42')

    const story = await new ReferredUserStories({ jira, github }).detail(key)

    expect(jira.asked).toEqual([key])
    expect(github.asked).toEqual([])
    expect(story.summary).toBe('answered by jira')
  })

  it('a_github_issue_url_is_asked_to_the_github_adapter_and_never_reaches_the_jira_one', async () => {
    const jira = new UserStoriesDouble('jira')
    const github = new UserStoriesDouble('github')
    const url = new UserStoryUrl('https://github.com/mercadona/control-tower/issues/141')

    const story = await new ReferredUserStories({ jira, github }).detail(url)

    expect(github.asked).toEqual([url])
    expect(jira.asked).toEqual([])
    expect(story.summary).toBe('answered by github')
  })

  it('whichever_adapter_answers_the_refusal_it_throws_reaches_the_caller_unchanged', async () => {
    const failure = new Error('acli is not authenticated')
    const jira = new RefusingUserStoriesDouble(failure)
    const github = new UserStoriesDouble('github')

    const refusal = await new ReferredUserStories({ jira, github })
      .detail(new UserStoryKey('MO_SHOP-42'))
      .catch((cause) => cause)

    expect(refusal).toBe(failure)
  })
})
