import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { CmuxWorkspaceQuery, findWorkspaceByCwd } from '../../../plugin/scripts/cmux.js'
import { WorktreePlans } from '../../src/infrastructure/worktree-plans.js'
import { CmuxPlanAgents } from '../../src/infrastructure/cmux-plan-agents.js'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.js'
import { PreparedWorkspace } from '../../src/domain/value-objects/prepared-workspace.js'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.js'
import { UserStoryKey } from '../../src/domain/value-objects/user-story-key.js'
import { WorkspaceLocation } from '../../src/domain/value-objects/workspace-location.js'
import { WorkspaceSurvey } from '../../src/domain/value-objects/workspace-survey.js'

class ACmuxThatAnswers {
  static SCRIPT = [
    '#!/bin/sh',
    'if [ "$1" = "list-windows" ]; then echo \'[{"id":"w1"}]\'; exit 0; fi',
    'if [ "$1" = "workspace" ]; then printf %s "$CMUX_FAKE_WORKSPACES"; exit 0; fi',
    'exit 1',
  ].join('\n')

  constructor() {
    this.directory = mkdtempSync(join(tmpdir(), 'ct-cmux-contract-'))
    const binary = join(this.directory, 'cmux')
    writeFileSync(binary, `${ACmuxThatAnswers.SCRIPT}\n`)
    chmodSync(binary, 0o755)
    this.path = process.env.PATH
    process.env.PATH = `${this.directory}:${this.path}`
  }

  saying(workspaces) {
    process.env.CMUX_FAKE_WORKSPACES = JSON.stringify({ workspaces })

    return this
  }

  stop() {
    process.env.PATH = this.path
    delete process.env.CMUX_FAKE_WORKSPACES
    rmSync(this.directory, { recursive: true, force: true })
  }
}

class TheSameQuestion {
  static ROOT = '/repos/one'
  static WORKTREE = `${TheSameQuestion.ROOT}/.worktrees/33`
  static REPOSITORY = new RepositoryName('owner/repo')

  static TITLE = CmuxPlanAgents.nameFor({
    story: new UserStoryKey('ABC-123'),
    repository: TheSameQuestion.REPOSITORY,
    issueNumber: 33,
  })

  static askedOfThePlugin() {
    return findWorkspaceByCwd(TheSameQuestion.WORKTREE, { requireComplete: true })
  }

  static askedOfTheBackend() {
    return new WorktreePlans({
      checkouts: { known: () => [new CheckoutRoot(TheSameQuestion.ROOT)] },
      survey: () => new WorkspaceSurvey({
        repository: TheSameQuestion.REPOSITORY,
        prepared: [new PreparedWorkspace({
          issueNumber: 33,
          located: new WorkspaceLocation({
            root: TheSameQuestion.ROOT,
            path: TheSameQuestion.WORKTREE,
            branch: 'feat/33',
          }),
        })],
      }),
      sessions: () => CmuxWorkspaceQuery.ask({ requireComplete: true }),
      story: () => null,
      realpathOf: (path) => path,
      stderr: vi.fn(),
    }).inFlight()
  }
}

describe('the backend and the plugin answer the same question about a directory the same way', () => {
  let cmux

  beforeEach(() => {
    cmux = new ACmuxThatAnswers()
  })

  afterEach(() => {
    cmux.stop()
  })

  it('a_session_sitting_in_the_worktree_is_found_by_both_and_named_by_the_same_handle', async () => {
    cmux.saying([{
      custom_title: TheSameQuestion.TITLE,
      current_directory: TheSameQuestion.WORKTREE,
      ref: 'workspace:97',
    }])

    const [watch] = (await TheSameQuestion.askedOfTheBackend()).watches

    expect(TheSameQuestion.askedOfThePlugin()).toEqual({ consultado: true, ref: 'workspace:97' })
    expect(watch.agent).toBe('workspace:97')
  })

  it('when_no_session_shows_its_directory_neither_of_them_says_there_is_none', async () => {
    cmux.saying([{ custom_title: TheSameQuestion.TITLE, ref: 'workspace:97' }])

    expect(TheSameQuestion.askedOfThePlugin()).toEqual({ consultado: false, ref: null })
    expect((await TheSameQuestion.askedOfTheBackend()).wereListed).toBe(false)
  })

  it('a_session_that_shows_a_different_directory_is_answered_as_absent_by_both', async () => {
    cmux.saying([{
      custom_title: TheSameQuestion.TITLE,
      current_directory: '/repos/one/.worktrees/41',
      ref: 'workspace:97',
    }])

    expect(TheSameQuestion.askedOfThePlugin()).toEqual({ consultado: true, ref: null })
    expect((await TheSameQuestion.askedOfTheBackend()).watches).toEqual([])
  })
})
