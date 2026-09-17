import { describe, it, expect } from 'vitest'
import { SLICE_REL_PATH } from '../../../plugin/scripts/state-paths.js'
import { PlanAgentBrief } from '../../src/infrastructure/plan-agent-brief.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { PluginYardstick } from '../../../plugin/scripts/plugin-yardstick.js'

describe('PlanAgentBrief', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).errandFor({
    issue: new PlanIssue({ number: 42, url: 'https://github.com/owner/name/issues/42' }),
    repository: new RepositoryName('owner/name'),
  })

  it('points at the baseline already measured in the state file instead of ordering one', () => {
    expect(errand()).toMatch(/baseline/)
    expect(errand()).toContain(`\`baseline:\` field in ${SLICE_REL_PATH}`)
  })

  it('does not order the ground checked because the program cut and measured the worktree itself', () => {
    expect(errand()).not.toMatch(/pwd/)
    expect(errand()).not.toMatch(/baseline en verde ANTES/)
  })

  it('names the skill that writes the plan instead of describing the shape of one', () => {
    expect(errand()).toContain('control-tower-loop:writing-plans-prescriptive')
  })

  it('interpolates the absolute path of dispatch check because the plugin token stays literal in plain text', () => {
    expect(errand()).toContain('node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --check-plan')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('says where the plan file goes so the contract can find it by name', () => {
    expect(errand()).toContain('docs/superpowers/plans/YYYY-MM-DD-issue-42-<slug>.md')
  })

  it('publication is backend owned and implementation never claims a plan approval', () => {
    expect(errand()).toContain('The backend owns publication and continuation')
    expect(errand()).not.toContain('gh issue comment')
    expect(errand()).not.toMatch(/wait.*approval|poll.*approval|nonce/i)
    expect(new PlanAgentBrief({
      dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
      conventions: '/plugin/conventions',
      ctStep: '/plugin/scripts/ct-step.mjs',
    }).implementationErrandFor({
      issueNumber: 42,
      repository: new RepositoryName('owner/name'),
    })).not.toMatch(/human.*closed.*plan|plan.*approv/i)
  })

  it('orders the session to stop after committing instead of starting the work', () => {
    expect(errand()).toMatch(/STOP/)
    expect(errand()).toMatch(/do not implement/i)
  })

  it('carries the order of precedence verbatim from the plugin instead of wording it again', () => {
    expect(errand()).toContain('/plugin/conventions')
    expect(errand()).toContain(PluginYardstick.precedenceHeader())
  })

  it('the precedence it carries cannot be read the other way round', () => {
    expect(errand()).not.toMatch(/convenciones de este repo tienen PREFERENCIA/)
    expect(errand()).not.toMatch(/las convenciones de este repo ganan/i)
  })

  it('does not override the scope the architecture document declares for itself', () => {
    expect(errand()).not.toMatch(/la vara de arquitectura se aplica SIEMPRE/)
    expect(errand()).not.toMatch(/la única regla de la vara que este encargo cambia/i)
  })

  it('does not order the five documents read before planning', () => {
    expect(errand()).not.toMatch(/Lee la vara de Control Tower/)
    expect(errand()).not.toContain(PluginYardstick.FILES.join(', '))
  })

  it('names the sections that carry what the acceptance criteria cannot', () => {
    expect(errand()).toContain(PlanAgentBrief.MILESTONE_CONTEXT)
    expect(errand()).toContain('Contexto heredado')
    expect(errand()).toMatch(/do not look outside the issue/)
  })

  it('does not send the agent to a section the body never writes', () => {
    expect(errand()).not.toMatch(/decisiones congeladas/i)
  })

  it('never promises a permission nobody mints', () => {
    expect(errand()).not.toContain('-OK')
    expect(errand()).not.toContain('nonce')
  })

  it('sends the agent to the section where a person wrote by hand what they want planned', () => {
    expect(errand()).toContain('Comentario de quien pide el plan')
    expect(errand()).toContain('planning input')
  })

  it('says the criteria are the agents to propose when the issue declares none instead of leaving it stuck', () => {
    expect(errand()).toContain('there is no spec from which to fill them')
  })
})

describe('PlanAgentBrief resuming the agent', () => {
  const errand = () => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).implementationErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name') })

  it('is one single line because a newline would run the order half written', () => {
    expect(errand()).not.toContain('\n')
  })

  it('implementation still follows the ct-step oracle without a backend step table', () => {
    expect(errand()).toContain('node /plugin/scripts/ct-step.mjs next --plan')
    expect(errand()).toContain('--issue 42')
    expect(errand()).not.toContain('CLAUDE_PLUGIN_ROOT')
  })

  it('translates ct-step to node by absolute path because ct-step is not a command', () => {
    expect(errand()).toContain('where it says `ct-step`, use `node /plugin/scripts/ct-step.mjs`')
  })

  it('orders rewriting slice md role task and next action before asking for the first step', () => {
    const composed = errand()
    expect(composed).toContain('.agent/SLICE.md')
    expect(composed).toContain('role, task and next_action')
    expect(composed.indexOf('.agent/SLICE.md')).toBeLessThan(composed.indexOf('Ask for the step'))
  })

  it('orders the release that moves the issue to review instead of forbidding it', () => {
    expect(errand()).toContain(
      'node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --release'
    )
    expect(errand()).not.toMatch(/no ejecutes/i)
    expect(errand()).not.toContain('saldría por 9')
  })

  it('the release it orders waives the merge watcher because this flow has no coordinator to notify', () => {
    expect(errand()).toContain('--release --no-watch-merge')
  })

  it('still stops before the merge because that is the second human decision', () => {
    expect(errand()).toMatch(/do not merge/i)
    expect(errand()).toMatch(/STOP/)
  })
})

describe('PlanAgentBrief asking the agent to fix its pull request', () => {
  const CHANGES = 'varias cosas\nsrc/foo.js:42: revienta\tcon []'
  const errand = (changes = CHANGES) => new PlanAgentBrief({
    dispatchCheck: '/plugin/scripts/dispatch-check.mjs',
    conventions: '/plugin/conventions',
    ctStep: '/plugin/scripts/ct-step.mjs',
  }).fixErrandFor({ issueNumber: 42, repository: new RepositoryName('owner/name'), changes })

  it('the_errand_is_one_line_even_when_the_review_spread_the_anchors_across_several', () => {
    expect(errand()).not.toContain('\n')
    expect(errand()).not.toContain('\t')
    expect(errand()).toContain('varias cosas src/foo.js:42: revienta con []')
  })

  it('fix errands retain the requested anchors and existing pull request', () => {
    expect(errand()).toContain('src/foo.js:42')
    expect(errand()).toContain('without rewriting the plan')
    expect(errand()).toContain('without opening another pull request')
    expect(errand()).toContain(PlanAgentBrief.NO_NEW_WORKTREES)
  })

  it('the_errand_orders_the_release_that_puts_the_issue_back_in_review', () => {
    expect(errand()).toContain('#42')
    expect(errand()).toContain(
      'node /plugin/scripts/dispatch-check.mjs 42 --repo owner/name --release --no-watch-merge'
    )
  })

  it('the errand forbids merging because that gate stays human', () => {
    expect(errand()).toMatch(/do not merge/i)
  })
})
