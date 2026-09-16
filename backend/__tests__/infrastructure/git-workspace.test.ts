import { describe, it, expect, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { parseStateSafe } from '../../../plugin/scripts/state.js'
import { buildStateSeed } from '../../../plugin/scripts/kickoff.js'
import { mapGhIssue, NO_MILESTONE_KEY } from '../../../plugin/scripts/gh-issue-map.js'
import { resolveStatePath } from '../../../plugin/scripts/state-paths.js'
import { Baseline, BaselineOutcome, BaselineResult } from '../../../plugin/scripts/baseline.js'
import { GitWorkspace, SliceSeed } from '../../src/infrastructure/git-workspace.ts'
import { Gh } from '../../src/infrastructure/gh.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { RetryBudget, RetryPolicy } from '../../src/domain/policies/retry-policy.ts'
import {
  WorkspaceFailure, WorkspaceNotCleaned, WorkspaceNotPrepared, WorkspaceNotRead, WorkspaceNotUnderstood,
  CheckoutNotConfirmed,
} from '../../src/domain/exceptions.ts'
import { PlanIssue } from '../../src/domain/value-objects/plan-issue.ts'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.ts'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'

class BaselineDouble extends Baseline {
  readonly #result: BaselineResult
  readonly #measured: string[] = []

  constructor(result: BaselineResult = BaselineDouble.green()) {
    super({ run: () => { throw new Error('a baseline double never runs a command') } })
    this.#result = result
  }

  get measured(): string[] {
    return this.#measured
  }

  measure(worktree: string): Promise<BaselineResult> {
    this.#measured.push(worktree)
    return Promise.resolve(this.#result)
  }

  static green(): BaselineResult {
    return new BaselineResult({ outcome: BaselineOutcome.GREEN, command: 'npm test', summary: 'exit 0 · 12 passed' })
  }

  static red(): BaselineResult {
    return new BaselineResult({ outcome: BaselineOutcome.RED, command: 'npm test', summary: 'exit 1 · 2 failed' })
  }

  static unverified(): BaselineResult {
    return BaselineResult.notMeasured('no test command declared in AGENTS.md nor in .agent/conventions.md')
  }

  static answering(result: BaselineResult): BaselineDouble {
    return new BaselineDouble(result)
  }
}

class GitDouble {
  static readonly ROOT = '/repo/checkout'
  static readonly CHECKOUT = new CheckoutRoot(GitDouble.ROOT)
  static readonly REPOSITORY = new RepositoryName('owner/name')
  static readonly REMOTE_URL = 'git@github.com:owner/name.git'
  static readonly BASE = 'main'
  static readonly DECLARED = `refs/remotes/origin/${GitDouble.BASE}\n`
  static readonly CUT = 'a1b2c3d'
  static readonly COMMON_DIR = '/repo/checkout/.git'
  static readonly WORKTREE = '/repo/checkout/.worktrees/42'
  static readonly EXCLUDE_PATH = `${GitDouble.COMMON_DIR}/info/exclude`
  static readonly ISSUE_BODY = [
    '## Acceptance criteria (EARS, 1:1 con tests)',
    '- preserves the issue contract',
    '',
    '## Señal de observabilidad',
    'seed_written_total',
    '',
    '## E2E',
    '- open the seeded workspace',
    '',
    '<!-- ct-order:3 -->',
  ].join('\n')

  baseline: BaselineDouble
  answer: ProcessOutput
  removal: ProcessOutput | null
  deletion: ProcessOutput | null
  remote: ProcessOutput
  status: ProcessOutput
  existingExclude: string | null
  commonDir: string
  declared: ProcessOutput
  fetch: ProcessOutput
  toplevel: ProcessOutput
  calls: string[][]
  written: [string, string][]
  reads: string[]
  stderr: string[]
  ghCalls: string[][]
  issueRead: ProcessOutput

  constructor({
    answer, status, existingExclude = null, commonDir, declared, fetch, remote, toplevel,
    removal = null, deletion = null,
    baseline, issueRead,
  }: {
    answer?: ProcessOutput,
    status?: ProcessOutput,
    existingExclude?: string | null,
    commonDir?: string,
    declared?: ProcessOutput,
    fetch?: ProcessOutput,
    remote?: ProcessOutput,
    toplevel?: ProcessOutput,
    removal?: ProcessOutput | null,
    deletion?: ProcessOutput | null,
    baseline?: BaselineDouble,
    issueRead?: ProcessOutput,
  } = {}) {
    this.baseline = baseline ?? new BaselineDouble()
    this.answer = answer ?? GitDouble.ok()
    this.removal = removal
    this.deletion = deletion
    this.remote = remote ?? GitDouble.naming(GitDouble.REMOTE_URL)
    this.status = status ?? GitDouble.clean()
    this.existingExclude = existingExclude
    this.commonDir = commonDir ?? GitDouble.COMMON_DIR
    this.declared = declared ?? GitDouble.declaring()
    this.fetch = fetch ?? GitDouble.ok()
    this.toplevel = toplevel ?? GitDouble.canonical()
    this.calls = []
    this.written = []
    this.reads = []
    this.stderr = []
    this.ghCalls = []
    this.issueRead = issueRead ?? GitDouble.issueAnswer()
  }

  workspace(): GitWorkspace {
    return new GitWorkspace({
      baseline: this.baseline,
      gh: this.gh(),
      read: (path) => {
        this.reads.push(path)
        return Promise.resolve(this.existingExclude)
      },
      write: (path, text) => {
        this.written.push([path, text])
        return Promise.resolve()
      },
      run: (argv) => {
        this.calls.push(argv)
        return Promise.resolve(this.answering(argv))
      },
      stderr: (line) => {
        this.stderr.push(line)
      },
    })
  }

  gh(): Gh {
    return new Gh({
      launch: (argv) => {
        this.ghCalls.push(argv)
        return Promise.resolve(this.issueRead)
      },
      policy: new RetryPolicy({ budget: new RetryBudget({ attempts: 0, waitSeconds: 0 }) }),
      sleep: () => Promise.resolve(),
    })
  }

  answering(argv: string[]): ProcessOutput {
    if (argv.includes('get-url')) return this.remote
    if (argv.includes('--show-toplevel')) return this.toplevel
    if (argv.includes('symbolic-ref')) return this.declared
    if (argv.includes('fetch')) return this.fetch
    if (argv.includes('--verify')) return GitDouble.printing(`${GitDouble.CUT}\n`)
    if (argv.includes('--git-common-dir')) return GitDouble.printing(`${this.commonDir}\n`)
    if (argv.includes('HEAD')) return GitDouble.printing(`${GitDouble.CUT}\n`)
    if (argv.includes('status')) return this.status
    if (argv.includes('remove') && this.removal !== null) return this.removal
    if (argv.includes('-D') && this.deletion !== null) return this.deletion
    if (argv.includes('worktree') || argv.includes('branch')) return this.answer
    throw new Error(`nobody wrote an answer for git ${argv.join(' ')}`)
  }

  asking(order: string): string[] | undefined {
    return this.calls.find((argv) => argv.includes(order))
  }

  prepared(issue: PlanIssue = GitDouble.issue()) {
    return this.workspace().prepare({ issue, repository: GitDouble.REPOSITORY, root: GitDouble.CHECKOUT })
  }

  confirmed(): Promise<CheckoutRoot> {
    return this.workspace().confirm({ root: GitDouble.CHECKOUT, repository: GitDouble.REPOSITORY })
  }

  refusedTo(asking: Promise<CheckoutRoot>) {
    return asking.catch((cause) => cause)
  }

  cut(): string[] | undefined {
    return this.asking('worktree')
  }

  static issue(number = 42): PlanIssue {
    return new PlanIssue({ number, url: `https://github.com/${GitDouble.REPOSITORY.text}/issues/${number}` })
  }

  static issueFields({
    number = 42,
    labels = [{ name: 'status:ready' }, { name: 'type:infra' }, { name: 'gate:apply' }],
    milestone = { title: 'the milestone' },
  }: {
    number?: number,
    labels?: { name: string }[],
    milestone?: { title: string } | null,
  } = {}) {
    return { number, title: '#3 authoritative slice', body: GitDouble.ISSUE_BODY, labels, milestone }
  }

  static issueAnswer(fields: Record<string, unknown> = GitDouble.issueFields()): ProcessOutput {
    return GitDouble.printing(JSON.stringify(fields))
  }

  static printing(stdout: string): ProcessOutput {
    return new ProcessOutput({ code: 0, stdout, stderr: '' })
  }

  static ok(): ProcessOutput {
    return GitDouble.printing('')
  }

  static declaring(stdout: string = GitDouble.DECLARED): ProcessOutput {
    return GitDouble.printing(stdout)
  }

  static naming(url: string): ProcessOutput {
    return GitDouble.printing(`${url}\n`)
  }

  static canonical(path: string = GitDouble.ROOT): ProcessOutput {
    return GitDouble.printing(`${path}\n`)
  }

  static declaringNothing(argv: string[]): ProcessOutput | null {
    if (argv.includes('get-url')) return GitDouble.naming(GitDouble.REMOTE_URL)
    if (argv.includes('fetch')) return GitDouble.ok()
    if (argv.includes('--verify')) return GitDouble.printing(`${GitDouble.CUT}\n`)

    return argv.includes('symbolic-ref') ? GitDouble.declaring() : null
  }

  static refused(stderr: string): ProcessOutput {
    return new ProcessOutput({ code: 1, stdout: '', stderr })
  }

  static clean(): ProcessOutput {
    return GitDouble.printing('')
  }

  static located(): WorkspaceLocation {
    return new WorkspaceLocation({ root: GitDouble.ROOT, path: GitDouble.WORKTREE, branch: 'feat/42' })
  }

  static stillVisible(): ProcessOutput {
    return GitDouble.printing(`?? ${SliceSeed.RELATIVE_PATH}\n`)
  }
}

describe('GitWorkspace', () => {
  it('the default branch is fetched before cutting the worktree', async () => {
    const git = new GitDouble()

    await git.prepared()

    const fetch = git.calls.findIndex((argv) => argv.includes('fetch'))
    const verify = git.calls.findIndex((argv) => argv.includes('--verify'))
    const cut = git.calls.findIndex((argv) => argv.includes('worktree'))
    expect(git.calls[fetch]).toEqual(['-C', GitDouble.ROOT, 'fetch', 'origin', GitDouble.BASE])
    expect(git.calls[verify]).toEqual([
      '-C', GitDouble.ROOT, 'rev-parse', '--verify', '--quiet', `origin/${GitDouble.BASE}^{commit}`,
    ])
    expect(fetch).toBeLessThan(verify)
    expect(verify).toBeLessThan(cut)
  })

  it('an issue read or fetch failure creates no worktree', async () => {
    const unread = new GitDouble({ issueRead: GitDouble.refused('gh is unavailable') })
    const malformed = new GitDouble({ issueRead: GitDouble.issueAnswer({ number: 41 }) })
    const unfetched = new GitDouble({ fetch: GitDouble.refused('origin is unavailable') })

    const readFailure = await unread.prepared().catch((cause) => cause)
    const malformedFailure = await malformed.prepared().catch((cause) => cause)
    const fetchFailure = await unfetched.prepared().catch((cause) => cause)

    expect(readFailure).toBeInstanceOf(WorkspaceNotRead)
    expect(malformedFailure).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(fetchFailure).toBeInstanceOf(WorkspaceNotPrepared)
    expect(unread.calls.some((argv) => argv.includes('worktree'))).toBe(false)
    expect(malformed.calls.some((argv) => argv.includes('worktree'))).toBe(false)
    expect(unfetched.calls.some((argv) => argv.includes('worktree'))).toBe(false)
  })

  it('an explicit plan gate is refused before preparation', async () => {
    const issueRead = GitDouble.issueAnswer(GitDouble.issueFields({
      labels: [{ name: 'status:ready' }, { name: 'gate:none' }, { name: 'gate:plan' }],
    }))
    const git = new GitDouble({ issueRead })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('plan')
    expect(git.calls).toEqual([])
    expect(git.written).toEqual([])
  })

  it('it_cuts_the_branch_from_the_remote_base_so_the_session_starts_from_what_is_published', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.cut()).toEqual([
      '-C', '/repo/checkout',
      'worktree', 'add',
      '-b', 'feat/42',
      '/repo/checkout/.worktrees/42',
      'origin/main',
    ])
  })

  it('the_base_it_cuts_from_is_the_one_the_remote_declares_and_never_a_name_the_backend_assumed', async () => {
    const git = new GitDouble({ declared: GitDouble.declaring('refs/remotes/origin/trunk\n') })

    await git.prepared()

    expect(git.asking('symbolic-ref')).toEqual([
      '-C', GitDouble.ROOT, 'symbolic-ref', 'refs/remotes/origin/HEAD',
    ])
    expect(git.cut()?.at(-1)).toBe('origin/trunk')
  })

  it('the_base_the_remote_declares_is_the_one_the_seed_records_so_a_rehydrated_agent_reads_the_truth', async () => {
    const git = new GitDouble({ declared: GitDouble.declaring('refs/remotes/origin/trunk\n') })

    await git.prepared()

    expect(parseStateSafe(git.written[1][1]).meta.base).toBe('trunk')
  })

  it('a_remote_that_declares_no_default_branch_stops_before_a_worktree_is_cut_for_nothing', async () => {
    const git = new GitDouble({
      declared: GitDouble.refused('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref'),
    })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('does not declare a default branch')
    expect(git.calls.some((argv) => argv.includes('worktree'))).toBe(false)
  })

  it('git_answering_something_that_is_not_a_remote_head_is_not_guessed_into_a_branch_name', async () => {
    const git = new GitDouble({ declared: GitDouble.declaring('refs/heads/main\n') })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('refs/remotes/origin/HEAD')
    expect(git.calls.some((argv) => argv.includes('worktree'))).toBe(false)
  })

  it('git_answering_no_common_directory_at_all_is_not_pasted_onto_the_root_as_a_dangling_path', async () => {
    const git = new GitDouble({ commonDir: '   ' })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('--git-common-dir')
  })

  it('a_state_file_git_never_hid_after_the_rule_was_written_broke_our_contract_with_git_and_says_so', async () => {
    const git = new GitDouble({ status: GitDouble.stillVisible() })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain(SliceSeed.RELATIVE_PATH)
  })

  it('git_answering_something_unreadable_is_told_apart_from_git_refusing_the_call', async () => {
    const unreadable = await new GitDouble({ declared: GitDouble.declaring('refs/heads/main\n') })
      .prepared().catch((cause) => cause)
    const refused = await new GitDouble({ declared: GitDouble.refused('fatal: no such ref') })
      .prepared().catch((cause) => cause)

    expect(unreadable).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refused).toBeInstanceOf(WorkspaceNotPrepared)
    expect(unreadable).not.toBeInstanceOf(WorkspaceNotPrepared)
    expect(refused).not.toBeInstanceOf(WorkspaceNotUnderstood)
  })

  it('both_ways_of_failing_share_a_type_so_a_caller_that_does_not_care_can_catch_one_thing', async () => {
    const unreadable = await new GitDouble({ declared: GitDouble.declaring('refs/heads/main\n') })
      .prepared().catch((cause) => cause)
    const refused = await new GitDouble({ declared: GitDouble.refused('fatal: no such ref') })
      .prepared().catch((cause) => cause)

    expect(unreadable).toBeInstanceOf(WorkspaceFailure)
    expect(refused).toBeInstanceOf(WorkspaceFailure)
  })

  it('confirming_asks_the_remote_and_then_the_canonical_top_level_and_nothing_else', async () => {
    const git = new GitDouble()

    await git.confirmed()

    expect(git.calls).toEqual([
      ['-C', GitDouble.ROOT, 'remote', 'get-url', 'origin'],
      ['-C', GitDouble.ROOT, 'rev-parse', '--show-toplevel'],
    ])
  })

  it('confirming_answers_the_canonical_root_git_printed_and_not_the_one_it_was_asked_about', async () => {
    const git = new GitDouble({ toplevel: GitDouble.canonical('/real/checkout') })

    const confirmed = await git.confirmed()

    expect(confirmed).toBeInstanceOf(CheckoutRoot)
    expect(confirmed.text).toBe('/real/checkout')
  })

  it('a_root_that_is_a_different_repository_than_the_issue_is_a_checkout_not_confirmed_naming_both', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('git@github.com:someone/else.git') })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(CheckoutNotConfirmed)
    expect(refusal.message).toContain('someone/else')
    expect(refusal.message).toContain('owner/name')
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('an_https_remote_names_the_same_repository_as_its_ssh_form_so_neither_checkout_is_refused', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('https://github.com/owner/name.git') })

    const confirmed = await git.confirmed()

    expect(confirmed.text).toBe(GitDouble.ROOT)
  })

  it('an_https_remote_without_the_git_suffix_names_the_same_repository_too', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('https://github.com/owner/name') })

    const confirmed = await git.confirmed()

    expect(confirmed.text).toBe(GitDouble.ROOT)
  })

  it('a_remote_url_nobody_can_read_a_repository_out_of_is_a_checkout_not_confirmed_too', async () => {
    const git = new GitDouble({ remote: GitDouble.naming('/some/local/mirror') })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(CheckoutNotConfirmed)
    expect(refusal.message).toContain('/some/local/mirror')
  })

  it('a_remote_git_refuses_to_name_at_all_is_a_checkout_not_confirmed_that_names_the_root', async () => {
    const git = new GitDouble({ remote: GitDouble.refused("fatal: cannot change to '/somewhere/else': No such file or directory") })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(CheckoutNotConfirmed)
    expect(refusal.message).toContain('No such file or directory')
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('git_refusing_to_resolve_the_top_level_is_a_checkout_not_confirmed_too', async () => {
    const git = new GitDouble({ toplevel: GitDouble.refused("fatal: not a git repository (or any of the parent directories): .git") })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(CheckoutNotConfirmed)
    expect(refusal.message).toContain('not a git repository')
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('git_show_toplevel_printing_nothing_is_our_contract_with_git_broken_not_a_mismatched_repository', async () => {
    const git = new GitDouble({ toplevel: GitDouble.printing('') })

    const refusal = await git.refusedTo(git.confirmed())

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain(GitDouble.ROOT)
  })

  it('every_way_confirming_can_fail_shares_the_one_type_a_caller_that_does_not_care_can_catch', async () => {
    const mismatched = new GitDouble({ remote: GitDouble.naming('git@github.com:someone/else.git') })
    const unreadable = new GitDouble({ remote: GitDouble.naming('/some/local/mirror') })
    const unread = new GitDouble({
      remote: GitDouble.refused("fatal: cannot change to '/repo/checkout': No such file or directory"),
    })
    const notCanonicalised = new GitDouble({
      toplevel: GitDouble.refused('fatal: not a git repository'),
    })
    const unprintable = new GitDouble({ toplevel: GitDouble.printing('') })

    const refusals = await Promise.all(
      [mismatched, unreadable, unread, notCanonicalised, unprintable].map((git) => git.refusedTo(git.confirmed()))
    )

    for (const refusal of refusals) expect(refusal).toBeInstanceOf(WorkspaceFailure)
  })

  it('preparing_never_asks_the_remote_again_because_the_root_was_confirmed_at_the_door', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.calls.some((argv) => argv.includes('get-url'))).toBe(false)
    expect(git.calls[0]).toEqual(['-C', GitDouble.ROOT, 'symbolic-ref', 'refs/remotes/origin/HEAD'])
  })

  it('the_location_it_answers_is_where_the_session_will_actually_run_and_the_root_it_was_cut_from', async () => {
    const { located } = await new GitDouble().prepared()

    expect(located.root).toBe('/repo/checkout')
    expect(located.path).toBe('/repo/checkout/.worktrees/42')
    expect(located.branch).toBe('feat/42')
  })

  it('a_git_that_refuses_travels_out_typed_carrying_what_git_said', async () => {
    const git = new GitDouble({ answer: GitDouble.refused("fatal: 'feat/42' is already checked out") })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain("fatal: 'feat/42' is already checked out")
  })

  it('it_never_reuses_a_directory_it_did_not_create_because_git_is_the_one_that_refuses', async () => {
    const git = new GitDouble({
      answer: GitDouble.refused('fatal: destination path already exists'),
      issueRead: GitDouble.issueAnswer(GitDouble.issueFields({ number: 7 })),
    })

    await expect(git.prepared(GitDouble.issue(7))).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_rule_that_hides_the_state_is_written_before_the_state_itself_in_the_directory_git_actually_reads', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.written.map(([path]) => path)).toEqual([
      GitDouble.EXCLUDE_PATH,
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('the_exclude_rule_it_writes_is_exactly_the_path_of_the_state_file_and_nothing_else', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.written[0][1]).toBe(`${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('a_common_dir_git_answers_as_relative_is_resolved_against_the_root_and_not_kept_as_a_dangling_path', async () => {
    const git = new GitDouble({ commonDir: '.git' })

    await git.prepared()

    expect(git.written[0][0]).toBe(`${GitDouble.ROOT}/.git/info/exclude`)
  })

  it('a_users_existing_exclude_rules_survive_the_seeding_instead_of_being_truncated', async () => {
    const git = new GitDouble({ existingExclude: 'node_modules/\n' })

    await git.prepared()

    expect(git.written[0][1]).toBe(`node_modules/\n${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('an_existing_exclude_file_missing_its_final_newline_does_not_get_the_new_rule_glued_onto_its_last_line', async () => {
    const git = new GitDouble({ existingExclude: 'node_modules/' })

    await git.prepared()

    expect(git.written[0][1]).toBe(`node_modules/\n${SliceSeed.RELATIVE_PATH}\n`)
  })

  it('a_second_seeding_does_not_duplicate_the_rule_because_it_is_already_in_the_shared_exclude_file', async () => {
    const git = new GitDouble({ existingExclude: `node_modules/\n${SliceSeed.RELATIVE_PATH}\n` })

    await git.prepared()

    expect(git.written.map(([path]) => path)).toEqual([
      '/repo/checkout/.worktrees/42/.agent/SLICE.md',
    ])
  })

  it('a_common_dir_it_cannot_resolve_stops_the_seeding_because_the_state_would_be_visible_to_git', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      baseline: git.baseline,
      gh: git.gh(),
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      stderr: (line) => { git.stderr.push(line) },
      run: (argv) => Promise.resolve(GitDouble.declaringNothing(argv) ?? (argv.includes('--git-common-dir')
        ? GitDouble.refused('not a git repository')
        : GitDouble.ok())),
    })

    await expect(git.prepared()).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('the_state_it_seeds_carries_the_cut_it_measured_in_the_worktree_and_not_the_one_it_guessed', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(parseStateSafe(git.written[1][1]).meta.base_sha).toBe(GitDouble.CUT)
  })

  it('the_baseline_is_measured_in_the_worktree_it_just_cut_and_not_in_the_checkout_it_cut_it_from', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.baseline.measured).toEqual([GitDouble.WORKTREE])
  })

  it('the_state_it_seeds_carries_the_baseline_the_program_measured_so_the_agent_reads_it_instead_of_claiming_one', async () => {
    const git = new GitDouble({ baseline: BaselineDouble.answering(BaselineDouble.red()) })

    await git.prepared()

    expect(parseStateSafe(git.written[1][1]).meta.baseline).toEqual({
      outcome: 'rojo', command: 'npm test', summary: 'exit 1 · 2 failed',
    })
  })

  it('the_baseline_it_answers_is_the_same_one_it_sowed_so_the_page_and_the_agent_cannot_disagree', async () => {
    const git = new GitDouble({ baseline: BaselineDouble.answering(BaselineDouble.red()) })

    const { baseline } = await git.prepared()

    expect(baseline.seedField).toEqual(parseStateSafe(git.written[1][1]).meta.baseline)
    expect(baseline.outcome).toBe(BaselineOutcome.RED)
  })

  it('a_baseline_that_is_not_green_is_said_on_the_error_channel_because_starting_on_one_is_a_human_decision', async () => {
    const git = new GitDouble({ baseline: BaselineDouble.answering(BaselineDouble.unverified()) })

    await git.prepared()

    expect(git.stderr.join('')).toContain(BaselineOutcome.UNVERIFIED)
    expect(git.stderr.join('')).toContain('no test command declared')
  })

  it('a_green_baseline_says_nothing_because_a_line_that_is_always_printed_is_a_line_nobody_reads', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.stderr).toEqual([])
  })

  it('the_baseline_is_measured_after_the_cut_because_there_is_no_worktree_to_run_it_in_before', async () => {
    const git = new GitDouble({ answer: GitDouble.refused('fatal: destination path already exists') })

    await git.prepared().catch((cause) => cause)

    expect(git.baseline.measured).toEqual([])
  })

  it('the_state_it_seeds_no_longer_invites_anyone_to_ask_for_changes_by_commenting_on_the_issue', async () => {
    const git = new GitDouble()

    await git.prepared()

    const gates = parseStateSafe(git.written[1][1]).meta.gates
    expect(gates).not.toContain('-REVIEW')
  })

  it('a_remote_base_it_cannot_verify_stops_before_writing_a_state_without_a_cut', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      baseline: git.baseline,
      gh: git.gh(),
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      stderr: (line) => { git.stderr.push(line) },
      run: (argv) => {
        git.calls.push(argv)
        return Promise.resolve(argv.includes('--verify')
          ? GitDouble.refused('fatal: ambiguous argument HEAD')
          : GitDouble.declaringNothing(argv) ?? GitDouble.ok())
      },
    })

    await expect(git.prepared()).rejects.toBeInstanceOf(WorkspaceNotPrepared)
    expect(git.calls.some((argv) => argv.includes('worktree'))).toBe(false)
  })

  it('the_check_that_the_state_stays_hidden_asks_git_with_untracked_files_all_so_a_whole_untracked_directory_cannot_collapse_into_one_line', async () => {
    const git = new GitDouble()

    await git.prepared()

    expect(git.calls.at(-1)).toEqual([
      '-C', GitDouble.WORKTREE, 'status', '--porcelain', '--untracked-files=all',
    ])
  })

  it('a_status_check_that_git_refuses_to_answer_is_not_taken_for_a_clean_tree', async () => {
    const git = new GitDouble({ status: GitDouble.refused('git is not available') })

    await expect(git.prepared()).rejects.toBeInstanceOf(WorkspaceNotPrepared)
  })

  it('undoing_a_location_removes_the_worktree_and_deletes_the_branch_it_was_cut_on', async () => {
    const git = new GitDouble()
    const { located } = await git.prepared()
    git.calls = []

    await git.workspace().undo(located)

    expect(git.calls).toEqual([
      ['-C', GitDouble.ROOT, 'worktree', 'remove', '--force', GitDouble.WORKTREE],
      ['-C', GitDouble.ROOT, 'branch', '-D', 'feat/42'],
    ])
  })

  it('undoing_a_location_runs_both_orders_against_the_root_the_location_carries_and_never_against_the_process_directory', async () => {
    const git = new GitDouble()
    const located = new WorkspaceLocation({ root: '/elsewhere/clone', path: '/elsewhere/clone/.worktrees/42', branch: 'feat/42' })

    await git.workspace().undo(located)

    expect(git.calls).toEqual([
      ['-C', '/elsewhere/clone', 'worktree', 'remove', '--force', '/elsewhere/clone/.worktrees/42'],
      ['-C', '/elsewhere/clone', 'branch', '-D', 'feat/42'],
    ])
  })
})

