import { describe, it, expect } from 'vitest'
import { GhPublishedSpecs } from '../../src/infrastructure/gh-published-specs.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.ts'
import { SleepDouble } from '../sleep-double.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PublishedSpecNotRead } from '../../src/domain/exceptions.ts'

class RealGhAnswers {
  static readonly CAPTURE =
    'gh api repos/mercadona/control-tower/contents/<path>, captured on 2026-09-14: README.md exits 0 with the ' +
    'file on stdout, and docs/nope.md exits 1 printing exactly this line on stderr, nothing more'

  static readonly SPEC_ABSENT_FROM_THE_DEFAULT_BRANCH = 'gh: Not Found (HTTP 404)'
}

class GhDouble {
  static REPOSITORY = new RepositoryName('mercadona/control-tower')
  static PATH = 'docs/superpowers/specs/2026-09-14-issue-330.md'

  readonly answer: ProcessOutput
  readonly calls: string[][]
  readonly sleeping: SleepDouble

  constructor(answer: ProcessOutput) {
    this.answer = answer
    this.calls = []
    this.sleeping = new SleepDouble()
  }

  static answering(code: number, { stdout = '', stderr = '' }: { stdout?: string, stderr?: string } = {}) {
    return new GhDouble(new ProcessOutput({ code, stdout, stderr }))
  }

  specs() {
    return new GhPublishedSpecs({
      gh: new Gh({
        launch: (argv) => {
          this.calls.push(argv)

          return Promise.resolve(this.answer)
        },
        policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 3, waitSeconds: 2 }) }),
        sleep: (seconds) => this.sleeping.sleep(seconds),
      }),
    })
  }

  async holds(path = GhDouble.PATH) {
    return this.specs().holds({ repository: GhDouble.REPOSITORY, path })
  }

  async refusal(path = GhDouble.PATH) {
    return this.holds(path).catch((cause) => cause)
  }
}

describe('GhPublishedSpecs', () => {
  describe(RealGhAnswers.CAPTURE, () => {
    it('a spec github cannot find on the default branch is not published and is no failure', async () => {
      const gh = GhDouble.answering(1, { stderr: RealGhAnswers.SPEC_ABSENT_FROM_THE_DEFAULT_BRANCH })

      await expect(gh.holds()).resolves.toBe(false)
    })

    it('a readable spec answers true and asks for the contents of the default branch with no ref', async () => {
      const gh = GhDouble.answering(0, { stdout: '{"name":"2026-09-14-issue-330.md"}' })

      await expect(gh.holds()).resolves.toBe(true)
      expect(gh.calls).toEqual([['api', `repos/${GhDouble.REPOSITORY.text}/contents/${GhDouble.PATH}`]])
    })
  })

  it('a gh that failed for any other reason raises instead of passing for not published', async () => {
    const refusal = await GhDouble.answering(1, { stderr: 'gh: To use GitHub CLI, run: gh auth login' }).refusal()

    expect(refusal).toBeInstanceOf(PublishedSpecNotRead)
    expect(refusal.message).toContain('gh: To use GitHub CLI, run: gh auth login')
  })

  it('a path with a space is percent-encoded before it becomes part of the url', async () => {
    const gh = GhDouble.answering(0)

    await gh.holds('docs/superpowers/specs/2026-09-11 the loop.md')

    expect(gh.calls).toEqual([[
      'api', `repos/${GhDouble.REPOSITORY.text}/contents/docs/superpowers/specs/2026-09-11%20the%20loop.md`,
    ]])
  })
})
