import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BranchReconciliation } from '../scripts/branch-reconciliation.js'
import { ReconcileOutcome } from '../scripts/reconcile-outcome.js'
import { rmSyncBestEffort } from './fixtures/cleanup.js'

class UnreachableRemoteRepoMother {
  static port(dir) {
    return (argv) => {
      const r = spawnSync('git', argv, { cwd: dir, encoding: 'utf8' })
      return { code: r.status, stdout: r.stdout ?? '' }
    }
  }

  static aBranchWhoseBaseMovedBehindAnUnreachableRemote() {
    const dir = mkdtempSync(join(tmpdir(), 'ct-recon-sin-remoto-'))
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    git('init', '-q', '-b', 'main', '.')
    git('config', 'user.email', 'test@test')
    git('config', 'user.name', 'test')
    writeFileSync(join(dir, 'shared.txt'), 'original line\n')
    git('add', '-A')
    git('commit', '-qm', 'base')

    const origin = mkdtempSync(join(tmpdir(), 'ct-recon-sin-remoto-origin-'))
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin], { encoding: 'utf8' })
    git('remote', 'add', 'origin', origin)
    git('push', '-q', 'origin', 'main')
    git('switch', '-q', '-c', 'feature')

    const clone = mkdtempSync(join(tmpdir(), 'ct-recon-sin-remoto-clone-'))
    execFileSync('git', ['clone', '-q', origin, clone], { encoding: 'utf8' })
    const gClone = (...a) => execFileSync('git', a, { cwd: clone, encoding: 'utf8' })
    gClone('config', 'user.email', 'base@test')
    gClone('config', 'user.name', 'base')
    writeFileSync(join(clone, 'shared.txt'), 'the base line\n')
    gClone('add', '-A')
    gClone('commit', '-qm', 'the base moves on')
    gClone('push', '-q', 'origin', 'main')

    rmSyncBestEffort(origin)
    rmSyncBestEffort(clone)
    return dir
  }
}

describe('BranchReconciliation, when the base cannot be read', () => {
  it('a_base_one_commit_ahead_behind_an_unreachable_remote_is_never_answered_as_up_to_date', () => {
    const dir = UnreachableRemoteRepoMother.aBranchWhoseBaseMovedBehindAnUnreachableRemote()
    try {
      const reconciliation = new BranchReconciliation({ git: UnreachableRemoteRepoMother.port(dir) })
      const staleCount = execFileSync('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: dir, encoding: 'utf8' }).trim()
      expect(staleCount).toBe('0')

      let outcome = null
      try {
        outcome = reconciliation.merge({ baseBranch: 'main' }).outcome
      } catch (e) {
        outcome = e.message
      }

      expect(outcome).not.toBe(ReconcileOutcome.UP_TO_DATE)
      expect(outcome).toMatch(/git fetch origin main failed/)
    } finally {
      rmSyncBestEffort(dir)
    }
  })
})
