import { describe, it, expect, afterAll } from 'vitest'
import { tokenizeSegments } from '../scripts/closing-keywords.js'

describe('F27 — tokenizeSegments', () => {
  it('splits tokens by spaces', () => {
    expect(tokenizeSegments('git commit -m hola')).toEqual([['git', 'commit', '-m', 'hola']])
  })

  it('respects double and single quotes as ONE token', () => {
    expect(tokenizeSegments('git commit -m "dos palabras"')).toEqual([['git', 'commit', '-m', 'dos palabras']])
    expect(tokenizeSegments("git commit -m 'dos palabras'")).toEqual([['git', 'commit', '-m', 'dos palabras']])
  })

  it('an empty quoted token is still a token', () => {
    expect(tokenizeSegments('git commit -m ""')).toEqual([['git', 'commit', '-m', '']])
  })

  // THE property that holds up the whole round: the `gh pr create` of the happy
  // path lives in its own segment and does not get mixed with the commit's.
  it('cuts by &&, ||, ; and | into independent segments', () => {
    expect(tokenizeSegments('git commit -m x && gh pr create --body y')).toEqual([
      ['git', 'commit', '-m', 'x'],
      ['gh', 'pr', 'create', '--body', 'y'],
    ])
    expect(tokenizeSegments('a ; b | c || d')).toEqual([['a'], ['b'], ['c'], ['d']])
  })

  it('cuts by newline', () => {
    expect(tokenizeSegments('cd x\ngit commit -m y')).toEqual([['cd', 'x'], ['git', 'commit', '-m', 'y']])
  })

  it('a backslash escape keeps the literal character', () => {
    expect(tokenizeSegments('git commit -m a\\ b')).toEqual([['git', 'commit', '-m', 'a b']])
  })

  it('an unclosed quote does not throw: it is consumed to the end', () => {
    expect(() => tokenizeSegments('git commit -m "sin cerrar')).not.toThrow()
  })

  it('a non-string input returns an empty list', () => {
    expect(tokenizeSegments(undefined)).toEqual([])
    expect(tokenizeSegments(null)).toEqual([])
  })
})

import { extractCommitMessages } from '../scripts/closing-keywords.js'

