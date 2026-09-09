#!/usr/bin/env node
// IO wrapper around scripts/conventions.js: reads the target repo and writes
// the warning (if there is one) to stdout. ct-init.sh calls it and redirects
// that to stderr alongside its other warnings.
//
// The output contract, deliberately poor so that ct-init.sh does not have to
// interpret anything:
//   exit 0  → scan completed. Empty stdout = nothing was found;
//             stdout with text = the warning, already formatted.
//   exit 1  → the scan could NOT be done (wrong usage, unreadable directory).
//             stderr explains why. The caller must NEVER read this as
//             "clean repo": that is exactly the expensive false negative.
import { statSync } from 'node:fs'
import { detectConventions, formatFindings, ACK_PATH } from './conventions.js'
import { readRepoDocs, readAck, MAX_LINKED_DOCS } from './conventions-io.js'
// The tree walk used to live here and was extracted into `repo-walk.js`: it
// shares it with `detect-yardstick.mjs` (§3.12 of the handoff, candidates for the
// repo's yardstick) so that the caps and the exclusions of the two sweeps
// cannot diverge in silence. See that file's header for the why of each rule;
// nothing that follows changes one letter of behaviour.
import { walkRepo, MAX_DEPTH, MAX_ENTRIES } from './repo-walk.js'

const target = process.argv[2]
if (!target) {
  console.error('usage: detect-conventions.mjs <dir-repo>')
  process.exit(1)
}

let files = []
let truncated = false
try {
  const st = statSync(target)
  if (!st.isDirectory()) {
    console.error(`not a directory: ${target}`)
    process.exit(1)
  }
  const r = walkRepo(target)
  files = r.entradas
  truncated = r.truncated
} catch (e) {
  console.error(`could not scan ${target}: ${e.message}`)
  process.exit(1)
}

// The documents where the instruction the dispatched agent is going to read
// lives: AGENTS.md, CLAUDE.md and —at ONE hop— the repo's `.md` files they
// cite. F14: scanning only the two root ones left the old order alive in the
// document both guides called the "full reference", that is, one click from
// the agent.
const { docs, failures, truncated: linksTruncated } = readRepoDocs(target)
const { acks, problems: ackProblems, unreadable: ackUnreadable, proseWithoutAcks: ackProseWithoutAcks } = readAck(target)

const findings = detectConventions({ docs, files, acks })
const text = formatFindings(findings, { where: 'this repo', ackProblems, ackUnreadable, ackProseWithoutAcks })
if (text) console.log(text)
for (const f of failures) {
  console.log(`  warning: the repo documentation could not be read (${f}). Do NOT read that as "there is nothing there": it has not been looked at.`)
}
// Acknowledgement hygiene, and only here: /ct-init does the COMPLETE scan (all
// three signals), so it is the only moment at which "this line no longer
// silences anything" is an honest claim. Without this the acknowledgement file
// turns into a permanent gap: someone acknowledges `estado` in July, in
// September resolves the state file, and the line is still there covering up
// any foreign state that turns up tomorrow.
for (const [id, ack] of acks) {
  if (findings.some((f) => f.id === id)) continue
  console.log(
    `  note: ${ACK_PATH}:${ack.line} acknowledges \`${id}\` but there is no longer any signal of that kind in this repo. ` +
      'Delete it: while it is there, it silences in advance any convention of that kind that turns up tomorrow.'
  )
}
if (linksTruncated) {
  console.log(
    `  note: AGENTS.md/CLAUDE.md cite more than ${MAX_LINKED_DOCS} \`.md\` documents of the repo and only the ` +
      'first ones have been looked at. An old instruction may be left in the ones that were not read.'
  )
}
if (truncated) {
  console.log(
    `  note: the scan was cut short at ${MAX_ENTRIES} files (or ${MAX_DEPTH} levels deep), ` +
      'so there may be conventions of its own that were not looked at. Absence of a warning here is not proof of absence.'
  )
}
