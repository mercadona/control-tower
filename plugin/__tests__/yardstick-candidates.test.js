// §3.12 of the handoff (docs/prompt-juez-lo-que-queda.md): `reference-paths`
// proves that what §3 cited EXISTS (it catches invention) — nothing proved that
// EVERYTHING relevant was cited (the omission). This file protects the sweep
// that closes that asymmetry: `yardstickCandidates`, `declaredIn`,
// `pareceEsqueleto` and `formatCandidatos` in scripts/repo-yardstick.js, plus the
// executable wrapper scripts/detect-yardstick.mjs and its hook in scripts/ct-init.sh.
//
// The property these tests protect, above any detail of format: THE SWEEP
// PROPOSES AND NEVER DECLARES. It never writes to `.agent/conventions.md` —
// only the human who runs `/ct-init` decides what goes in there.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  CONVENTIONS_FILE,
  CANDIDATOS_HEADER,
  MAX_CANDIDATOS,
  MAX_PER_DIRECTORY,
  yardstickCandidates,
  declaredIn,
  pareceEsqueleto,
  formatCandidatos,
} from '../scripts/repo-yardstick.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const detectYardstickScript = join(root, 'scripts', 'detect-yardstick.mjs')
const initScript = join(root, 'scripts', 'ct-init.sh')

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ }
  }
})
function tmp(prefix = 'vara-cand-') {
  const d = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(d)
  return d
}
const paths = (r) => r.candidatos.map((c) => c.ruta)

