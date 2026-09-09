// F14 — F11'S DETECTOR WAS A GUARD THAT COULD NOT BE SATISFIED.
//
// Verified in the field against the real repo (menoplus, read only). The repo
// followed the detector's own advice: it decided that the plugin's claim rules
// and rewrote AGENTS.md and CLAUDE.md to say so. **The detector went on
// flagging it**, because it looked for substrings: it matched against the
// `scripts/` line of a directory tree, against the new sentences explaining
// that the claim is NO LONGER done by the agent, against the deliberate
// documentation of the manual use, and against the factual descriptions of the
// hooks in an inventory table. The only way to turn it green was to delete
// correct documentation.
//
// And at the same time it missed the only live thing left: the two guides
// pointed at `docs/agentic-workflow.md` as the «referencia completa», and
// there it still was, in the imperative aimed straight at the agent, `Claim
// (primer paso del agente): ./scripts/dispatch-check.sh <issue#>`. The
// detector only looked at AGENTS.md and CLAUDE.md.
//
// These tests pin the property that was missing: **from any state the detector
// flags there is a path that leaves it green without making the repo worse**,
// and the detector reaches where the guide itself says to look.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  detectConventions,
  formatFindings,
  parseAcks,
  linkedDocPaths,
  ACK_PATH,
} from '../scripts/conventions.js'
import { readRepoDocs, readAck, MAX_LINKED_DOCS } from '../scripts/conventions-io.js'

const here = dirname(fileURLToPath(import.meta.url))
const detectScript = join(here, '..', 'scripts', 'detect-conventions.mjs')
const initScript = join(here, '..', 'scripts', 'ct-init.sh')

