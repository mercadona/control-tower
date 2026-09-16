import { isAbsolute } from 'node:path'
import { lstat as inspectPath } from 'node:fs/promises'
import { SLICE_REL_PATH, excludeContentWith } from '../../../plugin/scripts/state-paths.js'
import { LOOP_BRANCH_PREFIX } from '../../../plugin/scripts/conventions.js'
import { buildStateSeed } from '../../../plugin/scripts/kickoff.js'
import { parseStateSafe } from '../../../plugin/scripts/state.js'
import { mapGhIssue, NO_MILESTONE_KEY } from '../../../plugin/scripts/gh-issue-map.js'
import { BaselineOutcome, BaselineResult } from '../../../plugin/scripts/baseline.js'
import type { Baseline } from '../../../plugin/scripts/baseline.js'
import { SownWorkspace } from '../domain/value-objects/sown-workspace.ts'
import { Workspace } from '../domain/ports/workspace.ts'
import { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import { PreparedWorkspace } from '../domain/value-objects/prepared-workspace.ts'
import { RepositoryName } from '../domain/value-objects/repository-name.ts'
import { WorkspaceLocation } from '../domain/value-objects/workspace-location.ts'
import { WorkspaceSurvey } from '../domain/value-objects/workspace-survey.ts'
import { UnusedWorkspace } from '../domain/value-objects/unused-workspace.ts'
import {
  PlanCleanupConflict, PlanCleanupNotRead, PlanCleanupNotUnderstood,
  WorkspaceNotCleaned, WorkspaceNotPrepared, WorkspaceNotRead, WorkspaceNotUnderstood, CheckoutNotConfirmed,
} from '../domain/exceptions.ts'
import type { PlanIssue } from '../domain/value-objects/plan-issue.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import type { ProcessOutput } from './tool-runner.ts'
import type { ToolLaunch } from './external-tool.ts'
import type { Gh } from './gh.ts'

export type NumberedIssue = { readonly number: number }
export type DiskWrite = (path: string, text: string) => Promise<void>
export type DiskRead = (path: string) => Promise<string | null>
export type DiagnosticWriter = (line: string) => void
export type SeedSlice = ReturnType<typeof mapGhIssue> & { readonly epic: string }
type Presence = 'present' | 'absent'

class UnlaunchedWorkspace {
  readonly evidence: UnusedWorkspace
  readonly worktree: Presence
  readonly branch: Presence

  constructor(asked: { evidence: UnusedWorkspace, worktree: boolean, branch: boolean }) {
    this.evidence = asked.evidence
    this.worktree = asked.worktree ? 'present' : 'absent'
    this.branch = asked.branch ? 'present' : 'absent'
    Object.freeze(this)
  }

  removeWorktree(): boolean { return this.worktree === 'present' }
  removeBranch(): boolean { return this.branch === 'present' }
}

export class SliceSeed {
  static readonly RELATIVE_PATH = SLICE_REL_PATH
  static readonly EXCLUDE_PATH = 'info/exclude'
  static readonly EXCLUDE_RULE = SliceSeed.RELATIVE_PATH

  static textFor({ slice, branch, base, cut, baseline }: {
    slice: SeedSlice,
    branch: string,
    base: string,
    cut: string,
    baseline: BaselineResult,
  }): string {
    return buildStateSeed(slice, { branch, base, baseSha: cut, baseline })
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

  static requireAbsent(printed: string, watch: PlanWatch): void {
    const blocks = printed.split('\n\n').map((block) => block.trim()).filter((block) => block.length > 0)
    if (blocks.length === 0) throw new PlanCleanupNotUnderstood('git worktree list printed no checkout')
    const paths = new Set<string>()
    for (const block of blocks) {
      const lines = block.split('\n')
      if (!lines[0].startsWith(WorktreeListing.HEADING)) {
        throw new PlanCleanupNotUnderstood(`malformed worktree heading ${JSON.stringify(lines[0])}`)
      }
      const path = lines[0].slice(WorktreeListing.HEADING.length)
      if (!isAbsolute(path) || paths.has(path)) {
        throw new PlanCleanupNotUnderstood(`invalid or duplicate worktree path ${JSON.stringify(path)}`)
      }
      paths.add(path)
      const fields = lines.slice(1)
      const heads = fields.filter((line) => line.startsWith('HEAD '))
      const branches = fields.filter((line) => line.startsWith('branch '))
      const detached = fields.filter((line) => line === 'detached')
      const bare = fields.filter((line) => line === 'bare')
      const recognized = fields.every((line) => /^(HEAD [0-9a-f]{40}|branch refs\/heads\/.+|detached|bare|locked(?: .*)?|prunable(?: .*)?)$/.test(line))
      const normal = heads.length === 1 && branches.length + detached.length === 1 && bare.length === 0
      const bareRecord = bare.length === 1 && heads.length === 0 && branches.length === 0 && detached.length === 0
      if (!recognized || (!normal && !bareRecord)) {
        throw new PlanCleanupNotUnderstood(`malformed worktree block for ${JSON.stringify(path)}`)
      }
      if (path === watch.located.path) {
        throw new WorkspaceNotCleaned(`worktree registration ${path} remains after cleanup`)
      }
      if (branches.includes(`branch refs/heads/${watch.located.branch}`)) {
        throw new WorkspaceNotCleaned(`branch ${watch.located.branch} remains registered at ${path}`)
      }
    }
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
  readonly gh: Gh
  readonly inspectPath: typeof inspectPath

  constructor({ run, write, read, stderr, baseline, gh, lstat }: {
    run: ToolLaunch,
    write: DiskWrite,
    read: DiskRead,
    stderr: DiagnosticWriter,
    baseline: Baseline,
    gh: Gh,
    lstat?: typeof inspectPath,
  }) {
    super()
    this.run = run
    this.write = write
    this.read = read
    this.stderr = stderr
    this.baseline = baseline
    this.gh = gh
    this.inspectPath = lstat ?? inspectPath
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

  static declaredBranchIn(printed: string): string | null {
    const declared = printed.trim().match(GitWorkspace.#DECLARED)
    return declared === null ? null : declared[1]
  }

  static fetchArgvFor(root: string, base: string): string[] {
    return ['-C', root, 'fetch', GitWorkspace.REMOTE, base]
  }

  static verifyBaseArgvFor(root: string, base: string): string[] {
    return ['-C', root, 'rev-parse', '--verify', '--quiet', `${GitWorkspace.REMOTE}/${base}^{commit}`]
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

  static removeUnlaunchedArgvFor(root: string, path: string): string[] {
    return ['-C', root, 'worktree', 'remove', path]
  }

  static deleteUnusedBranchArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'branch', '-d', branch]
  }

  static branchTipArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]
  }

  static remoteBranchArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'ls-remote', '--heads', GitWorkspace.REMOTE, branch]
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

  async inspectUnlaunched(watch: PlanWatch, previous: UnusedWorkspace | null): Promise<UnusedWorkspace> {
    return (await this.#inspectUnlaunched(watch, previous)).evidence
  }

  async undoUnlaunched(evidence: UnusedWorkspace): Promise<void> {
    const state = await this.#inspectUnlaunched(evidence.watch, evidence)
    const root = GitWorkspace.#requiredRoot(evidence.watch)
    if (state.removeWorktree()) {
      const removed = await this.run(GitWorkspace.removeUnlaunchedArgvFor(
        root,
        evidence.watch.located.path,
      ))
      if (removed.failed) {
        throw new PlanCleanupNotRead(
          `the verified unused worktree ${evidence.watch.located.path} could not be removed: ${GitWorkspace.#output(removed)}`
        )
      }
    }
    if (state.removeBranch()) {
      const deleted = await this.run(GitWorkspace.deleteUnusedBranchArgvFor(
        root,
        evidence.watch.located.branch,
      ))
      if (deleted.failed) {
        throw new PlanCleanupNotRead(
          `the verified unused branch ${evidence.watch.located.branch} could not be removed: ${GitWorkspace.#output(deleted)}`
        )
      }
    }
  }

  async confirmAbsent(watch: PlanWatch): Promise<void> {
    const root = GitWorkspace.#requiredRoot(watch)
    await this.#requireCleanupIdentity(watch, root)
    const listed = await this.run(GitWorkspace.surveyArgvFor(root))
    if (listed.failed) {
      throw new PlanCleanupNotRead(`worktree registration absence could not be confirmed: ${GitWorkspace.#output(listed)}`)
    }
    WorktreeListing.requireAbsent(listed.stdout, watch)
    const checked = await this.run(GitWorkspace.branchTipArgvFor(root, watch.located.branch))
    if (!checked.failed) {
      if (!/^[0-9a-f]{40}\n?$/.test(checked.stdout) || checked.stderr.length !== 0) {
        throw new PlanCleanupNotUnderstood(`local branch query printed malformed evidence: ${GitWorkspace.#output(checked)}`)
      }
      throw new WorkspaceNotCleaned(`local branch ${watch.located.branch} remains after cleanup`)
    }
    if (checked.code !== 1 || checked.stdout.length !== 0 || checked.stderr.length !== 0) {
      throw new PlanCleanupNotRead(`local branch absence could not be confirmed: ${GitWorkspace.#output(checked)}`)
    }
    const path = watch.located.path
    try {
      await this.inspectPath(path)
    } catch (cause) {
      if (cause !== null && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') {
        await this.#requireNoRemoteWork(watch, root)
        return
      }
      throw new PlanCleanupNotRead(`worktree path absence could not be confirmed: ${String(cause)}`)
    }
    throw new WorkspaceNotCleaned(`worktree path ${path} remains after cleanup`)
  }

  async #inspectUnlaunched(watch: PlanWatch, previous: UnusedWorkspace | null): Promise<UnlaunchedWorkspace> {
    const root = GitWorkspace.#requiredRoot(watch)
    await this.#requireCleanupIdentity(watch, root)
    const listed = await this.run(GitWorkspace.surveyArgvFor(root))
    if (listed.failed) {
      throw new PlanCleanupNotRead(`git worktree list failed: ${GitWorkspace.#output(listed)}`)
    }
    const worktree = GitWorkspace.#worktreeState(listed.stdout, watch)
    let branch = worktree
    let baseSha: string
    if (worktree) {
      baseSha = await this.#seedBase(watch)
      const head = await this.run(['-C', watch.located.path, 'rev-parse', 'HEAD'])
      if (head.failed) throw new PlanCleanupNotRead(`worktree HEAD could not be read: ${GitWorkspace.#output(head)}`)
      if (head.stdout.trim() !== baseSha) {
        throw new PlanCleanupConflict(`worktree HEAD changed from seeded base ${baseSha}`)
      }
      const status = await this.run(GitWorkspace.statusArgvFor(watch.located.path))
      if (status.failed) throw new PlanCleanupNotRead(`worktree status could not be read: ${GitWorkspace.#output(status)}`)
      if (status.stdout.length !== 0) throw new PlanCleanupConflict(`worktree ${watch.located.path} is not clean`)
    } else {
      if (previous === null) {
        throw new PlanCleanupConflict(`worktree ${watch.located.path} is absent without cleanup evidence`)
      }
      baseSha = previous.baseSha
      const tip = await this.run(GitWorkspace.branchTipArgvFor(root, watch.located.branch))
      if (tip.failed) {
        if (tip.code !== 1 || tip.stdout.length !== 0 || tip.stderr.length !== 0) {
          throw new PlanCleanupNotRead(`local branch state could not be read: ${GitWorkspace.#output(tip)}`)
        }
        branch = false
      } else if (tip.stdout.trim() !== baseSha) {
        throw new PlanCleanupConflict(`local branch ${watch.located.branch} changed from seeded base ${baseSha}`)
      } else {
        branch = true
      }
    }
    if (previous !== null && previous.baseSha !== baseSha) {
      throw new PlanCleanupConflict(`cleanup evidence base ${previous.baseSha} differs from seeded base ${baseSha}`)
    }
    await this.#requireNoRemoteWork(watch, root)
    return new UnlaunchedWorkspace({
      evidence: previous ?? new UnusedWorkspace({ watch, baseSha, checkedAt: new Date().toISOString() }),
      worktree,
      branch,
    })
  }

  async #seedBase(watch: PlanWatch): Promise<string> {
    const path = `${watch.located.path}/${SliceSeed.RELATIVE_PATH}`
    const text = await this.read(path)
    if (text === null) throw new PlanCleanupNotUnderstood(`${path} is absent`)
    const parsed = parseStateSafe(text)
    if (parsed.error !== null) throw new PlanCleanupNotUnderstood(`${path} cannot be parsed: ${parsed.error}`)
    if (parsed.meta.branch !== watch.located.branch || parsed.meta.github_issue !== watch.issue.number
      || typeof parsed.meta.base_sha !== 'string' || !/^[0-9a-f]{40}$/.test(parsed.meta.base_sha)) {
      throw new PlanCleanupNotUnderstood(`${path} does not carry the recorded branch, issue and 40-hex base`)
    }
    return parsed.meta.base_sha
  }

  async #requireCleanupIdentity(watch: PlanWatch, root: string): Promise<void> {
    const remote = await this.run(GitWorkspace.remoteArgvFor(root))
    if (remote.failed) throw new PlanCleanupNotRead(`checkout remote could not be read: ${GitWorkspace.#output(remote)}`)
    const named = remote.stdout.trim().match(GitWorkspace.#NAMED)
    if (named === null || named[1] !== watch.repository.text) {
      throw new PlanCleanupConflict(`${root} does not hold ${watch.repository.text}`)
    }
    const top = await this.run(GitWorkspace.toplevelArgvFor(root))
    if (top.failed) throw new PlanCleanupNotRead(`checkout root could not be resolved: ${GitWorkspace.#output(top)}`)
    if (top.stdout.trim() !== root) throw new PlanCleanupConflict(`${root} is not the canonical checkout root`)
  }

  async #requireNoRemoteWork(watch: PlanWatch, root: string): Promise<void> {
    const remote = await this.run(GitWorkspace.remoteBranchArgvFor(root, watch.located.branch))
    if (remote.failed) throw new PlanCleanupNotRead(`remote branch state could not be read: ${GitWorkspace.#output(remote)}`)
    if (remote.stdout.trim().length !== 0) {
      throw new PlanCleanupConflict(`remote branch ${watch.located.branch} exists`)
    }
    const pulls = await this.gh.run([
      'pr', 'list', '--repo', watch.repository.text, '--state', 'all', '--head', watch.located.branch,
      '--json', 'number', '--limit', '1',
    ], { safeToRepeat: true })
    if (pulls.failed) throw new PlanCleanupNotRead(`pull requests could not be read: ${GitWorkspace.#output(pulls)}`)
    let parsed: unknown
    try {
      parsed = JSON.parse(pulls.stdout)
    } catch {
      throw new PlanCleanupNotUnderstood(`gh pr list printed non-json: ${JSON.stringify(pulls.stdout)}`)
    }
    if (!Array.isArray(parsed)) throw new PlanCleanupNotUnderstood('gh pr list did not print an array')
    if (parsed.length > 0) throw new PlanCleanupConflict(`a pull request exists for ${watch.located.branch}`)
  }

  static #worktreeState(printed: string, watch: PlanWatch): boolean {
    const blocks = printed.split('\n\n').map((block) => block.trim()).filter((block) => block.length > 0)
    if (blocks.length === 0) throw new PlanCleanupNotUnderstood('git worktree list printed no checkout')
    const matching = blocks.filter((block) => block.split('\n')[0] === `worktree ${watch.located.path}`)
    if (matching.length > 1) throw new PlanCleanupNotUnderstood(`worktree ${watch.located.path} is listed more than once`)
    if (matching.length === 0) return false
    if (!matching[0].split('\n').includes(`branch refs/heads/${watch.located.branch}`)) {
      throw new PlanCleanupConflict(`worktree ${watch.located.path} does not hold ${watch.located.branch}`)
    }
    return true
  }

  static #requiredRoot(watch: PlanWatch): string {
    if (watch.located.root === undefined) {
      throw new PlanCleanupNotUnderstood(`dispatch ${watch.agent} has no checkout root`)
    }
    return watch.located.root
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
    const slice = await this.#sliceFor(issue, repository)
    if (slice.gates.includes('plan')) {
      throw new WorkspaceNotPrepared(`issue #${issue.number} declares the plan gate and cannot be prepared`)
    }
    const base = await this.#declaredBase(root.text)
    await this.#fetch(root.text, base)
    const cut = await this.#verifiedCut(root.text, base)
    const path = GitWorkspace.pathFor(root.text, issue)
    const branch = GitWorkspace.branchFor(issue)
    await this.#cut(root.text, issue, base)
    const located = new WorkspaceLocation({ root: root.text, path, branch })
    try {
      return new SownWorkspace({ located, baseline: await this.#seed(located, slice, base, cut) })
    } catch (failure) {
      try {
        await this.undo(located)
      } catch (cleanup) {
        throw new WorkspaceNotCleaned(
          `workspace preparation failed after ${GitWorkspace.#cause(failure)}; ` +
          `workspace cleanup failed: ${GitWorkspace.#cause(cleanup)}`
        )
      }
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
    const declared = GitWorkspace.declaredBranchIn(asked.stdout)
    if (declared === null) {
      throw new WorkspaceNotUnderstood(
        `the remote does not declare a default branch under ${GitWorkspace.REMOTE_HEAD}, git printed ${JSON.stringify(asked.stdout)}`
      )
    }

    return declared
  }

  async undo(located: WorkspaceLocation): Promise<void> {
    const root = located.root as string
    const removed = await this.run(GitWorkspace.removeArgvFor(root, located.path))
    if (removed.failed) {
      throw new WorkspaceNotCleaned(
        `the worktree ${located.path} remains and branch cleanup was not attempted: ${GitWorkspace.#output(removed)}`
      )
    }
    const deleted = await this.run(GitWorkspace.deleteBranchArgvFor(root, located.branch))
    if (deleted.failed) {
      throw new WorkspaceNotCleaned(
        `the worktree ${located.path} was removed but branch ${located.branch} remains: ${GitWorkspace.#output(deleted)}`
      )
    }
  }

  async #cut(root: string, issue: NumberedIssue, base: string): Promise<void> {
    const argv = GitWorkspace.argvFor({ root, base, issue })
    const output = await this.run(argv)
    if (output.failed) {
      throw new WorkspaceNotPrepared(`${GitWorkspace.BIN} worktree add failed: ${output.stderr.trim()}`)
    }
  }

  async #seed(located: WorkspaceLocation, slice: SeedSlice, base: string, cut: string): Promise<BaselineResult> {
    await this.#exclude(located)
    const baseline = await this.#baselineOf(located)
    await this.write(
      `${located.path}/${SliceSeed.RELATIVE_PATH}`,
      SliceSeed.textFor({ slice, branch: located.branch, base, cut, baseline })
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

  async #sliceFor(issue: PlanIssue, repository: RepositoryName): Promise<SeedSlice> {
    const output = await this.gh.run([
      'issue', 'view', String(issue.number), '--repo', repository.text,
      '--json', 'number,title,body,labels,milestone',
    ], { safeToRepeat: true })
    if (output.failed) {
      throw new WorkspaceNotRead(`gh issue view failed: ${GitWorkspace.#output(output)}`)
    }

    return GitWorkspace.#sliceIn(output.stdout, issue.number)
  }

  static #sliceIn(printed: string, expectedNumber: number): SeedSlice {
    let value: unknown
    try {
      value = JSON.parse(printed)
    } catch {
      throw new WorkspaceNotUnderstood(`gh issue view printed non-json: ${JSON.stringify(printed)}`)
    }
    const source = GitWorkspace.#record(value, `gh issue view printed no issue object`)
    if (source.number !== expectedNumber || typeof source.title !== 'string' || typeof source.body !== 'string') {
      throw new WorkspaceNotUnderstood(
        `gh issue view printed malformed issue #${expectedNumber}: ${JSON.stringify(value)}`
      )
    }
    if (!Array.isArray(source.labels)) {
      throw new WorkspaceNotUnderstood(
        `gh issue view printed malformed issue #${expectedNumber}: ${JSON.stringify(value)}`
      )
    }
    const labels = source.labels.map((label, index) => {
      const read = GitWorkspace.#record(label, `gh issue view printed malformed label ${index}`)
      if (typeof read.name !== 'string') {
        throw new WorkspaceNotUnderstood(`gh issue view printed malformed label ${index}: ${JSON.stringify(label)}`)
      }

      return { name: read.name }
    })
    let milestone: { title: string } | null
    if (source.milestone === null) {
      milestone = null
    } else {
      const read = GitWorkspace.#record(source.milestone, `gh issue view printed malformed milestone`)
      if (typeof read.title !== 'string') {
        throw new WorkspaceNotUnderstood(`gh issue view printed malformed milestone: ${JSON.stringify(source.milestone)}`)
      }
      milestone = { title: read.title }
    }
    const projected = {
      number: source.number,
      title: source.title,
      body: source.body,
      labels,
      milestone,
    }

    return Object.freeze({
      ...mapGhIssue(projected),
      epic: projected.milestone?.title ?? NO_MILESTONE_KEY,
    })
  }

  async #fetch(root: string, base: string): Promise<void> {
    const output = await this.run(GitWorkspace.fetchArgvFor(root, base))
    if (output.failed) {
      throw new WorkspaceNotPrepared(`git fetch origin ${base} failed: ${GitWorkspace.#output(output)}`)
    }
  }

  async #verifiedCut(root: string, base: string): Promise<string> {
    const output = await this.run(GitWorkspace.verifyBaseArgvFor(root, base))
    if (output.failed) {
      throw new WorkspaceNotPrepared(`origin/${base} does not resolve to a commit: ${GitWorkspace.#output(output)}`)
    }
    const cut = output.stdout.trim()
    if (cut.length === 0) {
      throw new WorkspaceNotUnderstood(`git verified origin/${base} but printed no commit`)
    }

    return cut
  }

  static #output(output: ProcessOutput): string {
    return `exit ${output.code}, stdout ${JSON.stringify(output.stdout)}, stderr ${JSON.stringify(output.stderr)}`
  }

  static #cause(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause)
  }

  static #record(value: unknown, context: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new WorkspaceNotUnderstood(`${context}: ${JSON.stringify(value)}`)
    }

    return Object.fromEntries(Object.entries(value))
  }
}