// ---------------------------------------------------------------------------
// yardstickCandidates (pure)
// ---------------------------------------------------------------------------
describe('yardstickCandidates', () => {
  it('proposes the guides at the root and not a namesake under a subdirectory', () => {
    const r = yardstickCandidates({
      entradas: ['AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'CONTRIBUTING', 'docs/', 'docs/AGENTS.md'],
    })
    expect(paths(r)).toContain('AGENTS.md')
    expect(paths(r)).toContain('CLAUDE.md')
    expect(paths(r)).toContain('CONTRIBUTING.md')
    expect(paths(r)).not.toContain('docs/AGENTS.md')
    const agents = r.candidatos.find((c) => c.ruta === 'AGENTS.md')
    expect(agents.motivo).toBe('repo guide at the root')
  })

  it('from a directory matching "convention|rules" it proposes ITS FILES and not the directory', () => {
    const r = yardstickCandidates({
      entradas: [
        'docs/', 'docs/conventions/', 'docs/conventions/backend.md', 'docs/conventions/frontend.md',
        '.cursor/', '.cursor/rules/', '.cursor/rules/style.md',
      ],
    })
    expect(paths(r)).toContain('docs/conventions/backend.md')
    expect(paths(r)).toContain('docs/conventions/frontend.md')
    expect(paths(r)).toContain('.cursor/rules/style.md')
    // the directory itself is NEVER a candidate: a path ending in "/" cannot be read
    expect(paths(r).some((x) => x.endsWith('/'))).toBe(false)
    const m = r.candidatos.find((c) => c.ruta === 'docs/conventions/backend.md').motivo
    expect(m).toContain('docs/conventions/')
    expect(m).toContain('convention|rules')
  })

  it('proposes project skills by their SKILL.md', () => {
    const r = yardstickCandidates({ entradas: ['.claude/', '.claude/skills/', '.claude/skills/oc-review/', '.claude/skills/oc-review/SKILL.md'] })
    expect(paths(r)).toContain('.claude/skills/oc-review/SKILL.md')
    const m = r.candidatos.find((c) => c.ruta === '.claude/skills/oc-review/SKILL.md').motivo
    expect(m).toContain('Skills')
  })

  it('never proposes anything under .agent/ — neither the declaration itself nor the acknowledgement, not even when a subdirectory matches the rules rule', () => {
    const r = yardstickCandidates({
      entradas: [
        '.agent/', '.agent/conventions.md', '.agent/conventions-ack.md',
        '.agent/rules/', '.agent/rules/x.md',
      ],
    })
    expect(paths(r)).toEqual([])
  })

  it('filters out the ones already declared', () => {
    const r = yardstickCandidates({
      entradas: ['AGENTS.md', 'CLAUDE.md'],
      declaradas: new Set(['AGENTS.md']),
    })
    expect(paths(r)).toEqual(['CLAUDE.md'])
  })

  it('deterministic order: the input order makes no difference, and there are no duplicates even when a path matches two rules', () => {
    // `entradas` and `declaradas` are the option keys of `yardstickCandidates`
    // in repo-yardstick.js: they cross the module boundary and stay as they are.
    const entries = [
      'CLAUDE.md', 'AGENTS.md', 'CONTRIBUTING.md',
      'docs/', 'docs/conventions/', 'docs/conventions/rules/',
      'docs/conventions/rules/x.md', 'docs/conventions/b.md',
      '.claude/', '.claude/skills/', '.claude/skills/oc-review/', '.claude/skills/oc-review/SKILL.md',
    ]
    const a = yardstickCandidates({ entradas: entries })
    const b = yardstickCandidates({ entradas: [...entries].reverse() })
    expect(a).toEqual(b)
    // docs/conventions/rules/x.md matches TWO directories that match the rule
    // (docs/conventions/ AND docs/conventions/rules/) — once only in the list.
    expect(paths(a).filter((x) => x === 'docs/conventions/rules/x.md').length).toBe(1)
  })

  it('omitidos counts what did not fit in MAX_PER_DIRECTORY, and what is already declared does not count as omitted', () => {
    const files = Array.from({ length: 15 }, (_, i) => `docs/conventions/f${String(i + 1).padStart(2, '0')}.md`)
    const entries = ['docs/', 'docs/conventions/', ...files]
    const undeclared = yardstickCandidates({ entradas: entries })
    expect(paths(undeclared).length).toBe(MAX_PER_DIRECTORY)
    expect(undeclared.omitidos).toBe(15 - MAX_PER_DIRECTORY)

    const withOneDeclared = yardstickCandidates({ entradas: entries, declaradas: new Set(['docs/conventions/f01.md']) })
    expect(paths(withOneDeclared)).not.toContain('docs/conventions/f01.md')
    expect(paths(withOneDeclared).length).toBe(MAX_PER_DIRECTORY)
    // 14 candidates are left after filtering the declared one; cut to 12 → 2 omitted
    expect(withOneDeclared.omitidos).toBe(14 - MAX_PER_DIRECTORY)
  })

  it('MAX_CANDIDATOS cuts the global list once grouped, and counts the rest as omitted', () => {
    const skills = Array.from({ length: 50 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return [`.claude/skills/s${n}/`, `.claude/skills/s${n}/SKILL.md`]
    }).flat()
    const r = yardstickCandidates({ entradas: ['.claude/', '.claude/skills/', ...skills] })
    expect(r.candidatos.length).toBe(MAX_CANDIDATOS)
    expect(r.omitidos).toBe(50 - MAX_CANDIDATOS)
  })
})

// ---------------------------------------------------------------------------
// declaredIn
// ---------------------------------------------------------------------------
describe('declaredIn', () => {
  it('extracts the tokens between backticks and normalises "./" and the trailing slash', () => {
    const s = declaredIn('- `AGENTS.md`\n- `./docs/CONTRIBUTING.md`\n- `docs/conventions/`\n- ``\n- prosa sin backticks')
    expect(s.has('AGENTS.md')).toBe(true)
    expect(s.has('docs/CONTRIBUTING.md')).toBe(true)
    expect(s.has('docs/conventions')).toBe(true)
    expect(s.size).toBe(3)
  })

  it('the seed ct-init.sh sows declares nothing — the set comes out empty', () => {
    const dir = tmp()
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const content = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(declaredIn(content).size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// pareceEsqueleto
// ---------------------------------------------------------------------------
describe('pareceEsqueleto', () => {
  it('an AGENTS.md of headings only, in a vacuum, is a skeleton', () => {
    const headingsOnly = [
      '# AGENTS.md',
      '<!-- Guía durable del repo (≤150 líneas). Procedimientos → Skills. -->',
      '## Project overview',
      '## Setup commands',
      '## Build, test & lint',
      '## Code style & conventions',
      '## Project layout',
      '## Workflow: 1 issue = 1 slice = 1 session',
      '## Commit & PR rules',
      '## Security & data handling',
      '## Do NOT touch',
      '## Gotchas',
      '## Skills (load on demand)',
      '',
    ].join('\n')
    expect(pareceEsqueleto(headingsOnly)).toBe(true)
  })

  // Round 2 of the judge's verdict: the test above measures a literal written by
  // hand, not the file `ct-init.sh` REALLY leaves on disk — and that real file
  // does not stay at "headings only": the script itself always adds the slices
  // contract section to it (hundreds of lines of prose). This test runs the real
  // `ct-init.sh` and measures over its output, so that a regression in the
  // discounting of the contract block (see `withoutCtInitBlocks` in
  // scripts/repo-yardstick.js) shows up here.
  it('the AGENTS.md ct-init.sh REALLY leaves on disk is a skeleton, despite the sections the script itself adds to it', () => {
    const dir = tmp()
    execFileSync('bash', [initScript, dir], { encoding: 'utf8' })
    const content = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    // Confirms that the scenario is the real one and not a degenerate case: the
    // real file carries prose from the plugin —since #93, the short loop section
    // and the crossing one; before that, the whole contract as well— and not a
    // handful of loose headings. The threshold dropped from 100 lines to 20
    // precisely because of that split: what is measured here is that
    // `withoutCtInitBlocks`'s discounting still covers ALL the blocks ct-init
    // sows, and today there are three.
    expect(content.split('\n').length).toBeGreaterThan(20)
    for (const marker of ['<!-- ct-init:loop -->', '<!-- ct-init:e2e-howto -->']) {
      expect(content, marker).toContain(marker)
    }
    expect(pareceEsqueleto(content)).toBe(true)
  })

  it('a document with three real rules is not a skeleton', () => {
    const withRules = [
      '# Convenciones',
      'Usa siempre inyección de dependencias en el constructor.',
      'Los objetos de frontera son Pydantic, nunca dicts sueltos.',
      'Ningún caso de uso importa infraestructura directamente.',
    ].join('\n')
    expect(pareceEsqueleto(withRules)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// formatCandidatos
// ---------------------------------------------------------------------------
describe('formatCandidatos', () => {
  it('with no candidates, it returns the empty string', () => {
    expect(formatCandidatos([])).toBe('')
  })

  it('with candidates, it carries the header, every path between backticks and the sentence saying it proposes and does not declare — and never "warning"/"ATTENTION"/"unblock"', () => {
    const text = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'repo guide at the root' }])
    expect(text).toContain(CANDIDATOS_HEADER)
    expect(text).toContain('`AGENTS.md`')
    expect(text).toMatch(/PROPOSES.*human DECLARES|the human DECLARES/s)
    expect(text.toLowerCase()).not.toContain('warning')
    expect(text).not.toContain('ATTENTION')
    expect(text).not.toContain('unblock')
  })

  it("with a candidate marked as a skeleton, it explains that declaring it is worse than not declaring it — it hands the judge an empty document that does count as the repository's yardstick", () => {
    const text = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'repo guide at the root', esqueleto: true }])
    expect(text).toContain('[skeleton: headings only]')
    expect(text).toMatch(/empty document/)
    expect(text).toMatch(/worse than not declaring them/)
  })

  it('with omitted ones, it says how many more candidates are left unlisted', () => {
    const text = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'repo guide at the root' }], { omitidos: 5 })
    expect(text).toMatch(/\+5 more candidates/)
  })

  it('with truncated, it warns that absence is not proof of absence', () => {
    const text = formatCandidatos([{ ruta: 'AGENTS.md', motivo: 'repo guide at the root' }], { truncated: true })
    expect(text).toContain('Absence here is not proof of absence')
  })
})

// ---------------------------------------------------------------------------
// End to end: scripts/detect-yardstick.mjs
// ---------------------------------------------------------------------------
describe('detect-yardstick.mjs end to end', () => {
  it('repository with docs/conventions/backend.md → exit 0 and stdout carrying that path', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'backend.md'), '# reglas\nusa DI\n')
    const r = spawnSync('node', [detectYardstickScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('docs/conventions/backend.md')
  })

  it('repository with nothing → exit 0 and empty stdout', () => {
    const dir = tmp()
    const r = spawnSync('node', [detectYardstickScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })

  it('the same path already declared between backticks in .agent/conventions.md → empty stdout', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'backend.md'), '# reglas\nusa DI\n')
    mkdirSync(join(dir, '.agent'), { recursive: true })
    writeFileSync(join(dir, '.agent', 'conventions.md'), 'Rules to obey:\n- `docs/conventions/backend.md`\n')
    const r = spawnSync('node', [detectYardstickScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout.trim()).toBe('')
  })

  it('a target that is not a directory → exit 1, stderr explains it, empty stdout', () => {
    const dir = tmp()
    const file = join(dir, 'no-es-dir.txt')
    writeFileSync(file, 'x')
    const r = spawnSync('node', [detectYardstickScript, file], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stdout.trim()).toBe('')
    expect(r.stderr).toMatch(/no es un directorio/)
  })

  // Round 2 of the judge's verdict: nothing proved that `detect-yardstick.mjs`
  // really READ each candidate off disk and called `pareceEsqueleto` — the
  // `formatCandidatos` tests inject `esqueleto: true` by hand, so that wiring
  // could be deleted without the suite noticing. This test runs the real script
  // against real files, one a skeleton and one with rules, so that mutating
  // that line (or deleting it) DOES knock something down.
  it('reads each candidate off disk and marks [skeleton: headings only] ONLY on the one that really is', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'esqueleto.md'), '# Reglas\n## Sección\n')
    writeFileSync(
      join(dir, 'docs', 'conventions', 'real.md'),
      ['# Reglas', 'Usa siempre inyección de dependencias.', 'No importes infraestructura desde el dominio.', 'Los DTOs son inmutables.'].join('\n')
    )
    const r = spawnSync('node', [detectYardstickScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/`docs\/conventions\/esqueleto\.md` — [^\n]*\[skeleton: headings only\]/)
    expect(r.stdout).not.toMatch(/`docs\/conventions\/real\.md`[^\n]*\[skeleton/)
  })
})

