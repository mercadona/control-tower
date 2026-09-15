import { describe, it, expect } from 'vitest'
import { GitEpicBranch } from '../../src/infrastructure/git-epic-branch.ts'
import { EpicBranchNotPublished, EpicBranchNotUnderstood } from '../../src/domain/exceptions.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'

class GitEpicBranchDouble {
  static readonly ROOT = '/repo/checkout'
  static readonly CHECKOUT = new CheckoutRoot(GitEpicBranchDouble.ROOT)
  static readonly DEFAULT_BRANCH = 'main'
  static readonly EPIC_BRANCH = 'epic/the-loop'
  static readonly MILESTONE_BRANCH = 'milestone/2026-09-14-the-loop-execution'
  static readonly MESSAGE = 'freeze the execution spec'
  static readonly SHA = '9f2c1d7a6b5e4c3d2a1f0e9d8c7b6a5f4e3d2c1b'
  static readonly NO_LOCAL_HEAD = 'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref'
  static readonly PATHS = [
    'docs/superpowers/specs/2026-09-14-the-loop-execution.md',
    'docs/superpowers/specs/2026-09-14-the-loop-design.md',
  ]

  current: ProcessOutput
  symbolicRef: ProcessOutput
  remoteHead: ProcessOutput
  localBranch: ProcessOutput
  remoteBranch: ProcessOutput
  fetch: ProcessOutput
  switched: ProcessOutput
  add: ProcessOutput
  commit: ProcessOutput
  push: ProcessOutput
  calls: string[][]

  constructor({ current, symbolicRef, remoteHead, localBranch, remoteBranch, fetch, switched, add, commit, push }: {
    current?: ProcessOutput,
    symbolicRef?: ProcessOutput,
    remoteHead?: ProcessOutput,
    localBranch?: ProcessOutput,
    remoteBranch?: ProcessOutput,
    fetch?: ProcessOutput,
    switched?: ProcessOutput,
    add?: ProcessOutput,
    commit?: ProcessOutput,
    push?: ProcessOutput,
  } = {}) {
    this.current = current ?? GitEpicBranchDouble.printing(`${GitEpicBranchDouble.EPIC_BRANCH}\n`)
    this.symbolicRef = symbolicRef ??
      GitEpicBranchDouble.printing(`refs/remotes/origin/${GitEpicBranchDouble.DEFAULT_BRANCH}\n`)
    this.remoteHead = remoteHead ?? GitEpicBranchDouble.refused(GitEpicBranchDouble.NO_LOCAL_HEAD)
    this.localBranch = localBranch ?? GitEpicBranchDouble.refused('')
    this.remoteBranch = remoteBranch ?? GitEpicBranchDouble.printing('')
    this.fetch = fetch ?? GitEpicBranchDouble.ok()
    this.switched = switched ?? GitEpicBranchDouble.ok()
    this.add = add ?? GitEpicBranchDouble.ok()
    this.commit = commit ?? GitEpicBranchDouble.ok()
    this.push = push ?? GitEpicBranchDouble.ok()
    this.calls = []
  }

  static onTheDefaultBranch(): GitEpicBranchDouble {
    return new GitEpicBranchDouble({
      current: GitEpicBranchDouble.printing(`${GitEpicBranchDouble.DEFAULT_BRANCH}\n`),
    })
  }

  static holdingTheMilestoneBranchLocally(): GitEpicBranchDouble {
    const holding = GitEpicBranchDouble.onTheDefaultBranch()
    holding.localBranch = GitEpicBranchDouble.printing(`${GitEpicBranchDouble.SHA}\n`)

    return holding
  }

  static holdingTheMilestoneBranchOnTheRemoteOnly(): GitEpicBranchDouble {
    const holding = GitEpicBranchDouble.onTheDefaultBranch()
    holding.remoteBranch = GitEpicBranchDouble.printing(
      `${GitEpicBranchDouble.SHA}\trefs/heads/${GitEpicBranchDouble.MILESTONE_BRANCH}\n`
    )

    return holding
  }

  static withNoLocalOriginHead(): GitEpicBranchDouble {
    const asking = GitEpicBranchDouble.onTheDefaultBranch()
    asking.symbolicRef = GitEpicBranchDouble.refused(GitEpicBranchDouble.NO_LOCAL_HEAD)
    asking.remoteHead = GitEpicBranchDouble.printing(
      `ref: refs/heads/${GitEpicBranchDouble.DEFAULT_BRANCH}\tHEAD\n${GitEpicBranchDouble.SHA}\tHEAD\n`
    )

    return asking
  }

