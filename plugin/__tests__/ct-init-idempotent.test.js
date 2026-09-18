// ct-init.sh --json (slice 4), the four drift classes (slice 5) and the
// `install` class (slice 6): the twice-run no-op proof slice 7 asks for.
//
// plugin-install is excluded from the blanket "every artifact is created"
// checks below, and only there: its status depends on this MACHINE's own
// `claude` registry, not on the target directory, so a genuinely clean slate
// legitimately reports `refused` (see ct-init.sh's `install` class comment).
// Every other assertion — byte-identical tree, no `created`/`drifted` on a
// second run, the same reproduction with `node` hidden — applies to it like
// any other artifact, because those hold regardless of what this particular
// machine can resolve.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname, relative } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')
const PLUGIN_INSTALL_ID = 'plugin-install'
const CLAUDE_SETTINGS_ID = 'claude-settings'
const NODE_LESS_TOOLS = [
  'bash', 'awk', 'grep', 'sed', 'mkdir', 'cp', 'cat', 'mktemp', 'mv', 'rm',
  'touch', 'tail', 'wc', 'head', 'dirname', 'basename', 'pwd', 'shasum', 'cmp',
]

// D2: without this, `plugin-install` spawns the REAL `claude` binary — see
// fake-claude-install-bin/claude for what the stand-in does and why.
const FAKE_CLAUDE_BIN = join(root, '__tests__', 'fixtures', 'fake-claude-install-bin', 'claude')
const TEST_ENV = { ...process.env, CT_CLAUDE_BIN: FAKE_CLAUDE_BIN }

function mkTarget() {
  return mkdtempSync(join(tmpdir(), 'ct-idem-'))
}

function runJson(dir, env = TEST_ENV) {
  const out = execFileSync('bash', [script, dir, '--json'], { encoding: 'utf8', env })
  return JSON.parse(out)
}

function nodeLessEnv(dir) {
  const binDir = join(dir, 'fake-bin')
  mkdirSync(binDir, { recursive: true })
  for (const tool of NODE_LESS_TOOLS) {
    const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
    if (found) symlinkSync(found, join(binDir, tool))
  }
  return { ...TEST_ENV, PATH: binDir }
}

function snapshotTree(dir) {
  const snapshot = {}
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.isFile()) {
        snapshot[relative(dir, full)] = createHash('sha256').update(readFileSync(full)).digest('hex')
      }
    }
  }
  walk(dir)
  return snapshot
}

function nonInstallArtifacts(report) {
  return report.artifacts.filter((artifact) => artifact.id !== PLUGIN_INSTALL_ID)
}

function installArtifact(report) {
  return report.artifacts.find((artifact) => artifact.id === PLUGIN_INSTALL_ID)
}

function artifactById(report, id) {
  return report.artifacts.find((artifact) => artifact.id === id)
}

// Both node-dependent artifacts, excluded from the blanket "created" checks
// that follow the `node`-hidden run: `plugin-install` for the reason given at
// the top of this file, and `claude-settings` because with `node` hidden it
// reports `refused` (nothing was compared, so it is never read as
// `already-present`), never `created` — even on a fresh directory where the
// file was in fact never written.
function nodeIndependentArtifacts(report) {
  return report.artifacts.filter((artifact) => artifact.id !== PLUGIN_INSTALL_ID && artifact.id !== CLAUDE_SETTINGS_ID)
}

describe('ct-init.sh --json is a true no-op the second time it runs', () => {
  it('a fresh run creates every artifact, except plugin-install which follows its own machine-dependent class', () => {
    const dir = mkTarget()
    const report = runJson(dir)
    for (const artifact of nonInstallArtifacts(report)) {
      expect(artifact.status).toBe('created')
    }
    expect(['created', 'already-present', 'refused']).toContain(installArtifact(report).status)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the second run touches not a single byte of the tree, and reports nothing as created or drifted', () => {
    const dir = mkTarget()
    runJson(dir)
    const before = snapshotTree(dir)
    const second = runJson(dir)
    const after = snapshotTree(dir)
    expect(after).toEqual(before)
    for (const artifact of second.artifacts) {
      expect(artifact.status).not.toBe('created')
      expect(artifact.status).not.toBe('drifted')
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('the exit code is the same on both runs', () => {
    const dir = mkTarget()
    const first = runJson(dir)
    const second = runJson(dir)
    expect(second.exitCode).toBe(first.exitCode)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with node hidden from PATH, both runs report the same refused reasons and touch the same bytes', () => {
    const dir = mkTarget()
    const env = nodeLessEnv(dir)
    const first = runJson(dir, env)
    for (const artifact of nodeIndependentArtifacts(first)) {
      expect(artifact.status).toBe('created')
    }
    expect(installArtifact(first).status).toBe('refused')
    expect(installArtifact(first).detail).toBe('node is not on the PATH')
    expect(artifactById(first, CLAUDE_SETTINGS_ID).status).toBe('refused')
    expect(artifactById(first, CLAUDE_SETTINGS_ID).detail).toBe('node is not on the PATH')

    const before = snapshotTree(dir)
    const second = runJson(dir, env)
    const after = snapshotTree(dir)
    expect(after).toEqual(before)
    for (const artifact of second.artifacts) {
      expect(artifact.status).not.toBe('created')
      expect(artifact.status).not.toBe('drifted')
    }
    expect(installArtifact(second).status).toBe('refused')
    expect(installArtifact(second).detail).toBe(installArtifact(first).detail)
    expect(artifactById(second, CLAUDE_SETTINGS_ID).status).toBe('refused')
    expect(artifactById(second, CLAUDE_SETTINGS_ID).detail).toBe(artifactById(first, CLAUDE_SETTINGS_ID).detail)
    expect(second.exitCode).toBe(first.exitCode)
    rmSync(dir, { recursive: true, force: true })
  })

  // mkdtemp never initialises git, so every target directory above is already
  // the "not a git repo" case — ct-init.sh makes no git call at all (grepping
  // the script for one turns up only comments and diagnostics, never an
  // invocation), so there is nothing for a missing repository to break. This
  // test names that decision instead of leaving it implicit: a plain
  // directory works exactly like any other target, and no git-status
  // assertion belongs here — that check is for a git-initialised target,
  // which no test in this file constructs.
  it('a target directory that is not a git repository bootstraps exactly like any other', () => {
    const dir = mkTarget()
    const report = runJson(dir)
    for (const artifact of nonInstallArtifacts(report)) {
      expect(artifact.status).toBe('created')
    }
    expect(report.exitCode).toBe(0)
    rmSync(dir, { recursive: true, force: true })
  })
})
