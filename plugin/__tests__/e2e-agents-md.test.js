// ============================================================================
// The section of AGENTS.md that declares HOW this repo is traversed.
//
// The plugin governs other people's repos and cannot know how one is brought
// up: in a Rust library it is `cargo run --example` and a port; in an app with
// staging it is a browser and flags. The repo's owner declares it, just as it
// already declares build/test/lint.
//
// AND MIND WHAT IS NOT REUSED: SLICES_PRISTINE_HASHES hashes its block to
// detect whether the user touched it. Here it would be the other way round —
// this section is a TEMPLATE the user HAS to fill in, and with pristine hashes
// filling it in would read as tampering. Same code, opposite purpose: the
// markers and the seeding are taken, and version and pristine are left out.
// ============================================================================
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const INIT = fileURLToPath(new URL('../scripts/ct-init.sh', import.meta.url))

// The contract version is READ from ct-init.sh itself (same doctrine and same
// reason as in ct-init.test.js): the number typed in here by hand fell behind
// at the first bump unrelated to this feature.
const CONTRACT_VERSION = Number(readFileSync(INIT, 'utf8').match(/^SLICES_CONTRACT_VERSION=(\d+)$/m)[1])

function initIn(existingAgents) {
  const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e-'))
  spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
  if (existingAgents != null) writeFileSync(join(dir, 'AGENTS.md'), existingAgents)
  const r = spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
  const agents = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
  // #93 — the contract moved out of AGENTS.md into its own file in the
  // governed repo. This suite looks at BOTH things: the traversal section,
  // which is still in AGENTS.md, and the contract version, which no longer is.
  const contrato = readFileSync(join(dir, 'docs', 'superpowers', 'CONTRATO-SLICES.md'), 'utf8')
  rmSync(dir, { recursive: true, force: true })
  return { r, agents, contrato }
}

describe('the traversal section in AGENTS.md', () => {
  it('is seeded with its six fields and the default time limit', () => {
    const { agents } = initIn(null)
    expect(agents).toContain('## Cómo se atraviesa este repo (e2e)')
    for (const f of ['Levantar:', 'Listo cuando:', 'Plazo:', 'Tirar:', 'Herramientas:', 'Fuera de límites:']) {
      expect(agents, f).toContain(f)
    }
    expect(agents).toMatch(/por defecto 60/)
  })

  it('filling it in does NOT stop the plugin from recognising it', () => {
    const { agents } = initIn(null)
    const relleno = agents.replace('- Levantar:', '- Levantar:      cargo run --example serve')
    const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e2-'))
    spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    writeFileSync(join(dir, 'AGENTS.md'), relleno)
    const r = spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(r.status).toBe(0)
    expect(after).toContain('cargo run --example serve')
    expect(after).toContain('## Cómo se atraviesa este repo (e2e)')
  })

  it('does not duplicate the section when run twice', () => {
    const { agents } = initIn(null)
    const dir = mkdtempSync(join(tmpdir(), 'ct-init-e2e3-'))
    spawnSync('git', ['init', '-q', dir], { encoding: 'utf8' })
    writeFileSync(join(dir, 'AGENTS.md'), agents)
    spawnSync('bash', [INIT, dir], { encoding: 'utf8' })
    const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8')
    rmSync(dir, { recursive: true, force: true })
    expect(after.match(/## Cómo se atraviesa este repo \(e2e\)/g)).toHaveLength(1)
  })

  // v20 and not v19: `Señal` and `E2E` arrived in parallel and both claimed
  // v19. v19 was published with the `Señal` block; the block that brings the
  // two columns needs a number of its own, and this is it. What the test nails
  // down is still the same — that the seeded block documents the E2E column and
  // that its version is the one the script declares, not a number typed twice.
  //
  // v21: the clarification of the TWO "not applicable" tokens (`no` and `n/a`)
  // went up a number — an earlier pass left it at v20 with no bump and no repo
  // bootstrapped with that v20 could receive it. The test nails down the same
  // thing, now against v21.
  //
  // #93: the contract stopped being a section of AGENTS.md, so the version is
  // looked up in its own file. What the test nails down does not change: that
  // it goes by the version the script declares and that it documents the E2E
  // column.
  it('the slices-table contract goes by the version the script declares and documents the E2E column', () => {
    const { contrato } = initIn(null)
    expect(contrato).toContain(`<!-- ct-init:slices-contract-version: ${CONTRACT_VERSION} -->`)
    expect(contrato).toContain('E2E')
  })
})