  branch(): GitEpicBranch {
    return new GitEpicBranch({
      run: (argv) => {
        this.calls.push(argv)
        return Promise.resolve(this.answering(argv))
      },
    })
  }

  answering(argv: string[]): ProcessOutput {
    if (argv.includes('rev-parse') && argv.includes('--abbrev-ref')) return this.current
    if (argv.includes('rev-parse') && argv.includes('--verify')) return this.localBranch
    if (argv.includes('symbolic-ref')) return this.symbolicRef
    if (argv.includes('ls-remote') && argv.includes('--symref')) return this.remoteHead
    if (argv.includes('ls-remote')) return this.remoteBranch
    if (argv.includes('fetch')) return this.fetch
    if (argv.includes('switch')) return this.switched
    if (argv.includes('add')) return this.add
    if (argv.includes('commit')) return this.commit
    if (argv.includes('push')) return this.push
    throw new Error(`nobody wrote an answer for git ${argv.join(' ')}`)
  }

  async published(paths: string[] = GitEpicBranchDouble.PATHS): Promise<string> {
    const epic = this.branch()
    const branch = await epic.publishing({
      root: GitEpicBranchDouble.CHECKOUT,
      milestone: GitEpicBranchDouble.MILESTONE_BRANCH,
    })
    await epic.commit({ root: GitEpicBranchDouble.CHECKOUT, paths, message: GitEpicBranchDouble.MESSAGE })
    await epic.push({ root: GitEpicBranchDouble.CHECKOUT, branch })

    return branch
  }

  cut(): boolean {
    return this.calls.some((argv) => argv.includes('switch') && argv.includes('--create'))
  }

  static printing(stdout: string): ProcessOutput {
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }

  static ok(): ProcessOutput {
    return GitEpicBranchDouble.printing('')
  }

  static refused(stderr: string): ProcessOutput {
    return new ProcessOutput({ code: 1, stdout: '', stderr })
  }
}

