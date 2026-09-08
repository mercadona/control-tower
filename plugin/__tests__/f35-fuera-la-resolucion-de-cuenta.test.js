// F35 — ACCOUNT RESOLUTION IS OUT.
//
// The user's decision (talked over with José): the loop stops evaluating «which
// account does what». Out go the project map (ACCOUNT_MAP), the resolution
// (resolveAccount), the old map kept around to detect reclassifications
// (resolveAccountLegacy + legacy) and its whole cascade in ct-next.mjs: the
// CLAUDE_CONFIG_DIR preflight, the `--env CLAUDE_CONFIG_DIR` that travelled to
// the cmux daemon, and the four warnings that announced account, fallback,
// conflict and reclassification.
//
// What remains: ONE binary gets typed, `claude`, with the ambient configuration
// of whoever launches. `CT_AGENT_BIN` survives as the only override — it is not
// an account, it is the name of the executable, and it exists for the reason
// F29 documented: in the machine's real .zshrc, `claude` was an interactive
// shell FUNCTION («¿Qué cuenta? 1/2») that left the agent hanging on a `read`
// while ct-next counted it as launched. With no accounts, that risk comes back,
// and this override is the only way out that does not reintroduce the map.
//
// parseRepoSlug does NOT go: it lives in the same block but has three consumers
// that have nothing to do with accounts (ct-status.mjs, ct-harvest.mjs and
// ct-next.mjs validating `--repo`).
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as kickoff from '../scripts/kickoff.js'
import * as dispatch from '../scripts/dispatch.js'
import { hermeticEnv } from './fixtures/hermetic-env.js'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-next.mjs')

const FIXTURE_ONE_READY = JSON.stringify({
  issues: [{ n: 42, order: 1, status: 'ready', deps: [], touches: ['api'], name: 'refresh', type: 'backend', ac: ['AC-1'], issue: '#42' }],
  mergedIssues: [],
})

function run(args, envOverrides = {}) {
  const r = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...hermeticEnv(), ...envOverrides },
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

describe('F35 — the account map no longer exists', () => {
  it('kickoff.js does not export ACCOUNT_MAP', () => {
    expect(kickoff.ACCOUNT_MAP).toBeUndefined()
  })

  it('dispatch.js exports nothing from account resolution', () => {
    for (const sym of ['resolveAccount', 'resolveAccountLegacy', 'validateAccountMap', 'matchesAccountPattern', 'accountPatternError', 'DEFAULT_AGENT_BIN']) {
      expect(dispatch[sym], `dispatch.js sigue exportando ${sym}`).toBeUndefined()
    }
  })

  // The cut does not take the neighbour down with it: parseRepoSlug lived in
  // the same block and ct-status, ct-harvest and ct-next use it to validate
  // --repo.
  it('parseRepoSlug survives and still validates `owner/repo`', () => {
    expect(dispatch.parseRepoSlug('o/r')).toEqual({ owner: 'o', name: 'r' })
    expect(dispatch.parseRepoSlug('sin-owner')).toBeNull()
  })

  // This test looks at EXECUTABLE CODE, not comments. Two references survive
  // on purpose and are not hidden debt:
  //   - the buildCmuxArgv comments in dispatch.js, which document with measured
  //     evidence how cmux's `--env` behaves (the mechanism still exists and is
  //     still tested; what is gone is a caller that passes it anything);
  //   - ct-init.sh, where the mention lives INSIDE the slices-contract block
  //     that gets seeded into every repository's AGENTS.md. Changing that text
  //     alters its hash and forces a bump of SLICES_CONTRACT_VERSION, which is
  //     a protocol with the user's explicit opt-in
  //     (--update-slices-contract): not something that sneaks in as a side
  //     effect of this deletion.
  it('no module imports the account symbols any more', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const dir = join(here, '..', 'scripts')
    const offenders = []
    for (const f of readdirSync(dir)) {
      if (!/\.(js|mjs)$/.test(f)) continue
      for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
        if (line.trimStart().startsWith('//')) continue
        for (const sym of ['ACCOUNT_MAP', 'resolveAccount', 'resolveAccountLegacy', 'validateAccountMap', 'CT_ACCOUNT_']) {
          if (line.includes(sym)) offenders.push(`${f}: ${sym} en \`${line.trim().slice(0, 60)}\``)
        }
      }
    }
    expect(offenders).toEqual([])
  })

})

describe('F35 — the dry run no longer talks about accounts', () => {
  const dry = () => run(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY })

  it('announces no resolved account, no fallback, no CLAUDE_CONFIG_DIR', () => {
    const { out } = dry()
    expect(out).not.toMatch(/cuenta resuelta/)
    expect(out).not.toMatch(/CLAUDE_CONFIG_DIR/)
    expect(out).not.toMatch(/ACCOUNT_MAP/)
    expect(out).not.toMatch(/CAMBIO DE CUENTA/)
  })

  // The cmux argv carried `--env CLAUDE_CONFIG_DIR=<dir>`. With no account to
  // resolve there is nothing to export: the session inherits the ambient
  // configuration.
  it('the cmux argv carries no --env at all', () => {
    const { out } = dry()
    const cmuxLine = out.split('\n').find((l) => l.includes('cmux') && l.includes('new-workspace'))
    expect(cmuxLine, 'no se encontró la línea de cmux en el dry-run').toBeTruthy()
    expect(cmuxLine).not.toMatch(/--env/)
  })

  it('the agent command types `claude`, and CT_AGENT_BIN can change it', () => {
    expect(dry().out).toMatch(/claude --dangerously-skip-permissions/)
    const { out } = run(['--repo', 'o/r', '--cap', '1', '--dry-run'], { CT_NEXT_FIXTURE: FIXTURE_ONE_READY, CT_AGENT_BIN: 'claude-otro' })
    expect(out).toMatch(/claude-otro --dangerously-skip-permissions/)
  })
})
