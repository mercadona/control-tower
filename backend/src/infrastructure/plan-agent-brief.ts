import { SLICE_REL_PATH } from '../../../plugin/scripts/state-paths.js'
import { PluginYardstick } from '../../../plugin/scripts/plugin-yardstick.js'
import { PlanIssueBody } from './gh-plan-issues.ts'
import type { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export class PlanAgentBrief {
  static readonly NO_NEW_WORKTREES = 'do not create new worktrees'
  static readonly WHITESPACE = /\s+/g
  static readonly EPIC_CONTEXT = 'Contexto del epic'
  static readonly INHERITED_CONTEXT = 'Contexto heredado'

  readonly dispatchCheck: string
  readonly conventions: string
  readonly ctStep: string

  constructor({ dispatchCheck, conventions, ctStep }: {
    dispatchCheck: string,
    conventions: string,
    ctStep: string,
  }) {
    this.dispatchCheck = dispatchCheck
    this.conventions = conventions
    this.ctStep = ctStep
    Object.freeze(this)
  }

  errandFor({ issue, repository }: { issue: PlanIssue, repository: RepositoryName }): string {
    const dispatchCheck = this.dispatchCheck
    const conventions = this.conventions
    const named = repository.text

    return [
      `Write the PLAN for issue #${issue.number} in ${named}. Do not implement it.`,
      `The baseline is already measured: its outcome, command and summary are in the \`baseline:\` field of ${SLICE_REL_PATH}. Read it there; do not run it again merely to confirm it.`,
      `Read the issue: \`gh issue view ${issue.number} --repo ${named}\`. Its acceptance criteria and "## Out of scope / Protected" section are plan input.`,
      `Also read "${PlanAgentBrief.EPIC_CONTEXT}" and "${PlanAgentBrief.INHERITED_CONTEXT}": they carry constraints beyond the acceptance criteria. If absent or empty, there is nothing to inherit; do not look outside the issue for it.`,
      `If the issue has "${PlanIssueBody.COMMENT_SECTION}", that request is plan input alongside the acceptance criteria. If there are no acceptance criteria, that section is the entire input: there is no separate spec to supply them. Propose them in the plan rather than looking elsewhere.`,
      'Before choosing responsibilities and closing contracts, read every Control Tower convention listed here:',
      ...PluginYardstick.FILES.map((name) => `- ${conventions}/${name}`),
      'Record the responsibility trace required by architecture.md in the plan\'s Reference patterns section. The program carries these conventions to every task; Rules to obey selects the repository\'s own conventions.',
      'The following header states the precedence. It is included verbatim because AGENTS.md may not carry it; apply it as written rather than rewriting it in the plan.',
      PluginYardstick.precedenceHeader(),
      'Write the plan with control-tower-loop:writing-plans-prescriptive, using the issue as its spec.',
      `Save it as docs/superpowers/plans/YYYY-MM-DD-issue-${issue.number}-<slug>.md.`,
      `Validate it with \`node ${dispatchCheck} ${issue.number} --repo ${named} --check-plan\` until exit 0.`,
      'Commit it: the plan travels in the pull request and does not count as written until committed.',
      `Publish it as an issue comment with \`gh issue comment ${issue.number} --repo ${named}\`: that is where a person reads it to approve it or ask for changes.`,
      `End that comment with this exact line: ${PlanIssueBody.CHANGES_LINE}`,
      `Then STOP. Do not implement, open a pull request or merge; ${PlanAgentBrief.NO_NEW_WORKTREES}: you are already in the prepared one.`,
    ].join('\n')
  }

  reviewErrandFor({ issueNumber, repository, changes }: {
    issueNumber: number,
    repository: RepositoryName,
    changes: string,
  }): string {
    const dispatchCheck = this.dispatchCheck
    const named = repository.text

    return [
      `A person reviewed the committed plan for issue #${issueNumber} and asks for changes:`,
      `«${String(changes).replace(PlanAgentBrief.WHITESPACE, ' ').trim()}».`,
      'Revise the plan accordingly without rewriting it from scratch. Do not implement anything.',
      `Revalidate it with \`node ${dispatchCheck} ${issueNumber} --repo ${named} --check-plan\` until exit 0,`,
      'commit the revision, and publish the revised plan as an issue comment with',
      `\`gh issue comment ${issueNumber} --repo ${named}\`, where the next change can be requested.`,
      `End that comment with this exact line: ${PlanIssueBody.CHANGES_LINE}`,
      `Then STOP again: do not implement or open a pull request; ${PlanAgentBrief.NO_NEW_WORKTREES}.`,
    ].join(' ')
  }

  implementationErrandFor({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): string {
    const ctStep = this.ctStep
    const dispatchCheck = this.dispatchCheck

    return [
      `A person closed the \`plan\` gate of issue #${issueNumber}:`,
      'implement the committed plan now, without rewriting it.',
      `Before asking for the first step, update role, task and next_action in ${SLICE_REL_PATH} to describe implementation rather than planning.`,
      `The machine dictates the sequence, not subagent-driven-development or its ledger. Ask for the step with \`node ${ctStep} next --plan <your plan under docs/superpowers/plans/> --issue ${issueNumber}\``,
      `and follow its output task by task (where it says \`ct-step\`, use \`node ${ctStep}\`), returning to \`next\` after each step until it says "run delivered".`,
      `Then open the pull request with \`Closes #${issueNumber}\` in its body and release with`,
      `\`node ${dispatchCheck} ${issueNumber} --repo ${repository.text} --release --no-watch-merge\`, which moves the issue to review.`,
      `STOP there: do not merge it and ${PlanAgentBrief.NO_NEW_WORKTREES}.`,
    ].join(' ')
  }

  fixErrandFor({ issueNumber, repository, changes }: {
    issueNumber: number,
    repository: RepositoryName,
    changes: string,
  }): string {
    const dispatchCheck = this.dispatchCheck
    const named = repository.text

    return [
      `A person reviewed the pull request for issue #${issueNumber} and asks for these changes:`,
      `«${String(changes).replace(PlanAgentBrief.WHITESPACE, ' ').trim()}».`,
      'Apply them on the existing branch and worktree without reworking the plan;',
      `${PlanAgentBrief.NO_NEW_WORKTREES} and do not open another pull request: the existing one receives your pushed changes.`,
      'When verification passes, release again with',
      `\`node ${dispatchCheck} ${issueNumber} --repo ${named} --release --no-watch-merge\`, which returns the issue to review.`,
      'Then STOP: do not merge it.',
    ].join(' ')
  }
}
