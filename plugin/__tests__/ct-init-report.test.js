// ct-init.sh --json (slice 4) and the four drift classes (slice 5).
//
// A NEW file on purpose — same reason as ct-init-conventions-seed.test.js:
// __tests__/ct-init.test.js carries a deliberately red test
// (SLICES_PRISTINE_HASHES) that nothing here should brush against.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, appendFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')
const initScriptSrc = readFileSync(script, 'utf8')
const CONTRACT_VERSION = Number(initScriptSrc.match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)[1])

// D2: `claude plugin list --json` and `claude plugin install ... --json` run
// for real inside ct-init.sh unless CT_CLAUDE_BIN points somewhere else — see
// fake-claude-install-bin/claude for what the stand-in does and why.
const FAKE_CLAUDE_BIN = join(root, '__tests__', 'fixtures', 'fake-claude-install-bin', 'claude')
const TEST_ENV = { ...process.env, CT_CLAUDE_BIN: FAKE_CLAUDE_BIN }

const ARTIFACT_IDS = [
  'state-md', 'conventions-md', 'spec-template', 'gitignore',
  'scope-gate-workflow', 'scope-gate-bundle', 'scope-gate-package',
  'claude-settings', 'plugin-install', 'agents-md', 'slices-contract', 'loop-section', 'e2e-howto',
]

function mkTarget() {
  return mkdtempSync(join(tmpdir(), 'ct-report-'))
}

function run(dir, extraArgs = [], opts = {}) {
  return execFileSync('bash', [script, dir, ...extraArgs], { encoding: 'utf8', env: TEST_ENV, ...opts })
}

function runJson(dir, extraArgs = []) {
  return JSON.parse(run(dir, ['--json', ...extraArgs]))
}

function byId(report) {
  return Object.fromEntries(report.artifacts.map((a) => [a.id, a]))
}

