import { describe, it, expect } from 'vitest'
import { ProbedToolSessions } from '../../src/infrastructure/probed-tool-sessions.js'
import { SessionState } from '../../src/domain/value-objects/tool-session.js'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.js'

class ClientsDouble {
  static #BINS = ['gh', 'acli', 'ssh', 'gcloud']

  constructor(answers = {}) {
    this.answers = answers
    this.calls = []
  }

  static allHappy() {
    return new ClientsDouble()
      .saying('gh', new ProcessOutput({ code: 0, stdout: '', stderr: '' }))
      .saying('acli', new ProcessOutput({ code: 0, stdout: '', stderr: '' }))
      .saying('ssh', new ProcessOutput({
        code: 1, stdout: '',
        stderr: "Hi jjponz! You've successfully authenticated, but GitHub does not provide shell access.\n",
      }))
      .saying('gcloud', new ProcessOutput({ code: 0, stdout: 'jponzvan@mercadona.es\n', stderr: '' }))
  }

  saying(bin, output) {
    this.answers = { ...this.answers, [bin]: output }
    return this
  }

  clients() {
    const built = {}
    for (const bin of ClientsDouble.#BINS) built[bin] = this.#clientFor(bin)

    return built
  }

  #clientFor(bin) {
    return {
      run: async (argv, options) => {
        if (!(bin in this.answers)) {
          throw new Error(`ClientsDouble: nobody wrote an answer for "${bin}"`)
        }
        this.calls.push({ bin, argv, options })

        return this.answers[bin]
      },
    }
  }

  sessions(lookUp = LookUpDouble.installedEverywhere()) {
    return new ProbedToolSessions({ clients: this.clients(), lookUp })
  }
}

class LookUpDouble {
  static installedEverywhere() {
    return LookUpDouble.#recording(() => true)
  }

  static missing(bin) {
    return LookUpDouble.#recording((candidate) => candidate !== bin)
  }

  static #recording(isInstalled) {
    const calls = []
    const lookUp = (bin) => {
      calls.push(bin)
      return isInstalled(bin) ? `/usr/local/bin/${bin}` : null
    }
    lookUp.calls = calls

    return lookUp
  }
}

