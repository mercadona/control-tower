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
// shares it with `detect-vara.mjs` (§3.12 of the handoff, candidates for the
// repo's yardstick) so that the caps and the exclusions of the two sweeps
// cannot diverge in silence. See that file's header for the why of each rule;
// nothing that follows changes one letter of behaviour.
import { walkRepo, MAX_DEPTH, MAX_ENTRIES } from './repo-walk.js'

const target = process.argv[2]
if (!target) {
  console.error('uso: detect-conventions.mjs <dir-repo>')
  process.exit(1)
}

let files = []
let truncated = false
try {
  const st = statSync(target)
  if (!st.isDirectory()) {
    console.error(`no es un directorio: ${target}`)
    process.exit(1)
  }
  const r = walkRepo(target)
  files = r.entradas
  truncated = r.truncated
} catch (e) {
  console.error(`no se ha podido escanear ${target}: ${e.message}`)
  process.exit(1)
}

// The documents where the instruction the dispatched agent is going to read
// lives: AGENTS.md, CLAUDE.md and —at ONE hop— the repo's `.md` files they
// cite. F14: scanning only the two root ones left the old order alive in the
// document both guides called the "full reference", that is, one click from
// the agent.
const { docs, failures, truncated: linksTruncated } = readRepoDocs(target)
const { acks, problems: ackProblems, unreadable: ackUnreadable, prosaSinAcuses: ackProsaSinAcuses } = readAck(target)

const findings = detectConventions({ docs, files, acks })
const text = formatFindings(findings, { where: 'este repo', ackProblems, ackUnreadable, ackProsaSinAcuses })
if (text) console.log(text)
for (const f of failures) {
  console.log(`  aviso: no se ha podido leer la documentación del repo (${f}). NO lo leas como "ahí no hay nada": no se ha mirado.`)
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
    `  nota: ${ACK_PATH}:${ack.line} acusa \`${id}\` pero ya no hay ninguna señal de ese tipo en este repo. ` +
      'Bórrala: mientras esté, silencia por adelantado cualquier convención de ese tipo que aparezca mañana.'
  )
}
if (linksTruncated) {
  console.log(
    `  nota: AGENTS.md/CLAUDE.md citan más de ${MAX_LINKED_DOCS} documentos \`.md\` del repo y solo se han ` +
      'mirado los primeros. Puede quedar una instrucción vieja en los que no se han leído.'
  )
}
if (truncated) {
  console.log(
    `  nota: el escaneo se cortó a los ${MAX_ENTRIES} ficheros (o ${MAX_DEPTH} niveles de profundidad), ` +
      'así que puede haber convenciones propias que no se hayan mirado. Ausencia de aviso aquí no es prueba de ausencia.'
  )
}