describe('ct-init.sh --json', () => {
  it('prints exactly one line of JSON on stdout, nothing else', () => {
    const dir = mkTarget()
    const out = run(dir, ['--json'])
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

  // plugin-install (slice 6) is excluded from the two blanket checks below: its
  // status depends on this machine's own `claude` registry, never on the
  // target directory, so it is checked on its own, against the closed set the
  // "install" class allows — never `drifted`, and `refused` is a legitimate
  // steady state, not a failure to seed.
  it('a fresh directory reports every artifact as created, except plugin-install', () => {
    const dir = mkTarget()
    const report = runJson(dir)
    for (const artifact of report.artifacts) {
      if (artifact.id === 'plugin-install') {
        expect(['created', 'already-present', 'refused']).toContain(artifact.status)
        continue
      }
      expect(artifact.status).toBe('created')
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('a second run on the same directory reports every artifact as already-present, except plugin-install', () => {
    const dir = mkTarget()
    run(dir)
    const report = runJson(dir)
    for (const artifact of report.artifacts) {
      if (artifact.id === 'plugin-install') {
        expect(['created', 'already-present', 'refused']).toContain(artifact.status)
        continue
      }
      expect(artifact.status).toBe('already-present')
    }
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
    run(dir)
    // Force a stderr warning: the scope-gate bundle no longer matches this
    // release's bytes.
    appendFileSync(join(dir, '.github', 'ct', 'scope-check.js'), '\n// tampered\n')
    const result = run(dir, ['--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
    const lines = result.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    expect(() => JSON.parse(lines[0])).not.toThrow()
    rmSync(dir, { recursive: true, force: true })
  })

  describe('the four drift classes', () => {
    it('user-owned: an edited scope-gate workflow is still reported already-present, never drifted', () => {
      const dir = mkTarget()
      run(dir)
      const workflowPath = join(dir, '.github', 'workflows', 'ct-scope-gate.yml')
      writeFileSync(workflowPath, `${readFileSync(workflowPath, 'utf8')}\n# a governed repo's own edit\n`)
      const report = runJson(dir)
      expect(byId(report)['scope-gate-workflow'].status).toBe('already-present')
      rmSync(dir, { recursive: true, force: true })
    })

    it('generated: a scope-gate bundle that no longer matches this release is reported drifted', () => {
      const dir = mkTarget()
      run(dir)
      appendFileSync(join(dir, '.github', 'ct', 'scope-check.js'), '\n// a stale copy\n')
      const report = runJson(dir)
      expect(byId(report)['scope-gate-bundle'].status).toBe('drifted')
      rmSync(dir, { recursive: true, force: true })
    })

    it('exempt: an e2e-howto section filled in by the user is reported already-present, never drifted', () => {
      const dir = mkTarget()
      run(dir)
      const agentsPath = join(dir, 'AGENTS.md')
      const filled = readFileSync(agentsPath, 'utf8').replace(
        '<!-- ct-init:e2e-howto -->',
        '<!-- ct-init:e2e-howto -->\n(filled in by the repo owner: `npm start`, then open localhost:3000)'
      )
      writeFileSync(agentsPath, filled)
      const report = runJson(dir)
      expect(byId(report)['e2e-howto'].status).toBe('already-present')
      rmSync(dir, { recursive: true, force: true })
    })

    it('versioned: an older contract than this release ships is reported drifted, with foundVersion and shippedVersion', () => {
      const dir = mkTarget()
      run(dir)
      const contractPath = join(dir, 'docs', 'superpowers', 'SLICES-CONTRACT.md')
      writeFileSync(
        contractPath,
        [
          '<!-- ct-init:slices-contract -->',
          '<!-- ct-init:slices-contract-version: 1 -->',
          '## Slices table format (contract with /ct-groom)',
          'body of an older contract',
          '<!-- /ct-init:slices-contract -->',
          '',
        ].join('\n')
      )
      const report = runJson(dir)
      const artifact = byId(report)['slices-contract']
      expect(artifact.status).toBe('drifted')
      expect(artifact.foundVersion).toBe(1)
      expect(artifact.shippedVersion).toBe(CONTRACT_VERSION)
      rmSync(dir, { recursive: true, force: true })
    })

    it('versioned: a NEWER contract than this release ships is refused, not drifted — an old plugin never downgrades', () => {
      const dir = mkTarget()
      run(dir)
      const contractPath = join(dir, 'docs', 'superpowers', 'SLICES-CONTRACT.md')
      const newerVersion = CONTRACT_VERSION + 500
      const original = [
        '<!-- ct-init:slices-contract -->',
        `<!-- ct-init:slices-contract-version: ${newerVersion} -->`,
        '## Slices table format (contract with /ct-groom)',
        'body seeded by a newer plugin release',
        '<!-- /ct-init:slices-contract -->',
        '',
      ].join('\n')
      writeFileSync(contractPath, original)
      const report = runJson(dir)
      const artifact = byId(report)['slices-contract']
      expect(artifact.status).toBe('refused')
      expect(artifact.foundVersion).toBe(newerVersion)
      expect(artifact.shippedVersion).toBe(CONTRACT_VERSION)
      // An old ct-init never downgrades: the file on disk is untouched.
      expect(readFileSync(contractPath, 'utf8')).toBe(original)
      rmSync(dir, { recursive: true, force: true })
    })

  })

  it('D2: CT_CLAUDE_BIN is honoured — pointing it at a fake binary makes plugin-install install against that fake, never the real claude', () => {
    const dir = mkTarget()
    const report = runJson(dir)
    // The fake binary starts with nothing installed, so plugin-install must
    // report `created` here — the fake actually ran and actually "installed".
    expect(byId(report)['plugin-install'].status).toBe('created')
    rmSync(dir, { recursive: true, force: true })
  })

  // D3: bash 3.2 (still /bin/bash on stock macOS) treats an empty array as
  // unbound under `set -u`. A target that fails before a single artifact is
  // recorded must still print well-formed JSON with an empty `artifacts`
  // array, exactly as the docs promise — not blow up on the report itself.
  it('D3: on /bin/bash, a target that fails before recording anything still emits JSON with artifacts: []', () => {
    // A read-only parent makes `mkdir -p "$TARGET/.agent"` — the very first
    // thing ct-init.sh does — fail before a single `record` call runs, on
    // any OS, without depending on a machine-specific unwritable path.
    const readOnlyParent = mkTarget()
    chmodSync(readOnlyParent, 0o500)
    const target = join(readOnlyParent, 'target-repo')
    const result = spawnSync('/bin/bash', [script, target, '--json'], { encoding: 'utf8', env: TEST_ENV })
    const lines = result.stdout.split('\n').filter((l) => l.length > 0)
    expect(lines).toHaveLength(1)
    const report = JSON.parse(lines[0])
    expect(report.artifacts).toEqual([])
    chmodSync(readOnlyParent, 0o700)
    rmSync(readOnlyParent, { recursive: true, force: true })
  })
})