describe('GitWorkspace undoes what it already created when preparing the ground fails afterward', () => {
  const undone = [
    ['-C', GitDouble.ROOT, 'worktree', 'remove', '--force', GitDouble.WORKTREE],
    ['-C', GitDouble.ROOT, 'branch', '-D', 'feat/42'],
  ]

  it('a_common_dir_git_refuses_to_resolve_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble()
    git.workspace = () => new GitWorkspace({
      baseline: git.baseline,
      gh: git.gh(),
      read: () => Promise.resolve(null),
      write: () => Promise.resolve(),
      stderr: (line) => { git.stderr.push(line) },
      run: (argv) => {
        git.calls.push(argv)
        return Promise.resolve(GitDouble.declaringNothing(argv) ?? (argv.includes('--git-common-dir')
          ? GitDouble.refused('not a git repository')
          : GitDouble.ok()))
      },
    })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(refusal.message).toContain('could not resolve the common git directory')
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_status_check_git_refuses_to_answer_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble({ status: GitDouble.refused('git is not available') })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotPrepared)
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('a_state_file_still_visible_to_git_after_seeding_still_gets_the_worktree_and_branch_undone', async () => {
    const git = new GitDouble({ status: GitDouble.stillVisible() })

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain(SliceSeed.RELATIVE_PATH)
    expect(git.calls.slice(-2)).toEqual(undone)
  })

  it('failed removal rejects without deleting the branch', async () => {
    const removal = new ProcessOutput({
      code: 17, stdout: 'worktree remains', stderr: 'fatal: worktree remove refused',
    })
    const git = new GitDouble({ removal })
    git.answering = (argv) => {
      if (argv.includes('--git-common-dir')) return GitDouble.refused('not a git repository')
      if (argv.includes('remove')) return removal

      return GitDouble.declaringNothing(argv) ?? GitDouble.ok()
    }

    const refusal = await git.prepared().catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotCleaned)
    expect(refusal.message).toContain('could not resolve the common git directory')
    expect(refusal.message).toContain('exit 17')
    expect(refusal.message).toContain('worktree remains')
    expect(refusal.message).toContain('fatal: worktree remove refused')
    expect(git.calls.some((argv) => argv.includes('-D'))).toBe(false)
  })
})

