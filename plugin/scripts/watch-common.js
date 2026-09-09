// ============================================================================
// WHAT THE TWO WATCHERS SHARE, and what was copied verbatim between them.
//
// `ct-watch-go.mjs` and `ct-watch-merge.mjs` are siblings on purpose: one
// watches the `plan` gate's `-OK` and the other the PR's merge, and they read
// side by side because the divergences between them show up precisely when
// everything else is identical. That holds for their STRUCTURE. It did not hold
// for this: the argv parsing, opening the log, the `plazo()` that aborts on an
// unreadable value and the `sleep` did not have two versions because anybody
// had decided two things — they had them because the second file was born by
// copying the first.
//
// An adversarial review on #37 pointed it out, and of its two halves this is
// the cheap one: the expensive half is that the cmux walk was also copied, and
// there there really was a divergence with consequences (see scripts/cmux.js).
//
// THE TWO DEADLINES STILL BELONG TO EACH OF THEM. This module shares the
// MECHANISM (`plazo`, which reads an environment variable and aborts if it
// cannot be understood), never the NUMBERS: the `-OK` watcher polls every 30 s
// for 8 h because it covers a person being asleep, and the merge one every
// 60 s for 48 h because it covers a PR waiting for review, which is counted in
// days. Melting them together here would turn two measured decisions into one
// shared constant that nobody looks at again.
// ============================================================================

import { mkdirSync, openSync, writeSync, closeSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseStrictInt } from './argnum.js'

// `--name value` out of a flat argv. There is no options parser on purpose:
// there are four flags, and one dependency less in a process that runs
// detached.
export function arg(argv, name) {
  const i = argv.indexOf(name)
  return i === -1 ? null : argv[i + 1] ?? null
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// A DEADLINE THAT CANNOT BE UNDERSTOOD ABORTS, it does not fall back to the
// default in silence. Same criterion as CT_NEXT_LAUNCH_TIMEOUT_MS, and for the
// same reason: a badly written deadline changes what the process MEANS, and you
// would not want to find that out eight hours (or two days) later while looking
// into why nobody warned you.
export function plazo(name, fallback) {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const v = parseStrictInt(raw)
  if (v == null || v <= 0) {
    process.stderr.write(`${name} invalid: "${raw}" — it must be a number of milliseconds greater than 0.\n`)
    process.exit(2)
  }
  return v
}

// THE WATCHER OPENS THE LOG ITSELF, never whoever launches it, and it goes
// outside the repo (`~/.claude/control-tower/log/`, see
// run-metrics.js#controlTowerLogDir). Two reasons, both learned the hard way:
// outside the repo so that no `git add` of the slice sweeps it into the PR, and
// the watcher opens it because when `ct-next` opened it the suite ended up
// creating files in the real `$HOME` of whoever ran it — exactly what
// `__tests__/fixtures/hermetic-env.js` exists to prevent — and on top of that
// it left one descriptor unclosed per slice.
//
// NOT BEING ABLE TO OPEN IT DOES NOT STOP THE WATCH: losing the trace is worse
// than not having one, but far less bad than losing the warning that was being
// waited for.
export function openLog(logPath) {
  let fd = null
  if (logPath) {
    try {
      mkdirSync(dirname(logPath), { recursive: true })
      fd = openSync(logPath, 'a')
    } catch (e) {
      process.stderr.write(`warning: could not open the log ${logPath} (${e.message}) — the watch goes on anyway, with no trace on disk\n`)
    }
  }
  const log = (msg) => {
    const line = `${new Date().toISOString()} ${msg}\n`
    if (fd !== null) { try { writeSync(fd, line) } catch { /* the trace is lost, the watch is not */ } }
    process.stdout.write(line)
  }
  // `terminar` is the key the two watchers destructure; the local name is
  // English, the key stays as it crosses the module boundary.
  const finish = (code) => {
    if (fd !== null) { try { closeSync(fd) } catch { /* already done */ } }
    process.exit(code)
  }
  return { log, terminar: finish }
}
