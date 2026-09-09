import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTRACT_MARKER, probeGovernedRepo } from '../scripts/governed-repo.js'
import { decide } from '../hooks/commit-keyword-guard.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const hook = join(root, 'hooks/commit-keyword-guard.js')

const created = []
function governedRepo() {
  const d = mkdtempSync(join(tmpdir(), 'f27g-')); created.push(d)
  mkdirSync(join(d, '.git'))
  writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
  return d
}
function normalRepo() {
  const d = mkdtempSync(join(tmpdir(), 'f27n-')); created.push(d)
  mkdirSync(join(d, '.git'))
  return d
}
afterAll(() => { for (const d of created) { try { chmodSync(d, 0o755) } catch {} ; rmSync(d, { recursive: true, force: true }) } })

function run(command, cwd, bin = hook) {
  const r = spawnSync('node', [bin], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command }, cwd }),
    encoding: 'utf8',
  })
  const out = (r.stdout || '').trim()
  return { status: r.status, out, json: out ? JSON.parse(out) : null }
}

// The property that matters most —only the command that already turned out to
// be a commit WITH a keyword pays the I/O of `probe`— measured DIRECTLY on the
// pure function, with a spy that counts its own invocations. This is what a
// `chmod 000` could only hint at as a side effect (and, for the `ls` path, not
// even that: an `ls` comes out clean whether `probe` is called and fails in
// silence or is never called at all, so that path cannot be verified by looking
// at the process output alone).
describe('F27 — decide (pure function, no process)', () => {
  it('ls -la: no decision AND the probe is NOT invoked', () => {
    let calls = 0
    const spy = () => { calls++; return { governed: true } }
    const r = decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls -la' }, cwd: '/x' }, spy)
    expect(r).toBeNull()
    expect(calls).toBe(0)
  })

  it('a commit with no keyword: no decision AND the probe is NOT invoked', () => {
    let calls = 0
    const spy = () => { calls++; return { governed: true } }
    const r = decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "arregla el parser"' }, cwd: '/x' }, spy)
    expect(r).toBeNull()
    expect(calls).toBe(0)
  })

  it('a commit with a keyword and a governed repo: DENY AND the probe is invoked ONCE', () => {
    let calls = 0
    const spy = () => { calls++; return { governed: true } }
    const r = decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, spy)
    expect(calls).toBe(1)
    expect(r.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('a commit with a keyword and a probe that cannot know: ASK, never silence', () => {
    const r = decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, () => ({ error: 'lo que sea' }))
    expect(r.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  it('a commit with a keyword and a NOT governed repo: no decision', () => {
    const r = decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, () => ({ governed: false }))
    expect(r).toBeNull()
  })

  // The event has to be the expected one: a `tool_name: 'Bash'` arriving hung
  // off ANOTHER event (or with no `hook_event_name`) is not this hook.
  it('a hook_event_name other than PreToolUse: no decision, even if the rest fits', () => {
    let calls = 0
    const spy = () => { calls++; return { governed: true } }
    const r = decide({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #7"' }, cwd: '/x' }, spy)
    expect(r).toBeNull()
    expect(calls).toBe(0)
  })

  // THE deliberate breakage: if `probe` were called BEFORE knowing there is a
  // closing keyword, this test would go red because `calls` would stop being
  // 0 here, for a compound command with no keyword at all.
  it('the order matters: for a command with no closing keyword, the probe never runs', () => {
    let calls = 0
    const spy = () => { calls++; return { governed: true } }
    decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git status && ls -la /etc' } }, spy)
    expect(calls).toBe(0)
  })

  // An absent, `null` or empty `cwd` is NOT replaced by the cwd of the hook's
  // own PROCESS: that would answer about a directory the caller never named.
  // `probeGovernedRepo` (the real probe, not a spy) already turns that into
  // `{error}`, and here it must come out `ask`, never silence.
  it.each([
    ['absent', undefined],
    ['null', null],
    ['empty string', ''],
  ])('a %s cwd in the payload: ASK, never silence', (_label, cwd) => {
    const r = decide({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git commit -m "Closes #451"' }, cwd }, probeGovernedRepo)
    expect(r.hookSpecificOutput.permissionDecision).toBe('ask')
  })
})

describe('F27 — the hook (end to end over the binary, via stdin)', () => {
  it('governed repo + commit with a keyword => DENY, naming keyword and reference', () => {
    const r = run('git commit -m "no dice \\"Closes #451\\" el kickoff"', governedRepo())
    expect(r.status).toBe(0)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
    const reason = r.json.hookSpecificOutput.permissionDecisionReason
    expect(reason).toContain('Closes')
    expect(reason).toContain('#451')
    // The uppercase emphasis of "CUERPO DEL PR" is deliberate -an agent that is
    // going to retry reads it- so the assertion is case insensitive.
    expect(reason).toMatch(/cuerpo del PR/i)
  })

  it('a NOT governed repo => no decision', () => {
    const r = run('git commit -m "Closes #451"', normalRepo())
    expect(r.status).toBe(0)
    expect(r.out).toBe('')
  })

  // The happy path the contract DEMANDS.
  it('gh pr create with the closure in the body => no decision', () => {
    const r = run('gh pr create --body "Closes #42"', governedRepo())
    expect(r.out).toBe('')
  })

  it('a clean commit chained with gh pr create => no decision', () => {
    const r = run('git commit -m limpio && gh pr create --body "Closes #1"', governedRepo())
    expect(r.out).toBe('')
  })

  it('a commit with no keyword => no decision', () => {
    const r = run('git commit -m "arregla el parser"', governedRepo())
    expect(r.out).toBe('')
  })

  it('a tool that is not Bash => no decision', () => {
    const r = spawnSync('node', [hook], {
      input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { command: 'git commit -m "Closes #1"' }, cwd: governedRepo() }),
      encoding: 'utf8',
    })
    expect((r.stdout || '').trim()).toBe('')
  })

  it('malformed stdin => empty output, exit 0 (no crash)', () => {
    const r = spawnSync('node', [hook], { input: 'no-json{', encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect((r.stdout || '').trim()).toBe('')
  })

  // This tests ONE concrete thing: that a cwd that cannot be read produces ASK
  // and not silence. It does NOT test "zero I/O on the common path" -for an
  // `ls`, the output is identical whether or not `probe` is called, because
  // `probeGovernedRepo` catches the EACCES and the `ls` path does not even get
  // as far as looking at the result- that property is tested by the block
  // above, over `decide` with a spy.
  it('with an unreadable cwd, a commit with a keyword comes out ASK (never silence)', () => {
    const d = mkdtempSync(join(tmpdir(), 'f27y-')); created.push(d)
    const inner = join(d, 'dentro'); mkdirSync(inner)
    chmodSync(d, 0o000)
    const r = run('git commit -m "Closes #7"', inner)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('ask')
  })

  // The real bug: `process.argv[1]` keeps the path exactly as it was invoked,
  // `import.meta.url` arrives with the symlinks already resolved. Without
  // resolving both before comparing, the executable body does not run down this
  // path and the whole gate switches off in silence (exit 0, empty stdout),
  // indistinguishable from "there was nothing to deny".
  it('invoked through a DIRECTORY symlink to the repo: it still denies', () => {
    const links = mkdtempSync(join(tmpdir(), 'f27link-')); created.push(links)
    const repoLink = join(links, 'repo-enlazado')
    symlinkSync(root, repoLink, 'dir')
    const hookViaLink = join(repoLink, 'hooks', 'commit-keyword-guard.js')
    const r = run('git commit -m "Closes #451"', governedRepo(), hookViaLink)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('invoked by a path where the FILE itself is a symlink: it still denies', () => {
    const links = mkdtempSync(join(tmpdir(), 'f27link-')); created.push(links)
    const linkedHook = join(links, 'guard-enlazado.js')
    symlinkSync(hook, linkedHook, 'file')
    const r = run('git commit -m "Closes #451"', governedRepo(), linkedHook)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  it('the production BUNDLE decides the same as the source', () => {
    const bundle = join(root, 'dist/commit-keyword-guard.js')
    const r = run('git commit -m "Closes #451"', governedRepo(), bundle)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
  })

  // The most valuable case, against the production BUNDLE: Claude Code's
  // default multiline form (`-m "$(cat <<'EOF' ... EOF)"`) travels literally
  // inside the command, and the hook denies it just as it denies any other
  // quoted message.
  it('the quoted heredoc inside the -m, against the BUNDLE: DENY, same as the source', () => {
    const bundle = join(root, 'dist/commit-keyword-guard.js')
    const command = [
      'git commit -m "$(cat <<\'EOF\'',
      'Documenta que el kickoff no lleva la keyword de cierre.',
      '',
      'Closes #451',
      'EOF',
      ')"',
    ].join('\n')
    const r = run(command, governedRepo(), bundle)
    expect(r.json.hookSpecificOutput.permissionDecision).toBe('deny')
    const reason = r.json.hookSpecificOutput.permissionDecisionReason
    expect(reason).toContain('Closes')
    expect(reason).toContain('#451')
  })
})
