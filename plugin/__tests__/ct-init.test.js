import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync, symlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ADDENDA } from '../scripts/kickoff.js'
import { parseState, readBlocked } from '../scripts/state.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'scripts', 'ct-init.sh')
const groomScript = join(root, 'scripts', 'ct-groom.mjs')

// F5: ct-groom.mjs --dry-run now also enumerates existing issues of `--repo`
// (a read, to detect divergence) — with no fake `gh` on the PATH, the only test
// in this file that invokes groomScript would call the machine's real `gh`
// against the fictitious repository "o/r". Same stub and same criterion as
// __tests__/ct-groom-dryrun.test.js: with no overrides, it answers "no existing
// issues", which is the right answer for a freshly created plan.
const fakeGhDir = join(root, '__tests__', 'fixtures', 'fake-gh-bin')
const fakeGhEnv = { ...process.env, PATH: `${fakeGhDir}:${process.env.PATH}` }

// extractWorkedExample: pulls out the markdown table block under "Ejemplo que
// parsea tal cual" from the AGENTS.md seeded by ct-init.sh — the same lines
// that start with "|", contiguous, up to the first line that does not start
// with "|" (the "Detalle completo..." prose that closes the section).
// F6, minor 6 — the seeded section now carries a version, and there is an
// EXPLICIT route to update an already bootstrapped repository. Shared helpers:
const MARKER_OPEN = '<!-- ct-init:slices-contract -->'
const MARKER_CLOSE = '<!-- /ct-init:slices-contract -->'
// The REAL block the previous version of the contract seeded (v1, with no
// version line), byte for byte. It lives as a fixture because it is the only
// way to really test the migration of a repository bootstrapped before F6 —
// which is exactly the case minor 6 describes (menoplus, the sandbox, any
// already initialised repository). Its hash is recorded in
// SLICES_PRISTINE_HASHES; the "recorded hashes" test (further down) checks it,
// so this file cannot drift without the suite finding out.
const V1_BLOCK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'slices-contract-v1.md'), 'utf8')

// ---------------------------------------------------------------------------
// THE BLOCKS THE SQUASH TOOK AWAY. `historicalContractBlocks()` reconstructs
// from `git rev-list HEAD`, and that source of truth has a hole it did not have
// when it was written: **a pull request merged with squash does not leave its
// intermediate commits on main**. If a branch bumped the contract twice before
// landing, the variant in the middle existed —it was pushed, and anybody could
// bootstrap a repository by cloning that ref, which is literally how a Claude
// Code plugin gets installed— but from main there is no way to see it.
//
// The real case, the one that left this file red across two merges: pull request
// #27 (branch `jjponz/prescriptive-plans`) bumped the contract to **v17** in
// `ac48fa3` (12 Aug, Juanjo) and to v18 afterwards; it was merged with SQUASH in
// `529d2f4`, so main jumped from v16 to v18 in one go and the v17 block is not
// reachable from HEAD. Its hash IS recorded in SLICES_PRISTINE_HASHES, and it
// must be: without it, a repository seeded with that variant and never touched
// gets "does not match any known version" and cannot be updated without
// `--force` — the false accusation F9 exists against. During that round real
// repositories were bootstrapped (repo-pulse, 7 slices).
//
// THE SHAPE OF THE SOLUTION, and why noting the provenance in a comment is not
// enough: a comment is believed, not checked. The block is kept as a fixture,
// byte for byte, just as the v1/v4/v5/v6/v7 ones already are, and the guard for
// "hashes that correspond to no real block" comes to accept the ones a fixture
// JUSTIFIES. That weakens the guard not at all: to justify a hash you have to
// produce content that hashes to it, which is exactly what a hash guarantees
// cannot be made up.
const SQUASHED_BLOCK_FIXTURES = ['slices-contract-v17.md']
// The ones that already existed before this and that other tests in this file
// use: historical blocks that ARE reachable from main, kept so the migration
// from each of them can be tested. They are named here only so the directory
// inventory does not accuse a file that does have an owner.
const FIXTURES_DE_OTROS_TESTS = [
  'slices-contract-v1.md', 'slices-contract-v4.md', 'slices-contract-v5.md',
  'slices-contract-v6.md', 'slices-contract-v7.md',
]
const squashedBlocks = () => SQUASHED_BLOCK_FIXTURES.map((f) => ({
  fixture: f,
  block: readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', f), 'utf8'),
}))
const initScriptSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ct-init.sh'), 'utf8')
// CONTRACT_VERSION: the contract's version is READ from ct-init.sh itself, not
// repeated by hand in every assertion. F11 bumped it from 2 to 3 and five tests
// that carried it hardcoded had to be touched — a cost that buys no guarantee
// at all (none of those tests is ABOUT the number, they just need "the version
// this script emits today").
// (F10 reached the same conclusion on its own, under another name; on
// integrating, this one is kept, and it also brings the `versionLineRe`
// helper.)
const CONTRACT_VERSION = Number(initScriptSrc.match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)[1])
const versionLineRe = () => new RegExp(`<!-- ct-init:slices-contract-version: ${CONTRACT_VERSION} -->`)

function extractBlock(agentsMd) {
  const lines = agentsMd.split('\n')
  const start = lines.indexOf(MARKER_OPEN)
  const end = lines.indexOf(MARKER_CLOSE)
  if (start === -1 || end === -1) return null
  return lines.slice(start, end + 1).join('\n') + '\n'
}
const sha256 = (s) => createHash('sha256').update(s).digest('hex')

// ---------------------------------------------------------------------------
// F9 — the contract block changed NINE times with different content, eight of
// them under the same name "v1" (the version line did not exist until F6).
// SLICES_PRISTINE_HASHES only recorded two, so an AGENTS.md seeded by plugin
// 0.5.1 and never touched got a "you edited it by hand" and was left unable to
// update. These helpers reconstruct from git's own history ALL the blocks
// ct-init.sh ever emitted: it is the list the suite compares against the
// recorded one, so that recording the new hash (or not deleting an old one)
// does not depend on somebody remembering.
function git(args, input = undefined) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
}

const prefijoDeArbolDe = (cwd) =>
  execFileSync('git', ['rev-parse', '--show-prefix'], { cwd, encoding: 'utf8' }).trim()

const rutasDeArbolPara = (cwd, ruta) => [...new Set([`${prefijoDeArbolDe(cwd)}${ruta}`, ruta])]

const existeEnElArbol = (cwd, rev, rutas) =>
  rutas.some((r) => spawnSync('git', ['cat-file', '-e', `${rev}:${r}`], { cwd }).status === 0)

// extractBlockFromSource: the block exactly as that ct-init.sh would emit it.
// The block lives inside a `<<'EOF'` heredoc with no expansion, so the lines of
// the script between the opening marker and the closing one (compared as a
// WHOLE line, which is how they never match assignments of the
// `SLICES_MARKER_OPEN='...'` sort) are literally what gets written into the
// AGENTS.md. The test `the textual extractor matches what ct-init really emits`
// checks it against a real execution, so this shortcut cannot drift in
// silence.
function extractBlockFromSource(src) {
  const lines = src.split('\n')
  const start = lines.indexOf(MARKER_OPEN)
  if (start === -1) return null
  const end = lines.indexOf(MARKER_CLOSE, start)
  if (end === -1) return null
  return lines.slice(start, end + 1).join('\n') + '\n'
}

// historicalContractBlocks: every DISTINCT block emitted by some commit
// reachable from HEAD, in order of appearance. A deliberate criterion (see the
// SLICES_PRISTINE_HASHES comment in ct-init.sh): every commit of the history,
// not only the ones that bump the plugin's version — this repository has no
// tags, a Claude Code plugin is installed by cloning a ref, and in any case
// five different blocks coexisted under the same plugin.json 0.6.0.
// It does not cover the uncommitted working tree: TODAY's block hash test takes
// care of that.
// oidsDelLedger: the ledger's blob at each commit, in ONE single invocation of
// git. It used to be up to two `git rev-parse` per commit —close to 1,900
// processes across this history—, some 20 s of pure spawn that, with another
// suite running, ate the 120 s timeout of the test that primes the cache
// (#109). `cat-file --batch-check` answers one line per input line and in the
// same order, so the answer is paired up by position; the one for an object
// that does not exist ends in `missing` and names no type.
function oidsDelLedger(commits, rutas) {
  const consulta = commits.flatMap((c) => rutas.map((r) => `${c}:${r}`)).join('\n') + '\n'
  const respuestas = git(['cat-file', '--batch-check'], consulta).split('\n')
  return commits.map((commit, i) => {
    for (let j = 0; j < rutas.length; j++) {
      const [oid, tipo] = (respuestas[i * rutas.length + j] || '').split(' ')
      if (tipo === 'blob') return { commit, oid }
    }
    return { commit, oid: '' }
  })
}

let historicalCache = null
function historicalContractBlocks() {
  if (historicalCache) return historicalCache
  let commits
  try {
    commits = git(['rev-list', 'HEAD']).trim().split('\n').filter(Boolean)
  } catch (err) {
    // Deliberately NOT skipped in silence: this is the only guard that detects
    // that SLICES_PRISTINE_HASHES is missing (or carrying one too many) a hash,
    // and skipping it without saying so is the very failure it comes to
    // prevent.
    throw new Error(
      'los tests de SLICES_PRISTINE_HASHES necesitan el historial de git del plugin ' +
        '(reconstruyen desde ahí todos los bloques del contrato que ct-init llegó a emitir). ' +
        `No se ha podido leer: ${err.message}`
    )
  }
  const oids = []
  const seenOid = new Set()
  const rutasDelLedger = rutasDeArbolPara(root, RUTA_LEDGER)
  for (const { commit, oid } of oidsDelLedger(commits, rutasDelLedger)) {
    if (oid && !seenOid.has(oid)) { seenOid.add(oid); oids.push({ oid, commit }) }
  }
  const blocks = []
  const seenBlock = new Set()
  for (const { oid, commit } of oids) {
    const block = extractBlockFromSource(git(['cat-file', 'blob', oid]))
    if (!block || seenBlock.has(block)) continue // pre-F2 (it seeded nothing yet), or already seen
    seenBlock.add(block)
    blocks.push({ block, commit: commit.slice(0, 7), hash: sha256(block) })
  }
  historicalCache = blocks
  return blocks
}

// bloquesEmitidos: the reachable history PLUS the blocks the squash took away
// (SQUASHED_BLOCK_FIXTURES, above). It is the answer to "what did ct-init ever
// EMIT?", which is not "what is on main?": the upgrade path and the vN-1 block
// path both ask it, and both times the right answer includes v17. It derives
// from the list above — there is no second list of hidden blocks, and each
// one's provenance is proved by its own test further down. `commit` is the name
// of the FIXTURE on purpose: for a block that no reachable commit reproduces,
// the honest label is the file that keeps it, not a sha that cannot be resolved
// in a clean clone.
const bloquesEmitidos = () => [
  ...historicalContractBlocks(),
  ...squashedBlocks().map(({ fixture, block }) => ({ block, fixture, commit: fixture, hash: sha256(block) })),
]