// ---------------------------------------------------------------------------
// End to end: scripts/ct-init.sh — the two that really protect the design
// ---------------------------------------------------------------------------
describe('ct-init.sh invokes the candidate sweep', () => {
  it('with docs/conventions/x.md in the repository: the candidate block goes out on STDOUT, and .agent/conventions.md is still the seed byte for byte', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'x.md'), '# reglas\n')
    const r = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain(CANDIDATOS_HEADER)
    expect(r.stdout).toContain('docs/conventions/x.md')
    expect(r.stderr).not.toContain(CANDIDATOS_HEADER)
    const conventions = readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')
    expect(conventions).toMatch(/ninguna declarada todavía/)
    expect(conventions).not.toContain('docs/conventions/x.md')
  })

  it('idempotence: the second run goes on proposing the same thing without touching the file; declaring it by hand makes the third run stop proposing it and not trample the edit', () => {
    const dir = tmp()
    mkdirSync(join(dir, 'docs', 'conventions'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'conventions', 'x.md'), '# reglas\n')

    spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    const second = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('docs/conventions/x.md')
    expect(readFileSync(join(dir, CONVENTIONS_FILE), 'utf8')).toMatch(/ninguna declarada todavía/)

    const conventionsPath = join(dir, CONVENTIONS_FILE)
    const edited = 'Rules to obey (una ruta por línea, entre backticks; tiene que poder leerse):\n\n- `docs/conventions/x.md`\n'
    writeFileSync(conventionsPath, edited)

    const third = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(third.status).toBe(0)
    expect(third.stdout).not.toContain('docs/conventions/x.md')
    expect(readFileSync(conventionsPath, 'utf8')).toBe(edited)
  })

  // Round 2 of the judge's verdict: the case that motivates `pareceEsqueleto`
  // (decision 11 of the design) is exactly this one — a new repository, running
  // `/ct-init` for the first time, where the AGENTS.md the scaffolder itself has
  // just created is proposed as a candidate. It has to come out marked, or the
  // human would declare it believing it carries real rules.
  it('in a new repository, the AGENTS.md ct-init.sh itself has just created comes out marked [skeleton: headings only]', () => {
    const dir = tmp()
    const r = spawnSync('bash', [initScript, dir], { encoding: 'utf8' })
    expect(r.status).toBe(0)
    expect(r.stdout).toMatch(/`AGENTS\.md` — repo guide at the root \[skeleton: headings only\]/)
  })
})

// ---------------------------------------------------------------------------
// Ties: the text that tells the agent what to look for cannot diverge from the
// block the script actually prints.
// ---------------------------------------------------------------------------
describe('the sweep does not diverge from the texts that describe it', () => {
  const read = (...parts) => readFileSync(join(root, ...parts), 'utf8')

  it('commands/ct-init.md contains CANDIDATOS_HEADER verbatim', () => {
    expect(read('commands', 'ct-init.md')).toContain(CANDIDATOS_HEADER)
  })

  it('scripts/ct-init.sh mentions detect-yardstick.mjs', () => {
    expect(read('scripts', 'ct-init.sh')).toContain('detect-yardstick.mjs')
  })
})
