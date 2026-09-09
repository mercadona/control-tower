#!/usr/bin/env node
// ============================================================================
// CT-GO — REISSUING THE GO OF A DISPATCH THAT IS ALREADY IN FLIGHT.
//
// F38. The go's nonce is drawn once, at dispatch time, and exists only on the
// screen of whoever dispatched. That leaves an everyday failure mode: the
// screen is lost (the session is closed, it scrolls away, it was dispatched
// yesterday) and then nobody can close the `plan` gate — the watcher does not
// start the session, and `dispatch-check --release` does not release. A slice
// stuck for having lost a scrap of paper is exactly the failure mode this repo
// has spent three rounds removing, so recovery is a piece of the mechanism,
// not an extra.
//
// WHAT IT DOES: it draws a NEW nonce, rewrites that issue's commitment (the
// previous one stops being valid in the same act — which is what is wanted: an
// old go that still worked would be one go too many) and dictates it through
// the usual channel (go-channel.js, `CT_GO_CHANNEL` included).
//
// WHAT IT DOES NOT DO, on purpose: it does NOT relaunch the watcher. Whatever
// watcher is alive is looking for the PREVIOUS commitment, so after answering
// the new go you will have to push the session by hand — which is the path
// that already existed when the watcher expired, and it is documented.
// Relaunching it from here would require the cmux workspace's title and
// duplicating the start-up of the detached child; two pieces that would only
// serve to save a manual push the person already knows how to give. It is said
// in the output, it is not hidden.
// ============================================================================

import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { newGoNonce, goCommitment } from './go-response.js'
import { writeGoCommitment } from './go-registry.js'
import { emitGoNonce } from './go-channel.js'
import { parseStrictInt } from './argnum.js'

const arg = (name) => {
  const i = process.argv.indexOf(name)
  return i === -1 ? null : process.argv[i + 1] ?? null
}

const usage = 'uso: ct-go.mjs --issue N --repo owner/name'
const issueRaw = arg('--issue')
const repo = arg('--repo')
const issue = parseStrictInt(String(issueRaw ?? ''))
if (!issueRaw || issue == null || issue <= 0 || !repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
  process.stderr.write(`${!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo) ? '--repo debe ser owner/name' : `--issue inválido: "${issueRaw}" — un número de issue en dígitos decimales`}\n${usage}\n`)
  process.exit(2)
}

const nonce = newGoNonce(randomBytes(4))
const commitment = goCommitment(nonce)
let path
try {
  path = writeGoCommitment({
    repo, issue, commitment,
    configDir: process.env.CLAUDE_CONFIG_DIR || null,
    home: homedir(),
  })
} catch (e) {
  process.stderr.write(`no se ha podido registrar el go de ${repo}#${issue}: ${e.message}. Sin registro, \`dispatch-check --release\` seguirá negándose (exit 9): el compromiso vive fuera del repo a propósito, así que comprueba los permisos de esa carpeta.\n`)
  process.exit(1)
}

console.log(`go de ${repo}#${issue} reemitido — el anterior (si había) ya no vale. Registro: ${path}`)
emitGoNonce(issue, nonce)
console.log(`  OJO: el vigilante que lanzó /ct-next (si sigue vivo) está buscando el go ANTERIOR, así que tras contestar tendrás que empujar la sesión a mano.`)