describe('GitEpicBranch', () => {
  it('a checkout on the branch the remote calls default cuts the milestone branch and publishes on that one', async () => {
    const git = GitEpicBranchDouble.onTheDefaultBranch()

    const answered = await git.published()

    expect(answered).toBe(GitEpicBranchDouble.MILESTONE_BRANCH)
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'switch', '--create', GitEpicBranchDouble.MILESTONE_BRANCH,
    ])
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'push', '--set-upstream', GitEpicBranch.REMOTE,
      GitEpicBranchDouble.MILESTONE_BRANCH,
    ])
    expect(git.calls.some((argv) => argv.includes(GitEpicBranchDouble.DEFAULT_BRANCH))).toBe(false)
  })

  it('a milestone branch this checkout already holds is switched to, never cut a second time', async () => {
    const git = GitEpicBranchDouble.holdingTheMilestoneBranchLocally()

    const answered = await git.published()

    expect(answered).toBe(GitEpicBranchDouble.MILESTONE_BRANCH)
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'rev-parse', '--verify', '--quiet',
      `refs/heads/${GitEpicBranchDouble.MILESTONE_BRANCH}`,
    ])
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'switch', GitEpicBranchDouble.MILESTONE_BRANCH,
    ])
    expect(git.cut()).toBe(false)
  })

  it('a milestone branch only the remote holds is fetched under its own name, never cut a second time', async () => {
    const git = GitEpicBranchDouble.holdingTheMilestoneBranchOnTheRemoteOnly()

    const answered = await git.published()

    expect(answered).toBe(GitEpicBranchDouble.MILESTONE_BRANCH)
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'ls-remote', '--heads', GitEpicBranch.REMOTE,
      GitEpicBranchDouble.MILESTONE_BRANCH,
    ])
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'fetch', GitEpicBranch.REMOTE,
      `${GitEpicBranchDouble.MILESTONE_BRANCH}:${GitEpicBranchDouble.MILESTONE_BRANCH}`,
    ])
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'switch', GitEpicBranchDouble.MILESTONE_BRANCH,
    ])
    expect(git.cut()).toBe(false)
  })

  it('a checkout whose clone never wrote origin/HEAD asks the remote itself which branch is default', async () => {
    const git = GitEpicBranchDouble.withNoLocalOriginHead()

    const answered = await git.published()

    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'ls-remote', '--symref', GitEpicBranch.REMOTE, 'HEAD',
    ])
    expect(answered).toBe(GitEpicBranchDouble.MILESTONE_BRANCH)
  })

  it('a default branch neither the checkout nor the remote names refuses, saying which command declares it', async () => {
    const git = GitEpicBranchDouble.onTheDefaultBranch()
    git.symbolicRef = GitEpicBranchDouble.refused(GitEpicBranchDouble.NO_LOCAL_HEAD)
    git.remoteHead = GitEpicBranchDouble.refused('fatal: could not read from remote repository')

    const refusal = await git.published().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(EpicBranchNotPublished)
    expect((refusal as Error).message).toContain(GitEpicBranch.DECLARE_DEFAULT)
    expect(git.calls.some((argv) => argv.includes('switch'))).toBe(false)
    expect(git.calls.some((argv) => argv.includes('add'))).toBe(false)
    expect(git.calls.some((argv) => argv.includes('commit'))).toBe(false)
    expect(git.calls.some((argv) => argv.includes('push'))).toBe(false)
  })

  it('commits the two documents and pushes the checkout\'s branch, and answers it', async () => {
    const git = new GitEpicBranchDouble()

    const answered = await git.published()

    expect(answered).toBe(GitEpicBranchDouble.EPIC_BRANCH)
    expect(git.calls).toContainEqual(['-C', GitEpicBranchDouble.ROOT, 'add', '--', ...GitEpicBranchDouble.PATHS])
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'commit', '-m', GitEpicBranchDouble.MESSAGE, '--', ...GitEpicBranchDouble.PATHS,
    ])
    expect(git.calls).toContainEqual([
      '-C', GitEpicBranchDouble.ROOT, 'push', '--set-upstream', GitEpicBranch.REMOTE, GitEpicBranchDouble.EPIC_BRANCH,
    ])
    expect(git.cut()).toBe(false)
  })

  it('current answers the branch the checkout is on', async () => {
    const git = new GitEpicBranchDouble({ current: GitEpicBranchDouble.printing('feat/42\n') })

    const branch = await git.branch().current(GitEpicBranchDouble.CHECKOUT)

    expect(branch).toBe('feat/42')
  })

  it('a push git refused is told apart from an unreadable symbolic-ref', async () => {
    const pushRefused = await new GitEpicBranchDouble({
      push: GitEpicBranchDouble.refused('fatal: unable to access remote'),
    }).published().catch((cause) => cause)
    const unreadableSymbolicRef = await new GitEpicBranchDouble({
      symbolicRef: GitEpicBranchDouble.printing('refs/heads/main\n'),
    }).published().catch((cause) => cause)

    expect(pushRefused).toBeInstanceOf(EpicBranchNotPublished)
    expect(unreadableSymbolicRef).toBeInstanceOf(EpicBranchNotUnderstood)
    expect(pushRefused).not.toBeInstanceOf(EpicBranchNotUnderstood)
    expect(unreadableSymbolicRef).not.toBeInstanceOf(EpicBranchNotPublished)
  })

  it('a remote that refused to name its default is told apart from one whose answer cannot be read', async () => {
    const unreachable = GitEpicBranchDouble.withNoLocalOriginHead()
    unreachable.remoteHead = GitEpicBranchDouble.refused('fatal: could not read from remote repository')
    const unreadable = GitEpicBranchDouble.withNoLocalOriginHead()
    unreadable.remoteHead = GitEpicBranchDouble.printing(`${GitEpicBranchDouble.SHA}\tHEAD\n`)

    const remoteRefused = await unreachable.published().catch((cause) => cause)
    const remoteUnreadable = await unreadable.published().catch((cause) => cause)

    expect(remoteRefused).toBeInstanceOf(EpicBranchNotPublished)
    expect(remoteUnreadable).toBeInstanceOf(EpicBranchNotUnderstood)
    expect(remoteRefused).not.toBeInstanceOf(EpicBranchNotUnderstood)
    expect(remoteUnreadable).not.toBeInstanceOf(EpicBranchNotPublished)
  })
})