describe('GitWorkspace checks every cleanup operation', () => {
  it('failed branch cleanup rejects with the remaining branch diagnostic', async () => {
    const git = new GitDouble({
      deletion: new ProcessOutput({
        code: 23, stdout: 'branch remains', stderr: "error: branch 'feat/42' not found",
      }),
    })

    const refusal = await git.workspace().undo(GitDouble.located()).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(WorkspaceNotCleaned)
    expect(refusal.message).toContain('exit 23')
    expect(refusal.message).toContain('branch remains')
    expect(refusal.message).toContain("error: branch 'feat/42' not found")
  })

  it('an_undo_git_carries_out_says_nothing', async () => {
    const git = new GitDouble()

    await git.workspace().undo(GitDouble.located())

    expect(git.stderr).toEqual([])
  })
})

class SeedFixture {
  static readonly CUT = 'a1b2c3d'
  static readonly #made: string[] = []

  static text(): string {
    return SliceSeed.textFor({
      slice: SeedFixture.slice(), branch: 'feat/42', base: 'main', cut: SeedFixture.CUT,
      baseline: BaselineDouble.green(),
    })
  }

  static slice() {
    return Object.freeze({ ...mapGhIssue(GitDouble.issueFields()), epic: 'the milestone' })
  }

  static sownWorktree(): string {
    const worktree = mkdtempSync(join(tmpdir(), 'ct-slice-'))
    SeedFixture.#made.push(worktree)
    const state = join(worktree, SliceSeed.RELATIVE_PATH)
    mkdirSync(dirname(state), { recursive: true })
    writeFileSync(state, SeedFixture.text())

    return worktree
  }

