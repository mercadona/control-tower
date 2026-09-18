import { afterEach, describe, expect, it } from 'vitest'
import { RealStepRepo } from './fixtures/real-step.js'
import { CtStepCommit } from '../scripts/ct-step-commit.js'

describe('ct-step commits against actual Git objects', () => {
  afterEach(() => RealStepRepo.clean())

  it('only the approved index travels and Git emits the trailer the reader recognises', () => {
    const repo = RealStepRepo.prepared()
    repo.approveWork()
    repo.write('unrelated.txt', 'unreviewed work\n')
    expect(repo.run('commit').status).toBe(0)
    const paths = repo.git('show', '--format=', '--name-only', 'HEAD').trim().split('\n')
    expect(paths).toEqual(['docs/superpowers/metrics/issue-7.jsonl', 'docs/superpowers/verdicts/issue-7-task-1.json', 'work with spaces.txt'])
    for (const path of ['docs/superpowers/metrics/issue-7.jsonl', 'docs/superpowers/verdicts/issue-7-task-1.json']) {
      expect(repo.git('show', `HEAD:${path}`)).toBe(repo.read(path))
    }
    expect(JSON.parse(repo.read('docs/superpowers/verdicts/issue-7-task-1.json')).verdict.ruling).toBe('PASS')
    const trailers = repo.git('log', `--format=${CtStepCommit.TRAILER_FORMAT}`, `${repo.base}..HEAD`).trimEnd().split('\n')
    expect(trailers).toEqual(['ct-step'])
    expect(CtStepCommit.wroteAllOf(trailers)).toBe(true)
    expect(repo.read('unrelated.txt')).toBe('unreviewed work\n')
  })

  it('a changed real index is refused and read-tree restores only the approved staged version', () => {
    const repo = RealStepRepo.prepared()
    repo.approveWork()
    const seal = JSON.parse(repo.read('.agent/run-7.json')).sealedTree
    repo.write(RealStepRepo.WORK, 'unreviewed replacement\n')
    repo.git('add', '--', RealStepRepo.WORK)
    const refused = repo.run('commit')
    expect(refused.status).toBe(8)
    expect(refused.stderr).toContain('the index is no longer the one the judge approved')
    expect(repo.git('rev-parse', 'HEAD').trim()).toBe(repo.base)
    repo.git('read-tree', seal)
    expect(repo.run('commit').status).toBe(0)
    expect(repo.git('show', `HEAD:${RealStepRepo.WORK}`)).toBe('approved work\n')
    expect(repo.read(RealStepRepo.WORK)).toBe('unreviewed replacement\n')
  })

  it('multiple trailer values are comma separated and an unmarked commit makes the history mixed', () => {
    const repo = RealStepRepo.prepared()
    repo.git('commit', '--allow-empty', '-qm', 'owned\n\nCommitted-By: ct-step\nCommitted-By: reviewer')
    expect(repo.git('log', '-1', `--format=${CtStepCommit.TRAILER_FORMAT}`)).toBe('ct-step,reviewer\n')
    repo.git('commit', '--allow-empty', '-qm', 'manual work')
    const trailers = repo.git('log', `--format=${CtStepCommit.TRAILER_FORMAT}`, `${repo.base}..HEAD`).trimEnd().split('\n')
    expect(trailers).toEqual(['', 'ct-step,reviewer'])
    expect(CtStepCommit.wroteAllOf(trailers)).toBe(false)
  })

  it('the actual run count excludes the earlier plan commit and commits brought by a base merge', () => {
    const repo = RealStepRepo.prepared()
    repo.write('plan-note.md', 'planning evidence\n')
    repo.git('add', 'plan-note.md')
    repo.git('commit', '-qm', 'plan committed before the run')
    repo.approveWork()
    expect(repo.run('commit').status).toBe(0)
    const run = JSON.parse(repo.read('.agent/run-7.json'))
    repo.git('switch', '-q', 'main')
    repo.write('base-change.txt', 'foreign work\n')
    repo.git('add', 'base-change.txt')
    repo.git('commit', '-qm', 'the base advances')
    repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD')
    repo.git('switch', '-q', 'feat/7')
    repo.git('merge', '-q', '--no-edit', 'origin/main')
    expect(repo.git('rev-list', '--count', '--no-merges', `${run.baseSha}..HEAD`, '^origin/main').trim()).toBe('1')
    expect(repo.git('rev-list', '--count', '--no-merges', `${repo.base}..HEAD`, '^origin/main').trim()).toBe('2')
    const next = repo.run('next')
    expect(next.status).toBe(0)
    expect(next.stderr).not.toContain('do not count the same')
  })
})
