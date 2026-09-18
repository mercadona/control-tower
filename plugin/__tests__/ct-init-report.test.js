// ct-init.sh --json (slice 4) and the four drift classes (slice 5).
//
// A NEW file on purpose — same reason as ct-init-conventions-seed.test.js:
// __tests__/ct-init.test.js carries a deliberately red test
// (SLICES_PRISTINE_HASHES) that nothing here should brush against.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')
const initScriptSrc = readFileSync(script, 'utf8')
const CONTRACT_VERSION = Number(initScriptSrc.match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)[1])

const ARTIFACT_IDS = [
  'state-md', 'conventions-md', 'spec-template', 'gitignore',
  'scope-gate-workflow', 'scope-gate-bundle', 'scope-gate-package',
  'claude-settings', 'agents-md', 'slices-contract', 'loop-section', 'e2e-howto',
]

function mkTarget() {
  return mkdtempSync(join(tmpdir(), 'ct-report-'))
}

function runJson(dir, extraArgs = []) {
  const out = execFileSync('bash', [script, dir, '--json', ...extraArgs], { encoding: 'utf8' })
  return JSON.parse(out)
}

function byId(report) {
  return Object.fromEntries(report.artifacts.map((a) => [a.id, a]))
}

describe('ct-init.sh --json', () => {
  it('prints exactly one line of JSON on stdout, nothing else', () => {
    const dir = mkTarget()
    const out = execFileSync('bash', [script, dir, '--json'], { encoding: 'utf8' })
    const lines = out.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    expect(() => JSON.parse(lines[0])).not.toThrow()
    rmSync(dir, { recursive: true, force: true })
  })

  it('the report names ctInitVersion, configDir and exitCode, with every artifact in the fixed order', () => {
    const dir = mkTarget()
    const report = runJson(dir)
    expect(typeof report.ctInitVersion).toBe('string')
    expect(report.ctInitVersion.length).toBeGreaterThan(0)
    expect(typeof report.configDir).toBe('string')
    expect(report.exitCode).toBe(0)
    expect(report.artifacts.map((a) => a.id)).toEqual(ARTIFACT_IDS)
    for (const artifact of report.artifacts) {
      expect(typeof artifact.path).toBe('string')
      expect(artifact.path.startsWith('/')).toBe(false)
      expect(['created', 'already-present', 'drifted', 'refused']).toContain(artifact.status)
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('a fresh directory reports every artifact as created', () => {
    const dir = mkTarget()
    const report = runJson(dir)
    for (const artifact of report.artifacts) expect(artifact.status).toBe('created')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a second run on the same directory reports every artifact as already-present', () => {
    const dir = mkTarget()
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const report = runJson(dir)
    for (const artifact of report.artifacts) expect(artifact.status).toBe('already-present')
    rmSync(dir, { recursive: true, force: true })
  })

  it('the same inputs produce the same bytes: no timestamp and no absolute target path leak into the report', () => {
    const dirA = mkTarget()
    const dirB = mkTarget()
    const reportA = runJson(dirA)
    const reportB = runJson(dirB)
    // Strip nothing: both reports describe an identical fresh bootstrap of two
    // different absolute paths, and the report itself must not distinguish them.
    expect(reportA).toEqual(reportB)
    rmSync(dirA, { recursive: true, force: true })
    rmSync(dirB, { recursive: true, force: true })
  })

  it('--json emits no prose on stdout even when a warning fires on stderr', () => {
    const dir = mkTarget()
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    // Force a stderr warning: the scope-gate bundle no longer matches this
    // release's bytes.
    appendFileSync(join(dir, '.github', 'ct', 'scope-check.js'), '\n// tampered\n')
    const result = execFileSync('bash', [script, dir, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    const lines = result.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    expect(() => JSON.parse(lines[0])).not.toThrow()
    rmSync(dir, { recursive: true, force: true })
  })
})