describe('ProbedToolSessions', () => {
  it('every_probe_is_sent_the_literal_argv_the_table_declares', async () => {
    const clients = ClientsDouble.allHappy()

    await clients.sessions().all()

    expect(clients.calls).toEqual([
      { bin: 'gh', argv: ['auth', 'status'], options: { safeToRepeat: true } },
      { bin: 'acli', argv: ['jira', 'auth', 'status'], options: { safeToRepeat: true } },
      {
        bin: 'ssh',
        argv: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-T', 'git@github.com'],
        options: { safeToRepeat: true },
      },
      {
        bin: 'gcloud',
        argv: ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'],
        options: { safeToRepeat: true },
      },
    ])
  })

  it('every_rows_bin_is_looked_up_against_PATH_in_table_order', async () => {
    const lookUp = LookUpDouble.installedEverywhere()

    await ClientsDouble.allHappy().sessions(lookUp).all()

    expect(lookUp.calls).toEqual(['gh', 'acli', 'claude', 'git', 'bq'])
  })

  it('git_is_ready_when_ssh_says_it_authenticated_even_though_it_exits_1', async () => {
    const sessions = await ClientsDouble.allHappy().sessions().all()

    const git = sessions.find((session) => session.tool === 'git')

    expect(git.state).toBe(SessionState.READY)
    expect(git.fix).toBeNull()
  })

  it('bq_is_missing_when_gcloud_lists_no_active_account', async () => {
    const clients = ClientsDouble.allHappy().saying('gcloud', new ProcessOutput({ code: 0, stdout: '\n', stderr: '' }))

    const sessions = await clients.sessions().all()

    const bq = sessions.find((session) => session.tool === 'bq')
    expect(bq.state).toBe(SessionState.MISSING)
    expect(bq.fix).toBe('gcloud auth login && gcloud auth application-default login')
  })

  it('bq_is_ready_when_gcloud_prints_an_active_account', async () => {
    const sessions = await ClientsDouble.allHappy().sessions().all()

    const bq = sessions.find((session) => session.tool === 'bq')

    expect(bq.state).toBe(SessionState.READY)
    expect(bq.fix).toBeNull()
  })

  it('claude_is_always_unknown_and_says_where_to_log_in', async () => {
    const sessions = await ClientsDouble.allHappy().sessions().all()

    const claude = sessions.find((session) => session.tool === 'claude')

    expect(claude.state).toBe(SessionState.UNKNOWN)
    expect(claude.fix).toBe('claude, then /login — not observable from this process')
  })

  it('claude_is_unknown_even_when_its_binary_is_missing_because_its_login_is_never_observable', async () => {
    const sessions = await ClientsDouble.allHappy().sessions(LookUpDouble.missing('claude')).all()

    const claude = sessions.find((session) => session.tool === 'claude')

    expect(claude.installed).toBe(false)
    expect(claude.state).toBe(SessionState.UNKNOWN)
    expect(claude.fix).toBe('claude, then /login — not observable from this process')
  })

  it('a_tool_missing_from_PATH_is_not_installed_and_is_never_probed', async () => {
    const clients = new ClientsDouble()
      .saying('acli', new ProcessOutput({ code: 0, stdout: '', stderr: '' }))
      .saying('ssh', new ProcessOutput({
        code: 1, stdout: '',
        stderr: "Hi jjponz! You've successfully authenticated, but GitHub does not provide shell access.\n",
      }))
      .saying('gcloud', new ProcessOutput({ code: 0, stdout: 'jponzvan@mercadona.es\n', stderr: '' }))

    const sessions = await clients.sessions(LookUpDouble.missing('gh')).all()

    const gh = sessions.find((session) => session.tool === 'gh')
    expect(gh.installed).toBe(false)
    expect(gh.state).toBe(SessionState.MISSING)
  })

  it('a_ready_tool_carries_no_fix', async () => {
    const sessions = await ClientsDouble.allHappy().sessions().all()

    const gh = sessions.find((session) => session.tool === 'gh')

    expect(gh.state).toBe(SessionState.READY)
    expect(gh.fix).toBeNull()
  })

  it('gh_that_is_not_logged_in_is_missing_and_says_how_to_log_in', async () => {
    const clients = ClientsDouble.allHappy().saying('gh', new ProcessOutput({
      code: 1, stdout: '',
      stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login',
    }))

    const sessions = await clients.sessions().all()

    const gh = sessions.find((session) => session.tool === 'gh')
    expect(gh.state).toBe(SessionState.MISSING)
    expect(gh.fix).toBe('gh auth login')
  })

  it('acli_that_is_not_authenticated_is_missing_and_says_how_to_authenticate', async () => {
    const clients = ClientsDouble.allHappy().saying('acli', new ProcessOutput({
      code: 1, stdout: '',
      stderr: "✗ Error: unauthorized: use 'acli jira auth login' to authenticate",
    }))

    const sessions = await clients.sessions().all()

    const acli = sessions.find((session) => session.tool === 'acli')
    expect(acli.state).toBe(SessionState.MISSING)
    expect(acli.fix).toBe('acli jira auth login')
  })

  it('git_whose_key_github_refuses_is_missing_and_says_to_add_one_even_though_it_exits_255', async () => {
    const clients = ClientsDouble.allHappy().saying('ssh', new ProcessOutput({
      code: 255, stdout: '',
      stderr: 'git@github.com: Permission denied (publickey).\n',
    }))

    const sessions = await clients.sessions().all()

    const git = sessions.find((session) => session.tool === 'git')
    expect(git.state).toBe(SessionState.MISSING)
    expect(git.fix).toBe('add an SSH key to your GitHub account')
  })
})
