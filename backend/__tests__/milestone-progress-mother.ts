import { EpicIssue } from '../src/domain/value-objects/epic-issue.ts'
import { EpicSpec } from '../src/domain/value-objects/epic-spec.ts'
import { PlanIssue } from '../src/domain/value-objects/plan-issue.ts'
import { PlanIssueStatus } from '../src/domain/value-objects/plan-issue-status.ts'
import { PlanWatch } from '../src/domain/value-objects/plan-watch.ts'
import { CheckoutRoot } from '../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../src/domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../src/domain/value-objects/workspace-location.ts'
import { CoordinatingConversationMother } from './coordinating-conversation-mother.ts'

export class MilestoneProgressMother {
  static readonly ROOT = new CheckoutRoot('/repo')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly STORY = CoordinatingConversationMother.STORY
  static readonly MILESTONE = 'Some milestone'
  static readonly ISSUE_NUMBER = 591
  static readonly AGENT = '11111111-1111-4111-8111-111111111111'

  static frozenSpec(): EpicSpec {
    return new EpicSpec({
      path: 'docs/superpowers/specs/2026-09-25-some-milestone-execution.md',
      text: [
        `# ${MilestoneProgressMother.MILESTONE} — Execution spec`,
        '',
        '**Fecha de congelación:** 2026-09-14',
        '**Estado:** CONGELADA',
        '',
      ].join('\n'),
    })
  }

  static draftSpec(): EpicSpec {
    return new EpicSpec({
      path: 'docs/superpowers/specs/2026-09-25-some-milestone-execution.md',
      text: [
        `# ${MilestoneProgressMother.MILESTONE} — Execution spec`,
        '',
        '**Fecha de congelación:** —',
        '**Estado:** DRAFT',
        '',
      ].join('\n'),
    })
  }

  static openIssue(): EpicIssue {
    return new EpicIssue({
      number: MilestoneProgressMother.ISSUE_NUMBER,
      url: MilestoneProgressMother.#issueUrl(),
      title: 'Milestone progress read',
      status: PlanIssueStatus.IN_PROGRESS,
      isOpen: true,
      order: 1,
    })
  }

  static closedIssue(): EpicIssue {
    return new EpicIssue({
      number: MilestoneProgressMother.ISSUE_NUMBER,
      url: MilestoneProgressMother.#issueUrl(),
      title: 'Milestone progress read',
      status: PlanIssueStatus.NONE,
      isOpen: false,
      order: 1,
    })
  }

  static watch(): PlanWatch {
    return new PlanWatch({
      story: null,
      issue: new PlanIssue({ number: MilestoneProgressMother.ISSUE_NUMBER, url: MilestoneProgressMother.#issueUrl() }),
      located: new WorkspaceLocation({
        root: MilestoneProgressMother.ROOT.text,
        path: `${MilestoneProgressMother.ROOT.text}/.worktrees/${MilestoneProgressMother.ISSUE_NUMBER}`,
        branch: `feat/${MilestoneProgressMother.ISSUE_NUMBER}`,
      }),
      repository: MilestoneProgressMother.REPOSITORY,
      agent: MilestoneProgressMother.AGENT,
    })
  }

  static #issueUrl(): string {
    return `https://github.com/${MilestoneProgressMother.REPOSITORY.text}/issues/${MilestoneProgressMother.ISSUE_NUMBER}`
  }
}
