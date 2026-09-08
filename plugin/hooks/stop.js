#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, isAbsolute } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { parseStateSafe, describeStopRelation, classifyStopState, withLastCommit, noticeDecision, STOP_NOTICE_REL_NAME } from '../scripts/state.js'
import { resolveStatePath, excludeContentWith } from '../scripts/state-paths.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
// F22: same precedence as in session-start.js. In a slice worktree this
// resolves to .agent/SLICE.md, which is the file whose freshness matters.
//
// `rel` (the same path, relative) travels all the way into the messages. Here
// that is NOT a detail: ever since the seed carries the sha of the base, the
// blocking reason of this hook comes out on EVERY turn of EVERY slice, and it
// said «Actualiza STATE.md» — the coordinator's TRACKED file, whose
// contamination is exactly what F22 removes.
const { path: statePath, rel: stateRel } = resolveStatePath(cwd)

if (!statePath) process.exit(0)

// A runner that NEVER throws and returns the exit code: `merge-base
// --is-ancestor` answers by code (0 yes / 1 no), so a runner that turns the 1
// into an exception cannot tell "it is not an ancestor" apart from "git has
// failed" — and that difference is exactly the one this hook needs.
const git = (args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  if (r.error || r.status == null) return { status: -1, stdout: '' }
  return { status: r.status, stdout: r.stdout || '' }
}

// With no HEAD there is nothing to compare: a freshly initialised repo with
// no commits, or a cwd that is not a repo. It exits in silence (as before).
let headSha = ''
try { headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { process.exit(0) }
if (!headSha) process.exit(0)

// '' when HEAD is detached — and then it says "HEAD (desprendido en …)"
// instead of inventing a branch.
const branchProbe = git(['symbolic-ref', '--short', '-q', 'HEAD'])
const branch = branchProbe.status === 0 ? branchProbe.stdout.trim() : ''

// F7: `parseState` THROWS on a malformed frontmatter, and here it was called
// with no safety net — a STATE.md with broken YAML blew this hook up (stack
// trace on stderr) on EVERY turn closing in that repo, without ever saying
// that the problem was the file. Now it is treated as what it is: the state
// cannot be read, so neither is it known whether HEAD has moved on nor whether
// the work is blocked — and that is SAID (once; `stop_hook_active` cuts the
// loop just as on the normal path) instead of dying loudly or, worse, keeping
// quiet.
const { meta, error: parseError } = parseStateSafe(readFileSync(statePath, 'utf8'))
if (parseError) {
  if (!input.stop_hook_active) {
    process.stdout.write(JSON.stringify({
      decision: 'block',
      reason: `No se ha podido interpretar el frontmatter YAML de ${stateRel} (${parseError}). Arréglalo antes de cerrar el turno: mientras siga así, la próxima sesión no podrá hidratarse del estado ni saber si el trabajo está BLOQUEADO (campo \`blocked\`), y este mismo aviso volverá a salir.`,
    }))
  }
  process.exit(0)
}
// F12: this used to be `headSha !== stateSha` and the message claimed «hay
// commits más nuevos» — an ancestry relation the code never checked at any
// point. Now git is asked, and each case says its own thing (see the header of
// the section in scripts/state.js).
const relation = describeStopRelation({ headSha, lastCommit: meta.last_commit, git, branch })
const verdict = classifyStopState({ relation, stopHookActive: input.stop_hook_active, stateRel })

// #95/H5: the work above was committed by ct-step, so the sha the guard used
// to ask the agent for is written by the program — into the file
// `resolveStatePath` resolved, which in a slice worktree is SLICE.md and never
// the coordinator's tracked STATE.md. If the write fails, nothing is said: the
// turn closes all the same and the guard will look again on the next one.
if (verdict.updateLastCommitTo) {
  const { text, updated } = withLastCommit(readFileSync(statePath, 'utf8'), verdict.updateLastCommitTo)
  if (updated) {
    try { writeFileSync(statePath, text) } catch { /* the turn closing does not depend on this */ }
  }
}

// #95/H8: the marker of which anomaly was last warned about and how many
// turns it has been going on for. It lives next to the state file this hook
// has just resolved, and it is excluded from git by the same route `/ct-next`
// uses for `.agent/SLICE.md`: the `info/exclude` of the COMMON directory,
// which is never committed and covers the main checkout and all its worktrees
// in one go.
//
// FAIL OPEN: if it cannot be excluded, the marker is not written — and then a
// warning goes out on every turn, as before. A bookkeeping file sneaked into a
// PR costs more than a repeated warning.
const noticeRel = `${dirname(stateRel)}/${STOP_NOTICE_REL_NAME}`
const noticePath = join(dirname(statePath), STOP_NOTICE_REL_NAME)

const noticeExcluded = () => {
  const probe = git(['rev-parse', '--git-common-dir'])
  if (probe.status !== 0) return false
  const raw = probe.stdout.trim()
  if (!raw) return false
  const base = isAbsolute(raw) ? raw : join(cwd, raw)
  try {
    mkdirSync(join(base, 'info'), { recursive: true })
    const excludePath = join(base, 'info', 'exclude')
    let current = ''
    try { current = readFileSync(excludePath, 'utf8') } catch { current = '' }
    const next = excludeContentWith(current, noticeRel)
    if (next.added) writeFileSync(excludePath, next.content)
    return true
  } catch {
    return false
  }
}

const readNotice = () => {
  try { return JSON.parse(readFileSync(noticePath, 'utf8')) } catch { return null }
}

if (verdict.block) {
  process.stdout.write(JSON.stringify({ decision: 'block', reason: verdict.reason }))
} else if (verdict.systemMessage) {
  const { emit, next } = noticeDecision({ relation, previous: readNotice() })
  if (noticeExcluded()) {
    try { writeFileSync(noticePath, `${JSON.stringify(next)}\n`) } catch { /* it will warn too much, never too little */ }
  }
  // It does not block, but it does not keep quiet either: `systemMessage` is
  // the non-blocking channel of the hooks' JSON output. The turn closes all
  // the same.
  if (emit) process.stdout.write(JSON.stringify({ systemMessage: verdict.systemMessage }))
}