  static sweep(): void {
    for (const worktree of SeedFixture.#made.splice(0)) {
      rmSync(worktree, { recursive: true, force: true })
    }
  }
}

describe('SliceSeed', () => {
  it('the seed preserves the issue gates signal and measured baseline without inventing plan', () => {
    const raw = GitDouble.issueFields()
    const slice = Object.freeze({ ...mapGhIssue(raw), epic: raw.milestone?.title ?? NO_MILESTONE_KEY })
    const baseline = BaselineDouble.red()
    const actual = parseStateSafe(SliceSeed.textFor({
      slice, branch: 'feat/42', base: 'main', cut: SeedFixture.CUT, baseline,
    })).meta
    const expected = parseStateSafe(buildStateSeed(slice, {
      branch: 'feat/42', base: 'main', baseSha: SeedFixture.CUT, baseline,
    })).meta

    expect(actual).toEqual(expected)
    expect(actual.gates).toContain('apply')
    expect(actual.gates).not.toContain('plan')
    expect(actual.senal).toBe('seed_written_total')
    expect(actual.baseline).toEqual(baseline.seedField)
  })

  it('a loose issue uses the same authoritative seed', async () => {
    const fields = GitDouble.issueFields({ milestone: null })
    const baseline = BaselineDouble.green()
    const git = new GitDouble({
      issueRead: GitDouble.issueAnswer(fields), baseline: BaselineDouble.answering(baseline),
    })

    await git.prepared()

    const seeded = parseStateSafe(git.written.at(-1)![1]).meta
    const mapped = Object.freeze({ ...mapGhIssue(fields), epic: NO_MILESTONE_KEY })
    expect(seeded).toEqual(parseStateSafe(buildStateSeed(mapped, {
      branch: 'feat/42', base: 'main', baseSha: GitDouble.CUT, baseline,
    })).meta)
    expect(git.ghCalls).toEqual([[
      'issue', 'view', '42', '--repo', 'owner/name', '--json', 'number,title,body,labels,milestone',
    ]])
  })

  it('it_says_the_agent_is_the_one_that_writes_the_plan_and_not_the_coordinator', () => {
    expect(parseStateSafe(SeedFixture.text()).meta.role).toMatch(/^slice-agent/)
  })

  it('the_cut_travels_as_both_the_base_and_the_last_commit_because_no_work_has_landed_yet', () => {
    const { meta } = parseStateSafe(SeedFixture.text())

    expect(meta.base_sha).toBe(SeedFixture.CUT)
    expect(meta.last_commit).toBe(SeedFixture.CUT)
  })

  it('it_names_the_issue_so_an_agent_that_rehydrates_knows_what_it_is_working_on', () => {
    const { meta } = parseStateSafe(SeedFixture.text())

    expect(meta.github_issue).toBe(42)
    expect(meta.branch).toBe('feat/42')
    expect(meta.base).toBe('main')
  })

  it('the_exclusion_it_asks_git_for_is_the_very_file_it_writes', () => {
    expect(SliceSeed.EXCLUDE_RULE).toBe(SliceSeed.RELATIVE_PATH)
  })

  it('the_exclude_file_hangs_off_the_git_dir_and_not_off_the_worktree_because_dot_git_is_a_file_there', () => {
    expect(SliceSeed.EXCLUDE_PATH.startsWith('.git/')).toBe(false)
    expect(SliceSeed.EXCLUDE_PATH).toBe('info/exclude')
  })
})