const ids = (r) => r.map((f) => f.id).sort()
const doc = (content, path = 'AGENTS.md') => ({ path, content })

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})
function tmp(prefix = 'ct-f14-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}

// ============================================================================
// A. MANDATE vs MENTION. Every case here is a LITERAL LINE from the real repo
// that F11's detector flagged and that cannot be "fixed" without deleting
// correct documentation.
// ============================================================================
describe('F14/A — the detector tells an order from a mention', () => {
  it('the `scripts/` line of a DIRECTORY TREE is not an order (AGENTS.md:69 of the real repo)', () => {
    const tree = [
      '# AGENTS.md',
      '## Project layout',
      '```',
      'apps/backend   FastAPI + Alembic + Docker',
      'scripts/       dispatch-check.sh, dependabot-*, sentry-*, workflow-models.json, tests/',
      '```',
    ].join('\n')
    expect(detectConventions({ docs: [doc(tree)], files: [] })).toEqual([])
  })

  it('the sentence explaining that the claim is NO LONGER done by the agent is not an order (CLAUDE.md:221 of the real repo)', () => {
    const line =
      '- **Flujo agéntico.** **El claim lo hace el dispatcher del loop (`/ct-next`), no el agente:** deja el ' +
      'issue en `status:in-progress` antes de arrancarte. `scripts/dispatch-check.sh` (anti-colisión por ' +
      'area/touches, `<issue#>` para claim y `--release <issue#>` al abrir PR) se queda para trabajar un ' +
      'issue **a mano, fuera del loop** — no lo corras por defecto.'
    expect(detectConventions({ docs: [doc(`# C\n${line}\n`, 'CLAUDE.md')], files: [] })).toEqual([])
  })

  it('documenting the manual use OUTSIDE the loop is not an order, not even when the scope lives in the parent bullet', () => {
    // docs/agentic-workflow.md of the real repo: the order and its scope live
    // on different lines. Read on its own, the claim line is indistinguishable
    // from the old version that did tell the agent to claim.
    const content = [
      '## Regla de colisión',
      '',
      '- **Dentro del loop Control Tower (por defecto):** lo hace `/ct-next` en código.',
      '- **A mano, fuera del loop:** entonces sí, lo aplicas tú con `scripts/dispatch-check.sh`:',
      '  - **Claim:** `./scripts/dispatch-check.sh <issue#>` → pone `status:in-progress`.',
      '  - **Release** (al abrir PR): `./scripts/dispatch-check.sh --release <issue#>`.',
    ].join('\n')
    expect(detectConventions({ docs: [doc(content)], files: [] })).toEqual([])
  })

  it('the description of a hook in an inventory table is not a worktrees convention (CLAUDE.md:267-268)', () => {
    const content = [
      '### Hooks locales del proyecto',
      '- **branch-isolation-guard.sh** (PreToolUse, Bash). Bloquea `git checkout/switch` hacia una rama ≠ `main`; empuja a `git worktree add`. Permite: `main`, restore `-- <fichero>`, detached (sha/tag).',
      '- **Resto.** `worktree-guard.sh` (bloquea `git worktree add` con dirty tree), `worktree-merge-check.sh` (advierte tras cherry-pick).',
    ].join('\n')
    expect(detectConventions({ docs: [doc(content, 'CLAUDE.md')], files: [] })).toEqual([])
  })

  it('a REAL `git worktree add <someone elses path>` still warns, inside a blockquote too (CLAUDE.md:149)', () => {
    const content = [
      '## Worktree Safety',
      '> ### 🛑 Política de aislamiento de ramas (ESTRICTA)',
      '> **Una sesión = un worktree = una rama.** Todo trabajo nuevo arranca creando un worktree propio:',
      '> ```',
      '> git worktree add .claude/worktrees/<slug> -b <rama> main   # y trabaja DENTRO del worktree',
      '> ```',
    ].join('\n')
    const r = detectConventions({ docs: [doc(content, 'CLAUDE.md')], files: [] })
    expect(ids(r)).toEqual(['worktrees'])
    expect(r[0].evidence[0].line).toBe(5)
  })

  it('a verb in front turns a mention into an order: `corre dispatch-check.sh 42` does, the bare name does not', () => {
    expect(ids(detectConventions({ docs: [doc('Antes de implementar, corre dispatch-check.sh 42.')], files: [] }))).toEqual(['claim'])
    expect(detectConventions({ docs: [doc('El anti-colisión vive en scripts/dispatch-check.sh y lo mantiene Jose.')], files: [] })).toEqual([])
  })

  it('the scope is inherited from the PARENT bullet, never from a SIBLING bullet', () => {
    // If a sibling could silence the next one, a single loose "fuera del loop"
    // anywhere in the list would be enough to switch the whole section off —
    // and that would be the false negative that costs the deadlock.
    const content = [
      '## Flujo',
      '- El claim lo hace `/ct-next`, no tú (fuera del loop es otra historia).',
      '- Antes de implementar corre `./scripts/dispatch-check.sh <issue#>`.',
    ].join('\n')
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['claim'])
  })

  it('a scope marker does NOT swallow a mandate that contains it: «ya no es opcional: corre …»', () => {
    const content = '- **Claim.** Ya no es opcional: corre `./scripts/dispatch-check.sh <issue#>` antes de implementar.'
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['claim'])
  })

  it('a bare «a mano» does NOT silence — it only silences when it takes the order out of the loop', () => {
    // Deliberate: «reclama el issue a mano con tu script» is EXACTLY the
    // deadlock that gave rise to F11.
    expect(ids(detectConventions({ docs: [doc('Reclama el issue a mano: `./scripts/dispatch-check.sh <issue#>`.')], files: [] }))).toEqual(['claim'])
  })

  // The next two came out of the SWEEP for false negatives, not out of thin
  // air: on narrowing the rule we measured what it stopped detecting and these
  // two were real orders that were slipping through. They were closed; the
  // other four cases of the sweep are the accepted cost and are in the F14
  // report.
  it('an obligation declared without command form IS STILL an order', () => {
    expect(ids(detectConventions({ docs: [doc('El claim se gestiona con `scripts/dispatch-check.sh`, que es obligatorio.')], files: [] }))).toEqual(['claim'])
    expect(ids(detectConventions({ docs: [doc('- **Claim** (primer paso del agente): `scripts/dispatch-check.sh`.')], files: [] }))).toEqual(['claim'])
    // Control: with no obligation marker, the same mention does not warn.
    expect(detectConventions({ docs: [doc('El claim se gestiona con `scripts/dispatch-check.sh`.')], files: [] })).toEqual([])
  })

  it('a `git worktree add` split over several lines warns: the path is not visible, so it cannot be ruled out', () => {
    const content = '```\ngit worktree add \\\n  ../wt/foo -b x main\n```'
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['worktrees'])
  })

  it('the TEST of a claim script and an archived STATE.md are not living conventions', () => {
    expect(detectConventions({ docs: [], files: ['scripts/tests/dispatch-check.test.sh'] })).toEqual([])
    expect(detectConventions({ docs: [], files: ['docs/archive/planning-gsd/STATE.md'] })).toEqual([])
    // Control: the real script and a living state still count.
    expect(ids(detectConventions({ docs: [], files: ['scripts/dispatch-check.sh'] }))).toEqual(['claim'])
    expect(ids(detectConventions({ docs: [], files: ['docs/STATE.md'] }))).toEqual(['estado'])
  })
})