// ---------------------------------------------------------------------------
// Slice 8 (LOW finding of the review of pull request #36) — PROVENANCE of the
// blocks kept because of a squash. Slice 4 fixed the ledger test with
// SQUASHED_BLOCK_FIXTURES, and with that the self-watch went from "git proves
// it" to "git OR a file of this very commit proves it": the pair (ledger entry,
// fixture) was validated against itself, because the fixture is editable in the
// SAME commit that records its hash. It is not forgeable —nobody manufactures a
// file with a chosen sha256— but it is DEGRADABLE: a block ct-init never
// published could get into the pristine list without any test noticing, and
// from then on `--update-slices-contract` would accept it without --force.
//
// What tied down the v17 case was not the fixture: it was that its hash was
// already on main EIGHT DAYS before the fixture existed. That is INDEPENDENT
// evidence, and it is what is demanded here of every fixture in the list,
// present and future.
//
// The check, in one sentence: the commit that put the hash into the ledger did
// NOT yet contain the fixture. Deliberately, the fixture is NOT dated and
// ancestors are NOT compared:
//   - dating the addition and looking at its parent commit breaks with merges
//     (`^` is `^1`), with a fixture deleted and re-added, and with a rename;
//   - demanding `merge-base --is-ancestor <witness> <fixture-commit>` catches NO
//     case the step below does not catch already, and it would go red when the
//     ledger entry arrives on one branch and the fixture on another (this
//     repository's v19/v20/v21/v22 numbering race, twice over).
// This shape, by contrast, is MONOTONIC (a valid witness stays valid after any
// future merge) and tolerates the working tree running ahead of the history,
// which is the normal state halfway through a slice.
//
// What this does NOT do, said so nobody oversells it: an attacker with TWO
// commits (1st the hash, 2nd the fixture) passes this check. What closes the
// hole is the PAIR of tests — in that 1st commit the hash is recorded with no
// backing, and the test "it records no hashes of blocks that never existed" is
// RED. Over a history with the suite green at every commit, a false pristine
// entry is impossible: you have to pass through a red commit.
//
// This test does NOT duplicate the fixture's two guards, which prove something
// else: theirs proves the block EXISTS (the file hashes to the recorded hash);
// this one, that whoever added the file did not MAKE IT UP. And noting the
// provenance in the ledger's comment is not enough —the one on the v17 line
// tells it— for the same reason its own message gives for the fixture: a
// comment is believed, not checked. Both say the same thing; only one goes
// red.
const RUTA_LEDGER = 'scripts/ct-init.sh'
const RUTA_FIXTURES = '__tests__/fixtures'

// procedenciaDelBloqueGuardado: returns null if the provenance is proved, or the
// REASON (a string) if not. The repository is a PARAMETER —not the `git()`
// above, which has `root` fixed— precisely so the negative test can run this
// very function against a toy repository built with `git init`, instead of
// reimplementing it (a negative test that reimplements what it judges judges
// nothing).
function procedenciaDelBloqueGuardado({ cwd, fixture, hash }) {
  const g = (args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const rutaFixture = `${RUTA_FIXTURES}/${fixture}`
  const rutasDelLedger = rutasDeArbolPara(cwd, RUTA_LEDGER)
  const rutasDelFixture = rutasDeArbolPara(cwd, rutaFixture)
  const existeEn = (rev, rutas) => existeEnElArbol(cwd, rev, rutas)
  // An anti-tautology check: were these relative paths to stop existing (some
  // day the fixtures directory or the script gets moved), the `cat-file -e`
  // below would ALWAYS fail and the check would quietly become empty — exactly
  // the failure mode this slice comes to close. Looking at the disk is not
  // enough: the `git mv` to `plugin/` left the file where `existsSync` sees it
  // and where `cat-file` no longer does. Making sure the TREE paths still name
  // something is the job of "the fixtures and the ledger are looked up by paths
  // that HEAD's TREE resolves", which judges the real repository; not here,
  // because a toy repository with nothing committed is a legitimate case with a
  // diagnostic of its own.
  if (!existsSync(join(cwd, RUTA_LEDGER))) return `no existe ${RUTA_LEDGER} en ${cwd}`
  if (!existsSync(join(cwd, rutaFixture))) return `no existe ${rutaFixture} en ${cwd}`
  // The commit that introduced the hash into the ledger. `git log` with no
  // revision = reachable from HEAD, which is the only durable base. It is also
  // the reason SQUASHED_BLOCK_FIXTURES is a list of FILE NAMES and not of
  // (file, commit) pairs: the shas the ledger's prose cites for v17 (743fe3f,
  // ac48fa3) are NOT reachable from HEAD — using them as a ref works on this
  // machine and breaks in a clean clone.
  // Reverse chronological, so the oldest one is the last.
  const testigos = g(['log', '--format=%H', `-S${hash}`, '--', ...rutasDelLedger.map((r) => `:(top)${r}`)])
    .trim().split('\n').filter(Boolean)
  if (testigos.length === 0) {
    return (
      `${fixture}: el hash ${hash.slice(0, 12)}… no entró en ${RUTA_LEDGER} en ningún commit ` +
      `alcanzable desde HEAD. La entrada del ledger no tiene procedencia: o solo existe en el ` +
      `árbol de trabajo, o el bloque nunca lo emitió ct-init`
    )
  }
  const testigo = testigos[testigos.length - 1]
  if (existeEn(testigo, rutasDelFixture)) {
    return (
      `${fixture}: el commit que metió el hash en el ledger (${testigo.slice(0, 7)}) YA traía ` +
      `${rutaFixture}. El par (entrada, fixture) se valida contra sí mismo: no hay evidencia ` +
      `independiente de que ct-init emitiera ese bloque`
    )
  }
  return null
}

// exigirHistorialCompleto: the SAME stance as historicalContractBlocks() —
// with no history it is NOT skipped in silence, because "it is not known" is
// not "it is fine" (it is the third state ct-init.sh already tells apart when
// it cannot compute the sha256). Two ways of not having it, and `rev-list` only
// detects one:
//   - no .git: the npm tarball packs __tests__/ but never .git, so `rev-list`
//     fails;
//   - a shallow clone: `rev-list` does NOT fail, it returns fewer commits, and
//     the witness ends up below the graft. Without this branch the test would
//     say "the hash never entered the ledger", ACCUSING A CORRECT LEDGER OF
//     FORGERY.
// This file has demanded a complete history since F9 (the two
// `toBeGreaterThanOrEqual(9)` checks fail with --depth 1): it is not a new
// requirement.
function exigirHistorialCompleto() {
  try {
    git(['rev-list', '-1', 'HEAD'])
  } catch (err) {
    throw new Error(
      'la comprobación de procedencia de SQUASHED_BLOCK_FIXTURES necesita el historial de git del ' +
        'plugin (busca en él el commit que metió cada hash en el ledger). ' +
        `No se ha podido leer: ${err.message}`
    )
  }
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error(
      'la comprobación de procedencia de SQUASHED_BLOCK_FIXTURES no se puede hacer en un clon shallow: ' +
        'el commit que metió el hash en el ledger puede quedar por debajo del injerto, y el test ' +
        'acusaría de forja a un ledger correcto. Corre `git fetch --unshallow`.'
    )
  }
}

// seedFreshAgentsMd: runs ct-init.sh in an empty directory and returns the
// AGENTS.md it seeds.
function seedFreshAgentsMd() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('bash', [script, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return agents
}

// #93 — the contract left AGENTS.md for its own file in the governed
// repository. The block is THE SAME byte for byte (markers, version line and
// body), and that is why everything this file watches —the hash ledger, the
// textual extractor of the history, the doctrine of versions— still holds
// without touching a single entry: the only thing that changes is which file
// gets searched.
const CONTRATO_REL = ['docs', 'superpowers', 'CONTRATO-SLICES.md']
const contratoPath = (dir) => join(dir, ...CONTRATO_REL)
const leerContrato = (dir) => readFileSync(contratoPath(dir), 'utf8')

// seedFreshContrato: TODAY's block exactly as it comes out of the script (not
// read from its source), which is what the hash ledger and the textual
// extractor above are validated against.
function seedFreshContrato() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-'))
  execFileSync('bash', [script, dir], { encoding: 'utf8' })
  const contrato = leerContrato(dir)
  rmSync(dir, { recursive: true, force: true })
  return contrato
}

// conContrato: a contract file with text of the repository's own around the
// block. It is the scenario that matters in every update test: what is outside
// the block is never touched.
const conContrato = (bloque, nota = 'mías') =>
  `# Contrato de slices\n\n## Notas\n- ${nota}\n\n${bloque}\n## Después\n- intocable\n`

// sembrarContrato: writes that file in the place where ct-init looks for it.
function sembrarContrato(dir, contenido) {
  mkdirSync(dirname(contratoPath(dir)), { recursive: true })
  writeFileSync(contratoPath(dir), contenido)
  return contenido
}

// E2E_MARKER_OPEN/CLOSE + E2E_BLOCK: task 5 of "e2e at the slice's closure"
// added a SECOND section that ct-init seeds (the journey one), which gets added
// WHENEVER it is missing, no matter what state the slices contract section is
// in. Many of the tests below write an AGENTS.md that carries only the contract
// (to test THEIR logic in isolation) and check with `toBe` that the file is left
// byte for byte the same — an assumption that held true until the journey
// section existed. Now those fixtures receive that section too (correctly: a
// repository bootstrapped before this task also receives it on its next run), so
// their assertions have to account for the added block. E2E_BLOCK is computed
// ONCE by running the script (never copied by hand), so a future change in the
// text does not make this constant drift in silence.
const E2E_MARKER_OPEN = '<!-- ct-init:e2e-howto -->'
const E2E_MARKER_CLOSE = '<!-- /ct-init:e2e-howto -->'
function extractE2eBlock(agentsMd) {
  const lines = agentsMd.split('\n')
  const start = lines.indexOf(E2E_MARKER_OPEN)
  const end = lines.indexOf(E2E_MARKER_CLOSE)
  if (start === -1 || end === -1) return null
  return lines.slice(start, end + 1).join('\n') + '\n'
}
const E2E_BLOCK = extractE2eBlock(seedFreshAgentsMd())

// #93 — the loop's short section, the one that stays in AGENTS.md in the place
// the contract left. It is computed like E2E_BLOCK, by running the script, so a
// change in its text does not make this constant drift in silence.
const LOOP_MARKER_OPEN = '<!-- ct-init:loop -->'
const LOOP_MARKER_CLOSE = '<!-- /ct-init:loop -->'
function extractLoopBlock(agentsMd) {
  const lines = agentsMd.split('\n')
  const start = lines.indexOf(LOOP_MARKER_OPEN)
  const end = lines.indexOf(LOOP_MARKER_CLOSE)
  if (start === -1 || end === -1) return null
  return lines.slice(start, end + 1).join('\n') + '\n'
}
const LOOP_BLOCK = extractLoopBlock(seedFreshAgentsMd())

