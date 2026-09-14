import { EpicBranch } from '../domain/ports/epic-branch.ts'
import { EpicBranchNotPublished, EpicBranchNotUnderstood } from '../domain/exceptions.ts'
import { GitWorkspace } from './git-workspace.ts'
import type { CheckoutRoot } from '../domain/value-objects/checkout-root.ts'
import type { ToolLaunch } from './external-tool.ts'

export class GitEpicBranch extends EpicBranch {
  static readonly REMOTE = 'origin'

  readonly run: ToolLaunch

  constructor({ run }: { run: ToolLaunch }) {
    super()
    this.run = run
  }

  static currentArgvFor(root: string): string[] {
    return ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']
  }

  static addArgvFor(root: string, paths: string[]): string[] {
    return ['-C', root, 'add', '--', ...paths]
  }

  static commitArgvFor(root: string, message: string, paths: string[]): string[] {
    return ['-C', root, 'commit', '-m', message, '--', ...paths]
  }

  static pushArgvFor(root: string, branch: string): string[] {
    return ['-C', root, 'push', '--set-upstream', GitEpicBranch.REMOTE, branch]
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

  async publish({ root, paths, message }: { root: CheckoutRoot, paths: string[], message: string }): Promise<string> {
    const branch = await this.current(root)
    const declaredDefault = await this.#defaultBranchOf(root)
    if (branch === declaredDefault) {
      throw new EpicBranchNotPublished(
        `${root.text} sits on ${branch}, the branch the remote calls default, so the epic's documents are not published on it`
      )
    }
    await this.#add(root, paths)
    await this.#commit(root, message, paths)
    await this.#push(root, branch)

    return branch
  }

  async #defaultBranchOf(root: CheckoutRoot): Promise<string> {
    const asked = await this.run(GitWorkspace.defaultBranchArgvFor(root.text))
    if (asked.failed) {
      throw new EpicBranchNotPublished(
        `the remote of ${root.text} does not declare a default branch: ${asked.stderr.trim()}`
      )
    }
    const declared = GitWorkspace.declaredBranchIn(asked.stdout)
    if (declared === null) {
      throw new EpicBranchNotUnderstood(
        `the remote does not declare a default branch under ${GitWorkspace.REMOTE_HEAD}, git printed ${JSON.stringify(asked.stdout)}`
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