class PluginSeed {
  static readonly NOT_OURS = Object.freeze({
    epic: 'the plan of one issue belongs to no milestone: the epic is groomed, this is not',
    senal: 'an observability signal is declared by an implementation slice, not by writing a plan',
    gates: 'the human gates close on the pull request of an implementation, and no plan opens one',
    e2e: 'a plan walks no end-to-end run: it is written and committed, nothing is exercised',
    tasks: 'the tasks are what the plan itself declares, so seeding them would prejudge it',
    verify: 'the verification of a plan is --check-plan, which the errand already names',
  })

  static keys(): string[] {
    return Object.keys(parseStateSafe(buildStateSeed(
      { name: 'a slice', issue: '#42', ac: ['does the thing'] },
      { branch: 'feat/42', base: 'main', baseSha: SeedFixture.CUT }
    )).meta)
  }

  static expectedOfUs(): string[] {
    return PluginSeed.keys().filter((key) => !(key in PluginSeed.NOT_OURS))
  }
}

describe('what the backend sows is read back by the plugin that has to read it', () => {
  afterEach(() => {
    SeedFixture.sweep()
  })

  it('the_plugins_own_reader_parses_the_seed_without_an_error_instead_of_the_two_halves_drifting', () => {
    const worktree = SeedFixture.sownWorktree()

    const read = parseStateSafe(readFileSync(join(worktree, SliceSeed.RELATIVE_PATH), 'utf8'))

    expect(read.error).toBe(null)
  })

  it('the_cut_and_the_absence_of_a_block_reach_the_plugin_as_data_and_not_as_unparsed_prose', () => {
    const worktree = SeedFixture.sownWorktree()

    const read = parseStateSafe(readFileSync(join(worktree, SliceSeed.RELATIVE_PATH), 'utf8'))

    expect(read.meta.last_commit).toBe(SeedFixture.CUT)
    expect(read.meta.blocked).toBe(null)
  })

  it('a_branch_carrying_a_quote_is_serialised_instead_of_breaking_the_yaml_the_plugin_has_to_parse', () => {
    const text = SliceSeed.textFor({
      slice: SeedFixture.slice(), branch: 'feat/42-"quoted"', base: 'main', cut: SeedFixture.CUT,
      baseline: BaselineDouble.green(),
    })

    const read = parseStateSafe(text)

    expect(read.error).toBe(null)
    expect(read.meta.branch).toBe('feat/42-"quoted"')
  })

  it('every_field_the_plugins_own_seed_carries_is_carried_here_too_except_the_ones_declared_not_to_apply', () => {
    const ours = Object.keys(parseStateSafe(SeedFixture.text()).meta)

    expect(PluginSeed.expectedOfUs().filter((key) => !ours.includes(key))).toEqual([])
  })

  it('a_worktree_that_carries_the_seed_is_recognised_by_the_plugin_as_a_slice_and_not_as_a_coordinator', () => {
    const worktree = SeedFixture.sownWorktree()

    expect(resolveStatePath(worktree).kind).toBe('slice')
  })
})

