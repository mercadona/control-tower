import { isAbsolute } from 'node:path'
import { SLICE_REL_PATH, excludeContentWith } from '../../../plugin/scripts/state-paths.js'
import { LOOP_BRANCH_PREFIX } from '../../../plugin/scripts/conventions.js'
import { renderState } from '../../../plugin/scripts/state.js'
import { BaselineOutcome, BaselineResult } from '../../../plugin/scripts/baseline.js'
import type { Baseline } from '../../../plugin/scripts/baseline.js'
import { SownWorkspace } from '../domain/value-objects/sown-workspace.ts'
import { GhPlanIssues } from './gh-plan-issues.js'
import { Workspace } from '../domain/ports/workspace.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { PreparedWorkspace } from '../domain/value-objects/prepared-workspace.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.ts'
import { WorkspaceSurvey } from '../domain/value-objects/workspace-survey.ts'
import {
  WorkspaceNotPrepared, WorkspaceNotRead, WorkspaceNotUnderstood, CheckoutNotConfirmed,
} from '../domain/exceptions.ts'
import type { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import type { ProcessOutput } from './tool-runner.ts'
import type { ToolLaunch } from './external-tool.ts'

export type NumberedIssue = { readonly number: number }
export type DiskWrite = (path: string, text: string) => Promise<void>
export type DiskRead = (path: string) => Promise<string | null>
export type DiagnosticWriter = (line: string) => void

export class SliceSeed {
  static readonly RELATIVE_PATH = SLICE_REL_PATH
  static readonly PLAN_GATE = 'plan'
  static readonly GATES =
    `${SliceSeed.PLAN_GATE} — GATE HUMANO pendiente: lo cierra una persona desde la app cuando pide ` +
    'implementar el plan, NO tú. Y hasta entonces puede pedirte cambios comentando ' +
    `\`${GhPlanIssues.CHANGES_TOKEN}\` en el issue. ` +
    'Ojo: la sección "## Gates" del issue describe el carril de /ct-next y aquí no aplica.'
  static readonly EXCLUDE_PATH = 'info/exclude'
  static readonly EXCLUDE_RULE = SliceSeed.RELATIVE_PATH
  static readonly NOT_MEASURED = BaselineResult.notMeasured('nobody ran the baseline while sowing this seed')

  static textFor({ issue, branch, base, cut, baseline = SliceSeed.NOT_MEASURED }: {
    issue: NumberedIssue,
    branch: string,
    base: string,
    cut: string,
    baseline?: BaselineResult,
  }): string {
    return renderState({
      meta: {
        baseline: baseline.seedField,
        task: `escribir el plan del issue #${issue.number}`,
        role: 'slice-agent: escribes el plan de este slice contra el código real y PARAS. No implementas nada.',
        status: 'in_progress',
        branch,
        base,
        base_sha: cut,
        last_commit: cut,
        gates: SliceSeed.GATES,
        github_issue: issue.number,
        you_are_here: 'worktree recién cortado, sin trabajo encima',
        next_action: 'escribe el plan prescriptivo, valídalo con --check-plan, commitéalo y para',
        blocked: null,
      },
      body: [
        `Estado del slice del issue #${issue.number}. Lo sembró el backend de Control Tower al abrir esta sesión.`,
        '',
        'Este fichero está fuera de la vista de git a propósito: no puede entrar en el pull request.',
      ].join('\n'),
    })
  }
}

class WorktreeListing {
  static readonly HEADING = 'worktree '
  static readonly BRANCH = 'branch refs/heads/'
  static readonly #NUMBERED = /^[1-9]\d*$/

  static surveyOf({ printed, root, repository }: {
    printed: string,
    root: string,
    repository: RepositoryName,
  }): WorkspaceSurvey {
    const blocks = printed.split('\n\n').map((block) => block.trim()).filter((block) => block.length > 0)
    if (blocks.length === 0) {
      throw new WorkspaceNotUnderstood(
        `git worktree list --porcelain printed nothing for ${root}, and a checkout always lists at least itself`
      )
    }

    return new WorkspaceSurvey({
      repository,
      prepared: blocks
        .map((block) => WorktreeListing.#preparedIn(block, root))
        .filter((found) => found !== null),
    })
  }

  static #preparedIn(block: string, root: string): PreparedWorkspace | null {
    const lines = block.split('\n')
    if (!lines[0].startsWith(WorktreeListing.HEADING)) {
      throw new WorkspaceNotUnderstood(
        `every block of git worktree list --porcelain names a worktree first, and ${root} answered ${JSON.stringify(lines[0])}`
      )
    }
    const path = lines[0].slice(WorktreeListing.HEADING.length)
    const numbered = path.split('/').at(-1) ?? ''
    if (!WorktreeListing.#NUMBERED.test(numbered)) return null
    const issue = { number: Number(numbered) }
    if (path !== GitWorkspace.pathFor(root, issue)) return null
    const branch = GitWorkspace.branchFor(issue)
    if (!lines.includes(`${WorktreeListing.BRANCH}${branch}`)) return null

    return new PreparedWorkspace({ issueNumber: issue.number, located: new WorkspaceLocation({ root, path, branch }) })
  }
}

export class GitWorkspace extends Workspace {
  static readonly BIN = 'git'
  static readonly DIRECTORY = '.worktrees'
  static readonly REMOTE_HEAD = 'refs/remotes/origin/HEAD'
  static readonly REMOTE = 'origin'
  static readonly #DECLARED = /^refs\/remotes\/origin\/(.+)$/
  static readonly #NAMED = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/

  readonly run: ToolLaunch
  readonly write: DiskWrite
  readonly read: DiskRead
  readonly stderr: DiagnosticWriter
  readonly baseline: Baseline

  constructor({ run, write, read, stderr, baseline }: {
    run: ToolLaunch,
    write: DiskWrite,
    read: DiskRead,
    stderr: DiagnosticWriter,
    baseline: Baseline,
  }) {
    super()
    this.run = run
    this.write = write
    this.read = read
    this.stderr = stderr
    this.baseline = baseline
  }

  static branchFor(issue: NumberedIssue): string {
    return `${LOOP_BRANCH_PREFIX}${issue.number}`
  }

  static pathFor(root: string, issue: NumberedIssue): string {
    return `${root}/${GitWorkspace.DIRECTORY}/${issue.number}`
  }

  static argvFor({ root, base, issue }: { root: string, base: string, issue: NumberedIssue }): string[] {
    return [
      '-C', root,
      'worktree', 'add',
      '-b', GitWorkspace.branchFor(issue),
      GitWorkspace.pathFor(root, issue),
      `origin/${base}`,
    ]
  }

  static remoteArgvFor(root: string): string[] {
    return ['-C', root, 'remote', 'get-url', GitWorkspace.REMOTE]
  }

  static surveyArgvFor(root: string): string[] {
    return ['-C', root, 'worktree', 'list', '--porcelain']
  }

  static toplevelArgvFor(root: string): string[] {
    return ['-C', root, 'rev-parse', '--show-toplevel']
  }

  static defaultBranchArgvFor(root: string): string[] {
    return ['-C', root, 'symbolic-ref', GitWorkspace.REMOTE_HEAD]
  }

  static cutArgvFor(path: string): string[] {
    return ['-C', path, 'rev-parse', 'HEAD']
  }

  static commonDirArgvFor(path: string): string[] {
    return ['-C', path, 'rev-parse', '--git-common-dir']
  }

  static statusArgvFor(path: string): string[] {
    return ['-C', path, 'status', '--porcelain', '--untracked-files=all']
  }

  static removeArgvFor(root: string, path: string): string[] {
    return ['-C', root, 'worktree', 'remove', '--force', path]
  }

  static deleteBranchArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'branch', '-D', branch]
  }

  async confirm({ root, repository }: { root: CheckoutRoot, repository: RepositoryName }): Promise<CheckoutRoot> {
    let held
    try {
      held = await this.#repositoryOfRoot(root.text)
    } catch (failure) {
      throw new CheckoutNotConfirmed(`${repository.text}: ${(failure as Error).message}`)
    }
    if (held.text !== repository.text) {
      throw new CheckoutNotConfirmed(`${repository.text}: ${root.text} holds ${held.text}`)
    }

    return await this.#canonicalRootOf(root.text, repository.text)
  }

  async #canonicalRootOf(root: string, repository: string): Promise<CheckoutRoot> {
    const asked = await this.run(GitWorkspace.toplevelArgvFor(root))
    if (asked.failed) {
      throw new CheckoutNotConfirmed(`${repository}: ${root} could not be resolved to its git top level: ${asked.stderr.trim()}`)
    }
    const printed = asked.stdout.trim()
    if (printed.length === 0) {
      throw new WorkspaceNotUnderstood(
        `git rev-parse --show-toplevel printed nothing for ${root}, and a checkout always has one`
      )
    }

    return new CheckoutRoot(printed)
  }

  async prepare({ issue, repository, root }: {
    issue: PlanIssue,
    repository: RepositoryName,
    root: CheckoutRoot,
  }): Promise<SownWorkspace> {
    const base = await this.#declaredBase(root.text)
    const path = GitWorkspace.pathFor(root.text, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(root.text, issue, base)
    const located = new WorkspaceLocation({ root: root.text, path, branch })
    try {
      return new SownWorkspace({ located, baseline: await this.#seed(located, issue, base) })
    } catch (failure) {
      await this.undo(located)
      throw failure
    }
  }

  async survey(root: CheckoutRoot): Promise<WorkspaceSurvey> {
    const repository = await this.#repositoryOfRoot(root.text)
    const listed = await this.run(GitWorkspace.surveyArgvFor(root.text))
    if (listed.failed) {
      throw new WorkspaceNotRead(
        `git worktree list could not say what ${root.text} holds, so the checkout was not surveyed: ${listed.stderr.trim()}`
      )
    }

    return WorktreeListing.surveyOf({ printed: listed.stdout, root: root.text, repository })
  }

  async #repositoryOfRoot(root: string): Promise<RepositoryName> {
    const asked = await this.run(GitWorkspace.remoteArgvFor(root))
    if (asked.failed) {
      throw new WorkspaceNotRead(
        `${root} does not name a ${GitWorkspace.REMOTE} remote, so the repository it holds cannot be confirmed: ${asked.stderr.trim()}`
      )
    }
    const url = asked.stdout.trim()
    const named = url.match(GitWorkspace.#NAMED)
    if (named === null || !RepositoryName.isWellFormed(named[1])) {
      throw new WorkspaceNotUnderstood(
        `the ${GitWorkspace.REMOTE} of ${root} is ${JSON.stringify(url)}, and no owner/name can be read out of it`
      )
    }

    return new RepositoryName(named[1])
  }

  async #declaredBase(root: string): Promise<string> {
    const asked = await this.run(GitWorkspace.defaultBranchArgvFor(root))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `the remote of ${root} does not declare a default branch, so there is no base to cut from: ${asked.stderr.trim()}`
      )
    }
    const declared = asked.stdout.trim().match(GitWorkspace.#DECLARED)
    if (declared === null) {
      throw new WorkspaceNotUnderstood(
        `the remote does not declare a default branch under ${GitWorkspace.REMOTE_HEAD}, git printed ${JSON.stringify(asked.stdout)}`
      )
    }

    return declared[1]
  }

  async undo(located: WorkspaceLocation): Promise<void> {
    const root = located.root as string
    const removed = await this.run(GitWorkspace.removeArgvFor(root, located.path))
    if (removed.failed) this.#warn(`the worktree ${located.path}`, removed)
    const deleted = await this.run(GitWorkspace.deleteBranchArgvFor(root, located.branch))
    if (deleted.failed) this.#warn(`the branch ${located.branch}`, deleted)
  }

  #warn(what: string, refused: ProcessOutput): void {
    this.stderr(`git workspace: could not undo ${what}, it stays behind: ${refused.stderr.trim()}\n`)
  }

  async #cut(root: string, issue: NumberedIssue, base: string): Promise<void> {
    const argv = GitWorkspace.argvFor({ root, base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }
  }

  async #seed(located: WorkspaceLocation, issue: NumberedIssue, base: string): Promise<BaselineResult> {
    await this.#exclude(located)
    const cut = await this.#cutOf(located)
    const baseline = await this.#baselineOf(located)
    await this.write(
      `${located.path}/${SliceSeed.RELATIVE_PATH}`,
      SliceSeed.textFor({ issue, branch: located.branch, base, cut, baseline })
    )
    await this.#verifyHidden(located)

    return baseline
  }

  async #baselineOf(located: WorkspaceLocation): Promise<BaselineResult> {
    const measured = await this.baseline.measure(located.path)
    if (measured.outcome !== BaselineOutcome.GREEN) {
      this.stderr(
        `git workspace: the baseline of ${located.path} is ${measured.outcome}: ${measured.summary}. ` +
        `It is sown into ${SliceSeed.RELATIVE_PATH} as it stands, and the session starts anyway: ` +
        'whether to work on a baseline that is not green is a decision for a person.\n'
      )
    }

    return measured
  }

  async #exclude(located: WorkspaceLocation): Promise<void> {
    const commonDir = await this.#commonDirOf(located)
    const path = `${commonDir}/${SliceSeed.EXCLUDE_PATH}`
    const current = await this.read(path)
    const next = excludeContentWith(current ?? '', SliceSeed.EXCLUDE_RULE)
    if (next.added) await this.write(path, next.content)
  }

  async #commonDirOf(located: WorkspaceLocation): Promise<string> {
    const asked = await this.run(GitWorkspace.commonDirArgvFor(located.path))
    if (asked.failed) {
      throw new WorkspaceNotPrepared(
        `could not resolve the common git directory of ${located.path}, so ${SliceSeed.RELATIVE_PATH} would stay visible to git: ${asked.stderr.trim()}`
      )
    }
    const answered = asked.stdout.trim()
    if (answered.length === 0) {
      throw new WorkspaceNotUnderstood(
        `git --git-common-dir printed nothing for ${located.path}, so there is no directory to write ${SliceSeed.EXCLUDE_PATH} into`
      )
    }

    return isAbsolute(answered) ? answered : `${located.root}/${answered}`
  }

  async #cutOf(located: WorkspaceLocation): Promise<string> {
    const measured = await this.run(GitWorkspace.cutArgvFor(located.path))
    if (measured.failed) {
      throw new WorkspaceNotPrepared(
        `could not measure the commit of ${located.path}, so ${SliceSeed.RELATIVE_PATH} is not seeded without a cut: ${measured.stderr.trim()}`
      )
    }

    return measured.stdout.trim()
  }

  async #verifyHidden(located: WorkspaceLocation): Promise<void> {
    const status = await this.run(GitWorkspace.statusArgvFor(located.path))
    if (status.failed) {
      throw new WorkspaceNotPrepared(
        `could not check that ${SliceSeed.RELATIVE_PATH} stays out of git's sight in ${located.path}: ${status.stderr.trim()}`
      )
    }
    const visible = status.stdout.split('\n').some((line) => line.includes(SliceSeed.RELATIVE_PATH))
    if (visible) {
      throw new WorkspaceNotUnderstood(
        `${SliceSeed.RELATIVE_PATH} is still visible to git in ${located.path} after seeding the exclusion rule`
      )
    }
  }
}