describe('F27 — extractCommitMessages', () => {
  it('takes the message out of -m with a space', () => {
    expect(extractCommitMessages('git commit -m "arregla algo"')).toEqual(['arregla algo'])
  })

  it('takes the message out of the glued -mX form', () => {
    expect(extractCommitMessages('git commit -marregla')).toEqual(['arregla'])
  })

  it('takes the message out of --message= and of --message with a space', () => {
    expect(extractCommitMessages('git commit --message=uno')).toEqual(['uno'])
    expect(extractCommitMessages('git commit --message dos')).toEqual(['dos'])
  })

  it('several -m are all returned (git concatenates them as paragraphs)', () => {
    expect(extractCommitMessages('git commit -m titulo -m cuerpo')).toEqual(['titulo', 'cuerpo'])
  })

  it('accepts global options before the subcommand', () => {
    expect(extractCommitMessages('git -C /tmp/repo commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git -c user.name=x commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git --git-dir=/tmp/.git commit -m hola')).toEqual(['hola'])
  })

  it('accepts an absolute path to git', () => {
    expect(extractCommitMessages('/usr/bin/git commit -m hola')).toEqual(['hola'])
  })

  it('an --amend with -m does carry an inline message', () => {
    expect(extractCommitMessages('git commit --amend -m nuevo')).toEqual(['nuevo'])
  })

  // The NEGATIVES are the ones that matter: blocking the happy path is the
  // expensive failure.
  it('gh pr create is not a commit and contributes nothing', () => {
    expect(extractCommitMessages('gh pr create --body "Closes #42"')).toEqual([])
  })

  it('a commit chained with a gh pr create contributes only its own', () => {
    expect(extractCommitMessages('git commit -m limpio && gh pr create --body "Closes #1"')).toEqual(['limpio'])
  })

  it('git without the commit subcommand contributes nothing', () => {
    expect(extractCommitMessages('git log -m cosa')).toEqual([])
    expect(extractCommitMessages('git push origin main')).toEqual([])
  })

  it('a commit with no -m contributes nothing (the editor supplies the message)', () => {
    expect(extractCommitMessages('git commit --amend --no-edit')).toEqual([])
    expect(extractCommitMessages('git commit -F mensaje.txt')).toEqual([])
  })

  it('what goes after -- is a pathspec, not a message', () => {
    expect(extractCommitMessages('git commit -m real -- -m falso')).toEqual(['real'])
  })

  // Short flags combined into ONE single-dash cluster: getopt semantics, the
  // ones git uses. If an 'm' appears in the cluster, what comes behind it is the
  // value if it is not empty; if it is empty, the value is the next token.
  it('an -am cluster with the message in the next token', () => {
    expect(extractCommitMessages('git commit -am "hola"')).toEqual(['hola'])
  })

  it('a -qm cluster with the message in the next token', () => {
    expect(extractCommitMessages('git commit -qm "hola"')).toEqual(['hola'])
  })

  it('an -am cluster with the message glued after the m', () => {
    expect(extractCommitMessages('git commit -amhola')).toEqual(['hola'])
  })

  // The happy path is already covered above; it is repeated here as an explicit
  // anchor of the contrast with the clusters: the lone 'm' still works the
  // same.
  it('the lone m, with a space or glued, still works', () => {
    expect(extractCommitMessages('git commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -mhola')).toEqual(['hola'])
  })

  // Negatives: no cluster without an 'm', and no double-dash --amend,
  // contributes text. Blocking these by mistake would turn the guardrail into a
  // brick.
  it('a cluster with no m contributes nothing', () => {
    expect(extractCommitMessages('git commit -a')).toEqual([])
  })

  it('-C after commit reuses another commit message: there is no text here', () => {
    expect(extractCommitMessages('git commit -C HEAD')).toEqual([])
  })

  it('a double-dash --amend on its own contributes nothing', () => {
    expect(extractCommitMessages('git commit --amend')).toEqual([])
  })

  // A flag that consumes the rest of the cluster as ITS mandatory value
  // (F, C, c, t) covers up any 'm' that comes behind it. That 'm' is part of the
  // other flag's value, not the start of a message.
  it('the glued F eats the whole file name, the m in the middle is not a message', () => {
    expect(extractCommitMessages('git commit -Fmensaje.txt')).toEqual([])
  })

  it('the glued C eats the commit to reuse, the m in the middle is not a message', () => {
    expect(extractCommitMessages('git commit -Cmabcdef')).toEqual([])
  })

  it('the glued c eats the commit to reuse and edit, the m in the middle is not a message', () => {
    expect(extractCommitMessages('git commit -cmabcdef')).toEqual([])
  })

  it('the glued t eats the template, the m in the middle is not a message', () => {
    expect(extractCommitMessages('git commit -tplantilla.txt')).toEqual([])
  })

  it('-F with a space still contributes no message (it already worked, do not break it)', () => {
    expect(extractCommitMessages('git commit -F mensaje.txt')).toEqual([])
  })

  // An explicit anti-regression: the clusters and -m forms with no flag that
  // consumes the rest have to keep working the same after the
  // character-by-character scan.
  it('anti-regression: the clusters and -m forms that already worked stay the same', () => {
    expect(extractCommitMessages('git commit -am "hola"')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -qm "hola"')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -aqm "hola"')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -amhola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -m hola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -mhola')).toEqual(['hola'])
    expect(extractCommitMessages('git commit -ma')).toEqual(['a'])
    expect(extractCommitMessages('git commit -a')).toEqual([])
    expect(extractCommitMessages('git commit -C HEAD')).toEqual([])
  })
})

import { findClosingKeywords, CLOSING_KEYWORDS } from '../scripts/closing-keywords.js'

