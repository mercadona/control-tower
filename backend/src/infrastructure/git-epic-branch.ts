import { EpicBranch } from '../domain/ports/epic-branch.ts'
import { EpicBranchNotPublished, EpicBranchNotUnderstood } from '../domain/exceptions.ts'
import { GitWorkspace } from './git-workspace.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { ToolLaunch } from './external-tool.ts'

export class GitEpicBranch extends EpicBranch {
  static readonly REMOTE = 'origin'
  static readonly DECLARE_DEFAULT = `git remote set-head ${GitEpicBranch.REMOTE} -a`

  readonly run: ToolLaunch

  constructor({ run }: { run: ToolLaunch }) {
    super()
    this.run = run
  }

  static currentArgvFor(root: string): string[] {
    return GitWorkspace.currentBranchArgvFor(root)
  }

  static addArgvFor(root: string, paths: string[]): string[] {
    return ['-C', root, 'add', '--', ...paths]
  }

  static commitArgvFor(root: string, message: string, paths: string[]): string[] {
    return ['-C', root, 'commit', '-m', message, '--', ...paths]
  }

  static dirtyArgvFor(root: string, paths: string[]): string[] {
    return ['-C', root, 'status', '--porcelain', '--', ...paths]
  }

  static remoteRefArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'rev-parse', '--verify', '--quiet', `refs/remotes/${GitEpicBranch.REMOTE}/${branch}`]
  }

  static aheadArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'rev-list', '--count', `${GitEpicBranch.REMOTE}/${branch}..${branch}`]
  }

  static pushArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'push', '--set-upstream', GitEpicBranch.REMOTE, branch]
  }

  static #localRefArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]
  }

  static #remoteBranchArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'ls-remote', '--heads', GitEpicBranch.REMOTE, branch]
  }

  static #fetchArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'fetch', GitEpicBranch.REMOTE, `${branch}:${branch}`]
  }

  static #switchArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'switch', branch]
  }

  static #cutArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'switch', '--create', branch]
  }

  async current(root: CheckoutRoot): Promise<string> {
    const asked = await this.run(GitEpicBranch.currentArgvFor(root.text))
    if (asked.failed) {
      throw new EpicBranchNotPublished(
        `could not resolve the branch ${root.text} is on: ${asked.stderr.trim()}`
      )
    }
    const branch = asked.stdout.trim()
    if (branch.length === 0) {
      throw new EpicBranchNotUnderstood(
        `git rev-parse --abbrev-ref HEAD printed nothing for ${root.text}, and a checkout always sits on a branch`
      )
    }

    return branch
  }

  async publishing({ root, milestone }: { root: CheckoutRoot, milestone: string }): Promise<string> {
    const branch = await this.current(root)
    if (branch !== await this.defaultBranch(root)) return branch

    return await this.#milestoneBranchOf(root, milestone)
  }

  async committed({ root, paths }: { root: CheckoutRoot, paths: string[] }): Promise<boolean> {
    const asked = await this.run(GitEpicBranch.dirtyArgvFor(root.text, paths))
    if (asked.failed) {
      throw new EpicBranchNotPublished(
        `git status could not say whether ${paths.join(', ')} are committed in ${root.text}: ${asked.stderr.trim()}`
      )
    }

    return asked.stdout.trim().length === 0
  }

  async commit({ root, paths, message }: {
    root: CheckoutRoot, paths: string[], message: string,
  }): Promise<void> {
    await this.#add(root, paths)
    await this.#commit(root, message, paths)
  }

  async pushed({ root, branch }: { root: CheckoutRoot, branch: string }): Promise<boolean> {
    const known = await this.run(GitEpicBranch.remoteRefArgvFor(root.text, branch))
    if (known.failed) return false
    const ahead = await this.run(GitEpicBranch.aheadArgvFor(root.text, branch))
    if (ahead.failed) {
      throw new EpicBranchNotPublished(
        `git rev-list could not say whether ${branch} of ${root.text} is on the remote: ${ahead.stderr.trim()}`
      )
    }

    return ahead.stdout.trim() === '0'
  }

  async push({ root, branch }: { root: CheckoutRoot, branch: string }): Promise<void> {
    await this.#push(root, branch)
  }

  async #milestoneBranchOf(root: CheckoutRoot, milestone: string): Promise<string> {
    if (await this.#held(root, milestone)) return await this.#switchTo(root, milestone)
    if (await this.#heldByTheRemote(root, milestone)) {
      await this.#fetch(root, milestone)
      return await this.#switchTo(root, milestone)
    }

    return await this.#cut(root, milestone)
  }

  async #held(root: CheckoutRoot, branch: string): Promise<boolean> {
    return !(await this.run(GitEpicBranch.#localRefArgvFor(root.text, branch))).failed
  }

  async #heldByTheRemote(root: CheckoutRoot, branch: string): Promise<boolean> {
    const asked = await this.run(GitEpicBranch.#remoteBranchArgvFor(root.text, branch))
    if (asked.failed) {
      throw new EpicBranchNotPublished(
        `${GitEpicBranch.REMOTE} could not say whether it already holds ${branch}: ${asked.stderr.trim()}`
      )
    }

    return asked.stdout.trim().length > 0
  }

  async #fetch(root: CheckoutRoot, branch: string): Promise<void> {
    const fetched = await this.run(GitEpicBranch.#fetchArgvFor(root.text, branch))
    if (fetched.failed) {
      throw new EpicBranchNotPublished(
        `git fetch of the ${branch} ${GitEpicBranch.REMOTE} already holds failed: ${fetched.stderr.trim()}`
      )
    }
  }

  async #switchTo(root: CheckoutRoot, branch: string): Promise<string> {
    const switched = await this.run(GitEpicBranch.#switchArgvFor(root.text, branch))
    if (switched.failed) {
      throw new EpicBranchNotPublished(`git switch to ${branch} failed: ${switched.stderr.trim()}`)
    }

    return branch
  }

  async #cut(root: CheckoutRoot, branch: string): Promise<string> {
    const created = await this.run(GitEpicBranch.#cutArgvFor(root.text, branch))
    if (created.failed) {
      throw new EpicBranchNotPublished(`git switch --create of ${branch} failed: ${created.stderr.trim()}`)
    }

    return branch
  }

  async defaultBranch(root: CheckoutRoot): Promise<string> {
    const declared = await this.run(GitWorkspace.defaultBranchArgvFor(root.text))
    if (!declared.failed) return GitEpicBranch.#branchIn(declared.stdout, GitWorkspace.declaredBranchIn)
    const asked = await this.run(GitWorkspace.remoteHeadArgvFor(root.text))
    if (asked.failed) {
      throw new EpicBranchNotPublished(
        `neither ${GitWorkspace.REMOTE_HEAD} in ${root.text} nor ${GitEpicBranch.REMOTE} itself says which branch ` +
        `is default: ${asked.stderr.trim()}. Run ${GitEpicBranch.DECLARE_DEFAULT} in that checkout and press again`
      )
    }

    return GitEpicBranch.#branchIn(asked.stdout, GitWorkspace.remoteHeadBranchIn)
  }

  static #branchIn(printed: string, reading: (printed: string) => string | null): string {
    const declared = reading(printed)
    if (declared === null) {
      throw new EpicBranchNotUnderstood(
        `no default branch can be read out of what git printed for ${GitEpicBranch.REMOTE}: ${JSON.stringify(printed)}`
      )
    }

    return declared
  }

  async #add(root: CheckoutRoot, paths: string[]): Promise<void> {
    const added = await this.run(GitEpicBranch.addArgvFor(root.text, paths))
    if (added.failed) {
      throw new EpicBranchNotPublished(`git add of ${paths.join(', ')} failed: ${added.stderr.trim()}`)
    }
  }

  async #commit(root: CheckoutRoot, message: string, paths: string[]): Promise<void> {
    const committed = await this.run(GitEpicBranch.commitArgvFor(root.text, message, paths))
    if (committed.failed) {
      throw new EpicBranchNotPublished(`git commit of ${paths.join(', ')} failed: ${committed.stderr.trim()}`)
    }
  }

  async #push(root: CheckoutRoot, branch: string): Promise<void> {
    const pushed = await this.run(GitEpicBranch.pushArgvFor(root.text, branch))
    if (pushed.failed) {
      throw new EpicBranchNotPublished(`git push of ${branch} failed: ${pushed.stderr.trim()}`)
    }
  }
}