class SurveyDouble extends GitDouble {
  static readonly PORCELAIN = [
    'worktree /repo/checkout',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/main',
    '',
    'worktree /repo/elsewhere/11',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/feat/11',
    'prunable gitdir file points to non-existent location',
    '',
    'worktree /repo/checkout/.worktrees/13',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/hotfix',
    'locked manual hold',
    '',
    'worktree /repo/checkout/.worktrees/42',
    'HEAD 9a8b7c6d5e4f30211f0e9d8c7b6a5948372615ff',
    'branch refs/heads/feat/42',
    '',
    'worktree /repo/checkout/.worktrees/7',
    'HEAD 4f2c1ab9d3e5c7081b6a0f2d9e4c8b1a5d3f7e60',
    'branch refs/heads/feat/7',
    '',
    'worktree /repo/checkout/.worktrees/9',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'detached',
    '',
    'worktree /repo/checkout/.worktrees/notes',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/feat/notes',
    '',
    'worktree /repo/checkout/.worktrees/0',
    'HEAD 368980b38f86b03e0f228da7388d33626c521c48',
    'branch refs/heads/feat/0',
    '',
    '',
  ].join('\n')

  listed: ProcessOutput

  constructor({ listed, remote }: { listed?: ProcessOutput, remote?: ProcessOutput } = {}) {
    super({ remote })
    this.listed = listed ?? SurveyDouble.listing()
  }