describe('F27 — findClosingKeywords', () => {
  it("GitHub's NINE keywords, not one more and not one fewer", () => {
    expect(CLOSING_KEYWORDS).toEqual([
      'close', 'closes', 'closed',
      'fix', 'fixes', 'fixed',
      'resolve', 'resolves', 'resolved',
    ])
  })

  it('each one of the nine fires', () => {
    for (const k of CLOSING_KEYWORDS) {
      expect(findClosingKeywords(`${k} #7`)).toHaveLength(1)
    }
  })

  it('it is case-insensitive and allows a colon', () => {
    expect(findClosingKeywords('CLOSES #10')).toHaveLength(1)
    expect(findClosingKeywords('Closes: #10')).toHaveLength(1)
    expect(findClosingKeywords('Fixes:#10')).toHaveLength(1)
  })

  it('it accepts the owner/repo#N form', () => {
    const f = findClosingKeywords('Fixes octo-org/octo-repo#100')
    expect(f).toHaveLength(1)
    expect(f[0].ref).toBe('octo-org/octo-repo#100')
  })

  it('it returns the keyword and the reference it found', () => {
    expect(findClosingKeywords('Closes #451')).toEqual([{ keyword: 'Closes', ref: '#451' }])
  })

  it('it catches the keyword inside a quoted sentence — the quotes do NOT protect it', () => {
    // It is, word for word, the shape of the commit that closed #451 in the
    // field.
    const f = findClosingKeywords('Dos observaciones sobre el kickoff: no dice "Closes #451", y el agente no recibe el spec.')
    expect(f).toEqual([{ keyword: 'Closes', ref: '#451' }])
  })

  // NEGATIVES
  it('a reference with no keyword does not fire', () => {
    expect(findClosingKeywords('mira el #42 cuando puedas')).toEqual([])
  })

  it('a keyword with no reference does not fire', () => {
    expect(findClosingKeywords('closes the door')).toEqual([])
    expect(findClosingKeywords('fixed the flaky test')).toEqual([])
  })

  it('the keyword has to be a whole word', () => {
    expect(findClosingKeywords('prefix #42')).toEqual([])
    expect(findClosingKeywords('foreclosed #42')).toEqual([])
  })

  it('a non-string input returns an empty list', () => {
    expect(findClosingKeywords(undefined)).toEqual([])
  })

  // The failure mode this branch fights: a keyword followed by a pathological
  // amount of spaces, with no reference behind it. Without a bound on the space
  // quantifiers, the regex engine distributes those spaces in every possible
  // way before giving up — quadratic in their number — and an input of 120,000
  // exceeds the hook's `timeout: 5`: the process dies and the gate switches off
  // in silence over ANY commit of that session, not just the pathological one.
  // Bounding the spacing to a reasonable maximum while leaving the normal cases
  // intact (measured above: zero or one space, with or without a colon) is what
  // avoids the collapse without ceasing to detect anything real.
  it('a keyword followed by pathological spacing finishes fast, without blocking the hook', () => {
    const pathological = `closes${' '.repeat(120000)}`
    const start = Date.now()
    const result = findClosingKeywords(pathological)
    const duration = Date.now() - start
    expect(result).toEqual([])
    expect(duration).toBeLessThan(1000)
  })
})

import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { probeGovernedRepo, CONTRACT_MARKER, LOOP_MARKER } from '../scripts/governed-repo.js'