// withE2eAppended: reproduces EXACTLY what ct-init.sh does when adding its
// sections to an AGENTS.md that does not carry them yet — it makes sure of a
// trailing newline, adds a blank line, and pastes the block. `crlf` does the
// same as the script's `file_is_crlf`/`replace_slices_block`: if the starting
// file uses CRLF, the blank line and the block are written with the same line
// endings. `loop: false` is for the case in which the AGENTS.md already carries
// the contract inside it (one bootstrapped before #93): there the short section
// is NOT added, because it would be a second copy of the same thing, and the
// migration warning comes out instead.
function withE2eAppended(before, { crlf = false, loop = true } = {}) {
  let out = before
  const nl = crlf ? '\r\n' : '\n'
  const pegar = (bloque) => {
    if (out.length && !out.endsWith(nl)) out += nl
    out += nl
    out += crlf ? bloque.replace(/\n/g, '\r\n') : bloque
  }
  if (loop) pegar(LOOP_BLOCK)
  pegar(E2E_BLOCK)
  return out
}

function extractWorkedExample(agentsMd) {
  const lines = agentsMd.split('\n')
  const startIdx = lines.findIndex((l) => l.includes('Ejemplo que parsea tal cual'))
  const tableLines = []
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (lines[i].trim().startsWith('|')) tableLines.push(lines[i])
    else if (tableLines.length) break
  }
  return tableLines.join('\n') + '\n'
}

