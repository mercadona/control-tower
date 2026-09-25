import { RetryBudget, RetryPolicy } from '../../../src/domain/policies/retry-policy.ts'
import { Gh } from '../../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../../src/infrastructure/tool-runner.ts'
import { UnscriptedRequest } from './scripted-conversation.ts'

export type CreateHold = 'before' | 'after'

type HeldCreate = {
  readonly order: CreateHold,
  readonly wait: Promise<void>,
}

export class ScriptedGitHub {
  static readonly PULL_NUMBER = 41
  static readonly HEAD = 'feat/7'
  static readonly BASE = 'main'
  static readonly REPOSITORY = 'acme/widget'
  static readonly URL = `https://github.com/${ScriptedGitHub.REPOSITORY}/pull/${ScriptedGitHub.PULL_NUMBER}`

  readonly gh: Gh
  readonly pulls: Record<string, unknown>[] = []
  readonly queries: string[][] = []
  readonly issueReads: string[][] = []
  labels: string[] = ['status:in-progress']

  readonly #sha: string
  #hold: HeldCreate | null = null

  constructor({ sha }: { sha: string }) {
    this.#sha = sha
    this.gh = new Gh({
      launch: (argv) => this.#run(argv),
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
      sleep: async () => {},
    })
  }

  holdNextCreate(order: CreateHold): () => void {
    let release!: () => void
    const wait = new Promise<void>((resolve) => { release = resolve })
    this.#hold = { order, wait }
    return release
  }

  async #run(argv: string[]): Promise<ProcessOutput> {
    if (argv[0] === 'api' && argv[1] === 'graphql') return this.#pullRequests(argv)
    if (argv[0] === 'pr' && argv[1] === 'create') return this.#create(argv)
    if (argv[0] === 'issue' && argv[1] === 'view') return this.#issue(argv)
    throw new UnscriptedRequest({ binary: 'gh', argv })
  }

  #pullRequests(argv: string[]): ProcessOutput {
    this.queries.push([...argv])
    return ScriptedGitHub.#output(JSON.stringify([{
      data: {
        repository: {
          pullRequests: {
            nodes: this.pulls.map(({ baseRepository: _baseRepository, ...pull }) => ({
              ...pull, repository: { nameWithOwner: ScriptedGitHub.REPOSITORY },
            })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    }]))
  }

  async #create(argv: string[]): Promise<ProcessOutput> {
    const hold = this.#hold
    this.#hold = null
    const publish = (): void => this.#publish(argv)
    if (hold === null) {
      publish()
    } else if (hold.order === 'before') {
      publish()
      await hold.wait
    } else {
      await hold.wait
      publish()
    }
    return ScriptedGitHub.#output(`${ScriptedGitHub.URL}\n`)
  }

  #publish(argv: string[]): void {
    const body = argv[argv.indexOf('--body') + 1]
    this.pulls.push({
      number: ScriptedGitHub.PULL_NUMBER, url: ScriptedGitHub.URL, body, state: 'OPEN', isDraft: false,
      headRefName: ScriptedGitHub.HEAD, headRefOid: this.#sha,
      headRepository: { nameWithOwner: ScriptedGitHub.REPOSITORY },
      baseRefName: ScriptedGitHub.BASE, baseRepository: { nameWithOwner: ScriptedGitHub.REPOSITORY },
    })
  }

  #issue(argv: string[]): ProcessOutput {
    this.issueReads.push([...argv])
    return ScriptedGitHub.#output(JSON.stringify({ state: 'OPEN', labels: this.labels.map((name) => ({ name })) }))
  }

  static #output(stdout: string): ProcessOutput {
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }
}