describe('F27 — probeGovernedRepo', () => {
  const created = []
  const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'f27-')); created.push(d); return d }
  afterAll(() => { for (const d of created) { try { chmodSync(d, 0o755) } catch {} ; rmSync(d, { recursive: true, force: true }) } })

  it('a repo with an AGENTS.md carrying the marker is governed', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), `# AGENTS\n${CONTRACT_MARKER}\ncosas\n`)
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })

  // #93 — the contract moved out of AGENTS.md into its own file, and in its
  // place the loop's short section was left with ITS marker. The "governed"
  // signal has to be either of the two: with only the new one, every repo
  // bootstrapped up to today is left with no gate; with only the old one, every
  // repo bootstrapped from now on is left without it. And neither of the two
  // blackouts would be seen: the commit just passes.
  it("a repo seeded by #93, with only the loop section's marker, is governed too", () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), `# AGENTS\n${LOOP_MARKER}\ncosas\n`)
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })

  // Half the gate's coverage is the dispatched agents, and they all work in a
  // worktree, where .git is a FILE.
  it('a worktree, whose .git is a FILE, is recognised just the same', () => {
    const d = tmp()
    writeFileSync(join(d, '.git'), 'gitdir: /otro/sitio/.git/worktrees/2\n')
    writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })

  it('it climbs from a subdirectory up to the root', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), CONTRACT_MARKER)
    const sub = join(d, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    expect(probeGovernedRepo(sub)).toEqual({ governed: true })
  })

  it('a repo with no AGENTS.md is NOT governed', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    expect(probeGovernedRepo(d)).toEqual({ governed: false })
  })

  it('an AGENTS.md without the marker is NOT governed', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    writeFileSync(join(d, 'AGENTS.md'), '# AGENTS\nsin marcador\n')
    expect(probeGovernedRepo(d)).toEqual({ governed: false })
  })

  it('what is not a git repo is NOT governed', () => {
    expect(probeGovernedRepo(tmp())).toEqual({ governed: false })
  })

  it('an unreadable AGENTS.md is an ERROR, never "not governed"', () => {
    const d = tmp()
    mkdirSync(join(d, '.git'))
    const f = join(d, 'AGENTS.md')
    writeFileSync(f, CONTRACT_MARKER)
    chmodSync(f, 0o000)
    const r = probeGovernedRepo(d)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('a cwd that does not exist is an ERROR, never "not governed"', () => {
    const r = probeGovernedRepo(join(tmpdir(), 'f27-no-existe-jamas', 'x'))
    expect(r.error).toBeTruthy()
  })

  // A cwd that is not a string cannot be silently coerced into the PROCESS's
  // cwd: that would answer about a directory the caller never named. The
  // assertion does not depend on which directory the test process runs in: a
  // present `.error` and an absent `.governed` already tell "I refused to
  // answer" from "I answered no", regardless of whether that directory is
  // governed or not.
  it("an undefined cwd is an ERROR, never an answer about the process's cwd", () => {
    const r = probeGovernedRepo(undefined)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it("a null cwd is an ERROR, never an answer about the process's cwd", () => {
    const r = probeGovernedRepo(null)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it("an empty-string cwd is an ERROR, never an answer about the process's cwd", () => {
    const r = probeGovernedRepo('')
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('a numeric cwd is an ERROR by type, not by coincidence with a nonexistent path', () => {
    const r = probeGovernedRepo(42)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('an object cwd is an ERROR', () => {
    const r = probeGovernedRepo({})
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  // The error message describes the value received, but building that
  // description cannot bring the function down: an invalid cwd arrives from
  // outside and may carry precisely the object designed to break whoever
  // serialises it.
  it('a circular object as cwd does not throw, and is an ERROR', () => {
    const circular = {}
    circular.self = circular
    expect(() => probeGovernedRepo(circular)).not.toThrow()
    const r = probeGovernedRepo(circular)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('a getter that throws when read as cwd does not throw, and is an ERROR', () => {
    const hostile = {}
    Object.defineProperty(hostile, 'x', { enumerable: true, get() { throw new Error('boom') } })
    expect(() => probeGovernedRepo(hostile)).not.toThrow()
    const r = probeGovernedRepo(hostile)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('a toJSON that throws as cwd does not throw, and is an ERROR', () => {
    const hostile = { toJSON() { throw new Error('boom') } }
    expect(() => probeGovernedRepo(hostile)).not.toThrow()
    const r = probeGovernedRepo(hostile)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })

  it('a toString that throws as cwd does not throw, and is an ERROR', () => {
    const hostile = { toString() { throw new Error('boom') } }
    expect(() => probeGovernedRepo(hostile)).not.toThrow()
    const r = probeGovernedRepo(hostile)
    expect(r.error).toBeTruthy()
    expect(r.governed).toBeUndefined()
  })
})

// The most valuable case of the whole gate, and until now caught by accident:
// nothing tied this shape to a test, and `grep -n 'cat <<' __tests__/f27-*.test.js`
// returned nothing before this block.
describe("F27 — the quoted heredoc inside the -m (Claude Code's default multiline form)", () => {
  // `git commit -m "$(cat <<'EOF' ... EOF)"` is almost certainly the shape of
  // the real commit that motivated this branch: the heredoc's text travels
  // LITERALLY inside the double quotes of the `-m` itself, and
  // closing-keywords.js does not interpret `$(...)` — it only copies characters
  // — so that text, keyword included, is as visible as any other quoted
  // message.
  const command = [
    'git commit -m "$(cat <<\'EOF\'',
    'Documenta que el kickoff no lleva la keyword de cierre.',
    '',
    'Closes #451',
    'EOF',
    ')"',
  ].join('\n')

  it('the complete message, heredoc included, comes out of extractCommitMessages', () => {
    const messages = extractCommitMessages(command)
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('Closes #451')
  })

  it('findClosingKeywords DOES find the keyword inside that message', () => {
    const findings = extractCommitMessages(command).flatMap(findClosingKeywords)
    expect(findings).toEqual([{ keyword: 'Closes', ref: '#451' }])
  })
})

import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The self-referential fixture: CONTRACT_MARKER is defined by hand in
// governed-repo.js, SLICES_MARKER_OPEN is defined by hand in ct-init.sh, and
// every test above writes CONTRACT_MARKER and checks that CONTRACT_MARKER is
// detected — they tie the reader to itself, never to the real writer. By
// changing only the literal in governed-repo.js, that whole suite stays green
// over a repo seeded by the real ct-init.sh, with the gate switched off.
//
// This test ties the two of them: it seeds with the real WRITER (`bash
// scripts/ct-init.sh <dir>`, over a real git repo) and checks with the real
// READER (`probeGovernedRepo`) — without the marker's literal appearing written
// anywhere in this file.
describe('F27 — the writer (ct-init.sh) and the reader (probeGovernedRepo), tied by the same test', () => {
  const created = []
  afterAll(() => { for (const d of created) { try { chmodSync(d, 0o755) } catch {} ; rmSync(d, { recursive: true, force: true }) } })

  it('a repo seeded by the real ct-init.sh is recognised as governed', () => {
    const d = mkdtempSync(join(tmpdir(), 'f27-e2e-'))
    created.push(d)
    execFileSync('git', ['init', '-q'], { cwd: d })
    const ctInit = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-init.sh')
    execFileSync('bash', [ctInit, d], { encoding: 'utf8' })
    expect(probeGovernedRepo(d)).toEqual({ governed: true })
  })
})
