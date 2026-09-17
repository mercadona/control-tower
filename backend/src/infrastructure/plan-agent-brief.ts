import { SLICE_REL_PATH } from '../../../plugin/scripts/state-paths.js'
import { PluginYardstick } from '../../../plugin/scripts/plugin-yardstick.js'
import { MilestoneContextHeading } from '../../../plugin/scripts/milestone-context.js'
import { PlanIssueBody } from './gh-plan-issues.ts'
import type { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import type { RepositoryName } from '../domain/value-objects/repository-name.ts'

export class PlanAgentBrief {
  static readonly NO_NEW_WORKTREES = 'do not create new worktrees'
  static readonly WHITESPACE = /\s+/g
  static readonly MILESTONE_CONTEXT = MilestoneContextHeading.WRITTEN.replace(/^#+\s*/, '')
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
      `You write the PLAN for issue #${issue.number} in ${named}. Do not implement it.`,
      `The baseline is already measured: its result, command and summary are in the \`baseline:\` field in ${SLICE_REL_PATH}. Read it there; do not rerun it to make a claim.`,
      `Hydrate from the issue with \`gh issue view ${issue.number} --repo ${named}\`. Its acceptance criteria and "## Out of scope / Protected" section are the planning input.`,
      `Also read its "${PlanAgentBrief.MILESTONE_CONTEXT}" and "${PlanAgentBrief.INHERITED_CONTEXT}" sections. They carry constraints that do not fit in the acceptance criteria. If they are empty or absent, there is nothing to inherit; do not look outside the issue.`,
      `If the issue has a "${PlanIssueBody.COMMENT_SECTION}" section, the manually requested work is planning input just like the acceptance criteria. If the issue declares no acceptance criteria, that section is the entire input: there is no spec from which to fill them, so propose the criteria in the plan and do not look elsewhere.`,
      `Control Tower's yardstick lives in ${conventions}, and the program carries it to every task: pasted for the implementer and provided by path to the judge. Your plan selects the repository yardstick in §3's \`Rules to obey:\`; open from ${conventions} only the document needed for a concrete decision, not all five in advance.`,
      'The header carried with that yardstick states how the two relate when they conflict, and it is included here because this repository may not put it in `AGENTS.md`. It is the only wording of that rule: apply it verbatim rather than reinterpreting or rewriting it in the plan.',
      PluginYardstick.precedenceHeader(),
      'Write the plan with control-tower-loop:writing-plans-prescriptive, using the issue as its spec.',
      `Save it as docs/superpowers/plans/YYYY-MM-DD-issue-${issue.number}-<slug>.md.`,
      `Validate it with \`node ${dispatchCheck} ${issue.number} --repo ${named} --check-plan\` until it exits 0.`,
      'Commit it: the plan travels in the pull request and does not count as written until committed.',
      'The backend owns publication and continuation. Do not comment on the issue.',
      `Then STOP. Do not implement anything, open a pull request or merge, and ${PlanAgentBrief.NO_NEW_WORKTREES}; you are already in the prepared worktree.`,
    ].join('\n')
  }

  implementationErrandFor({ issueNumber, repository }: {
    issueNumber: number,
    repository: RepositoryName,
  }): string {
    const ctStep = this.ctStep
    const dispatchCheck = this.dispatchCheck

    return [
      `Milestone work for issue #${issueNumber} is already authorised by GATE 2:`,
      'implement the committed plan NOW without rewriting it.',
      `Before asking for the first step, rewrite the role, task and next_action fields in ${SLICE_REL_PATH} so they say you are implementing the plan rather than writing it.`,
      `Do not conduct the sequence with subagent-driven-development or its ledger; the machine dictates it. Ask for the step with \`node ${ctStep} next --plan <your plan in docs/superpowers/plans/> --issue ${issueNumber}\``,
      `and obey its output literally, task by task; where it says \`ct-step\`, use \`node ${ctStep}\`. Return to \`next\` after each step until it says "run delivered".`,
      `Then open the pull request with \`Closes #${issueNumber}\` in its body and release with`,
      `\`node ${dispatchCheck} ${issueNumber} --repo ${repository.text} --release --no-watch-merge\`, which moves the issue to review.`,
      `STOP there: do not merge it, and ${PlanAgentBrief.NO_NEW_WORKTREES}.`,
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
      `A person reviewed the pull request for issue #${issueNumber} and requested these changes:`,
      `«${String(changes).replace(PlanAgentBrief.WHITESPACE, ' ').trim()}».`,
      'Apply them on the existing branch and worktree without rewriting the plan,',
      `${PlanAgentBrief.NO_NEW_WORKTREES}, and without opening another pull request: the existing one remains open and receives what you push.`,
      'Once it is green, release again with',
      `\`node ${dispatchCheck} ${issueNumber} --repo ${named} --release --no-watch-merge\`, which returns the issue to review.`,
      'Then STOP: do not merge it.',
    ].join(' ')
  }
}