// ============================================================================
// B. THE ACKNOWLEDGEMENT. The GUARANTEE that there is a way out.
// Deterministic, per signal, with a date and a reason: it does not depend on
// any text heuristic getting it right.
// ============================================================================
describe('F14/B — the explicit acknowledgement gives a way out for ONE signal, not for all', () => {
  const noisy = {
    docs: [doc('- corre `./scripts/dispatch-check.sh <n>`\n- `git worktree add wt/<slug> -b x main`')],
    files: ['docs/STATE.md'],
  }

  it('a valid acknowledgement silences ITS signal and leaves the others intact', () => {
    const { acks, problems } = parseAcks('claim: 2026-07-28 — manda el claim del plugin; el script se queda para trabajo a mano\n')
    expect(problems).toEqual([])
    const r = detectConventions({ ...noisy, acks })
    expect(ids(r)).toEqual(['claim', 'estado', 'worktrees'])
    expect(r.find((f) => f.id === 'claim').silenced).toMatchObject({ date: '2026-07-28' })
    expect(r.find((f) => f.id === 'worktrees').silenced).toBeUndefined()
    expect(r.find((f) => f.id === 'estado').silenced).toBeUndefined()
  })

  it('what is silenced is said in ONE line: «se decidió no mirar esto» is not «no hay nada»', () => {
    const { acks } = parseAcks('claim: 2026-07-28 — manda el del plugin\nworktrees: 2026-07-28 — el hook admite feat/\nestado: 2026-07-28 — el otro es histórico\n')
    const text = formatFindings(detectConventions({ ...noisy, acks }))
    expect(text).not.toMatch(/ATTENTION/)
    expect(text).toMatch(/note: \[claim\] silenced by \.agent\/conventions-ack\.md \(2026-07-28: manda el del plugin\)/)
    expect(text.split('\n')).toHaveLength(3)
  })

  it('the LIVE warning carries the way out written into it: it says where and in what shape one acknowledges', () => {
    const text = formatFindings(detectConventions(noisy))
    expect(text).toContain(ACK_PATH)
    expect(text).toMatch(/claim: \d{4}-\d{2}-\d{2} —/)
    expect(text).toMatch(/There is no need to delete correct/)
  })

  // F15/H3: the last line ('esto es prosa suelta') is NO LONGER a problem —
  // it did not mean to be an acknowledgement. The three above did mean to be
  // and are still reported, which is the property that cannot be lost.
  it('with no date, no reason, with an unknown signal: it does NOT silence and why is SAID (loose prose, by contrast, is ignored)', () => {
    const { acks, problems } = parseAcks(
      [
        '# comentario, se ignora',
        'claim: manda el del plugin',        // no date
        'worktrees: 2026-07-28',             // no reason
        'claims: 2026-07-28 — typo en la señal',
        'esto es prosa suelta',
      ].join('\n')
    )
    expect(acks.size).toBe(0)
    expect(problems.map((p) => p.line)).toEqual([2, 3, 4])
    expect(problems[0].why).toMatch(/date/)
    expect(problems[1].why).toMatch(/reason/)
    expect(problems[2].why).toMatch(/unknown/)
    // And the warning prints it: an acknowledgement that neither silences nor
    // complains is the worst combination — the human believes they have
    // already decided it and keeps seeing the warning.
    const text = formatFindings(detectConventions(noisy), { ackProblems: problems })
    expect(text).toMatch(/silences nothing/)
    expect(text).toContain('claims')
  })

  it('a signal acknowledged twice is reported: the second line adds nothing', () => {
    const { acks, problems } = parseAcks('claim: 2026-07-01 — a\nclaim: 2026-07-28 — b\n')
    expect(acks.get('claim').date).toBe('2026-07-01')
    expect(problems).toHaveLength(1)
    expect(problems[0].why).toMatch(/was already acknowledged/)
  })

  it('CRLF, BOM, a bullet in front and upper case: the acknowledgement still holds', () => {
    const { acks, problems } = parseAcks('﻿# ack\r\n- Claim: 2026-07-28 — decidido\r\n')
    expect(problems).toEqual([])
    expect(acks.get('claim')).toMatchObject({ date: '2026-07-28', reason: 'decidido' })
  })

  it('a code block inside the acknowledgement file is not taken for failed acknowledgements', () => {
    const { acks, problems } = parseAcks(['# ejemplo', '```', 'claim: YYYY-MM-DD — motivo', '```', 'claim: 2026-07-28 — de verdad'].join('\n'))
    expect(problems).toEqual([])
    expect(acks.get('claim').date).toBe('2026-07-28')
  })

  it('an UNREADABLE acknowledgement file is said: it does not pass for «no acusaste nada»', () => {
    const root = tmp()
    mkdirSync(join(root, '.agent'))
    mkdirSync(join(root, ACK_PATH)) // a DIRECTORY where the file should go: EISDIR, not ENOENT
    const { acks, unreadable } = readAck(root)
    expect(acks.size).toBe(0)
    expect(unreadable).toBeTruthy()
    expect(formatFindings(detectConventions(noisy), { ackUnreadable: unreadable })).toMatch(
      /`.*` exists but could not be read/
    )
  })

  it('PROPERTY, end to end: a flagged repo reaches GREEN without touching its documentation', () => {
    // This is the test F11 did not have, and that is why a wall came out. The
    // repo does NOT change one line of its guides: it only writes down what it
    // had already decided.
    const root = tmp()
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'dispatch-check.sh'), '#!/usr/bin/env bash\n')
    writeFileSync(
      join(root, 'AGENTS.md'),
      '# AGENTS.md\n- **Claim:** `./scripts/dispatch-check.sh <issue#>` antes de implementar.\n'
    )
    const before = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(before.status).toBe(0)
    expect(before.stdout).toMatch(/\[claim\]/)
    expect(before.stdout).toContain(ACK_PATH)

    const docsBefore = spawnSync('cat', [join(root, 'AGENTS.md')], { encoding: 'utf8' }).stdout
    mkdirSync(join(root, '.agent'), { recursive: true })
    writeFileSync(
      join(root, ACK_PATH),
      '# Convenciones ya decididas\nclaim: 2026-07-28 — manda el claim del plugin; el script del repo se queda para trabajo a mano fuera del loop\n'
    )
    const after = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(after.status).toBe(0)
    expect(after.stdout).not.toMatch(/ATTENTION/)
    expect(after.stdout).toMatch(/note: \[claim\] silenced/)
    // And the documentation is exactly the same: nobody has had to delete anything.
    expect(spawnSync('cat', [join(root, 'AGENTS.md')], { encoding: 'utf8' }).stdout).toBe(docsBefore)
  })

  it('an acknowledgement that no longer silences anything is flagged: otherwise it is a permanent hole', () => {
    // Someone acknowledges `estado` in July, in September they resolve the
    // file, and the line stays there covering in advance any foreign state
    // that may turn up tomorrow. It is only said in /ct-init, which is the one
    // that does the full scan.
    const root = tmp()
    mkdirSync(join(root, '.agent'), { recursive: true })
    writeFileSync(join(root, ACK_PATH), 'estado: 2026-07-28 — el otro STATE.md era histórico y ya se borró\n')
    const r = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/acknowledges `estado` but there is no longer any signal/)
  })

  it('ct-init respects the acknowledgement (the same detection in the bootstrap as in the dispatch)', () => {
    const root = tmp()
    mkdirSync(join(root, 'scripts'), { recursive: true })
    writeFileSync(join(root, 'scripts', 'dispatch-check.sh'), '#!/usr/bin/env bash\n')
    mkdirSync(join(root, '.agent'), { recursive: true })
    writeFileSync(join(root, ACK_PATH), 'claim: 2026-07-28 — decidido: manda el del plugin\n')
    const r = spawnSync('bash', [initScript, root], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stderr).not.toMatch(/ATTENTION: this repo already had conventions/)
    expect(r.stderr).toMatch(/note: \[claim\] silenced/)
  })
})

