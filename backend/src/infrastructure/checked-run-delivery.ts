import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { parseStateSafe } from '../../../plugin/scripts/state.js'
import { RunDelivery } from '../domain/ports/run-delivery.ts'
import type { PlanWatch } from '../domain/value-objects/plan-watch.ts'
import {
  RunDeliveryFailure, RunDeliveryUncertain, type DeliveredPullRequest, type RunDeliveryInspection,
} from '../domain/value-objects/run-delivery.ts'
import type { ProcessOutput, RunOptions } from './tool-runner.ts'
import type { Gh } from './gh.ts'
import type { CtRunMachine } from './ct-run-machine.ts'
import type { RunJournal } from './run-journal.ts'
import { SliceSeed } from './git-workspace.ts'

type Launch = (argv: string[], options?: RunOptions) => Promise<ProcessOutput>

type DeliveryIntent = {
  readonly version: 1,
  readonly conversation: string,
  readonly repository: string,
  readonly issue: number,
  readonly root: string,
  readonly worktree: string,
  readonly branch: string,
  readonly base: string,
  readonly sha: string,
  readonly machineDigest: string,
  readonly title: string,
  readonly body: string,
}

type PullCandidate = DeliveredPullRequest & {
  readonly body: string,
  readonly state: string,
  readonly isDraft: boolean,
  readonly headRefName: string,
  readonly headRefOid: string,
  readonly headRepository: { readonly nameWithOwner: string },
  readonly baseRefName: string,
  readonly baseRepository: { readonly nameWithOwner: string },
}

type RecordedRequest = {
  readonly version: 1,
  readonly attempt: number,
  readonly requestedAt: string,
  readonly sha: string,
  readonly argv: readonly string[],
  readonly cwd: string,
}

type RecordedResult = {
  readonly version: 1,
  readonly attempt: number,
  readonly at: string,
  readonly requestDigest: string,
  readonly command: string,
  readonly argv: readonly string[],
  readonly cwd: string,
  readonly code: number,
  readonly stdout: string,
  readonly stderr: string,
}

type RecordedOwner = {
  readonly version: 2,
  readonly attempt: number,
  readonly pid: number,
  readonly processGroup: number,
  readonly startedAt: string,
}

export class CheckedRunDelivery extends RunDelivery {
  static readonly #INTENT = Object.freeze(['intent.json'])
  static readonly #RECEIPT = Object.freeze(['receipt.json'])
  static readonly #SHA = /^[0-9a-f]{40}$/
  static readonly #DIGEST = /^[0-9a-f]{64}$/
  static readonly #CONVENTIONAL = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:\s+\S/
  static readonly #REMOTE = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/
  static readonly #PULL_QUERY = `query($owner:String!,$name:String!,$headRefName:String!,$endCursor:String){repository(owner:$owner,name:$name){pullRequests(first:100,after:$endCursor,headRefName:$headRefName){nodes{number url body state isDraft headRefName headRefOid headRepository{nameWithOwner} baseRefName repository{nameWithOwner}}pageInfo{hasNextPage endCursor}}}}`

  readonly journal: RunJournal
  readonly machine: CtRunMachine
  readonly git: Launch
  readonly node: Launch
  readonly gh: Gh
  readonly read: (path: string) => Promise<string | null>
  readonly dispatchCheck: string
  readonly newId: () => string
  readonly now: () => string
  readonly alive: (pid: number) => boolean
  readonly delivering = new Map<string, Promise<void>>()
  readonly proven = new Map<string, { readonly receipt: string, readonly pullRequest: DeliveredPullRequest }>()

  constructor(ports: {
    journal: RunJournal,
    machine: CtRunMachine,
    git: Launch,
    node: Launch,
    gh: Gh,
    read: (path: string) => Promise<string | null>,
    dispatchCheck: string,
    newId: () => string,
    now: () => string,
    alive?: (pid: number) => boolean,
  }) {
    super()
    this.journal = ports.journal
    this.machine = ports.machine
    this.git = ports.git
    this.node = ports.node
    this.gh = ports.gh
    this.read = ports.read
    this.dispatchCheck = ports.dispatchCheck
    this.newId = ports.newId
    this.now = ports.now
    this.alive = ports.alive ?? CheckedRunDelivery.#alive
  }

  override async deliver(watch: PlanWatch): Promise<void> {
    const existing = this.delivering.get(watch.agent)
    if (existing !== undefined) return existing
    const delivery = this.#deliver(watch)
    this.delivering.set(watch.agent, delivery)
    try {
      await delivery
    } finally {
      if (this.delivering.get(watch.agent) === delivery) this.delivering.delete(watch.agent)
    }
  }

