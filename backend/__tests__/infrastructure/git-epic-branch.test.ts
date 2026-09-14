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
  static readonly MESSAGE = 'freeze the execution spec'
  static readonly PATHS = [
    'docs/superpowers/specs/2026-09-14-the-loop-execution.md',
    'docs/superpowers/specs/2026-09-14-the-loop-design.md',
  ]

  current: ProcessOutput
  symbolicRef: ProcessOutput
  add: ProcessOutput
  commit: ProcessOutput
  push: ProcessOutput
  calls: string[][]

  constructor({ current, symbolicRef, add, commit, push }: {
    current?: ProcessOutput,
    symbolicRef?: ProcessOutput,
    add?: ProcessOutput,
    commit?: ProcessOutput,
    push?: ProcessOutput,
  } = {}) {
    this.current = current ?? GitEpicBranchDouble.printing(`${GitEpicBranchDouble.EPIC_BRANCH}\n`)
    this.symbolicRef = symbolicRef ??
      GitEpicBranchDouble.printing(`refs/remotes/origin/${GitEpicBranchDouble.DEFAULT_BRANCH}\n`)
    this.add = add ?? GitEpicBranchDouble.ok()
    this.commit = commit ?? GitEpicBranchDouble.ok()
    this.push = push ?? GitEpicBranchDouble.ok()
    this.calls = []
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
    if (argv.includes('symbolic-ref')) return this.symbolicRef
    if (argv.includes('add')) return this.add
    if (argv.includes('commit')) return this.commit
    if (argv.includes('push')) return this.push
    throw new Error(`nobody wrote an answer for git ${argv.join(' ')}`)
  }

  async published(paths: string[] = GitEpicBranchDouble.PATHS): Promise<string> {
    const epic = this.branch()
    const branch = await epic.publishable(GitEpicBranchDouble.CHECKOUT)
    await epic.commit({ root: GitEpicBranchDouble.CHECKOUT, paths, message: GitEpicBranchDouble.MESSAGE })
    await epic.push({ root: GitEpicBranchDouble.CHECKOUT, branch })

    return branch
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
  it('refuses before writing anything when the checkout sits on the branch the remote calls default', async () => {
    const git = new GitEpicBranchDouble({
      current: GitEpicBranchDouble.printing('main\n'),
      symbolicRef: GitEpicBranchDouble.printing('refs/remotes/origin/main\n'),
    })

    const refusal = await git.published().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(EpicBranchNotPublished)
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
})
