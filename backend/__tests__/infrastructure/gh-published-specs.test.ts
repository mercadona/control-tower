import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import { GhPublishedSpecs } from '../../src/infrastructure/gh-published-specs.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryPolicy, RetryBudget } from '../../src/domain/policies/retry-policy.ts'
import { SpecRevision } from '../../src/domain/policies/spec-revision.ts'
import { SleepDouble } from '../sleep-double.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PublishedSpecNotRead, PublishedSpecNotUnderstood } from '../../src/domain/exceptions.ts'

class RealGhAnswers {
  static readonly CAPTURE =
    'gh api repos/mercadona/control-tower/contents/<path>, captured on 2026-09-15: VERSION exits 0 printing '
    + '{"name":"VERSION","path":"VERSION","sha":"6e8bf73aa550d4c57f6f35830f1bcdc7a4a62f38","size":6,'
    + '"url":"…","content":"MC4xLjAK\\n","encoding":"base64",…} on stdout, and '
    + "printf '0.1.0\\n' | git hash-object --stdin prints that very sha, which is why the sha of that answer is "
    + 'the git blob sha of what the default branch holds. docs/nope.md exits 1 printing exactly the line below '
    + 'on stderr, nothing more'

  static readonly SPEC_ABSENT_FROM_THE_DEFAULT_BRANCH = 'gh: Not Found (HTTP 404)'

  static readonly FROZEN_BLOB = '58267779d2053c09425dc5c86ed9c5597458f47e'
  static readonly RESLICED_BLOB = 'f2c47d1f9d8d4f9cda71a8d0875129245fc0c265'

  static contentsOf(sha: string): string {
    return `{"name":"2026-01-01-test-execution.md","path":"${Specs.PATH}","sha":"${sha}",`
      + '"size":163,"type":"file","encoding":"base64"}'
  }
}

class Specs {
  static readonly PATH = 'docs/superpowers/specs/2026-01-01-test-execution.md'
  static readonly FROZEN_TEXT = [
    '# Test epic — Execution spec',
    '',
    '**Handoff origen:** `docs/superpowers/specs/2026-01-01-test-design.md`',
    '**Fecha de congelación:** 2026-09-14',
    '**Estado:** CONGELADA',
    '',
  ].join('\n')

  static frozen(): EpicSpec {
    return new EpicSpec({ path: Specs.PATH, text: Specs.FROZEN_TEXT })
  }

  static resliced(): EpicSpec {
    return new EpicSpec({
      path: Specs.PATH,
      text: `${Specs.FROZEN_TEXT}\n## 9. Slices\n\n| Orden |\n|---|\n| 1 |\n`,
    })
  }
}

class GhDouble {
  static REPOSITORY = new RepositoryName('mercadona/control-tower')

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

  static holding(sha: string) {
    return GhDouble.answering(0, { stdout: RealGhAnswers.contentsOf(sha) })
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
      revisions: new SpecRevision({ digest: (text) => createHash('sha1').update(text, 'utf8').digest('hex') }),
    })
  }

  async holds(spec = Specs.frozen()) {
    return this.specs().holds({ repository: GhDouble.REPOSITORY, spec })
  }

  async refusal(spec = Specs.frozen()) {
    return this.holds(spec).catch((cause) => cause)
  }
}

describe('GhPublishedSpecs', () => {
  describe(RealGhAnswers.CAPTURE, () => {
    it('a spec github cannot find on the default branch is not published and is no failure', async () => {
      const gh = GhDouble.answering(1, { stderr: RealGhAnswers.SPEC_ABSENT_FROM_THE_DEFAULT_BRANCH })

      await expect(gh.holds()).resolves.toBe(false)
    })

    it('a spec whose blob sha is the one the default branch reports is published, asked for with no ref', async () => {
      const gh = GhDouble.holding(RealGhAnswers.FROZEN_BLOB)

      await expect(gh.holds()).resolves.toBe(true)
      expect(gh.calls).toEqual([[
        'api', `repos/${GhDouble.REPOSITORY.text}/contents/${Specs.PATH}`,
      ]])
    })

    it('a spec whose local text is not the text the default branch holds is not published', async () => {
      const gh = GhDouble.holding(RealGhAnswers.FROZEN_BLOB)

      await expect(gh.holds(Specs.resliced())).resolves.toBe(false)
    })

    it('a re-sliced spec reads as published once the default branch holds that very text', async () => {
      const gh = GhDouble.holding(RealGhAnswers.RESLICED_BLOB)

      await expect(gh.holds(Specs.resliced())).resolves.toBe(true)
    })
  })

  it('a gh that failed for any other reason raises instead of passing for not published', async () => {
    const refusal = await GhDouble.answering(1, { stderr: 'gh: To use GitHub CLI, run: gh auth login' }).refusal()

    expect(refusal).toBeInstanceOf(PublishedSpecNotRead)
    expect(refusal.message).toContain('gh: To use GitHub CLI, run: gh auth login')
  })

  it('an answer with no readable sha is told apart from a gh that failed', async () => {
    const withoutSha = '{"name":"2026-01-01-test-execution.md"}'

    const refusal = await GhDouble.answering(0, { stdout: withoutSha }).refusal()

    expect(refusal).toBeInstanceOf(PublishedSpecNotUnderstood)
    expect(refusal).not.toBeInstanceOf(PublishedSpecNotRead)
    expect(refusal.message).toBe(
      `gh api repos/${GhDouble.REPOSITORY.text}/contents/${Specs.PATH} named no sha this reads, `
      + `it printed ${JSON.stringify(withoutSha)}`
    )
  })

  it('an answer that is not json at all is unreadable too, quoting what gh printed', async () => {
    const refusal = await GhDouble.answering(0, { stdout: 'not json at all' }).refusal()

    expect(refusal).toBeInstanceOf(PublishedSpecNotUnderstood)
    expect(refusal.message).toContain(JSON.stringify('not json at all'))
  })

  it('a path with a space is percent-encoded before it becomes part of the url', async () => {
    const gh = GhDouble.holding(RealGhAnswers.FROZEN_BLOB)

    await gh.holds(new EpicSpec({ path: 'docs/superpowers/specs/2026-09-11 the loop.md', text: '' }))

    expect(gh.calls).toEqual([[
      'api', `repos/${GhDouble.REPOSITORY.text}/contents/docs/superpowers/specs/2026-09-11%20the%20loop.md`,
    ]])
  })
})