  async #deliver(watch: PlanWatch): Promise<void> {
    const local = await this.machine.inspect(watch)
    if (local.fact.kind !== 'delivered') {
      throw new RunDeliveryFailure(`local implementation is ${local.fact.kind}, not delivered`)
    }
    const intent = await this.#intent(watch)
    await this.#requireIntentIdentity(watch, intent)
    await this.#requireWorkspaceIdentity(watch)
    const receipt = await this.journal.publicationRead(watch, CheckedRunDelivery.#RECEIPT)
    if (receipt !== null) {
      await this.#validateReceipt(watch, intent, receipt)
      await this.#requireFinalFacts(watch, intent)
      return
    }
    await this.#requirePinned(intent)
    const push = await this.#push(watch, intent)
    const pull = await this.#pullRequest(watch, intent)
    const release = await this.#release(watch, intent, pull.pullRequest)
    await this.#requireFinalFacts(watch, intent)
    await this.journal.publicationWrite(watch, CheckedRunDelivery.#RECEIPT, this.#json({
      version: 1, at: this.now(), sha: intent.sha, pullRequest: pull.pullRequest,
      pushAttempt: push.attempt, pushResultDigest: push.resultDigest,
      pullRequestAttempt: pull.attempt, pullRequestResultDigest: pull.resultDigest,
      releaseAttempt: release.attempt, releaseResultDigest: release.resultDigest,
    }))
  }

  override async inspect(watch: PlanWatch): Promise<RunDeliveryInspection> {
    try {
      const raw = await this.journal.publicationRead(watch, CheckedRunDelivery.#INTENT)
      if (raw === null) return { kind: 'absent' }
      const intent = this.#parseIntent(raw, watch)
      await this.#requireIntentIdentity(watch, intent)
      const receipt = await this.journal.publicationRead(watch, CheckedRunDelivery.#RECEIPT)
      if (receipt !== null) return { kind: 'delivered', pullRequest: await this.#provenPull(watch, intent, receipt) }
      const remoteSha = await this.#remoteSha(intent)
      const pendingPush = await this.#pendingAttempt(watch, 'push', intent, remoteSha === intent.sha)
      if (pendingPush !== null && (pendingPush.result !== null || remoteSha !== intent.sha)) {
        const ownership = await this.#ownership(watch, 'push', pendingPush.name, pendingPush.request)
        if (ownership.running) return CheckedRunDelivery.#running('push', ownership.owner)
      }
      const pendingRelease = await this.#pendingAttempt(watch, 'release', intent)
      if (pendingRelease !== null) {
        const ownership = await this.#ownership(watch, 'release', pendingRelease.name, pendingRelease.request)
        if (ownership.running) return CheckedRunDelivery.#running('release', ownership.owner)
      }
      const pullRequest = await this.#compatiblePull(intent, false)
      if (pullRequest === null
        && await this.journal.publicationRead(watch, ['pull-request', 'request.json']) !== null
        && await this.journal.publicationRead(watch, ['pull-request', 'result.json']) === null) {
        return this.delivering.has(watch.agent)
          ? { kind: 'publishing', pullRequest: null, diagnostic: 'pull request creation is in flight' }
          : { kind: 'uncertain', pullRequest: null, diagnostic: 'pull request creation has an unknown effect' }
      }
      const diagnostic = await this.#latestDiagnostic(watch)
      return { kind: 'publishing', pullRequest, diagnostic }
    } catch (cause) {
      return {
        kind: 'uncertain', pullRequest: null,
        diagnostic: cause instanceof Error ? cause.message : String(cause),
      }
    }
  }

  async #provenPull(watch: PlanWatch, intent: DeliveryIntent, receipt: string): Promise<DeliveredPullRequest> {
    const digest = this.#digest(receipt)
    const remembered = this.proven.get(watch.agent)
    if (remembered !== undefined && remembered.receipt === digest) return remembered.pullRequest
    const recorded = await this.#validateReceipt(watch, intent, receipt)
    const current = await this.#historicalPull(intent)
    if (current.number !== recorded.number || current.url !== recorded.url) {
      throw new RunDeliveryUncertain('the live pull request does not match the delivery receipt')
    }
    this.proven.set(watch.agent, { receipt: digest, pullRequest: current })
    return current
  }

  async #intent(watch: PlanWatch): Promise<DeliveryIntent> {
    const existing = await this.journal.publicationRead(watch, CheckedRunDelivery.#INTENT)
    if (existing !== null) return this.#parseIntent(existing, watch)
    if (watch.located.root === undefined) throw new RunDeliveryUncertain('the plan watch has no checkout root')
    const seedPath = join(watch.located.path, SliceSeed.RELATIVE_PATH)
    const text = await this.read(seedPath)
    if (text === null) throw new RunDeliveryUncertain(`${seedPath} is absent`)
    const parsed = parseStateSafe(text)
    if (parsed.error !== null) throw new RunDeliveryUncertain(`${seedPath} cannot be parsed: ${parsed.error}`)
    const meta = parsed.meta as Record<string, unknown>
    if (meta.github_issue !== watch.issue.number || meta.branch !== watch.located.branch
      || typeof meta.base !== 'string' || meta.base.length === 0 || typeof meta.task !== 'string' || meta.task.length === 0) {
      throw new RunDeliveryUncertain(`${seedPath} does not identify the recorded issue, branch, base and title`)
    }
    await this.#requireWorkspaceIdentity(watch)
    const sha = await this.#gitText(['-C', watch.located.path, 'rev-parse', 'HEAD'], 'worktree HEAD')
    if (!CheckedRunDelivery.#SHA.test(sha)) throw new RunDeliveryUncertain(`worktree HEAD is not a full commit: ${JSON.stringify(sha)}`)
    const title = CheckedRunDelivery.#CONVENTIONAL.test(meta.task) ? meta.task : `feat: ${meta.task}`
    const body = `Closes #${watch.issue.number}\n\n<!-- control-tower-delivery:${watch.repository.text}#${watch.issue.number}:${watch.agent} -->`
    const manifest = await this.journal.manifest(watch)
    const entries = await this.journal.entries(watch)
    const intent: DeliveryIntent = Object.freeze({
      version: 1, conversation: watch.agent, repository: watch.repository.text, issue: watch.issue.number,
      root: await realpath(watch.located.root), worktree: await realpath(watch.located.path),
      branch: watch.located.branch, base: meta.base, sha,
      machineDigest: createHash('sha256').update(JSON.stringify({ manifest, entries })).digest('hex'),
      title, body,
    })
    await this.journal.publicationWrite(watch, CheckedRunDelivery.#INTENT, this.#json(intent))
    return intent
  }

  async #push(watch: PlanWatch, intent: DeliveryIntent): Promise<{ attempt: number, resultDigest: string }> {
    const remote = await this.#remoteSha(intent)
    if (remote !== null && remote !== intent.sha && !(await this.#isAncestor(intent, remote, intent.sha))) {
      throw new RunDeliveryUncertain(`remote branch ${intent.branch} is not an ancestor of the pinned revision`)
    }
    const successful = await this.#successfulPush(watch, intent)
    if (successful !== null && remote === intent.sha) return successful
    const pending = await this.#pendingAttempt(watch, 'push', intent, remote === intent.sha)
    if (pending !== null) {
      if (remote === intent.sha && pending.result === null) {
        return this.#reconcilePush(watch, intent, pending)
      }
      await this.#requireTerminated(watch, 'push', pending.name, pending.request)
    }
    const argv = ['-C', intent.worktree, 'push', 'origin', `${intent.sha}:refs/heads/${intent.branch}`]
    const attempt = await this.#nextAttempt(watch, 'push')
    const name = this.newId()
    const request = this.#json({ version: 1, attempt, requestedAt: this.now(), sha: intent.sha,
      branch: intent.branch, argv, cwd: intent.worktree })
    await this.journal.publicationWrite(watch, ['push', name, 'request.json'], request)
    const output = await this.git(argv, {
      cwd: intent.worktree,
      ownedProcessGroup: true,
      onSpawn: ({ pid, processGroup }) => this.#recordOwner(watch, 'push', name, attempt, pid, processGroup),
    })
    const result = this.#result(attempt, request, argv, intent.worktree, output)
    await this.journal.publicationWrite(watch, ['push', name, 'result.json'], result)
    if (output.failed) throw new RunDeliveryFailure(`git push failed: ${output.stderr.trim()}`)
    await this.#requirePinned(intent)
    if (await this.#remoteSha(intent) !== intent.sha) throw new RunDeliveryUncertain('remote branch does not hold the pinned revision after push')
    return { attempt, resultDigest: this.#digest(result) }
  }

  async #pullRequest(watch: PlanWatch, intent: DeliveryIntent): Promise<{
    pullRequest: DeliveredPullRequest, attempt: number, resultDigest: string,
  }> {
    await this.#requirePinned(intent)
    const compatible = await this.#compatiblePull(intent, true)
    const previous = await this.#pullRequestEvidence(watch, intent, compatible)
    if (previous !== null) return previous
    const requestPath = ['pull-request', 'request.json']
    const resultPath = ['pull-request', 'result.json']
    if (await this.journal.publicationRead(watch, requestPath) !== null) {
      throw new RunDeliveryUncertain('pull request creation was requested but its effect cannot be proven')
    }
    const argv = ['pr', 'create', '--repo', intent.repository, '--head', intent.branch, '--base', intent.base,
      '--title', intent.title, '--body', intent.body]
    const request = this.#json({ version: 1, attempt: 1, requestedAt: this.now(), head: intent.branch,
      base: intent.base, sha: intent.sha, title: intent.title, body: intent.body, argv, cwd: intent.worktree })
    await this.journal.publicationWrite(watch, requestPath, request)
    const output = await this.gh.run(argv, { safeToRepeat: false })
    const result = this.#result(1, request, argv, intent.worktree, output)
    await this.journal.publicationWrite(watch, resultPath, result)
    await this.#requirePinned(intent)
    const readback = await this.#compatiblePull(intent, true)
    if (readback !== null) return { pullRequest: readback, attempt: 1, resultDigest: this.#digest(result) }
    throw new RunDeliveryUncertain(output.failed
      ? `pull request creation failed without a compatible readback: ${output.stderr.trim()}`
      : 'pull request creation returned without a compatible readback')
  }

  async #release(watch: PlanWatch, intent: DeliveryIntent, pullRequest: DeliveredPullRequest): Promise<{
    attempt: number, resultDigest: string,
  }> {
    await this.#requirePinned(intent)
    const successful = await this.#successfulRelease(watch, intent, pullRequest)
    if (successful !== null) return successful
    const pending = await this.#pendingAttempt(watch, 'release', intent)
    if (pending !== null) await this.#requireTerminated(watch, 'release', pending.name, pending.request)
    const attempt = await this.#nextAttempt(watch, 'release')
    const name = this.newId()
    const argv = [this.dispatchCheck, String(intent.issue), '--repo', intent.repository, '--release', '--no-watch-merge']
    const request = this.#json({ version: 1, attempt, requestedAt: this.now(), sha: intent.sha,
      pullRequest, argv, cwd: intent.worktree })
    await this.journal.publicationWrite(watch, ['release', name, 'request.json'], request)
    const output = await this.node(argv, {
      cwd: intent.worktree,
      ownedProcessGroup: true,
      onSpawn: ({ pid, processGroup }) => this.#recordOwner(watch, 'release', name, attempt, pid, processGroup),
    })
    const result = this.#result(attempt, request, argv, intent.worktree, output)
    await this.journal.publicationWrite(watch, ['release', name, 'result.json'], result)
    await this.#requirePinned(intent)
    if (output.failed || !output.stdout.split(/\r?\n/).includes(`released #${intent.issue} → in-review`)) {
      throw new RunDeliveryFailure(`checked release failed: ${output.stderr.trim() || output.stdout.trim()}`)
    }
    return { attempt, resultDigest: this.#digest(result) }
  }

  async #requireFinalFacts(watch: PlanWatch, intent: DeliveryIntent): Promise<void> {
    await this.#requirePinned(intent)
    if (await this.#remoteSha(intent) !== intent.sha) throw new RunDeliveryUncertain('remote revision no longer matches delivered intent')
    if (await this.#compatiblePull(intent, false) === null) throw new RunDeliveryUncertain('no compatible open pull request proves delivery')
    const labels = await this.#issueLabels(intent)
    const statuses = labels.filter((label) => label.startsWith('status:'))
    if (statuses.length !== 1 || statuses[0] !== 'status:in-review') {
      throw new RunDeliveryUncertain(`issue status is ${statuses.join(', ') || 'absent'}, not exactly status:in-review`)
    }
    const local = await this.machine.inspect(watch)
    if (local.fact.kind !== 'delivered') throw new RunDeliveryUncertain('local completion evidence no longer reads as delivered')
  }

  async #requirePinned(intent: DeliveryIntent): Promise<void> {
    const branch = await this.#gitText(['-C', intent.worktree, 'symbolic-ref', '--quiet', '--short', 'HEAD'], 'symbolic HEAD')
    const sha = await this.#gitText(['-C', intent.worktree, 'rev-parse', 'HEAD'], 'worktree HEAD')
    if (branch !== intent.branch || sha !== intent.sha) throw new RunDeliveryUncertain('worktree branch or HEAD changed after delivery intent was sealed')
    const status = await this.git(['-C', intent.worktree, 'status', '--porcelain', '--untracked-files=all'])
    if (status.failed) throw new RunDeliveryFailure(`worktree status could not be read: ${status.stderr.trim()}`)
    if (status.stdout.length !== 0) throw new RunDeliveryUncertain(`worktree ${intent.worktree} is not clean`)
  }

  async #requireWorkspaceIdentity(watch: PlanWatch): Promise<void> {
    if (watch.located.root === undefined) throw new RunDeliveryUncertain('the plan watch has no checkout root')
    const root = await realpath(watch.located.root)
    const worktree = await realpath(watch.located.path)
    if (root !== watch.located.root || worktree !== watch.located.path) throw new RunDeliveryUncertain('recorded checkout paths are not canonical')
    const listed = await this.#gitText(['-C', root, 'worktree', 'list', '--porcelain'], 'worktree registration')
    const blocks = listed.split('\n\n').map((block) => block.trim())
    const matching = blocks.filter((block) => block.split('\n')[0] === `worktree ${worktree}`)
    if (matching.length !== 1 || !matching[0].split('\n').includes(`branch refs/heads/${watch.located.branch}`)) {
      throw new RunDeliveryUncertain('recorded worktree and branch are not uniquely registered')
    }
    const fetchUrls = await this.#gitLines(['-C', root, 'remote', 'get-url', '--all', 'origin'], 'origin fetch URL')
    const pushUrls = await this.#gitLines(['-C', root, 'remote', 'get-url', '--push', '--all', 'origin'], 'origin push URL')
    if (fetchUrls.length !== 1 || pushUrls.length !== 1
      || this.#repositoryIn(fetchUrls[0]) !== watch.repository.text || this.#repositoryIn(pushUrls[0]) !== watch.repository.text) {
      throw new RunDeliveryUncertain('origin fetch and push destinations do not uniquely identify the watched repository')
    }
  }

  async #compatiblePull(intent: DeliveryIntent, rejectIncompatible: boolean): Promise<DeliveredPullRequest | null> {
    const candidates = await this.#pullCandidates(intent)
    const compatible = candidates.filter((pull) => pull.state === 'OPEN' && !pull.isDraft
      && pull.headRefName === intent.branch && pull.headRefOid === intent.sha
      && pull.headRepository.nameWithOwner === intent.repository && pull.baseRefName === intent.base
      && pull.baseRepository.nameWithOwner === intent.repository
      && new RegExp(`(?:^|\\n)Closes #${intent.issue}(?:\\r?$|\\s)`, 'm').test(pull.body))
    if (compatible.length > 1) throw new RunDeliveryUncertain('multiple compatible pull requests exist for the pinned revision')
    if (compatible.length === 1 && candidates.length === 1) {
      return Object.freeze({ number: compatible[0].number, url: compatible[0].url })
    }
    if (candidates.length > 0 && (rejectIncompatible || compatible.length > 0)) {
      throw new RunDeliveryUncertain('an incompatible or ambiguous pull request already exists for the delivery branch')
    }
    return null
  }

  async #historicalPull(intent: DeliveryIntent): Promise<DeliveredPullRequest> {
    const candidates = await this.#pullCandidates(intent)
    const compatible = candidates.filter((pull) => (pull.state === 'OPEN' || pull.state === 'MERGED') && !pull.isDraft
      && pull.headRefName === intent.branch && pull.headRepository.nameWithOwner === intent.repository
      && pull.baseRefName === intent.base && pull.baseRepository.nameWithOwner === intent.repository
      && new RegExp(`(?:^|\\n)Closes #${intent.issue}(?:\\r?$|\\s)`, 'm').test(pull.body))
    if (compatible.length !== 1 || candidates.length !== 1) {
      throw new RunDeliveryUncertain('the delivered pull request is no longer uniquely compatible with the delivery identity')
    }
    const current = compatible[0]
    if (current.state === 'MERGED') return Object.freeze({ number: current.number, url: current.url })
    const remote = await this.#remoteSha(intent)
    if (remote === null || remote !== current.headRefOid || !(await this.#isAncestor(intent, intent.sha, remote))) {
      throw new RunDeliveryUncertain('the delivered pull request revision is not a descendant of the checked initial delivery')
    }
    const statuses = (await this.#issueLabels(intent)).filter((label) => label.startsWith('status:'))
    if (statuses.length !== 1 || (statuses[0] !== 'status:in-review' && statuses[0] !== 'status:in-progress')) {
      throw new RunDeliveryUncertain(`delivered issue status is ${statuses.join(', ') || 'absent'}`)
    }
    return Object.freeze({ number: current.number, url: current.url })
  }

  async #pullCandidates(intent: DeliveryIntent): Promise<readonly PullCandidate[]> {
    const [owner, name] = intent.repository.split('/')
    const argv = ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${CheckedRunDelivery.#PULL_QUERY}`,
      '-f', `owner=${owner}`, '-f', `name=${name}`, '-f', `headRefName=${intent.branch}`]
    const output = await this.gh.run(argv, { safeToRepeat: true })
    if (output.failed) throw new RunDeliveryUncertain(`pull request identity could not be read: ${output.stderr.trim()}`)
    let parsed: unknown
    try { parsed = JSON.parse(output.stdout) } catch { throw new RunDeliveryUncertain('pull request identity response is not JSON') }
    if (!Array.isArray(parsed)) throw new RunDeliveryUncertain('pull request identity response is malformed')
    const candidates: PullCandidate[] = []
    for (const page of parsed) {
      if (page === null || typeof page !== 'object' || !('data' in page)) {
        throw new RunDeliveryUncertain('pull request identity response is malformed')
      }
      const data = page.data
      if (data === null || typeof data !== 'object' || !('repository' in data)) {
        throw new RunDeliveryUncertain('pull request identity response is malformed')
      }
      const repository = data.repository
      if (repository === null || typeof repository !== 'object' || !('pullRequests' in repository)) {
        throw new RunDeliveryUncertain('pull request identity response is malformed')
      }
      const connection = repository.pullRequests
      if (connection === null || typeof connection !== 'object' || !('nodes' in connection)
        || !Array.isArray(connection.nodes) || !connection.nodes.every(CheckedRunDelivery.#isGraphqlPullCandidate)) {
        throw new RunDeliveryUncertain('pull request identity response is malformed')
      }
      candidates.push(...connection.nodes.map((pull: Omit<PullCandidate, 'baseRepository'> & {
        readonly repository: { readonly nameWithOwner: string },
      }) => ({ ...pull, baseRepository: pull.repository })))
    }
    if (!candidates.every(CheckedRunDelivery.#isPullCandidate)) {
      throw new RunDeliveryUncertain('pull request identity response is malformed')
    }
    return Object.freeze(candidates)
  }

  async #remoteSha(intent: DeliveryIntent): Promise<string | null> {
    const output = await this.git(['-C', intent.root, 'ls-remote', '--heads', 'origin', `refs/heads/${intent.branch}`])
    if (output.failed) throw new RunDeliveryUncertain(`remote branch could not be read: ${output.stderr.trim()}`)
    if (output.stdout.trim() === '') return null
    const lines = output.stdout.trim().split(/\r?\n/)
    if (lines.length !== 1) throw new RunDeliveryUncertain('remote branch lookup returned multiple refs')
    const [sha, ref, ...extra] = lines[0].split(/\s+/)
    if (!CheckedRunDelivery.#SHA.test(sha) || ref !== `refs/heads/${intent.branch}` || extra.length > 0) {
      throw new RunDeliveryUncertain('remote branch lookup returned malformed evidence')
    }
    return sha
  }

  async #isAncestor(intent: DeliveryIntent, ancestor: string, descendant: string): Promise<boolean> {
    const output = await this.git(['-C', intent.worktree, 'merge-base', '--is-ancestor', ancestor, descendant])
    if (output.code === 0) return true
    if (output.code === 1) return false
    throw new RunDeliveryFailure(`revision ancestry could not be checked: ${output.stderr.trim()}`)
  }

  async #issueLabels(intent: DeliveryIntent): Promise<readonly string[]> {
    const output = await this.gh.run(['issue', 'view', String(intent.issue), '--repo', intent.repository, '--json', 'state,labels'], { safeToRepeat: true })
    if (output.failed) throw new RunDeliveryUncertain(`issue status could not be read: ${output.stderr.trim()}`)
    let parsed: unknown
    try { parsed = JSON.parse(output.stdout) } catch { throw new RunDeliveryUncertain('issue status response is not JSON') }
    if (parsed === null || typeof parsed !== 'object' || !('state' in parsed) || parsed.state !== 'OPEN'
      || !('labels' in parsed) || !Array.isArray(parsed.labels)
      || !parsed.labels.every((label) => label !== null && typeof label === 'object' && 'name' in label && typeof label.name === 'string')) {
      throw new RunDeliveryUncertain('issue status response is malformed or the issue is not open')
    }
    return parsed.labels.map((label) => (label as { name: string }).name)
  }

  async #latestDiagnostic(watch: PlanWatch): Promise<string | null> {
    const attempts = await this.journal.publicationList(watch, ['release'])
    const results: { text: string, at: string, attempt: number }[] = []
    for (const name of attempts) {
      const result = await this.journal.publicationRead(watch, ['release', name, 'result.json'])
      if (result === null) continue
      const value = this.#object(result, 'checked release result')
      if (typeof value.at !== 'string' || !this.#date(value.at) || !Number.isInteger(value.attempt)) {
        throw new RunDeliveryUncertain('checked release result has no ordered attempt identity')
      }
      results.push({ text: result, at: value.at, attempt: value.attempt as number })
    }
    results.sort((left, right) => left.at === right.at ? left.attempt - right.attempt : left.at.localeCompare(right.at))
    return results.at(-1)?.text ?? null
  }

  async #successfulRelease(watch: PlanWatch, intent: DeliveryIntent, pullRequest: DeliveredPullRequest): Promise<{
    attempt: number, resultDigest: string,
  } | null> {
    const argv = [this.dispatchCheck, String(intent.issue), '--repo', intent.repository, '--release', '--no-watch-merge']
    for (const name of await this.journal.publicationList(watch, ['release'])) {
      const request = await this.journal.publicationRead(watch, ['release', name, 'request.json'])
      const result = await this.journal.publicationRead(watch, ['release', name, 'result.json'])
      if (request === null || result === null) continue
      const asked = this.#request(request, 'checked release request', intent, argv)
      const recorded = this.#recordedResult(result, request, asked, 'checked release result')
      const requestValue = this.#object(request, 'checked release request')
      if (!this.#samePull(requestValue.pullRequest, pullRequest)) {
        throw new RunDeliveryUncertain('checked release request names another pull request')
      }
      if (recorded.code === 0
        && recorded.stdout.split(/\r?\n/).includes(`released #${intent.issue} → in-review`)) {
        return { attempt: asked.attempt, resultDigest: this.#digest(result) }
      }
    }
    return null
  }

  async #successfulPush(watch: PlanWatch, intent: DeliveryIntent): Promise<{
    attempt: number, resultDigest: string,
  } | null> {
    const argv = ['-C', intent.worktree, 'push', 'origin', `${intent.sha}:refs/heads/${intent.branch}`]
    for (const name of await this.journal.publicationList(watch, ['push'])) {
      const request = await this.journal.publicationRead(watch, ['push', name, 'request.json'])
      const result = await this.journal.publicationRead(watch, ['push', name, 'result.json'])
      if (request === null || result === null) continue
      const asked = this.#request(request, 'push request', intent, argv)
      const recorded = this.#recordedResult(result, request, asked, 'push result')
      if (recorded.code === 0) return { attempt: asked.attempt, resultDigest: this.#digest(result) }
    }
    return null
  }

  async #pullRequestEvidence(
    watch: PlanWatch,
    intent: DeliveryIntent,
    compatible: DeliveredPullRequest | null,
  ): Promise<{ pullRequest: DeliveredPullRequest, attempt: number, resultDigest: string } | null> {
    const request = await this.journal.publicationRead(watch, ['pull-request', 'request.json'])
    const result = await this.journal.publicationRead(watch, ['pull-request', 'result.json'])
    const argv = ['pr', 'create', '--repo', intent.repository, '--head', intent.branch, '--base', intent.base,
      '--title', intent.title, '--body', intent.body]
    if (request === null) {
      if (compatible === null) return null
      const adoptedRequest = this.#json({ version: 1, attempt: 1, requestedAt: this.now(), head: intent.branch,
        base: intent.base, sha: intent.sha, title: intent.title, body: intent.body, argv, cwd: intent.worktree })
      const adoptedResult = this.#json({ version: 1, attempt: 1, at: this.now(), requestDigest: this.#digest(adoptedRequest),
        command: argv[0], argv, cwd: intent.worktree, code: 0,
        stdout: `reconciled ${compatible.url}\n`, stderr: '' })
      await this.journal.publicationWrite(watch, ['pull-request', 'request.json'], adoptedRequest)
      await this.journal.publicationWrite(watch, ['pull-request', 'result.json'], adoptedResult)
      return { pullRequest: compatible, attempt: 1, resultDigest: this.#digest(adoptedResult) }
    }
    const asked = this.#request(request, 'pull request request', intent, argv)
    if (asked.attempt !== 1) throw new RunDeliveryUncertain('pull request request has an invalid attempt identity')
    if (compatible === null) {
      if (result === null) return null
      this.#recordedResult(result, request, asked, 'pull request result')
      return null
    }
    if (result === null) {
      const reconciled = this.#json({ version: 1, attempt: 1, at: this.now(), requestDigest: this.#digest(request),
        command: argv[0], argv, cwd: intent.worktree, code: 0,
        stdout: `reconciled ${compatible.url}\n`, stderr: '' })
      await this.journal.publicationWrite(watch, ['pull-request', 'result.json'], reconciled)
      return { pullRequest: compatible, attempt: 1, resultDigest: this.#digest(reconciled) }
    }
    this.#recordedResult(result, request, asked, 'pull request result')
    return { pullRequest: compatible, attempt: 1, resultDigest: this.#digest(result) }
  }

  async #pendingAttempt(
    watch: PlanWatch,
    operation: 'push' | 'release',
    intent: DeliveryIntent,
    pushConfirmed = false,
  ): Promise<{
    name: string, request: RecordedRequest, requestText: string, result: RecordedResult | null,
  } | null> {
    let pending: {
      name: string, request: RecordedRequest, requestText: string, result: RecordedResult | null,
    } | null = null
    const argv = operation === 'push'
      ? ['-C', intent.worktree, 'push', 'origin', `${intent.sha}:refs/heads/${intent.branch}`]
      : [this.dispatchCheck, String(intent.issue), '--repo', intent.repository, '--release', '--no-watch-merge']
    for (const name of await this.journal.publicationList(watch, [operation])) {
      const request = await this.journal.publicationRead(watch, [operation, name, 'request.json'])
      if (request === null) throw new RunDeliveryUncertain(`${operation} attempt has no request`)
      const asked = this.#request(request, `${operation} request`, intent, argv)
      const result = await this.journal.publicationRead(watch, [operation, name, 'result.json'])
      const disposition = await this.journal.publicationRead(watch, [operation, name, 'disposition.json'])
      if (result !== null) {
        const recorded = this.#recordedResult(result, request, asked, `${operation} result`)
        if (disposition !== null) {
          await this.#terminatedDisposition(watch, operation, name, request, asked, disposition)
          continue
        }
        const successful = operation === 'push'
          ? recorded.code === 0 && pushConfirmed
          : recorded.code === 0
            && recorded.stdout.split(/\r?\n/).includes(`released #${intent.issue} → in-review`)
        if (successful) continue
        if (pending !== null) throw new RunDeliveryUncertain(`multiple ${operation} attempts have unknown outcomes`)
        pending = { name, request: asked, requestText: request, result: recorded }
        continue
      }
      if (disposition !== null) {
        await this.#terminatedDisposition(watch, operation, name, request, asked, disposition)
        continue
      }
      if (pending !== null) throw new RunDeliveryUncertain(`multiple ${operation} attempts have unknown outcomes`)
      pending = { name, request: asked, requestText: request, result: null }
    }
    return pending
  }

  async #requireTerminated(
    watch: PlanWatch,
    operation: 'push' | 'release',
    name: string,
    request: RecordedRequest,
  ): Promise<void> {
    const { ownerText, owner } = await this.#requireStopped(watch, operation, name, request)
    const requestText = await this.#requiredPublication(watch, [operation, name, 'request.json'])
    await this.journal.publicationWrite(watch, [operation, name, 'disposition.json'], this.#json({
      version: 1, attempt: request.attempt, at: this.now(), kind: 'terminated',
      requestDigest: this.#digest(requestText), ownerDigest: this.#digest(ownerText), processGroup: owner.processGroup,
    }))
  }

  async #requireStopped(
    watch: PlanWatch,
    operation: 'push' | 'release',
    name: string,
    request: RecordedRequest,
  ): Promise<{ ownerText: string, owner: RecordedOwner }> {
    const ownership = await this.#ownership(watch, operation, name, request)
    if (ownership.running) {
      throw new RunDeliveryUncertain(`${operation} process group ${ownership.owner.processGroup} may still be running`)
    }
    return ownership
  }

  async #ownership(
    watch: PlanWatch,
    operation: 'push' | 'release',
    name: string,
    request: RecordedRequest,
  ): Promise<{ ownerText: string, owner: RecordedOwner, running: boolean }> {
    const ownerText = await this.journal.publicationRead(watch, [operation, name, 'owner.json'])
    if (ownerText === null) throw new RunDeliveryUncertain(`${operation} child ownership is unknown`)
    const owner = this.#owner(ownerText, operation, request)
    return { ownerText, owner, running: this.alive(-owner.processGroup) }
  }

  async #recordOwner(
    watch: PlanWatch,
    operation: 'push' | 'release',
    name: string,
    attempt: number,
    pid: number,
    processGroup: number | undefined,
  ): Promise<void> {
    if (processGroup === undefined || processGroup !== pid) {
      throw new RunDeliveryUncertain(`${operation} process group ownership could not be established`)
    }
    await this.journal.publicationWrite(watch, [operation, name, 'owner.json'], this.#json({
      version: 2, attempt, pid, processGroup, startedAt: this.now(),
    }))
  }

  async #terminatedDisposition(
    watch: PlanWatch,
    operation: 'push' | 'release',
    name: string,
    requestText: string,
    request: RecordedRequest,
    text: string,
  ): Promise<void> {
    const ownerText = await this.journal.publicationRead(watch, [operation, name, 'owner.json'])
    if (ownerText === null) throw new RunDeliveryUncertain(`${operation} termination disposition has no ownership evidence`)
    const owner = this.#owner(ownerText, operation, request)
    const value = this.#object(text, `${operation} termination disposition`)
    if (value.version !== 1 || value.attempt !== request.attempt || value.kind !== 'terminated'
      || typeof value.at !== 'string' || !this.#date(value.at)
      || value.requestDigest !== this.#digest(requestText) || value.ownerDigest !== this.#digest(ownerText)
      || value.processGroup !== owner.processGroup) {
      throw new RunDeliveryUncertain(`${operation} termination disposition is malformed or unbound`)
    }
  }

  #owner(text: string, operation: 'push' | 'release', request: RecordedRequest): RecordedOwner {
    const owner = this.#object(text, `${operation} child ownership`)
    if (owner.version !== 2 || owner.attempt !== request.attempt || !Number.isInteger(owner.pid)
      || (owner.pid as number) < 1 || owner.processGroup !== owner.pid
      || typeof owner.startedAt !== 'string' || !this.#date(owner.startedAt)) {
      throw new RunDeliveryUncertain(`${operation} child ownership is malformed`)
    }
    return owner as RecordedOwner
  }

  async #nextAttempt(watch: PlanWatch, operation: 'push' | 'release'): Promise<number> {
    let latest = 0
    for (const name of await this.journal.publicationList(watch, [operation])) {
      const text = await this.journal.publicationRead(watch, [operation, name, 'request.json'])
      if (text === null) throw new RunDeliveryUncertain(`${operation} attempt has no request`)
      const value = this.#object(text, `${operation} request`)
      if (!Number.isInteger(value.attempt) || (value.attempt as number) < 1) {
        throw new RunDeliveryUncertain(`${operation} request has no ordered attempt identity`)
      }
      latest = Math.max(latest, value.attempt as number)
    }
    return latest + 1
  }

  async #reconcilePush(
    watch: PlanWatch,
    intent: DeliveryIntent,
    pending: { name: string, request: RecordedRequest },
  ): Promise<{ attempt: number, resultDigest: string }> {
    const result = this.#json({ version: 1, attempt: pending.request.attempt, at: this.now(),
      requestDigest: this.#digest(await this.#requiredPublication(watch, ['push', pending.name, 'request.json'])),
      command: pending.request.argv[0], argv: pending.request.argv, cwd: pending.request.cwd,
      code: 0, stdout: `reconciled refs/heads/${intent.branch} at ${intent.sha}\n`, stderr: '' })
    await this.journal.publicationWrite(watch, ['push', pending.name, 'result.json'], result)
    return { attempt: pending.request.attempt, resultDigest: this.#digest(result) }
  }

  async #evidenceByAttempt(watch: PlanWatch, operation: 'push' | 'release', attempt: number): Promise<{
    request: string, result: string,
  }> {
    let found: { request: string, result: string } | null = null
    for (const name of await this.journal.publicationList(watch, [operation])) {
      const request = await this.journal.publicationRead(watch, [operation, name, 'request.json'])
      if (request === null) continue
      const value = this.#object(request, `${operation} request`)
      if (value.attempt !== attempt) continue
      const result = await this.journal.publicationRead(watch, [operation, name, 'result.json'])
      if (result === null || found !== null) throw new RunDeliveryUncertain(`${operation} predecessor is absent or ambiguous`)
      found = { request, result }
    }
    if (found === null) throw new RunDeliveryUncertain(`${operation} predecessor is absent or ambiguous`)
    return found
  }

  async #requiredPublication(watch: PlanWatch, path: readonly string[]): Promise<string> {
    const text = await this.journal.publicationRead(watch, path)
    if (text === null) throw new RunDeliveryUncertain(`${path.join('/')} is absent`)
    return text
  }

  #parseIntent(text: string, watch: PlanWatch): DeliveryIntent {
    const value = this.#object(text, 'delivery intent')
    if (value.version !== 1 || value.conversation !== watch.agent || value.repository !== watch.repository.text
      || value.issue !== watch.issue.number || value.root !== watch.located.root || value.worktree !== watch.located.path
      || value.branch !== watch.located.branch || typeof value.base !== 'string' || value.base.length === 0
      || !CheckedRunDelivery.#SHA.test(String(value.sha)) || !CheckedRunDelivery.#DIGEST.test(String(value.machineDigest))
      || typeof value.title !== 'string' || !CheckedRunDelivery.#CONVENTIONAL.test(value.title)
      || value.body !== `Closes #${watch.issue.number}\n\n<!-- control-tower-delivery:${watch.repository.text}#${watch.issue.number}:${watch.agent} -->`) {
      throw new RunDeliveryUncertain('delivery intent does not identify this plan watch')
    }
    return value as DeliveryIntent
  }

  async #requireIntentIdentity(watch: PlanWatch, intent: DeliveryIntent): Promise<void> {
    if (watch.located.root === undefined || await realpath(watch.located.root) !== intent.root
      || await realpath(watch.located.path) !== intent.worktree) {
      throw new RunDeliveryUncertain('delivery intent paths no longer identify this plan watch')
    }
    const manifest = await this.journal.manifest(watch)
    const entries = await this.journal.entries(watch)
    const digest = createHash('sha256').update(JSON.stringify({ manifest, entries })).digest('hex')
    if (digest !== intent.machineDigest) {
      throw new RunDeliveryUncertain('delivery intent terminal machine digest does not match durable completion evidence')
    }
  }

  async #validateReceipt(watch: PlanWatch, intent: DeliveryIntent, text: string): Promise<DeliveredPullRequest> {
    const value = this.#object(text, 'delivery receipt')
    if (value.version !== 1 || value.sha !== intent.sha || typeof value.at !== 'string' || !this.#date(value.at)
      || !this.#isPull(value.pullRequest) || !Number.isInteger(value.pushAttempt)
      || !Number.isInteger(value.pullRequestAttempt) || !Number.isInteger(value.releaseAttempt)
      || typeof value.pushResultDigest !== 'string' || typeof value.pullRequestResultDigest !== 'string'
      || typeof value.releaseResultDigest !== 'string') {
      throw new RunDeliveryUncertain('delivery receipt is malformed or names another revision')
    }
    const push = await this.#evidenceByAttempt(watch, 'push', value.pushAttempt as number)
    const pushArgv = ['-C', intent.worktree, 'push', 'origin', `${intent.sha}:refs/heads/${intent.branch}`]
    const pushRequest = this.#request(push.request, 'push request', intent, pushArgv)
    const pushResult = this.#recordedResult(push.result, push.request, pushRequest, 'push result')
    if (pushResult.code !== 0 || this.#digest(push.result) !== value.pushResultDigest) {
      throw new RunDeliveryUncertain('delivery receipt has no successful bound push result')
    }
    const pullRequest = value.pullRequest
    const prRequest = await this.journal.publicationRead(watch, ['pull-request', 'request.json'])
    const prResult = await this.journal.publicationRead(watch, ['pull-request', 'result.json'])
    if (prRequest === null || prResult === null || value.pullRequestAttempt !== 1) {
      throw new RunDeliveryUncertain('delivery receipt has no pull request predecessor')
    }
    const prArgv = ['pr', 'create', '--repo', intent.repository, '--head', intent.branch, '--base', intent.base,
      '--title', intent.title, '--body', intent.body]
    const askedPr = this.#request(prRequest, 'pull request request', intent, prArgv)
    this.#recordedResult(prResult, prRequest, askedPr, 'pull request result')
    if (this.#digest(prResult) !== value.pullRequestResultDigest) {
      throw new RunDeliveryUncertain('delivery receipt has an unbound pull request result')
    }
    const release = await this.#evidenceByAttempt(watch, 'release', value.releaseAttempt as number)
    const releaseArgv = [this.dispatchCheck, String(intent.issue), '--repo', intent.repository, '--release', '--no-watch-merge']
    const releaseRequest = this.#request(release.request, 'checked release request', intent, releaseArgv)
    const requestValue = this.#object(release.request, 'checked release request')
    const releaseResult = this.#recordedResult(release.result, release.request, releaseRequest, 'checked release result')
    if (!this.#samePull(requestValue.pullRequest, pullRequest) || releaseResult.code !== 0
      || !releaseResult.stdout.split(/\r?\n/).includes(`released #${intent.issue} → in-review`)
      || this.#digest(release.result) !== value.releaseResultDigest) {
      throw new RunDeliveryUncertain('delivery receipt has no successful bound checked release result')
    }
    return pullRequest
  }

  #object(text: string, what: string): Record<string, unknown> {
    let value: unknown
    try { value = JSON.parse(text) } catch { throw new RunDeliveryUncertain(`${what} is not valid JSON`) }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new RunDeliveryUncertain(`${what} is not an object`)
    return value as Record<string, unknown>
  }

  #request(
    text: string,
    what: string,
    intent: DeliveryIntent,
    argv: readonly string[],
  ): RecordedRequest {
    const value = this.#object(text, what)
    if (value.version !== 1 || !Number.isInteger(value.attempt) || (value.attempt as number) < 1
      || typeof value.requestedAt !== 'string' || !this.#date(value.requestedAt)
      || value.sha !== intent.sha || value.cwd !== intent.worktree || !this.#sameArgv(value.argv, argv)) {
      throw new RunDeliveryUncertain(`${what} is malformed or names another delivery intent`)
    }
    return value as RecordedRequest
  }

  #recordedResult(
    text: string,
    requestText: string,
    request: RecordedRequest,
    what: string,
  ): RecordedResult {
    const value = this.#object(text, what)
    if (value.version !== 1 || value.attempt !== request.attempt || typeof value.at !== 'string' || !this.#date(value.at)
      || value.requestDigest !== this.#digest(requestText) || value.command !== request.argv[0]
      || !this.#sameArgv(value.argv, request.argv) || value.cwd !== request.cwd || !Number.isInteger(value.code)
      || typeof value.stdout !== 'string' || typeof value.stderr !== 'string') {
      throw new RunDeliveryUncertain(`${what} is malformed or is not bound to its request`)
    }
    return value as RecordedResult
  }

  #sameArgv(value: unknown, expected: readonly string[]): boolean {
    return Array.isArray(value) && value.length === expected.length
      && value.every((part, index) => part === expected[index])
  }

  #samePull(value: unknown, expected: DeliveredPullRequest): boolean {
    return this.#isPull(value) && value.number === expected.number && value.url === expected.url
  }

  #isPull(value: unknown): value is DeliveredPullRequest {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && 'number' in value && Number.isInteger(value.number) && (value.number as number) > 0
      && 'url' in value && typeof value.url === 'string' && value.url.length > 0
  }

  #date(value: string): boolean { return Number.isFinite(Date.parse(value)) }

  #digest(text: string): string { return createHash('sha256').update(text).digest('hex') }

  async #gitText(argv: string[], what: string): Promise<string> {
    const output = await this.git(argv)
    if (output.failed) throw new RunDeliveryFailure(`${what} could not be read: ${output.stderr.trim()}`)
    const text = output.stdout.trim()
    if (text.length === 0) throw new RunDeliveryUncertain(`${what} is empty`)
    return text
  }

  async #gitLines(argv: string[], what: string): Promise<readonly string[]> {
    return (await this.#gitText(argv, what)).split(/\r?\n/).filter((line) => line.length > 0)
  }

  #repositoryIn(url: string): string | null {
    return url.match(CheckedRunDelivery.#REMOTE)?.[1] ?? null
  }

  #result(attempt: number, request: string, argv: readonly string[], cwd: string, output: ProcessOutput): string {
    return this.#json({ version: 1, attempt, at: this.now(), requestDigest: this.#digest(request),
      command: argv[0], argv, cwd, code: output.code,
      stdout: output.stdout, stderr: output.stderr })
  }

  #json(value: unknown): string { return `${JSON.stringify(value)}\n` }

  static #running(operation: 'push' | 'release', owner: RecordedOwner): RunDeliveryInspection {
    return {
      kind: 'publishing', pullRequest: null,
      diagnostic: `${operation} process group ${owner.processGroup} is still running`,
    }
  }

  static #isPullCandidate(value: unknown): value is PullCandidate {
    if (value === null || typeof value !== 'object') return false
    const pull = value as Record<string, unknown>
    return Number.isInteger(pull.number) && typeof pull.url === 'string' && typeof pull.body === 'string'
      && typeof pull.state === 'string' && typeof pull.isDraft === 'boolean' && typeof pull.headRefName === 'string'
      && typeof pull.headRefOid === 'string' && typeof pull.baseRefName === 'string'
      && CheckedRunDelivery.#repositoryObject(pull.headRepository) && CheckedRunDelivery.#repositoryObject(pull.baseRepository)
  }

  static #isGraphqlPullCandidate(value: unknown): value is Omit<PullCandidate, 'baseRepository'> & {
    readonly repository: { readonly nameWithOwner: string },
  } {
    if (value === null || typeof value !== 'object') return false
    const pull = value as Record<string, unknown>
    return Number.isInteger(pull.number) && typeof pull.url === 'string' && typeof pull.body === 'string'
      && typeof pull.state === 'string' && typeof pull.isDraft === 'boolean' && typeof pull.headRefName === 'string'
      && typeof pull.headRefOid === 'string' && typeof pull.baseRefName === 'string'
      && CheckedRunDelivery.#repositoryObject(pull.headRepository) && CheckedRunDelivery.#repositoryObject(pull.repository)
  }

  static #repositoryObject(value: unknown): value is { readonly nameWithOwner: string } {
    return value !== null && typeof value === 'object' && 'nameWithOwner' in value
      && typeof value.nameWithOwner === 'string'
  }

  static #alive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (failure) {
      return failure !== null && typeof failure === 'object' && 'code' in failure && failure.code === 'EPERM'
    }
  }
}
