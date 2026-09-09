#!/usr/bin/env node
// IO wrapper around scripts/repo-yardstick.js: it sweeps the target repository and writes
// to stdout the candidates for its yardstick (`.agent/conventions.md`), if there
// are any. ct-init.sh calls it, and prints it WITHOUT redirecting to stderr —
// unlike its sibling `detect-conventions.mjs`.
//
// NAME TRAP, documented on purpose: this file is NOT
// `detect-conventions.mjs`. That other one sweeps for PROTOCOL COLLISIONS
// between the loop and the target repository (claim, worktrees, state file) and
// its output is an alarm (it goes to stderr). This one sweeps for CANDIDATES FOR
// THE REPOSITORY'S CODE YARDSTICK (§3.12, docs/prompt-juez-lo-que-queda.md) and
// its output is material for a human decision (it goes to stdout). Confusing
// them by their names would be the third trap — the first and the second are
// `scripts/conventions.js` and `conventions-io.js`, which are not this either.
//
// Output contract, deliberately poor, traced from the sibling:
//   exit 0  → sweep completed. Empty stdout = nothing to propose (either there
//             is no candidate at all, or every one there is has already been
//             declared — both are benign states); stdout with text = the
//             candidates, already formatted.
//   exit 1  → the sweep could NOT be done (incorrect usage, unreadable
//             directory). stderr explains why. The caller must NEVER read this
//             as "this repository has no conventions": nobody looked.
//
// This script NEVER writes to `.agent/conventions.md`. It only reads (the tree
// and, if it exists, the declaration itself) and proposes.
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { walkRepo } from './repo-walk.js'
import {
  CONVENTIONS_FILE,
  candidatosDeVara,
  declaradasEn,
  pareceEsqueleto,
  formatCandidatos,
} from './repo-yardstick.js'

const target = process.argv[2]
if (!target) {
  console.error('uso: detect-yardstick.mjs <dir-repo>')
  process.exit(1)
}

let entradas = []
let truncated = false
try {
  const st = statSync(target)
  if (!st.isDirectory()) {
    console.error(`no es un directorio: ${target}`)
    process.exit(1)
  }
  const r = walkRepo(target)
  entradas = r.entradas
  truncated = r.truncated
} catch (e) {
  console.error(`no se ha podido barrer ${target}: ${e.message}`)
  process.exit(1)
}

// If `.agent/conventions.md` does not exist yet (ENOENT), nothing has been
// declared: everything is proposed. If it exists and cannot be READ
// (permissions), that is not the same thing — it gets said, so that the human
// knows the list below may repeat something already declared.
let declaradas = new Set()
let notaLectura = ''
try {
  declaradas = declaradasEn(readFileSync(join(target, CONVENTIONS_FILE), 'utf8'))
} catch (e) {
  if (e.code !== 'ENOENT') {
    notaLectura =
      `  nota: ${CONVENTIONS_FILE} existe y no se ha podido leer (${String(e.message).trim()}): ` +
      'puede que alguno de los candidatos de abajo ya esté declarado.'
  }
}

const { candidatos, omitidos } = candidatosDeVara({ entradas, declaradas })
for (const c of candidatos) {
  try {
    c.esqueleto = pareceEsqueleto(readFileSync(join(target, c.ruta), 'utf8'))
  } catch {
    c.esqueleto = false
  }
}

const texto = formatCandidatos(candidatos, { omitidos, truncated })
if (texto) console.log(texto)
if (notaLectura && texto) console.log(notaLectura)