// ============================================================================
// C. ONE HOP from the guide. The hole through which the old order slipped in.
// ============================================================================
describe('F14/C — the detector follows the trail the guide itself declares authorised', () => {
  function repoWithReference() {
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(
      join(root, 'AGENTS.md'),
      [
        '# AGENTS.md',
        '- **El claim lo hace `/ct-next`, no tú.** No lo reclames a mano.',
        '- Referencia completa: `docs/agentic-workflow.md`.',
      ].join('\n')
    )
    writeFileSync(
      join(root, 'docs', 'agentic-workflow.md'),
      [
        '# Flujo agéntico',
        '## Regla de colisión',
        'Lo aplica `scripts/dispatch-check.sh` (claim/release vía labels):',
        '- **Claim** (primer paso del agente): `./scripts/dispatch-check.sh <issue#>` → pone `status:in-progress`.',
      ].join('\n')
    )
    return root
  }

  it('the old order living in the document AGENTS.md calls «referencia completa» IS DETECTED and cited', () => {
    const root = repoWithReference()
    const { docs } = readRepoDocs(root)
    expect(docs.map((d) => d.path)).toContain('docs/agentic-workflow.md')
    const r = detectConventions({ docs, files: [] })
    expect(ids(r)).toEqual(['claim'])
    expect(r[0].evidence[0]).toMatchObject({ path: 'docs/agentic-workflow.md', line: 4, via: 'AGENTS.md' })
    expect(formatFindings(r)).toContain('(enlazado desde AGENTS.md)')
  })

  it('the same order also comes out in the DISPATCH, not only in the bootstrap', () => {
    const root = repoWithReference()
    const r = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(r.stdout).toContain('docs/agentic-workflow.md:4')
  })

  it('ONE hop, not two: the grandchild is not read (a rabbit hole is not a scope)', () => {
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    writeFileSync(join(root, 'AGENTS.md'), '- Ver [el flujo](docs/flujo.md).\n')
    writeFileSync(join(root, 'docs', 'flujo.md'), '- Detalle en [el spec](spec.md).\n')
    writeFileSync(join(root, 'docs', 'spec.md'), '- Claim: `./scripts/dispatch-check.sh <n>`.\n')
    const { docs } = readRepoDocs(root)
    expect(docs.map((d) => d.path).sort()).toEqual(['AGENTS.md', 'docs/flujo.md'])
    expect(detectConventions({ docs, files: [] })).toEqual([])
  })

  it('a link that leaves the repo is not read, neither by path nor by symlink', () => {
    const outside = tmp('ct-f14-out-')
    writeFileSync(join(outside, 'evil.md'), '- Claim: `./scripts/dispatch-check.sh <n>`.\n')
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    symlinkSync(join(outside, 'evil.md'), join(root, 'docs', 'link.md'))
    writeFileSync(join(root, 'AGENTS.md'), '- Ver `../evil.md` y también `docs/link.md`.\n')
    const { docs } = readRepoDocs(root)
    expect(docs.map((d) => d.path)).toEqual(['AGENTS.md'])
  })

  it('links into the territory of the loop itself (.worktrees/, .agent/) and into templates are not followed', () => {
    expect(
      linkedDocPaths([doc('- estado en `.worktrees/<n>/.agent/STATE.md`, `.agent/STATE.md`, `apps/{a,b}/CLAUDE.md`, `https://x/y.md`, `/ruta/abs.md`')])
    ).toEqual([])
  })

  it('if the guide cites more documents than can be read, it is SAID that it was cut short', () => {
    const root = tmp()
    mkdirSync(join(root, 'docs'), { recursive: true })
    const links = []
    for (let i = 0; i < MAX_LINKED_DOCS + 3; i++) {
      writeFileSync(join(root, 'docs', `d${i}.md`), '# nada\n')
      links.push(`- ver \`docs/d${i}.md\``)
    }
    writeFileSync(join(root, 'AGENTS.md'), links.join('\n'))
    const { docs, truncated } = readRepoDocs(root)
    expect(truncated).toBe(true)
    expect(docs).toHaveLength(1 + MAX_LINKED_DOCS)
    const r = spawnSync('node', [detectScript, root], { encoding: 'utf8' })
    expect(r.stdout).toMatch(/only the first ones have been looked at/)
  })

  it('a broken link says nothing, but an unreadable AGENTS.md does', () => {
    const root = tmp()
    writeFileSync(join(root, 'AGENTS.md'), '- ver `docs/no-existe.md`\n')
    expect(readRepoDocs(root).failures).toEqual([])
    const root2 = tmp()
    mkdirSync(join(root2, 'AGENTS.md'))
    expect(readRepoDocs(root2).failures.join(' ')).toMatch(/AGENTS\.md/)
  })
})