describe('ct-init.sh', () => {
  it('creates .agent/STATE.md and AGENTS.md in an empty directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(existsSync(join(dir, '.agent', 'STATE.md'))).toBe(true)
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
  // F7: the seeded STATE.md has to carry the `blocked` field — and it has to
  // stay a parseable STATE.md with the field inside (not just a stray comment
  // nobody reads).
  it('the seeded STATE.md carries `blocked: null` and explains what it is for', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const state = readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')
    expect(state).toMatch(/^blocked: null$/m)
    expect(state).toMatch(/reason:/)
    expect(state).toMatch(/unblock:/)
    const { meta } = parseState(state)
    expect(meta.blocked).toBe(null)
    expect(readBlocked(meta).state).toBe('none')
    // And the other field that reads badly cold is left with its tense written out.
    expect(state).toMatch(/PENDING/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Tightening the format creates a new category: the STATE.md files older than
  // the field. They still work (they are read as NOT blocked) but their owner
  // would never find out that another way of saying it now exists.
  it('a pre-existing STATE.md WITHOUT the `blocked` field → it is not touched, but it is said that the field exists and how to use it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "lo mío"\nnext_action: "seguir"\n---\ncuerpo')
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(out).toMatch(/no se pisa/)
    expect(out).toMatch(/`blocked`/)
    expect(out).toMatch(/unblock/)
    expect(readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')).toContain('task: "lo mío"')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a pre-existing STATE.md that ALREADY declares `blocked` → the warning is not repeated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), '---\ntask: "lo mío"\nblocked: null\n---\ncuerpo')
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(out).toMatch(/STATE\.md ya existe, no se pisa/)
    expect(out).not.toMatch(/unblock/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('idempotent: it does not tread on an existing STATE.md', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    mkdirSync(join(dir, '.agent'))
    writeFileSync(join(dir, '.agent', 'STATE.md'), 'MÍO')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, '.agent', 'STATE.md'), 'utf8')).toBe('MÍO')
    rmSync(dir, { recursive: true, force: true })
  })
  it('idempotent: it does not tread on an existing AGENTS.md (it preserves its content, it only adds the §9 section if missing)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, 'AGENTS.md'), 'MÍO-AGENTS')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // The user's content is neither touched nor reordered...
    expect(agents.startsWith('MÍO-AGENTS')).toBe(true)
    // ...but the loop's short section is added all the same, because this
    // AGENTS.md did not carry it — and the whole contract is seeded in its own
    // file.
    expect(agents).toContain(LOOP_MARKER_OPEN)
    expect(leerContrato(dir)).toContain(MARKER_OPEN)
    rmSync(dir, { recursive: true, force: true })
  })

  // F2: the §9 table contract (which columns /ct-groom demands, which "no
  // value" markers it accepts, what each one generates) until now lived only in
  // commands/ct-groom.md — a file read by whoever RUNS groom, never by whoever
  // WRITES the spec. `ct-init` must seed that contract in the target
  // repository's AGENTS.md, which whoever writes specs does read.
  it('a new AGENTS.md: the skeleton already carries the §9 section (the contract with /ct-groom)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toContain('<!-- ct-init:slices-contract -->')
    expect(agents).toContain('| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca |')
    rmSync(dir, { recursive: true, force: true })
  })

  // F3: the seeded contract hid that "Tipo" decides the dispatched agent's
  // addendum, and that the issue's title comes from "Slice" (not from
  // "Entrega") — see the finding of the real spec that triggered this change.
  it('a new AGENTS.md: the §9 section says that "Slice" is mandatory and feeds the title, and that "Entrega" is optional (Descripción)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toMatch(/\*\*Slice\*\* \*\(obligatoria\)\*/)
    expect(agents).toMatch(/T.TULO/i)
    expect(agents).toMatch(/\*\*Entrega\*\* \*\(opcional\)\*/)
    expect(agents).toContain('Descripción')
    rmSync(dir, { recursive: true, force: true })
  })

  // F3's review, finding 2: this assertion used to list the four types as
  // hand-written literals ('ui'/'backend'/'infra'/'bugfix') — if somebody adds a
  // fifth addendum to ADDENDA (kickoff.js), ct-groom.mjs's runtime warning would
  // reflect it on its own (it derives from Object.keys(ADDENDA)), but this test
  // would stay GREEN with the seeded prose saying only four, without detecting
  // the drift. It derives from ADDENDA instead of hardcoding a third copy of the
  // list: the test watches itself, there is no need to touch it when a new type
  // is added.
  it('a new AGENTS.md: the §9 section names ALL the recognised "Tipo" values (derived from ADDENDA, not a hardcoded list) and that they decide the addendum', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toMatch(/addendum/i)
    expect(Object.keys(ADDENDA).length).toBeGreaterThan(0) // a check: were ADDENDA to be left empty, the .every() below would pass empty and prove nothing
    expect(Object.keys(ADDENDA).every((t) => agents.includes(`\`${t}\``))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  // An explicit requirement: the seeded example must keep really parsing — it is
  // extracted exactly as it is from the generated AGENTS.md (not a paraphrased
  // copy in the test) and run through ct-groom.mjs --dry-run.
  it('the seeded example ("Ejemplo que parsea tal cual") really parses with ct-groom.mjs --dry-run: 3 issues, titles from "Slice"', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    const table = extractWorkedExample(agents)
    expect(table).toContain('| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |')
    const specDir = mkdtempSync(join(tmpdir(), 'ct-example-'))
    const specPath = join(specDir, 'spec.md')
    // The wrapper (hypothesis + section heading) is put in by the TEST, not by
    // the seeded example: the contract block documents the TABLE and does not
    // grow past F32's freeze gate (the rule: the contract does not grow without
    // removing). A real spec carries its "## Hipótesis" from the template.
    writeFileSync(specPath, `## Hipótesis\n\nApuesta del fixture.\n\n## 9. Desglose en slices\n${table}`)
    // F21: the example now brings a row with a declared gate, so the groom warns
    // on stderr (that is its job: a gate that does not come from Tipo gets said
    // out loud). That stderr is EXPECTED here — it is captured instead of echoed
    // to the output of `npm test`, just as ct-groom-dryrun.test.js does.
    const out = execFileSync('node', [groomScript, specPath, '--repo', 'o/r', '--milestone', 'Epic', '--dry-run'], { encoding: 'utf8', env: fakeGhEnv, stdio: ['ignore', 'pipe', 'pipe'] })
    const plan = JSON.parse(out)
    expect(plan.issues).toHaveLength(3)
    expect(plan.issues[0].title).toBe('#1 modelo')
    expect(plan.issues[1].title).toBe('#2 barra')
    expect(plan.issues[2].title).toBe('#3 pantalla')
    expect(plan.issues[0].body).toContain('tabla `medicamentos`') // Entrega -> Descripción
    // F21: the seeded example does not only parse — it DEMONSTRATES the Gate
    // column. Row 2 is `backend` with `Gate: visual` (the real case that
    // motivated the column) and row 3 is `ui` declaring nothing, which receives
    // its gate all the same. If somebody swapped the example for one that
    // exercises neither of the two paths, this finds out.
    expect(plan.issues[1].labels).toContain('gate:visual') // declared, against its Tipo
    expect(plan.issues[2].labels).toContain('gate:visual') // implicit, from Tipo: ui
    expect(plan.issues[0].labels).toContain('gate:plan') // F-jjponz-2: the universal default, in the example too
    // Slice 10: the example DEMONSTRATES the Señal column in its three forms —
    // row 2 declares its signal (a section in the body, verbatim), row 3 exempts
    // itself with a reason (N/A — <razón>, also into the body), and row 1
    // declares nothing (no section). Copied from the gate asserts: if somebody
    // swapped the example for one that does not exercise the three paths, this
    // finds out.
    expect(plan.issues[1].body).toContain('## Señal de observabilidad')
    expect(plan.issues[1].body).toContain('métrica `backfill_progress` con label `estado`')
    expect(plan.issues[2].body).toContain('N/A — pantalla sin telemetría nueva que prometer')
    expect(plan.issues[0].body).not.toContain('## Señal de observabilidad')
    rmSync(dir, { recursive: true, force: true })
    rmSync(specDir, { recursive: true, force: true })
  })

  // Slice 10 — the contract (v19, today v20 after converging with the E2E
  // column) documents the Señal column: what it is, how it is exempted (`N/A —
  // <razón>`, and that without a reason it aborts), where it ends up (body
  // section → SLICE.md → the slice judge's package → observability item) and
  // that a cell with no value is measured as sin-vara in the epic's telemetry.
  // A v18 can deduce none of those things.
  it('the contract documents the Señal column: the N/A — <razón> exemption, where it ends up and that no value is sin-vara', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toContain('**Señal** *(opcional)*')
    expect(agents).toContain('N/A — <razón>')
    expect(agents).toMatch(/exención sin razón|exención SIN razón/i)
    expect(agents).toContain('## Señal de observabilidad')
    expect(agents).toContain('.agent/SLICE.md')
    expect(agents).toContain('`observabilidad`')
    expect(agents).toContain('`sin-vara`')
    // The line of "no value" markers names Señal too.
    expect(agents).toContain('Marcadores de "sin valor" (`Dep`/`Acepta`/`Protegido`/`Área`/`Toca`/`Gate`/`Señal`):')
    rmSync(dir, { recursive: true, force: true })
  })

  // Slice 4 (Capde's notes) — the v19 contract described the column but did not
  // say when it is worth anything, and on a real run the declared signal was a
  // paraphrase of the acceptance criteria: the judge's `observabilidad` item
  // measured what `estado-final` had already measured. The sentence lives in TWO
  // places (the contract that reaches the user repository's AGENTS.md verbatim
  // and the command whoever grooms reads) and this test is what stops one of the
  // two from falling behind.
  it('the contract says the signal is not one more acceptance criterion, and ct-groom.md says the same', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    // The sentence, on a single line (the bullet is wrapped at ~72 columns: if
    // the reflow broke it, this assert is what catches it).
    expect(agents).toMatch(/no es un criterio de aceptación más/i)
    // And what the sentence promises: production against the functional, and the
    // item that is left measuring nothing new when the signal repeats an AC.
    expect(agents).toMatch(/EN PRODUCCIÓN/)
    expect(agents).toContain('`estado-final`')
    expect(agents).toContain('`observabilidad`')
    // A check: up to v21 the contract said none of this — this test does not
    // pass on a coincidence of prose that was already there. The check is
    // anchored to THAT version and not to `CONTRACT_VERSION - 1`: the sentence
    // came in with v22, so as soon as a later bump is about something else (#93's
    // v23, to look no further) «the previous version» already carries it and
    // stops checking anything.
    const VERSION_SIN_LA_FRASE = 21
    const anterior = bloquesEmitidos().find(({ block }) =>
      block.includes(`<!-- ct-init:slices-contract-version: ${VERSION_SIN_LA_FRASE} -->`)
    )
    expect(anterior, `no hay ningún bloque v${VERSION_SIN_LA_FRASE} ni en la historia ni en SQUASHED_BLOCK_FIXTURES`).toBeDefined()
    expect(anterior.block).not.toMatch(/no es un criterio de aceptación más/i)
    expect(anterior.block).not.toContain('`estado-final`')
    // The other document that teaches the column cannot fall behind: whoever
    // grooms reads /ct-groom's reference, not the target repository's contract.
    // Since #93 that reference lives outside the plugin, in the repository's
    // docs/loop/ct-groom.md (commands/ct-groom.md kept the invocation and the
    // exit codes), so it is read from there.
    const groom = readFileSync(join(root, '..', 'docs', 'loop', 'ct-groom.md'), 'utf8')
    expect(groom).toMatch(/no es un criterio de aceptación más/i)
    expect(groom).toContain('`estado-final`')
    // Slice 7: and the JUDGE measures by the SAME rule, in the same words. Slice
    // 4's gap was exactly this: the sentence went into both documents and `git
    // diff main...HEAD -- agents/` came out empty, so a signal copied straight
    // from the ACs still satisfied the item's three checks. Normalised because
    // the contract's bullet is wrapped at ~72 columns.
    const norm = (s) => s.replace(/\s+/g, ' ')
    const REGLA = 'se puede comprobar corriendo los tests, es un criterio de aceptación, no una señal'
    expect(norm(agents)).toContain(REGLA)
    expect(norm(groom)).toContain(REGLA)
    const juez = readFileSync(join(root, 'agents', 'ct-slice-judge.md'), 'utf8')
    expect(norm(juez)).toContain(REGLA)
    // The token with which telemetry/`grep` tells this low apart from the item's
    // other lows, in the two texts that promise it.
    expect(norm(juez)).toContain('`señal redundante`')
    expect(norm(groom)).toContain('`señal redundante`')
    rmSync(dir, { recursive: true, force: true })
  })

  // Slice 7: the `observabilidad` item quotes the contract's rule between « »,
  // and that quotation has to be LITERAL. The same pattern kickoff.test.js uses
  // with «it opens with `(sin señal declarada`»: the quotation is extracted FROM
  // THE AGENT'S FILE and checked against the source, so the groom's criterion and
  // the judgement's criterion cannot each drift on their own.
  it('the slice judge\'s quotation is literally the contract\'s rule', () => {
    const norm = (s) => s.replace(/\s+/g, ' ')
    const juez = readFileSync(join(root, 'agents', 'ct-slice-judge.md'), 'utf8')
    const cita = /«([^»]+)»/.exec(juez)
    expect(cita).not.toBeNull()
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const bloque = extractBlock(leerContrato(dir))
    // BOTH normalised: the agent's quotation is wrapped at ~73 columns and the
    // contract's bullet at ~72, so neither of the two contains the other without
    // collapsing the line breaks. (Verified: without normalising `cita[1]`, this
    // test fails.)
    expect(norm(bloque)).toContain(norm(cita[1]))
    rmSync(dir, { recursive: true, force: true })
  })

  // A check on the five tests that follow: the PREVIOUS contract (the fixture
  // slices-contract-v1.md, the real block the earlier version seeded) said none
  // of these five things. Without this check, any of those tests could be
  // passing on a coincidence of prose instead of on the content F6 adds.
  it('check: the previous contract (v1) said nothing of this — the five tests that follow do not pass by accident', () => {
    expect(V1_BLOCK).not.toContain('status:backlog')
    expect(V1_BLOCK).not.toContain('status:ready')
    expect(V1_BLOCK).not.toContain('\\,')
    expect(V1_BLOCK).not.toContain('--milestone')
    expect(V1_BLOCK).not.toContain('--section')
    expect(V1_BLOCK).not.toContain('--project')
    expect(V1_BLOCK).not.toContain('gh label list')
    expect(V1_BLOCK).not.toContain('merge-after `#N`')
  })

  // F6, serious 2: the contract did not mention `status:backlog` even once.
  // Whoever reads only AGENTS.md groomed a whole epic and found out afterwards
  // that /ct-next saw none of those issues.
  it('the contract says issues are born in status:backlog, that promoting them to status:ready is a human step, and with which command', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toContain('status:backlog')
    expect(agents).toContain('status:ready')
    expect(agents).toMatch(/humano/i)
    expect(agents).toContain('gh issue edit')
    expect(agents).toMatch(/ct-next/)
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, important 3: "comma-separated" without saying what happens with a comma
  // INSIDE a criterion — and the section it generates is called "Acceptance
  // criteria (EARS…)", where the comma is all but mandatory.
  it('the contract explains that the comma always separates in "Acepta" and how to escape it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toContain('\\,')
    expect(agents).toMatch(/Protegido[\s\S]{0,400}la coma\s+\*\*no\*\*/i) // and where it does NOT separate
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, important 4: the contract spoke of "the §9 table" as if it were a fixed
  // place, without saying where the section number comes from, whether the
  // milestone is mandatory, nor why --project has the restrictions it has.
  it('the contract explains which of the author\'s decisions depend on --milestone/--section/--project', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toContain('--milestone')
    expect(agents).toContain('--section')
    expect(agents).toContain('--project')
    expect(agents).toMatch(/únicos \*\*dentro de su milestone\*\*/i) // the real scope of the "#"s
    expect(agents).toMatch(/cabecera/i) // the table is located by its header, not by the section number
    expect(agents).toContain('Sprint')
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, minor 5: "reuse the vocabulary that already exists" without saying how
  // to check it.
  it('the contract says how to check which labels already exist in the repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toContain('gh label list')
    rmSync(dir, { recursive: true, force: true })
  })

  // F6, serious 1: whoever writes the table has to know that the "#N" they will
  // see in the issue's body is NOT an issue number.
  it('the contract warns that merge-after\'s "#N" is the table\'s order, not a GitHub issue', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = leerContrato(dir)
    expect(agents).toContain('merge-after `#N`')
    expect(agents).toMatch(/nunca un número de issue/i)
    expect(agents).toContain('ct-order')
    rmSync(dir, { recursive: true, force: true })
  })

  it('an existing AGENTS.md WITHOUT the loop section → it is added without touching the rest (the "heavily hand-edited" case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const heavilyEdited = [
      '# AGENTS.md',
      '',
      '## Project overview',
      'Mi proyecto rarísimo con notas personales de Jose que no se deben perder.',
      '',
      '## Gotchas',
      '- ojo con el símbolo `#` en mis propias notas, no es un slice',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), heavilyEdited)
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('Mi proyecto rarísimo con notas personales de Jose que no se deben perder.')
    expect(agents).toContain('ojo con el símbolo `#` en mis propias notas, no es un slice')
    expect(agents).toContain(LOOP_MARKER_OPEN)
    // The added section goes AFTER the existing content, it does not displace it.
    expect(agents.indexOf('notas personales')).toBeLessThan(agents.indexOf(LOOP_MARKER_OPEN))
    // And the whole contract does not go into AGENTS.md: it lives in its file.
    expect(agents).not.toContain(MARKER_OPEN)
    expect(leerContrato(dir)).toContain(MARKER_OPEN)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an existing AGENTS.md WITHOUT a trailing newline → it adds the loop section without corrupting the user\'s last line', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, 'AGENTS.md'), '## Gotchas\n- última línea sin salto') // no trailing \n, on purpose
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toContain('- última línea sin salto')
    expect(agents).not.toMatch(/salto<!--/) // never merged onto the same line
    expect(agents).not.toMatch(/salto##/)
    expect(agents).toContain(LOOP_MARKER_OPEN)
    rmSync(dir, { recursive: true, force: true })
  })

  it('AGENTS.md already carries the contract inside it (hand-edited by the user) → it is neither duplicated nor trodden on, and it does not receive the short section either', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const customSection = [
      '# AGENTS.md',
      '',
      '<!-- ct-init:slices-contract -->',
      '## Formato de la tabla §9 (versión editada por Jose, con una columna extra)',
      'Texto completamente distinto al que generaría ct-init.',
      '<!-- /ct-init:slices-contract -->',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), customSection)
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // The edited contract is not touched by so much as a letter; the journey
    // section IS added (it was missing, as in any AGENTS.md that does not carry
    // it). The loop's is not: while the contract is still in there, adding it
    // would tell the same story twice — the migration warning says how to get
    // out of that.
    expect(agents).toBe(withE2eAppended(customSection, { loop: false }))
    const occurrences = agents.split('<!-- ct-init:slices-contract -->').length - 1
    expect(occurrences).toBe(1) // not duplicated
    rmSync(dir, { recursive: true, force: true })
  })

  // F2's review, point 2: if somebody wipes out the OPENING marker but leaves
  // the heading and the body (and the closing marker), the `grep -qF` for the
  // opening marker finds nothing → the script believes the section is not there
  // and adds a SECOND whole copy, in silence, exit 0: two "## Formato de la
  // tabla §9..." headings, one orphan closing marker. It must instead detect the
  // partial trace (heading OR closing marker without the complete pair) and warn
  // without adding anything.
  it('an AGENTS.md with the OPENING marker deleted (heading + body + closing marker intact) → it warns, it does not duplicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const orphan = [
      '# AGENTS.md',
      '',
      '## Formato de la tabla §9 (contrato con /ct-groom)',
      'cuerpo custom, el usuario borró el marcador de apertura sin querer.',
      '<!-- /ct-init:slices-contract -->',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), orphan)
    const output = execFileSync('bash', ['-c', `bash '${script}' '${dir}' 2>&1`], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // The contract's partial trace is not touched by so much as a letter; the
    // journey section IS added — it is independent of whatever state the
    // contract is in.
    expect(agents).toBe(withE2eAppended(orphan))
    const headingOccurrences = agents.split('## Formato de la tabla §9').length - 1
    expect(headingOccurrences).toBe(1) // not duplicated
    expect(output.toLowerCase()).toMatch(/aviso|warning/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an AGENTS.md with the CLOSING marker deleted (opening marker + heading + body intact) → it warns, it does not duplicate', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const orphan = [
      '# AGENTS.md',
      '',
      '<!-- ct-init:slices-contract -->',
      '## Formato de la tabla §9 (contrato con /ct-groom)',
      'cuerpo custom, el usuario borró el marcador de cierre sin querer.',
      '',
    ].join('\n')
    writeFileSync(join(dir, 'AGENTS.md'), orphan)
    const output = execFileSync('bash', ['-c', `bash '${script}' '${dir}' 2>&1`], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // The same reason as in the deleted-opening case: the contract is not
    // touched, but the journey section is added because it was missing. The
    // loop's short section is NOT: this AGENTS.md keeps the contract's opening
    // marker, and adding it would leave the same story told twice.
    expect(agents).toBe(withE2eAppended(orphan, { loop: false }))
    const headingOccurrences = agents.split('## Formato de la tabla §9').length - 1
    expect(headingOccurrences).toBe(1) // not duplicated
    expect(output.toLowerCase()).toMatch(/aviso|warning/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('running it three times in a row is idempotent: neither the loop section nor the contract gets duplicated', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents.split(LOOP_MARKER_OPEN).length - 1).toBe(1)
    // And the contract, in its file, is still one: neither the marker nor the
    // file gets duplicated by running the scaffolder again.
    expect(leerContrato(dir).split(MARKER_OPEN).length - 1).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F6, minor 6 — a correction to the contract never reached already
  // bootstrapped repositories: ct-init detects the section between its markers
  // and does not touch it (correct by default, so as not to tread on hand
  // edits), so everything fixed here stayed in the plugin forever.
  // ==========================================================================
  it('the seeded contract declares its version, and a second run says it is up to date (warning about nothing)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(leerContrato(dir)).toMatch(/<!-- ct-init:slices-contract-version: \d+ -->/)
    const again = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(again.status).toBe(0)
    expect(again.stdout).toMatch(/al día/)
    expect(again.stderr).not.toMatch(/aviso/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a contract from a PREVIOUS version (v1, with no version line) → it says so and explains how to update it; it touches nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = sembrarContrato(dir, conContrato(V1_BLOCK, 'mis notas'))
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0) // warning is not failing
    expect(res.stderr).toMatch(/v1/)
    expect(res.stderr).toMatch(new RegExp(`v${CONTRACT_VERSION}`))
    expect(res.stderr).toContain('--update-slices-contract')
    expect(leerContrato(dir)).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract over an UNTOUCHED v1 contract → it replaces it with the current one and leaves the rest of the file intact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    sembrarContrato(dir, conContrato(V1_BLOCK, 'mis notas irremplazables').replace('## Después\n- intocable', '## Lo que va después\n- tampoco se toca'))
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/actualizado/)
    const agents = leerContrato(dir)
    expect(agents).toContain('- mis notas irremplazables')
    expect(agents).toContain('## Lo que va después')
    expect(agents).toContain('- tampoco se toca')
    expect(agents).toContain('status:ready') // new content, for real
    expect(agents.split(MARKER_OPEN).length - 1).toBe(1) // exactly one block
    expect(agents.split(MARKER_CLOSE).length - 1).toBe(1)
    expect(agents).toMatch(versionLineRe())
    // And running it again has nothing left to do.
    const again = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(again.status).toBe(0)
    expect(again.stdout).toMatch(/al día/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract over an UNRECOGNISED block → it refuses, and says it may be a hand edit OR a version it does not know (without choosing)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const edited = V1_BLOCK.replace('- **Tipo** *(opcional)*', '- **Tipo** *(opcional; en ESTE repo también usamos `ios`)*')
    expect(edited).not.toBe(V1_BLOCK) // a check: the edit really was applied
    const before = `# AGENTS.md\n\n${edited}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(3) // an update was asked for and could not be done: that is not a success
    // F9: what the script KNOWS is that that hash is not in its list. That it is
    // an edit of the user's is ONE of the two possible readings, and it cannot
    // tell them apart — so it cannot assert either. It used to say "la has
    // editado a mano" flatly, and with that it accused someone who merely had an
    // AGENTS.md seeded by an earlier version of the plugin.
    expect(res.stderr).not.toMatch(/la has editado a mano/)
    expect(res.stderr).toMatch(/edición a mano/) // (a)
    expect(res.stderr).toMatch(/versión del plugin cuyo hash este ct-init no lleva registrado/) // (b)
    expect(res.stderr).toMatch(/NO hay forma de distinguirlas/)
    // And it gives the datum with which to settle the doubt / get it recorded.
    expect(res.stderr).toContain(sha256(extractBlock(before)))
    expect(res.stderr).toContain('--force')
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract --force over an unrecognised contract → it overwrites it, and warns in the conditional (it does not assert that there were edits)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const edited = V1_BLOCK.replace('- **Tipo** *(opcional)*', '- **Tipo** *(opcional; en ESTE repo también usamos `ios`)*')
    sembrarContrato(dir, `# Contrato de slices\n\n${edited}`)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract', '--force'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/no coincidía con ninguna versión que este ct-init sepa reconocer/)
    expect(res.stderr).toMatch(/Si había ediciones tuyas/) // conditional, not "your changes have been lost"
    expect(res.stderr).not.toMatch(/EDITADA A MANO/)
    const contrato = leerContrato(dir)
    expect(contrato).not.toContain('en ESTE repo también usamos')
    expect(contrato).toMatch(versionLineRe())
    rmSync(dir, { recursive: true, force: true })
  })

  // #93 — the other half of that same `--force`: an AGENTS.md that still carries
  // the contract inside it and whose block is not recognised. What `--force`
  // does there is not to update the block in place: it TAKES IT OUT, leaving in
  // its place the short section that links to the real contract.
  it('--update-slices-contract --force takes an unrecognised contract out of AGENTS.md and leaves the short section', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const edited = V1_BLOCK.replace('- **Tipo** *(opcional)*', '- **Tipo** *(opcional; en ESTE repo también usamos `ios`)*')
    writeFileSync(join(dir, 'AGENTS.md'), `# AGENTS.md\n\n## Gotchas\n- mías\n\n${edited}`)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract', '--force'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stderr).toMatch(/Si había ediciones tuyas/)
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).not.toContain('en ESTE repo también usamos')
    expect(agents).not.toContain(MARKER_OPEN)
    expect(agents).toContain(LOOP_MARKER_OPEN)
    expect(agents).toContain('- mías') // what is around it is not touched
    // And the real contract is where it now lives, with today's version.
    expect(leerContrato(dir)).toMatch(versionLineRe())
    rmSync(dir, { recursive: true, force: true })
  })

  // ==========================================================================
  // F9 — the real case: an AGENTS.md seeded by plugin 0.5.1, byte for byte as it
  // came out of ct-init, got "la has editado a mano" and exit 3. The block's
  // content changed nine times (eight of them all called "v1"), and
  // SLICES_PRISTINE_HASHES recorded only two of those nine.
  // ==========================================================================
  it('EVERY block ct-init ever emitted, untouched, updates with --update-slices-contract without --force and without accusing anybody', () => {
    const historical = bloquesEmitidos()
    // A check: if this does not reconstruct several versions, the test proves nothing.
    expect(historical.length).toBeGreaterThanOrEqual(9)
    // The "the reconstruction reaches today" check tolerates a contract bump
    // still UNCOMMITTED (ct-step's flow commits after the judge, so the working
    // tree runs ahead of the history during the very slice that bumps the
    // version): if the tree's block is not yet in any commit, what is demanded
    // instead is that its hash already be recorded in SLICES_PRISTINE_HASHES —
    // the same treatment of the working tree that "it records no hashes of
    // blocks that never existed" already applies (the known.add of the tree's
    // block). As soon as the bump is committed, the strict branch rules on its
    // own again.
    const bloqueDeHoy = extractBlock(seedFreshContrato())
    const current = historical.find((h) => sha256(h.block) === sha256(bloqueDeHoy))
    if (!current) expect(initScriptSrc).toContain(sha256(bloqueDeHoy))
    for (const { block, commit } of historical) {
      const dir = mkdtempSync(join(tmpdir(), 'ct-'))
      sembrarContrato(dir, conContrato(block, `notas de ${commit}`))
      const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
      expect(res.status, `${commit}: ${res.stderr}`).toBe(0)
      expect(res.stderr, commit).not.toMatch(/editado a mano|EDITADA A MANO|no coincide/)
      const contrato = leerContrato(dir)
      // The current contract is left, and the rest of the file untouched.
      expect(contrato, commit).toContain(`- notas de ${commit}`)
      expect(contrato, commit).toContain('- intocable')
      expect(contrato, commit).toMatch(versionLineRe())
      expect(contrato.split(MARKER_OPEN).length - 1, commit).toBe(1)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // RESERVE 2 of the for_developers: the path a real repository walks when a
  // bump is published — the previous version's block INTACT,
  // `--update-slices-contract` without `--force`. The loop above already treads
  // it, but it does not demand that the vN-1 block be in the history: if a squash
  // hid it again (which is how v17 was lost), the loop would stay green without
  // covering this path. With no hardcoded numbers: it goes up on its own with
  // CONTRACT_VERSION.
  it('a repository with the PREVIOUS version\'s block intact moves up to the current contract without --force', () => {
    const anterior = bloquesEmitidos().find(({ block }) =>
      block.includes(`<!-- ct-init:slices-contract-version: ${CONTRACT_VERSION - 1} -->`)
    )
    expect(anterior, `no hay ningún bloque v${CONTRACT_VERSION - 1} ni en la historia ni en SQUASHED_BLOCK_FIXTURES`).toBeDefined()
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    sembrarContrato(dir, conContrato(anterior.block))
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toMatch(new RegExp(`contrato v${CONTRACT_VERSION - 1} → v${CONTRACT_VERSION}`))
    expect(res.stderr).not.toMatch(/editad|no coincide|--force/i)
    const contrato = leerContrato(dir)
    expect(contrato).toMatch(versionLineRe())
    expect(contrato).toContain('- mías')
    expect(contrato).toContain('- intocable')
    expect(contrato.split(MARKER_OPEN).length - 1).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('with no way to compute the sha256 (neither shasum nor sha256sum) NOBODY is accused: it says it could not be checked, and it touches nothing', () => {
    // The "unedited" check is the only thing that separates a safe update from
    // treading on somebody else's work. If the machine cannot do it, the state
    // is not "hand-edited" — it is "not known", and it does not have the same
    // remedy.
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = `# AGENTS.md\n\n${V1_BLOCK}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const binDir = join(dir, 'fake-bin')
    mkdirSync(binDir)
    for (const tool of ['bash', 'awk', 'grep', 'sed', 'mkdir', 'cp', 'cat', 'mktemp', 'mv', 'rm', 'touch', 'tail', 'wc', 'head', 'dirname', 'pwd']) {
      const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim()
      if (found) symlinkSync(found, join(binDir, tool))
    }
    // A check: on this PATH there is nothing to hash with.
    for (const h of ['shasum', 'sha256sum']) {
      expect(existsSync(join(binDir, h))).toBe(false)
    }
    const env = { ...process.env, PATH: binDir }
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8', env })
    expect(res.status).toBe(3)
    expect(res.stderr).toMatch(/no se ha podido comprobar/)
    expect(res.stderr).toMatch(/puede estar perfectamente intacto, simplemente no se sabe/)
    expect(res.stderr).not.toMatch(/editad[oa] a mano/i)
    expect(res.stderr).toMatch(/sha256sum/) // it says how to unblock it
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('the "there is a newer version" warning says whether updating is safe, instead of the generic "you may have edited it"', () => {
    // Without the flag, ct-init only warns — but it already knows what state the
    // block is in, so it can say whether the update is going to work or to
    // refuse.
    const intact = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(intact, 'AGENTS.md'), `# AGENTS.md\n\n${V1_BLOCK}`)
    const a = spawnSync('bash', [script, intact], { encoding: 'utf8' })
    expect(a.stderr).toMatch(/Está exactamente como la dejó ct-init/)
    expect(a.stderr).not.toMatch(/podrías tenerla editada a mano/)
    rmSync(intact, { recursive: true, force: true })

    const changed = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(changed, 'AGENTS.md'), `# AGENTS.md\n\n${V1_BLOCK.replace('- **Dep**', '- **Dep** (ojo)')}`)
    const b = spawnSync('bash', [script, changed], { encoding: 'utf8' })
    expect(b.stderr).toMatch(/no coincide con ningún bloque que este ct-init reconozca/)
    expect(b.stderr).toMatch(/puede ser una edición tuya o una versión que no tiene registrada/)
    expect(b.stderr).toMatch(/[0-9a-f]{64}/) // the hash, so it can be recorded
    rmSync(changed, { recursive: true, force: true })
  })

  // ==========================================================================
  // F9, a case that was not in the commission: CRLF line endings. Every marker
  // was searched for with `grep -qxF`, which with a `\r` stuck on the end finds
  // nothing — not the opening, not the closing, not the heading. The script
  // concluded "there is no section here" and added a SECOND whole copy, in
  // silence.
  // ==========================================================================
  it('a contract with CRLF line endings does not receive a second copy of the block: the one it already has is recognised', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const crlf = `# Contrato de slices\n\n## Notas\n- notas\n\n${V1_BLOCK}`.replace(/\n/g, '\r\n')
    sembrarContrato(dir, crlf)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    const contrato = leerContrato(dir)
    expect(contrato.split(MARKER_OPEN).length - 1).toBe(1) // not a second copy
    expect(contrato.split('## Formato de la tabla §9').length - 1).toBe(1)
    expect(contrato).toBe(crlf) // nothing is touched
    // And the warning it was due to give is given (it used to skip it entirely).
    expect(res.stderr).toMatch(/es del contrato v1/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an intact block with CRLF is recognised as intact and updates without --force, keeping the CRLF line endings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const crlf = `# Contrato de slices\n\n## Notas\n- notas\n\n${V1_BLOCK}`.replace(/\n/g, '\r\n')
    sembrarContrato(dir, crlf)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).toMatch(/actualizado/)
    expect(res.stderr).not.toMatch(/no coincide|editad/i) // line endings are not an edit
    const contrato = leerContrato(dir)
    expect(contrato.split(MARKER_OPEN).length - 1).toBe(1)
    expect(contrato).toContain('- notas')
    expect(contrato).toMatch(versionLineRe())
    // The new block keeps CRLF: no leaving the file half done.
    expect(contrato).not.toMatch(/[^\r]\n/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('a contract from a version NEWER than the plugin\'s is not called "up to date": it is said that the out-of-date one is the plugin', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const seeded = leerContrato(dir)
    const fromFuture = seeded.replace(`slices-contract-version: ${CONTRACT_VERSION}`, `slices-contract-version: ${CONTRACT_VERSION + 1}`)
    writeFileSync(contratoPath(dir), fromFuture)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/al día/)
    expect(res.stderr).toMatch(new RegExp(`v${CONTRACT_VERSION + 1}`))
    expect(res.stderr).toMatch(/más nueva del plugin/)
    expect(leerContrato(dir)).toBe(fromFuture) // it is not downgraded
    rmSync(dir, { recursive: true, force: true })
  })

  it('the version is read from the BLOCK: a version line quoted further up in the AGENTS.md does not hijack the diagnosis', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    // The user documents the marker in their own notes, further up.
    const before = sembrarContrato(dir, `# Contrato de slices\n\n## Notas\n- el bloque lo marca \`<!-- ct-init:slices-contract-version: 99 -->\`\n\n${V1_BLOCK}`)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    expect(res.stdout).not.toMatch(/v99/) // before: "contrato v99, al día", without looking at the block
    expect(res.stderr).toMatch(/es del contrato v1/)
    expect(res.stderr).toContain('--update-slices-contract')
    rmSync(dir, { recursive: true, force: true })
  })

  it('a block that already declares the current version but with DIFFERENT content is not waved through as "up to date" when an update is asked for', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const seeded = leerContrato(dir)
    const tweaked = seeded.replace('status:backlog', 'status:backlog-de-la-casa')
    expect(tweaked).not.toBe(seeded)
    writeFileSync(contratoPath(dir), tweaked)
    // A normal run: it keeps quiet (the version number IS the current one and
    // there is nothing to offer — warning here would be noise in every
    // session).
    const plain = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(plain.stdout).toMatch(/al día/)
    expect(plain.stderr).not.toMatch(/aviso/)
    // But if a sync is ASKED FOR, saying "al día" would cover up that the text
    // is not this plugin's — which is exactly what happened nine times under the
    // name "v1".
    const asked = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(asked.status).toBe(0)
    expect(asked.stdout).not.toMatch(/al día/)
    expect(asked.stderr).toMatch(/no hay actualización de versión que hacer/)
    expect(asked.stderr).toMatch(/NO es el que emite este plugin/)
    expect(leerContrato(dir)).toBe(tweaked)
    rmSync(dir, { recursive: true, force: true })
  })

  it('without --update-slices-contract, --force on its own does not touch an out-of-date contract (the opt-in is the other flag)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = sembrarContrato(dir, `# Contrato de slices\n\n${V1_BLOCK}`)
    const res = spawnSync('bash', [script, dir, '--force'], { encoding: 'utf8' })
    expect(res.status).toBe(0)
    // The v1 contract is not touched: --force without --update-slices-contract
    // does nothing to it.
    expect(leerContrato(dir)).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('an unknown option aborts instead of being ignored in silence', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const res = spawnSync('bash', [script, dir, '--updat-slices-contract'], { encoding: 'utf8' })
    expect(res.status).toBe(2)
    expect(res.stderr).toMatch(/no reconocida/)
    rmSync(dir, { recursive: true, force: true })
  })

  // Self-watch: the "untouched" detection rests on a list of hashes INSIDE the
  // script. If somebody edits the block and forgets to record the new hash, the
  // next version could not recognise this one as intact (and no repository
  // carrying it could update without --force) — a failure that would not be seen
  // until the next round, in a user's repository.
  it('the hash of the block seeded TODAY is recorded in SLICES_PRISTINE_HASHES (and the v1 fixture\'s too)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const block = extractBlock(leerContrato(dir))
    expect(block).not.toBeNull()
    expect(initScriptSrc).toContain(sha256(block))
    expect(initScriptSrc).toContain(sha256(V1_BLOCK))
    rmSync(dir, { recursive: true, force: true })
  })

  // F9 — the test above covers only TODAY's block, and that is why F6 could
  // record two hashes believing they were all of them: the list can fall short
  // at the bottom (an old variant that was never recorded) or shrink (somebody
  // "tidies up" an old hash believing it dead), and neither of the two is
  // noticed until a user with that variant receives a false accusation. This one
  // closes the gap: the source of truth is nobody's memory, it is git's history.
  // Between the two they cover everything — this one, what is committed; the one
  // above, the working tree not yet committed.
  // What this one does NOT cover, on purpose: the blocks the squash deleted from
  // the history. Those are the business of "every block kept because of a squash
  // still hashes to its recorded hash", which is the specific guard and gives a
  // better message. Putting them in here would turn it into a duplicate of it.
  it('every block ct-init ever emitted in the history is recorded in SLICES_PRISTINE_HASHES', () => {
    const historical = historicalContractBlocks()
    expect(historical.length).toBeGreaterThanOrEqual(9) // a check: it really did reconstruct
    const missing = historical
      .filter(({ hash }) => !initScriptSrc.includes(hash))
      .map(({ commit, hash }) => `${commit} → ${hash}`)
    expect(
      missing,
      `Bloques del contrato que ct-init emitió y ya no sabe reconocer. Añade cada hash a ` +
        `SLICES_PRISTINE_HASHES en scripts/ct-init.sh (AÑADIR, nunca sustituir): un repo ` +
        `sembrado con esa variante y sin tocar recibe "no coincide con ninguna versión ` +
        `conocida" y no puede actualizarse sin --force.`
    ).toEqual([])
  })

  it('the historical reconstruction reaches TODAY\'s commit: HEAD\'s block is among the ones it sees', () => {
    const deHead = extractBlockFromSource(initScriptSrc)
    expect(
      historicalContractBlocks().map(({ block }) => block),
      'historicalContractBlocks() pregunta por `<commit>:<ruta>`, que se resuelve contra la RAÍZ del ' +
        'árbol: si nombra la ruta de una sola época, los commits de la otra caen en el `catch` y no ' +
        'se ven. Un bloque emitido desde entonces deja de estar cubierto sin que nada se ponga rojo.'
    ).toContain(deHead)
  })

  it('the textual extractor of the history matches what ct-init really emits when it runs', () => {
    // The test above reads the historical blocks from the SOURCE of each
    // ct-init.sh (between markers, inside its heredoc) instead of running each
    // version. Were that shortcut to stop being faithful, the guard would stop
    // guarding anything without anybody finding out.
    const emitted = extractBlock(seedFreshContrato())
    expect(extractBlockFromSource(initScriptSrc)).toBe(emitted)
  })

  it('SLICES_PRISTINE_HASHES records no hashes of blocks that never existed', () => {
    // The other direction: a MADE-UP hash makes ct-init silently replace
    // something it does not really recognise. Every recorded hash has to
    // correspond to a real block, and "real" has three possible sources: main's
    // history, the working tree, and the blocks a squash merge deleted from the
    // history but which were pushed and live here as a fixture (see
    // SQUASHED_BLOCK_FIXTURES above). All three are content: in none of them is
    // a comment believed.
    const registered = initScriptSrc
      .split('\n')
      .map((l) => l.trim().match(/^([0-9a-f]{64})\b/))
      .filter(Boolean)
      .map((m) => m[1])
    expect(registered.length).toBeGreaterThanOrEqual(9)
    const known = new Set(historicalContractBlocks().map((h) => h.hash))
    known.add(sha256(extractBlock(seedFreshContrato()))) // the working tree
    for (const { block } of squashedBlocks()) known.add(sha256(block))
    expect(
      registered.filter((h) => !known.has(h)),
      'Hashes registrados que no corresponden a NINGÚN bloque conocido. Si es un ' +
        'bloque que existió en una rama y el squash del merge se lo llevó de main, ' +
        'guárdalo byte a byte en __tests__/fixtures/slices-contract-vN.md y añade el ' +
        'fichero a SQUASHED_BLOCK_FIXTURES: un comentario de procedencia se cree, un ' +
        'fichero que hashea al hash registrado se comprueba. Si no existió, bórralo ' +
        'de SLICES_PRISTINE_HASHES: mientras esté, ct-init da por intacto (y por tanto ' +
        'reemplazable sin avisar) un bloque que no reconoce de verdad.'
    ).toEqual([])
  })

  // The fixture's other side: if the file drifts by a byte, it stops hashing to
  // the recorded hash and no longer justifies anything — so the guard above
  // would go back to accusing that hash of being made up, blaming the wrong
  // place. This test points at the real cause.
  it('every block kept because of a squash still hashes to its recorded hash', () => {
    for (const { fixture, block } of squashedBlocks()) {
      const h = sha256(block)
      expect(
        initScriptSrc.includes(h),
        `El fixture ${fixture} ya no corresponde a ningún hash de ` +
          `SLICES_PRISTINE_HASHES (hashea a ${h}). O ha derivado —y entonces ya no es ` +
          `el bloque que se pusheó, que es TODO su valor— o su hash se ha borrado del ` +
          `registro.`
      ).toBe(true)
    }
  })

  // And that there be none left over: a fixture with no recorded hash would be a
  // block kept "just in case" that ct-init does not recognise, that is, half a
  // fix. The test above covers it by hash; this one covers the directory's
  // inventory, so that adding a file and forgetting the list does not go
  // unnoticed.
  it('there are no squash-kept contract fixtures outside the list', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
    const enDisco = readdirSync(dir).filter((f) => /^slices-contract-v\d+\.md$/.test(f))
    const usados = new Set([...SQUASHED_BLOCK_FIXTURES, ...FIXTURES_DE_OTROS_TESTS])
    expect(enDisco.filter((f) => !usados.has(f))).toEqual([])
  })

  // Slice 8 — the test that ties SQUASHED_BLOCK_FIXTURES to the history. Without
  // it, adding a ledger entry and its fixture in the same commit leaves the suite
  // green, and a block ct-init never published becomes "pristine" forever. The
  // hash is NOT declared by hand: it comes from the sha256 of the file itself,
  // which is the only way for the witness looked up in the ledger to be that of
  // the block the fixture really keeps. That that hash is recorded is demanded by
  // the guard next door ("every block kept because of a squash still hashes to
  // its recorded hash"), and that is why it is not repeated here.
  it('every SQUASHED_BLOCK_FIXTURES fixture has provenance: its hash was already in the ledger of a commit that did NOT carry the file', () => {
    exigirHistorialCompleto()
    const guardados = squashedBlocks().map(({ fixture, block }) => ({ fixture, hash: sha256(block) }))
    // A check: if the list is empty this test proves nothing. Today there is one
    // (the v17 of pull request #27, hidden by the squash 529d2f4). If some day it
    // is emptied on purpose, this assert is the place to say so.
    expect(guardados.length).toBeGreaterThanOrEqual(1)
    const sinProcedencia = guardados
      .map(({ fixture, hash }) => procedenciaDelBloqueGuardado({ cwd: root, fixture, hash }))
      .filter(Boolean)
    expect(
      sinProcedencia,
      'Un fixture de SQUASHED_BLOCK_FIXTURES solo vale si su hash es evidencia INDEPENDIENTE del ' +
        'fichero: tiene que haber entrado en SLICES_PRISTINE_HASHES en un commit que todavía no ' +
        'contenía el fixture. Si no, el par se valida contra sí mismo y un bloque que ct-init ' +
        'nunca emitió puede colarse como pristine.'
    ).toEqual([])
  })

  it('the witness taken to be the commit that introduced the hash really did introduce it: its parent did not carry it', () => {
    exigirHistorialCompleto()
    const rutas = rutasDeArbolPara(root, RUTA_LEDGER)
    const ledgerEn = (rev) => {
      for (const ruta of rutas) {
        const leido = spawnSync('git', ['show', `${rev}:${ruta}`], { cwd: root, encoding: 'utf8' })
        if (leido.status === 0) return leido.stdout
      }
      return ''
    }
    const falsosTestigos = squashedBlocks().map(({ fixture, block }) => {
      const hash = sha256(block)
      const testigos = execFileSync(
        'git',
        ['log', '--format=%H', `-S${hash}`, '--', ...rutas.map((r) => `:(top)${r}`)],
        { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      ).trim().split('\n').filter(Boolean)
      const testigo = testigos[testigos.length - 1]
      if (!testigo) return `${fixture}: ningún commit alcanzable desde HEAD metió su hash en el ledger`
      if (!ledgerEn(`${testigo}^`)) return null
      if (!ledgerEn(`${testigo}^`).includes(hash)) return null
      return `${fixture}: ${testigo.slice(0, 7)} se toma por el commit que metió el hash, y su padre YA lo traía`
    }).filter(Boolean)

    expect(
      falsosTestigos,
      'El testigo sale de `git log -S` sobre el ledger, y sus pathspecs se resuelven contra la RAÍZ ' +
        'del árbol: si nombran la ruta de una sola época, el commit más antiguo que se encuentra es ' +
        'el que movió el fichero, no el que introdujo el hash. La procedencia queda anclada a un ' +
        'commit que no prueba nada.'
    ).toEqual([])
  })

  it('the fixtures and the ledger are looked up by paths that HEAD\'s TREE resolves, not only the disk', () => {
    expect(
      existeEnElArbol(root, 'HEAD', rutasDeArbolPara(root, RUTA_LEDGER)),
      `HEAD no resuelve ${RUTA_LEDGER}: todo cat-file de la procedencia falla y la comprobación queda vacía`
    ).toBe(true)
    for (const fixture of SQUASHED_BLOCK_FIXTURES) {
      expect(
        existeEnElArbol(root, 'HEAD', rutasDeArbolPara(root, `${RUTA_FIXTURES}/${fixture}`)),
        `HEAD no resuelve ${RUTA_FIXTURES}/${fixture}: el par (entrada, fixture) dejaría de compararse`
      ).toBe(true)
    }
  })

  it('the provenance check catches the forged pair: ledger entry and fixture in the SAME commit', () => {
    // Non-tautology. The check above passes green over this repository; that on
    // its own does not prove it is capable of going red. The SAME function (not a
    // reimplementation) is run over toy repositories with the history
    // manufactured on purpose.
    const HASH = 'a'.repeat(64) // it is the sha256 of nothing: the only thing judged here is the HISTORY
    const FIXTURE = 'bloque-inventado.md'
    const escenarios = []
    const construir = (guion) => {
      const dir = mkdtempSync(join(tmpdir(), 'proc-'))
      escenarios.push(dir)
      const g = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
      // An explicit `-b main`: without it `git init` uses the machine's
      // init.defaultBranch (the same reason as in f22-estado-del-slice.test.js).
      g('init', '-q', '-b', 'main', '.')
      g('config', 'user.email', 'test@test')
      g('config', 'user.name', 'test')
      mkdirSync(join(dir, 'scripts'), { recursive: true })
      mkdirSync(join(dir, RUTA_FIXTURES), { recursive: true })
      const ledger = (conHash) =>
        writeFileSync(join(dir, RUTA_LEDGER), `SLICES_PRISTINE_HASHES='\n${conHash ? `${HASH}  vX, 1 línea\n` : ''}'\n`)
      const fixture = () => writeFileSync(join(dir, RUTA_FIXTURES, FIXTURE), 'bloque\n')
      ledger(false)
      g('add', '-A')
      g('commit', '-qm', 'base')
      guion({ g, ledger, fixture })
      return dir
    }
    const juzgar = (dir) => procedenciaDelBloqueGuardado({ cwd: dir, fixture: FIXTURE, hash: HASH })

    // (1) POSITIVE CONTROL: the legitimate order (v17's) — the entry first, the
    // fixture afterwards. Without this, a red from the ones below would mean
    // nothing: it could be that the toy repositories always fail.
    const bueno = construir(({ g, ledger, fixture }) => {
      ledger(true); g('add', '-A'); g('commit', '-qm', 'entrada en el ledger')
      fixture(); g('add', '-A'); g('commit', '-qm', 'el fixture, después')
    })
    expect(juzgar(bueno)).toBeNull()

    // (2) THE REVIEW'S CASE: both of them in the same commit.
    const mismoCommit = construir(({ g, ledger, fixture }) => {
      ledger(true); fixture(); g('add', '-A'); g('commit', '-qm', 'entrada + fixture juntos')
    })
    expect(juzgar(mismoCommit)).toMatch(/se valida contra sí mismo/)

    // (3) The variant that also has to be caught: the fixture first and the
    // entry afterwards. The hash's witness already carries the fixture ⇒ the
    // same reason.
    const fixturePrimero = construir(({ g, ledger, fixture }) => {
      fixture(); g('add', '-A'); g('commit', '-qm', 'el fixture primero')
      ledger(true); g('add', '-A'); g('commit', '-qm', 'la entrada, después')
    })
    expect(juzgar(fixturePrimero)).toMatch(/se valida contra sí mismo/)

    // (4) The entry only in the working tree, uncommitted: there is no witness
    // to anything. A DIFFERENT message from (2)/(3)'s, because the remedy is
    // different.
    const soloArbol = construir(({ ledger, fixture }) => {
      ledger(true); fixture() // deliberately without a `git commit`
    })
    expect(juzgar(soloArbol)).toMatch(/no entró en scripts\/ct-init\.sh en ningún commit/)

    for (const dir of escenarios) rmSync(dir, { recursive: true, force: true })
  })

  // Finding 6 of the final review: ct-next.mjs writes each slice worktree in
  // <repoRoot>/.worktrees/<n>, INSIDE the target repository's own checkout. If
  // that repository does not ignore `.worktrees/`, a `git add -A` in the main
  // checkout swallows a whole nested working tree, and a `git clean -fdx`
  // destroys live worktrees.
  it('adds .worktrees/ to .gitignore (it creates the file if it does not exist)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  it('.gitignore already exists with other content → it adds .worktrees/ without treading on what was already there', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(gi).toContain('node_modules/')
    expect(gi).toContain('.worktrees/')
    rmSync(dir, { recursive: true, force: true })
  })

  // D-4 — the state of ct-run's run and its working folder. They are a slice's
  // INNER loop inside its worktree: they live less long than the worktree, and
  // the folder carries each task's diffs, which are the same content as the
  // commit. Seeing them show up as new files in the pull request is pure noise.
  it('adds ct-run\'s run rules to .gitignore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    expect(gi).toContain('.agent/run-*.json')
    expect(gi).toContain('.agent/run-*/')
    rmSync(dir, { recursive: true, force: true })
  })

  it('idempotent for the run rules too: two runs, one line of each', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const lineas = readFileSync(join(dir, '.gitignore'), 'utf8').split('\n')
    expect(lineas.filter((l) => l === '.agent/run-*.json')).toHaveLength(1)
    expect(lineas.filter((l) => l === '.agent/run-*/')).toHaveLength(1)
    rmSync(dir, { recursive: true, force: true })
  })

  it('idempotent: running it twice does not duplicate the .worktrees/ line in .gitignore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    execFileSync('bash', [script, dir], { encoding: 'utf8' }) // second run
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    const occurrences = gi.split('\n').filter((l) => l === '.worktrees/').length
    expect(occurrences).toBe(1)
    rmSync(dir, { recursive: true, force: true })
  })

  // A blocker from the re-review: a `.gitignore` that ALREADY has content but
  // does not end in a newline (written by hand with `printf`, say, with no
  // trailing `\n`) made `echo '.worktrees/' >> .gitignore` concatenate the new
  // line onto the SAME line as the user's last rule — "node_modules/.worktrees/"
  // — corrupting that rule (it stops ignoring node_modules/) and without
  // .worktrees/ really being ignored either (the whole purpose of finding 6,
  // silently unmet). It reproduces the reported case exactly and checks that,
  // after the fix, BOTH rules are left intact on separate lines.
  it('an existing .gitignore WITHOUT a trailing newline → it normalises before adding, without corrupting the previous rule', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    writeFileSync(join(dir, '.gitignore'), 'node_modules/') // no trailing \n, on purpose
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const gi = readFileSync(join(dir, '.gitignore'), 'utf8')
    const lines = gi.split('\n').filter((l) => l.length > 0)
    expect(lines).toContain('node_modules/')
    expect(lines).toContain('.worktrees/')
    expect(gi).not.toMatch(/node_modules\/\.worktrees\//) // never concatenated onto the same line
    rmSync(dir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // La plantilla del execution spec. El flujo tras /ct-init es brainstorming →
  // design doc → execution spec, y `skills/brainstorming/SKILL.md` (pasos 8 y
  // §"After the self-review") manda escribir ese spec «from the repo's
  // `_TEMPLATE-execution-spec.md`». Hasta aquí esa plantilla NO viajaba con el
  // plugin: vivía suelta en un repo privado, así que el paso 8 se quedaba sin
  // su fuente en cualquier repo recién bootstrapeado y el spec había que
  // escribirlo adivinando sus secciones.
  //
  // El destino es `docs/superpowers/specs/` y no la raíz porque es la carpeta
  // que el plugin YA declara como casa del spec en código que corre:
  // LOOP_ARTIFACT_PATTERNS (scripts/scope.js) exime `docs/superpowers/specs/**`
  // precisamente porque «el skill de brainstorming escribe aquí el design doc y
  // el execution spec». La misma ruta que documenta docs/loop/README.md.
  // ==========================================================================
  // #93 — el contrato sale de AGENTS.md. Lo que estos tests atan es el REPARTO:
  // qué queda en el fichero que se relee en cada sesión y qué se va al que se
  // lee una vez por epic. Sin ellos, el contrato podría volver a AGENTS.md sin
  // que nada se pusiera rojo, y el ahorro entero se deshace en un commit.
  // ==========================================================================
  it('el AGENTS.md sembrado cabe en 3 KB y enlaza al contrato en vez de llevarlo dentro', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(
      Buffer.byteLength(agents),
      'el AGENTS.md sembrado se ha pasado de 3 KB: es el fichero que cada agente de un repo gobernado relee en cada sesión, así que lo que crezca aquí se paga en cada hidratación. Si hace falta decir algo más, di si va en el contrato (docs/superpowers/CONTRATO-SLICES.md) o en la referencia del comando (docs/loop/), no aquí.'
    ).toBeLessThan(3 * 1024)
    expect(agents).toContain('docs/superpowers/CONTRATO-SLICES.md')
    expect(agents).not.toContain(MARKER_OPEN)
    rmSync(dir, { recursive: true, force: true })
  })

  it('el contrato sembrado es, byte a byte, el bloque que emite el script', () => {
    // Que sea idéntico no es comodidad: es lo que hace que el ledger de hashes
    // reconozca un bloque sembrado por cualquier versión anterior, y que la
    // poda de conventions.js y el descuento de vara.js lo sigan viendo por sus
    // marcadores sin una regla nueva. El fichero ES el bloque y nada más.
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const contrato = leerContrato(dir)
    expect(contrato).toBe(extractBlockFromSource(initScriptSrc))
    expect(extractBlock(contrato)).toBe(contrato)
    rmSync(dir, { recursive: true, force: true })
  })

  it('un repo bootstrapeado ANTES: el contrato sigue en su AGENTS.md, se avisa y no se toca nada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = `# AGENTS.md\n\n## Gotchas\n- mías\n\n${V1_BLOCK}`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir], { encoding: 'utf8' })
    expect(res.status).toBe(0) // warning is not failing
    expect(res.stderr).toMatch(/todavía lleva DENTRO el contrato/)
    expect(res.stderr).toContain('--update-slices-contract')
    // Su bloque no se toca, y tampoco recibe la sección corta: mientras el
    // contrato siga ahí, añadirla contaría el mismo tema dos veces.
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).toBe(withE2eAppended(before, { loop: false }))
    // Pero el contrato de HOY ya está sembrado en su sitio: quien escriba un
    // spec a partir de ahora lee el bueno, aunque nadie haya migrado nada.
    expect(leerContrato(dir)).toMatch(versionLineRe())
    rmSync(dir, { recursive: true, force: true })
  })

  it('--update-slices-contract migra ese repo: saca el bloque de AGENTS.md y deja la sección corta', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const before = `# AGENTS.md\n\n## Gotchas\n- mías\n\n${V1_BLOCK}\n## Después\n- intocable\n`
    writeFileSync(join(dir, 'AGENTS.md'), before)
    const res = spawnSync('bash', [script, dir, '--update-slices-contract'], { encoding: 'utf8' })
    expect(res.status, res.stderr).toBe(0)
    expect(res.stdout).toMatch(/el contrato de slices sale de/)
    expect(res.stderr).not.toMatch(/editad|acusa/i) // estaba sin editar: no se acusa a nadie
    const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    expect(agents).not.toContain(MARKER_OPEN)
    expect(agents).toContain(LOOP_MARKER_OPEN)
    // Y lo que el usuario tenía alrededor sigue exactamente donde estaba.
    expect(agents).toContain('- mías')
    expect(agents).toContain('- intocable')
    expect(leerContrato(dir)).toMatch(versionLineRe())
    rmSync(dir, { recursive: true, force: true })
  })

  it('siembra la plantilla del execution spec en docs/superpowers/specs/', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const out = execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const dest = join(dir, 'docs', 'superpowers', 'specs', '_TEMPLATE-execution-spec.md')
    expect(existsSync(dest)).toBe(true)
    expect(readFileSync(dest, 'utf8')).toBe(readFileSync(join(root, 'templates', '_TEMPLATE-execution-spec.md'), 'utf8'))
    expect(out).toMatch(/creado .*_TEMPLATE-execution-spec\.md/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('idempotente: no pisa una plantilla de execution spec ya existente', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    const dest = join(dir, 'docs', 'superpowers', 'specs', '_TEMPLATE-execution-spec.md')
    mkdirSync(dirname(dest), { recursive: true })
    writeFileSync(dest, 'MIA, editada a mano\n')
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    expect(readFileSync(dest, 'utf8')).toBe('MIA, editada a mano\n')
    rmSync(dir, { recursive: true, force: true })
  })

  // El test que de verdad importa: la plantilla que se siembra tiene que PASAR
  // las puertas del propio /ct-groom. Las dos trampas que traía la versión que
  // circulaba a mano las detecta esto y nada más:
  //
  //  1. `[NEEDS CLARIFICATION` escrito literal en su comentario didáctico.
  //     analyzeSpecFreeze hace un includes() línea a línea sobre TODO el
  //     fichero, sin descartar comentarios HTML (el descarte solo cubre el
  //     cuerpo de la hipótesis), así que la plantilla se autoinvalidaba: exit 2
  //     en cualquier spec que la copiara sin borrar ese bloque, estando
  //     perfectamente congelado.
  //  2. Un comentario multilínea DENTRO de `## Contexto del epic`.
  //     readEpicContext no lo descarta, y esa sección se copia byte a byte al
  //     cuerpo de todos los issues del epic: las instrucciones de la plantilla
  //     acababan pegadas en los N issues.
  it('la plantilla sembrada pasa las puertas de congelación de /ct-groom y su tabla parsea con el contrato vigente', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-'))
    execFileSync('bash', [script, dir], { encoding: 'utf8' })
    const md = readFileSync(join(dir, 'docs', 'superpowers', 'specs', '_TEMPLATE-execution-spec.md'), 'utf8')
    const { analyzeSpecFreeze, readEpicContext } = await import('../scripts/groom.js')
    const { analyzeSlicesTable } = await import('../scripts/slices.js')

    const freeze = analyzeSpecFreeze(md)
    expect(freeze.clarifications).toEqual([])
    expect(freeze.hypothesis).toBe('ok')

    expect(readEpicContext(md).content).not.toMatch(/<!--/)

    const table = analyzeSlicesTable(md)
    expect(table.tableFound).toBe(true)
    expect(table.gateColumnPresent).toBe(true)
    expect(table.missingRequiredColumns).toEqual([])
    expect(table.invalidRows).toEqual([])
    expect(table.malformedDepRows).toEqual([])
    expect(table.invalidDepRefs).toEqual([])
    expect(table.slices.map((s) => s.deps)).toEqual([[], [1]])

    rmSync(dir, { recursive: true, force: true })
  })
})
