import { describe, it, expect } from 'vitest'
import { SpecBranchReturns } from '../../src/infrastructure/spec-branch-returns.ts'
import {
  ReturnFromMergedSpecBranchParams, SpecBranchReturned,
} from '../../src/application/actions/return-from-merged-spec-branch.ts'
import { EpicBranchNotPublished } from '../../src/domain/exceptions.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { RemoteBranchFate } from '../../src/domain/value-objects/remote-branch-fate.ts'

type Answer = SpecBranchReturned | null | Error

class Mother {
  static readonly ROOT = new CheckoutRoot('/repo/checkout')
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly BRANCH = 'milestone/STAFF-129-execution'

  static returned(remote: (typeof RemoteBranchFate)[keyof typeof RemoteBranchFate] = RemoteBranchFate.REMOVED) {
    return new SpecBranchReturned({ branch: Mother.BRANCH, into: 'main', remote })
  }

  static refused(): EpicBranchNotPublished {
    return new EpicBranchNotPublished('git switch to main failed: error: Your local changes would be overwritten')
  }
}

class Settling {
  readonly answers: Answer[]
  readonly asked: ReturnFromMergedSpecBranchParams[]
  readonly written: string[]
  readonly returns: SpecBranchReturns

  constructor(...answers: Answer[]) {
    this.answers = answers
    this.asked = []
    this.written = []
    this.returns = new SpecBranchReturns({
      returning: {
        execute: async (params: ReturnFromMergedSpecBranchParams) => {
          this.asked.push(params)
          const answer = this.answers.shift()
          if (answer === undefined) throw new Error('nobody wrote an answer for this sweep')
          if (answer instanceof Error) throw answer
          return answer
        },
      },
      stderr: (line) => this.written.push(line),
    })
  }

  async sweeps(times = 1): Promise<Settling> {
    for (let sweep = 0; sweep < times; sweep += 1) await this.returns.settle(Mother.ROOT, Mother.REPOSITORY)

    return this
  }
}

describe('SpecBranchReturns', () => {
  it('asks to return the checkout it sweeps, for its repository', async () => {
    const settling = await new Settling(null).sweeps()

    expect(settling.asked).toEqual([new ReturnFromMergedSpecBranchParams({ root: Mother.ROOT, repository: Mother.REPOSITORY })])
    expect(settling.written).toEqual([])
  })

  it('a checkout that went back writes one line naming the branch and what happened to it on the remote', async () => {
    const settling = await new Settling(Mother.returned()).sweeps()

    expect(settling.written).toEqual([
      `spec branch: ${Mother.ROOT.text} is back on main; ${Mother.BRANCH} merged and was deleted here and on the remote\n`,
    ])
  })

  it('a remote branch the repository already deleted and one that moved on are told apart', async () => {
    const settling = await new Settling(Mother.returned(RemoteBranchFate.ABSENT), Mother.returned(RemoteBranchFate.KEPT)).sweeps(2)

    expect(settling.written).toEqual([
      `spec branch: ${Mother.ROOT.text} is back on main; ${Mother.BRANCH} merged and was deleted here, and the remote had already deleted it\n`,
      `spec branch: ${Mother.ROOT.text} is back on main; ${Mother.BRANCH} merged and was deleted here, but the remote one moved past the merge and was kept\n`,
    ])
  })

  it('a refusal is written once while it stays the same, and the sweep keeps going', async () => {
    const settling = await new Settling(Mother.refused(), Mother.refused(), Mother.refused()).sweeps(3)

    expect(settling.written).toEqual([
      `spec branch: ${Mother.ROOT.text} could not go back to the default branch: ${Mother.refused().message}\n`,
    ])
  })

  it('a refusal that comes back after the checkout settled is written again', async () => {
    const settling = await new Settling(Mother.refused(), null, Mother.refused()).sweeps(3)

    expect(settling.written).toHaveLength(2)
  })

  it('a failure that is not a plan failure escapes, because it is a fault and not a checkout', async () => {
    const settling = new Settling(new TypeError('a defect'))

    await expect(settling.sweeps()).rejects.toThrow(TypeError)
  })
})