  answering(argv: string[]): ProcessOutput {
    if (argv.includes('list')) return this.listed

    return super.answering(argv)
  }

  surveyed(): Promise<WorkspaceSurvey> {
    return this.workspace().survey(GitDouble.CHECKOUT)
  }

  refusal() {
    return this.surveyed().catch((cause) => cause)
  }

  numbers(): Promise<number[]> {
    return this.surveyed().then((survey) => survey.prepared.map((prepared) => prepared.issueNumber))
  }

  static listing(stdout: string = SurveyDouble.PORCELAIN): ProcessOutput {
    return GitDouble.printing(stdout)
  }
}

describe('GitWorkspace surveying the checkout', () => {
  it('the_checkout_is_asked_for_its_worktrees_in_the_form_that_is_a_contract_and_not_a_display', async () => {
    const git = new SurveyDouble()

    await git.surveyed()

    expect(git.asking('list')).toEqual(['-C', '/repo/checkout', 'worktree', 'list', '--porcelain'])
  })

  it('every_worktree_the_backend_prepared_comes_back_with_the_issue_it_belongs_to_and_where_it_sits', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.issueNumber)).toEqual([42, 7])
    expect(surveyed.prepared.map((prepared) => prepared.located.path)).toEqual([
      '/repo/checkout/.worktrees/42',
      '/repo/checkout/.worktrees/7',
    ])
    expect(surveyed.prepared.map((prepared) => prepared.located.branch)).toEqual(['feat/42', 'feat/7'])
  })

  it('the_checkout_itself_is_not_a_prepared_workspace_so_the_sweep_never_asks_to_collect_the_repository', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.path)).not.toContain('/repo/checkout')
  })

  it('a_worktree_on_a_branch_shaped_like_ours_that_sits_somewhere_else_is_not_ours_because_the_layout_names_it', async () => {
    expect(await new SurveyDouble().numbers()).not.toContain(11)
  })

  it('a_detached_worktree_under_our_directory_is_left_alone_instead_of_being_taken_for_the_branch_it_is_not', async () => {
    expect(await new SurveyDouble().numbers()).not.toContain(9)
  })

  it('a_worktree_under_our_directory_on_a_branch_that_is_not_the_one_we_cut_is_left_alone', async () => {
    expect(await new SurveyDouble().numbers()).not.toContain(13)
  })

  it('a_directory_under_the_worktrees_that_is_not_an_issue_number_is_not_an_issue_however_well_its_branch_reads', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.path))
      .not.toContain('/repo/checkout/.worktrees/notes')
  })

  it('the_repository_the_survey_names_is_the_one_the_origin_declares_and_never_one_the_backend_assumed', async () => {
    const git = new SurveyDouble()

    const surveyed = await git.surveyed()

    expect(git.asking('get-url')).toEqual(['-C', '/repo/checkout', 'remote', 'get-url', 'origin'])
    expect(surveyed.repository).toBeInstanceOf(RepositoryName)
    expect(surveyed.repository.text).toBe('owner/name')
  })

  it('a_git_that_cannot_list_the_worktrees_travels_out_typed_carrying_what_git_said', async () => {
    const refusal = await new SurveyDouble({
      listed: SurveyDouble.refused('fatal: not a git repository (or any of the parent directories): .git'),
    }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotRead)
    expect(refusal.message).toContain('fatal: not a git repository')
  })

  it('an_origin_nobody_can_read_a_repository_out_of_stops_the_survey_instead_of_naming_one_we_invented', async () => {
    const refusal = await new SurveyDouble({ remote: SurveyDouble.naming('/some/local/mirror') }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('/some/local/mirror')
  })

  it('an_answer_that_is_not_porcelain_at_all_is_our_broken_contract_with_git_and_not_a_checkout_without_worktrees', async () => {
    const refusal = await new SurveyDouble({
      listed: SurveyDouble.listing('/repo/checkout          368980b [main]\n'),
    }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('"/repo/checkout          368980b [main]"')
  })

  it('a_git_that_printed_nothing_is_not_a_checkout_that_holds_no_worktrees', async () => {
    const refusal = await new SurveyDouble({ listed: SurveyDouble.listing('') }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('always lists at least itself')
  })

  it('the_two_ways_a_survey_can_fail_are_told_apart_and_still_share_the_family_a_caller_can_catch', async () => {
    const refused = await new SurveyDouble({ listed: SurveyDouble.refused('fatal: no worktrees') }).refusal()
    const unreadable = await new SurveyDouble({ listed: SurveyDouble.listing('nonsense\n') }).refusal()

    expect(refused).toBeInstanceOf(WorkspaceNotRead)
    expect(unreadable).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refused).not.toBeInstanceOf(WorkspaceNotUnderstood)
    expect(unreadable).not.toBeInstanceOf(WorkspaceNotRead)
    expect(refused).toBeInstanceOf(WorkspaceFailure)
    expect(unreadable).toBeInstanceOf(WorkspaceFailure)
  })

  it('a_directory_numbered_zero_is_kept_out_by_the_guard_because_issues_are_numbered_from_one', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.path))
      .not.toContain('/repo/checkout/.worktrees/0')
  })

  it('an_origin_that_reads_as_owner_slash_name_but_is_not_one_never_becomes_an_argument_of_the_harvest', async () => {
    const refusal = await new SurveyDouble({
      remote: SurveyDouble.naming('git@github.com:ow ner/na me.git'),
    }).refusal()

    expect(refusal).toBeInstanceOf(WorkspaceNotUnderstood)
    expect(refusal.message).toContain('ow ner/na me')
  })

  it('every_prepared_workspace_the_survey_answers_carries_the_root_it_was_surveyed_from', async () => {
    const surveyed = await new SurveyDouble().surveyed()

    expect(surveyed.prepared.map((prepared) => prepared.located.root)).toEqual(['/repo/checkout', '/repo/checkout'])
  })
})
