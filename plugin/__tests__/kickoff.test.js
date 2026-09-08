import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderKickoff, buildStateSeed, ADDENDA, SENAL_AUSENTE } from '../scripts/kickoff.js'
import { BaselineOutcome, BaselineResult } from '../scripts/baseline.js'
import { parseState } from '../scripts/state.js'

const SLICE = { n: 7, name: 'refresh token', type: 'backend', ac: ['AC-7.1'], deps: [1], issue: '#7' }

// F-jjponz-4 — these four tests looked for each addendum's markers
// (`contrato`, `screenshot`, `dry-run`…) over the WHOLE kickoff, using it as a
// proxy for the addendum. It is the cross false positive `gates.js` warns
// about: the moment the kickoff's shared text uses one of those words —this
// round added "contratos" to the Primer acto— the ui/infra/bugfix tests fail
// without anything being broken. The absence is now checked against the REAL
// addendum (ADDENDA is already exported), which is what they actually mean to
// say: "the kickoff of this Tipo does not carry another one's addendum".
const otrosAddenda = (tipo) =>
  Object.entries(ADDENDA).filter(([t]) => t !== tipo).map(([, texto]) => texto)

describe('renderKickoff', () => {
  it('backend: carries its own addendum and none of the others', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain('ct-step')
    // F22: the state file of a slice agent is `.agent/SLICE.md`. The kickoff
    // is ONLY received by a slice agent, so naming the coordinator's
    // `.agent/STATE.md` here was sending it to the tracked file whose
    // contamination motivated this whole round.
    expect(k).toContain('.agent/SLICE.md')
    expect(k).toContain(ADDENDA.backend)
    for (const otro of otrosAddenda('backend')) expect(k).not.toContain(otro)
  })
  it('ui: carries its own addendum and none of the others', () => {
    const k = renderKickoff({ ...SLICE, type: 'ui' }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain(ADDENDA.ui)
    expect(k.toLowerCase()).toMatch(/screenshot|design system/)
    for (const otro of otrosAddenda('ui')) expect(k).not.toContain(otro)
  })
  it('infra: carries its own addendum and none of the others', () => {
    const k = renderKickoff({ ...SLICE, type: 'infra' }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain(ADDENDA.infra)
    expect(k.toLowerCase()).toMatch(/dry-run.*plan primero/)
    for (const otro of otrosAddenda('infra')) expect(k).not.toContain(otro)
  })
  it('bugfix: carries its own addendum and none of the others', () => {
    const k = renderKickoff({ ...SLICE, type: 'bugfix' }, { repo: 'o/r' , conventionsDir: '/plugin/conventions' })
    expect(k).toContain(ADDENDA.bugfix)
    expect(k.toLowerCase()).toMatch(/reproduce-first.*test que falla/)
    for (const otro of otrosAddenda('bugfix')) expect(k).not.toContain(otro)
  })
})

// W-C: releasing the claim (status:in-progress → status:in-review) still
// lives in the kickoff (the agent decides it, not the code) — but it has to be
// the LITERAL command with the real values substituted in, not a description
// the agent has to translate on its own and may never execute (see the brief:
// "instructing the agent via the prompt is not acceptable [for the claim]
// because a prompt is advisory" — the release IS deliberately left in the
// prompt, but with the same care over literality).
//
// Fix round 1 (W-C review), finding 1 — CRITICAL IN PRACTICE: `${CLAUDE_
// PLUGIN_ROOT}` is only substituted by Claude Code when it renders
// `commands/*.md` and `hooks/hooks.json` — it is NOT an environment variable
// of the agent session's shell (verified by the reviewer: `env | grep CLAUDE`
// in a session with the plugin loaded shows CLAUDE_CONFIG_DIR/CLAUDE_CODE_*,
// but never CLAUDE_PLUGIN_ROOT). A kickoff that emitted that literal token
// would produce `node ${CLAUDE_PLUGIN_ROOT}/scripts/dispatch-check.mjs ...` →
// the agent would run it exactly as it stands and get `Cannot find module` —
// on EVERY successful dispatch, not an edge case. `ct-next.mjs` already
// resolves `dispatchCheckPath` as a real absolute path (relative to its own
// location): renderKickoff must receive it and use it as it stands, never the
// unexpanded token.
describe('renderKickoff — the --release instruction (W-C, fix round 1: the real path, not ${CLAUDE_PLUGIN_ROOT})', () => {
  const FAKE_DISPATCH_CHECK_PATH = '/plugin/root/scripts/dispatch-check.mjs'

  it('includes the literal dispatch-check --release command with the real ABSOLUTE path it received, with issue and repo substituted', () => {
    const k = renderKickoff({ ...SLICE, n: 42 }, { repo: 'o/r', dispatchCheckPath: FAKE_DISPATCH_CHECK_PATH , conventionsDir: '/plugin/conventions' })
    expect(k).toContain(`node ${FAKE_DISPATCH_CHECK_PATH} 42 --repo o/r --release`)
  })

  it("NEVER emits the ${CLAUDE_PLUGIN_ROOT} token unexpanded — it is not a real env var of the agent session's shell", () => {
    const k = renderKickoff({ ...SLICE, n: 7 }, { repo: 'menoplus-app/menoplus', dispatchCheckPath: FAKE_DISPATCH_CHECK_PATH , conventionsDir: '/plugin/conventions' })
    expect(k).not.toContain('CLAUDE_PLUGIN_ROOT')
  })
})

describe('buildStateSeed', () => {
  it('produces a parseable STATE.md with the fields of the slice', () => {
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.status).toBe('not_started')
    expect(meta.github_issue).toBe(7)
    expect(meta.branch).toBe('feat/7')
  })
  // D-4 — the epic travels seeded into the slice's state, not asked of gh on
  // every run: it is read by ct-run's telemetry, which aggregates per epic.
  it('seeds the epic the slice carries', () => {
    const { meta } = parseState(buildStateSeed({ ...SLICE, epic: '12' }, { branch: 'feat/7', base: 'main' }))
    expect(meta.epic).toBe('12')
  })

  it('a slice with no milestone DECLARES the absence, it does not leave it empty', () => {
    // The same rule that stopped ct-next silently assuming `main` when it did
    // not know the base: a gap in a metric reads as a zero, and a zero is a
    // claim.
    for (const sinEpic of [{ ...SLICE }, { ...SLICE, epic: null }, { ...SLICE, epic: '' }]) {
      const { meta } = parseState(buildStateSeed(sinEpic, { branch: 'feat/7', base: 'main' }))
      expect(meta.epic).toBe('(sin milestone)')
    }
  })

  it('handles issue: null → github_issue: null', () => {
    const sliceNoIssue = { ...SLICE, issue: null }
    const seed = buildStateSeed(sliceNoIssue, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.github_issue).toBe(null)
  })
  // F7: the `blocked` field has to EXIST in the file the agent is going to
  // edit. A field that is only documented in the plugin is a field nobody
  // writes the day it is needed — and on that day, the alternative is prose
  // inside `next_action`, which is exactly the failure.
  it('seeds an explicit `blocked: null` (a freshly dispatched slice is not blocked, and the field stays in plain sight)', () => {
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' })
    expect(seed).toMatch(/^blocked:/m) // present in the text, not only after parsing
    const { meta } = parseState(seed)
    expect(Object.prototype.hasOwnProperty.call(meta, 'blocked')).toBe(true)
    expect(meta.blocked).toBe(null)
  })

  // #99 — the line used to be «NO en prosa dentro de next_action». It says
  // the same thing by pointing at the right channel: the FIELD is what
  // survives a re-hydration, which is the reason `blocked` exists (F7).
  it('the kickoff tells the agent how to mark a blocker: the `blocked` field, which survives re-hydration', () => {
    const k = renderKickoff(SLICE, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' , conventionsDir: '/plugin/conventions' })
    expect(k).toMatch(/`blocked: \{reason:/)
    expect(k).toMatch(/ese campo es el canal/)
    expect(k).toMatch(/sobrevive a una re-hidrataci[óo]n/)
  })

  it('handles empty ac array → next_action falls back to "ver issue"', () => {
    const sliceEmptyAc = { ...SLICE, ac: [] }
    const seed = buildStateSeed(sliceEmptyAc, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.next_action).toContain('ver issue')
  })
})

// Slice 1 (Capde notes) — `base_sha`: the SHA of the cut, in a field nobody
// overwrites. The sha already reached `buildStateSeed` (ct-next resolves it
// from `origin/<base>` before cutting the worktree) but it was only dumped
// into `last_commit`, which the agent tramples on its first working commit:
// the only trace of the cut disappeared from the file, and the release diff
// ended up measuring against the LOCAL copy of the base branch (slice 10's
// run, main 7 commits behind).
describe('buildStateSeed — base_sha, the sha of the cut that nobody overwrites (slice 1)', () => {
  const CORTE = 'c3af34c0dead0000beef0000cafe0000feed1234'

  it('the seed carries base_sha: = the SHA of origin/<base> at the cut', () => {
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main', baseSha: CORTE })
    // In the TEXT and on its own line, not only after parsing: its consumer
    // (dispatch-check, slice 2) will read it with a regex over the file.
    expect(seed).toMatch(new RegExp(`^base_sha: ${CORTE}$`, 'm'))
    expect(parseState(seed).meta.base_sha).toBe(CORTE)
  })

  it('with no resolvable SHA, the field does not appear', () => {
    // The two ways ct-next hands over "I could not resolve it": the argument
    // absent (the signature's default) and the explicit empty string
    // (`resolvedBaseSha` after the catch of ct-next.mjs:1679).
    for (const opts of [{ branch: 'feat/7', base: 'main' }, { branch: 'feat/7', base: 'main', baseSha: '' }]) {
      const seed = buildStateSeed(SLICE, opts)
      expect(seed).not.toMatch(/^base_sha:/m) // never `base_sha: ""`
      expect(Object.prototype.hasOwnProperty.call(parseState(seed).meta, 'base_sha')).toBe(false)
    }
  })

  it('`last_commit` does not change: the same sha when there is one, and `""` when there is not — the asymmetry is deliberate', () => {
    expect(parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'main', baseSha: CORTE })).meta.last_commit).toBe(CORTE)
    expect(parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' })).meta.last_commit).toBe('')
  })

  it('`base:` is still the branch name, never the sha: that is where the `--base` of `gh pr create` comes from', () => {
    const { meta } = parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'develop', baseSha: CORTE }))
    expect(meta.base).toBe('develop')
    expect(meta.base).not.toBe(meta.base_sha)
  })
})

// F3: `Tipo` (the spec's §9 column) decides which addendum the dispatched
// agent receives — ct-groom.mjs needs the set of recognised values in order to
// warn when the spec carries a `Tipo` that matches no key of `ADDENDA`,
// WITHOUT keeping a second hardcoded list that could diverge (if `type: 'ios'`
// is added here tomorrow, ct-groom.mjs's warning recognises it automatically,
// without touching ct-groom.mjs). For that, `ADDENDA` has to be exported —
// before, it was a `const` internal to this module.
describe('ADDENDA', () => {
  it('it is exported (ct-groom.mjs derives the set of recognised Tipo values from here, without duplicating it)', () => {
    expect(Object.keys(ADDENDA).sort()).toEqual(['backend', 'bugfix', 'infra', 'ui'])
  })
})


// D4, defect 4: the ISSUE number and the §9 ORDER number are two distinct
// identifier spaces. The seeded STATE.md called the issue number "slice #N" —
// and the agent that reads it believes it.
describe('buildStateSeed / renderKickoff — issue vs. §9 order (D4, defect 4)', () => {
  const S = { n: 47, order: 3, name: 'refresh token', type: 'backend', ac: ['AC-1'], issue: '#47' }

  it('you_are_here names the ISSUE as an issue, and the §9 order as the §9 order', () => {
    const { meta } = parseState(buildStateSeed(S, { branch: 'feat/47', base: 'main' }))
    expect(meta.you_are_here).toMatch(/issue #47/)
    expect(meta.you_are_here).toMatch(/#3/)
    // What it must NOT say again: "slice #47" (the issue number presented as
    // a slice number).
    expect(meta.you_are_here).not.toMatch(/slice #47/)
  })

  // gh-issue-map.js#mapGhIssue fills in `order: order ?? i.number` — an issue
  // WITHOUT a <!-- ct-order:N --> marker (created by hand, or older than
  // /ct-groom) ends up with an "order" that is a synthetic copy of its issue
  // number. Announcing that as "slice #47 of the §9 table" would be inventing
  // exactly the datum this fix exists in order not to confuse.
  it('order === n (mapGhIssue synthetic fill-in) → NO §9 order is announced', () => {
    const { meta } = parseState(buildStateSeed({ ...S, order: 47 }, { branch: 'feat/47', base: 'main' }))
    expect(meta.you_are_here).toMatch(/issue #47/)
    expect(meta.you_are_here).not.toMatch(/§9/)
    const k = renderKickoff({ ...S, order: 47 }, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs' , conventionsDir: '/plugin/conventions' })
    expect(k.split('\n')[0]).not.toMatch(/§9/)
  })

  it('with no known §9 order, none is invented', () => {
    const { meta } = parseState(buildStateSeed({ ...S, order: undefined }, { branch: 'feat/47', base: 'main' }))
    expect(meta.you_are_here).toMatch(/issue #47/)
    expect(meta.you_are_here).not.toMatch(/§9/)
  })

  it('the kickoff tells the two numbers apart on the first line', () => {
    const k = renderKickoff(S, { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs' , conventionsDir: '/plugin/conventions' })
    expect(k.split('\n')[0]).toMatch(/issue #47/)
    expect(k.split('\n')[0]).toMatch(/#3 de la tabla §9/)
  })

  it('with no `issue` but with `n`, the kickoff does NOT call the issue number "orden" (that was the symmetric bug)', () => {
    const k = renderKickoff({ ...S, issue: null }, { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs' , conventionsDir: '/plugin/conventions' })
    expect(k.split('\n')[0]).toMatch(/issue #47/)
    expect(k.split('\n')[0]).not.toMatch(/orden #47/)
  })
})

// F32 — the two-level model (handoff §4.3): epic level = CT, slice level = the
// skills FORKED inside the plugin. The kickoff is the only text the dispatched
// agent reads FOR SURE, so this is where it has to say (a) which skills to
// follow —its own, not those of a plugin task 6 uninstalls—, (b) what the
// first act is —the slice plan, written against the real code with the ISSUE
// as the spec—, and (c) the two prohibitions the fork's seam 3 already imposes
// but which cannot depend on the agent getting round to reading it.
describe('renderKickoff — F32, the two-level model (its own skills, plan first, prohibitions)', () => {
  const OPTS = { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs', ctStepPath: '/x/ct-step.mjs' , conventionsDir: '/plugin/conventions' }

  it('it cites its OWN skills (control-tower-loop:*) and no reference to the superpowers: namespace', () => {
    const k = renderKickoff(SLICE, OPTS)
    // D-4 taken in this fork: the conducting belongs to ct-step, and the
    // kickoff no longer sends anyone to subagent-driven-development — it
    // forbids it explicitly.
    expect(k).toContain('/x/ct-step.mjs')
    expect(k).not.toMatch(/sigue control-tower-loop:subagent-driven-development/)
    expect(k).toContain('control-tower-loop:writing-plans-prescriptive')
    expect(k).toContain('--check-plan')
    // With the colon on purpose: `docs/superpowers/plans/` (the
    // path-convention of the plans) can and must appear; the old plugin's
    // namespace, no.
    expect(k).not.toMatch(/superpowers:/)
  })

  it('the first act is the slice plan: writing-plans with the ISSUE as the spec, saved under docs/superpowers/plans/ and committed in the pull request', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/plan del slice/i)
    expect(k).toMatch(/issue como spec/i)
    expect(k).toContain('docs/superpowers/plans/')
    // The order in the text IS the order of execution: the plan
    // (writing-plans) has to appear BEFORE the conducting by ct-step — the
    // machine starts up on a committed plan (`--plan` is its first argument)
    // and with no plan there is no run.
    expect(k.indexOf('control-tower-loop:writing-plans-prescriptive'))
      .toBeLessThan(k.indexOf('/x/ct-step.mjs'))
  })

  // F-jjponz-4 — the kickoff warns about the trimming before the agent writes
  // 1.271 lines of code into the plan and eats a rejection from the validator.
  it('the first act says the blocks are ONLY the essential ones, and that the bodies are written by the implementer', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/bloques esenciales/i)
    expect(k).toMatch(/cuerpos/i)
  })

  // #99 — there used to be three prohibitions in capitals («NO mergees», «NO
  // empieces el siguiente slice», «NO crees worktrees nuevos»). Now it is the
  // SPLIT: whose each act is. What really prevents the merge and someone
  // else's dispatch is the hook with `deny`, not this prompt.
  it('an explicit split: the merge and the next slice belong to the coordinator, and the worktree is already in place', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/el merge del PR y el arranque del siguiente slice son de la sesión coordinadora/)
    expect(k).toMatch(/worktree que te preparó el dispatcher/)
    // The reason none gets created travels with it: it is already in one.
    expect(k).toMatch(/ya estás en/i)
  })

  // Task 10 — without this the `reconcile` step exists in the machine and
  // nobody on the agent's side knows how to invoke it or what to do with a
  // conflict.
  it('names the `ct-step reconcile` step, and that on a conflict it dispatches ct-reconciler with no Bash and no Write', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toContain('ct-step reconcile')
    expect(k).toMatch(/despacha ct-reconciler como subagente, declarado sin Bash y sin Write/)
  })

  // The count has to carry the new step: before this task there were two
  // (global, slice-verdict); with `reconcile` in front, there are three.
  it('counts three steps after the commit of the last task, not two', () => {
    const k = renderKickoff(SLICE, OPTS)
    expect(k).toMatch(/quedan tres pasos más/)
    expect(k).not.toMatch(/quedan dos pasos más/)
  })
})

// Slice 10 — the signal in the dispatch. The `senal:` field is ALWAYS seeded
// (with the verbatim text of the issue, or with SENAL_AUSENTE — the absence is
// declared, not omitted, the same criterion as gates:/blocked:), because its
// reader is ct-step, which pastes it as the first section of the slice judge's
// package with no agent in between. The kickoff's line, by contrast, is
// CONDITIONAL: it only comes out with a declared signal — "no demand the spec
// makes of the agent can depend on the agent reading the spec", and with an
// exemption or with no declaration there is nothing to demand (silence when
// there is nothing to say is what keeps the lines that do come out useful).
describe('the signal in the dispatch (Slice 10)', () => {
  const OPTS = { repo: 'o/r', dispatchCheckPath: '/x/dispatch-check.mjs', ctStepPath: '/x/ct-step.mjs' , conventionsDir: '/plugin/conventions' }

  it('buildStateSeed seeds senal: with the text of the issue, verbatim', () => {
    const seed = buildStateSeed({ ...SLICE, senal: 'métrica `backfill_progress` con label `estado`' }, { branch: 'feat/7', base: 'main' })
    const { meta } = parseState(seed)
    expect(meta.senal).toBe('métrica `backfill_progress` con label `estado`')
  })

  it('buildStateSeed declares the absence with SENAL_AUSENTE when the issue carries no section', () => {
    for (const sinSenal of [{ ...SLICE }, { ...SLICE, senal: null }, { ...SLICE, senal: '' }, { ...SLICE, senal: '  ' }]) {
      const { meta } = parseState(buildStateSeed(sinSenal, { branch: 'feat/7', base: 'main' }))
      expect(meta.senal).toBe(SENAL_AUSENTE)
    }
    // The constant opens with "(sin señal declarada" — it is the prefix by
    // which the slice judge's rubric recognises the sin-vara state.
    expect(SENAL_AUSENTE.startsWith('(sin señal declarada')).toBe(true)
  })

  it("the opening the slice judge's rubric cites is a real prefix of SENAL_AUSENTE", () => {
    // Low finding of the Slice 10 judge: the cross-check was one-directional —
    // the test above watches the constant, but the agent's CITATION («it opens
    // with `(sin señal declarada`») was not tied to it, so editing that
    // sentence in agents/ct-slice-judge.md would break the sin-vara
    // recognition without any test noticing it. It is read from the real file,
    // like every agent↔constant tie of step-contracts.test.js.
    const agente = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-slice-judge.md'), 'utf8')
    const cita = /opens with\s+`([^`]+)`/.exec(agente)
    expect(cita).not.toBeNull()
    expect(SENAL_AUSENTE.startsWith(cita[1])).toBe(true)
  })

  it('the reasoned exemption travels to SLICE.md as it stands (N/A — reason)', () => {
    const { meta } = parseState(buildStateSeed({ ...SLICE, senal: 'N/A — pantalla sin telemetría nueva que prometer' }, { branch: 'feat/7', base: 'main' }))
    expect(meta.senal).toBe('N/A — pantalla sin telemetría nueva que prometer')
  })

  it('renderKickoff names the signal when the issue declares one', () => {
    const k = renderKickoff({ ...SLICE, senal: 'métrica x' }, OPTS)
    expect(k).toContain('Este slice declara una SEÑAL DE OBSERVABILIDAD (sección "## Señal de observabilidad" del issue): lo que esa señal promete tiene que emitirlo el código de PRODUCCIÓN de este slice, instrumentado como ya instrumenta este repo y con todas sus labels acotadas — el juez del slice entero lo comprueba contra el diff acumulado antes del PR.')
    // After the "Lee también las secciones…" line — the "what to read of the
    // issue" zone, before the first act.
    expect(k.indexOf('Lee también las secciones')).toBeLessThan(k.indexOf('SEÑAL DE OBSERVABILIDAD'))
  })

  it('renderKickoff stays silent with an exemption and silent with no declaration', () => {
    expect(renderKickoff({ ...SLICE, senal: 'N/A — sin telemetría nueva' }, OPTS)).not.toContain('SEÑAL DE OBSERVABILIDAD')
    expect(renderKickoff(SLICE, OPTS)).not.toContain('SEÑAL DE OBSERVABILIDAD')
    expect(renderKickoff({ ...SLICE, senal: '–' }, OPTS)).not.toContain('SEÑAL DE OBSERVABILIDAD')
  })
})

// ct dictates the yardstick (docs/superpowers/specs/2026-08-26-la-vara-la-dicta-ct-design.md, §7):
// the brief is built AFTER the plan, so pasting ct's yardstick only there
// leaves the implementer between two vetoes — obey `**Files:**` and have the
// judge block its shape, or build the shape and have the scope check veto it
// for touching paths the plan did not declare. They are three consumers, not
// two. (The REPO's one already arrived: the skill orders you to start from
// `.agent/conventions.md`.)
describe('the first act names the yardstick of ct', () => {
  const OPTS_CON_VARA = {
    repo: 'o/r',
    dispatchCheckPath: '/x/dispatch-check.mjs',
    ctStepPath: '/x/ct-step.mjs',
    conventionsDir: '/plugin/conventions',
  }

  it('it names it by its absolute path, so that whoever plans can open whichever document they need', () => {
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k).toContain('/plugin/conventions')
  })

  // The order to READ THEM ALL raw was removed: they are some 41 KB in front
  // of a plan that hardly ever cites them, and what the plan has to select is
  // the REPO's yardstick in the `Rules to obey:` of §3. ct's one is carried to
  // every task by the program, without the plan being able to take it away.
  it('it does not order the whole yardstick to be read, but it names the two the plan cannot not have opened', () => {
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k).not.toMatch(/LEE la vara de ct/)
    expect(k).not.toMatch(/No hace falta que abras/)
    expect(k).toContain('simplicity.md')
    expect(k).toContain('decisions.md')
  })

  it('the order lands BEFORE the entry that orders the plan to be written', () => {
    // The anchor is that entry and not the next one: reading the yardstick
    // after the plan has already been written is no use at all, so a laxer
    // anchor would let through exactly the regression this test exists to
    // catch.
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k.indexOf('/plugin/conventions')).toBeGreaterThan(-1)
    expect(k.indexOf('/plugin/conventions')).toBeLessThan(k.indexOf('Primer acto'))
  })

  // THE PRECEDENCE RULE HAS A SINGLE SOURCE: the header `PluginYardstick`
  // writes. The kickoff CITES it —it says where it is and that it is not
  // reinterpreted— and does not state it: five copies of one rule in five
  // files is what let it diverge (the backend's said `architecture.md` always
  // applies). Whoever stated it here no longer states it, and the test that
  // checks that is `precedence-one-single-source.test.js`.
  it('it cites the header where the rule lives, and does not state it again', () => {
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k).toMatch(/CABECERA/)
    expect(k).not.toMatch(/regla a regla/i)
    expect(k).not.toMatch(/no por tema/i)
    expect(k).not.toMatch(/obliga entera/i)
  })

  // `architecture.md` deja de estar filtrado por `(create)`/`(modify)`: alcanza
  // a toda tarea (conventions/architecture.md, "Applies to: **every diff**").
  // El kickoff ya no puede decirle al planificador que reparta el trabajo
  // entre los dos marcadores para decidir a qué lado de esa regla cae cada cosa.
  it('no reparte la arquitectura entre las dos marcas: architecture.md alcanza a toda tarea', () => {
    const k = renderKickoff(SLICE, OPTS_CON_VARA)
    expect(k).not.toContain('MÓDULOS NUEVOS')
    expect(k).not.toMatch(/reparti[a-zé]* .*entre .*\(create\).* y .*\(modify\)/i)
  })
})

// #96 — the baseline is measured by the program (scripts/baseline.js) when it
// prepares the worktree, and travels in the seed as DATA: the agent reads it,
// it does not run it in order to assert it. The kickoff stops ordering it and
// moves to pointing at where it already is.
describe('buildStateSeed — the baseline measured by the dispatcher, not asserted by the agent (#96)', () => {
  it('seeds `baseline:` with the outcome, the command and the summary it is handed', () => {
    const baseline = new BaselineResult({ outcome: BaselineOutcome.RED, command: 'npm test', summary: 'exit 1 · 2 failed' })
    const seed = buildStateSeed(SLICE, { branch: 'feat/7', base: 'main', baseSha: 'abc', baseline })
    expect(seed).toMatch(/^baseline:$/m)
    expect(parseState(seed).meta.baseline).toEqual({ outcome: 'rojo', command: 'npm test', summary: 'exit 1 · 2 failed' })
  })

  it('with no measured baseline, the field declares the absence as not-verified instead of being omitted', () => {
    const { meta } = parseState(buildStateSeed(SLICE, { branch: 'feat/7', base: 'main' }))
    expect(meta.baseline.outcome).toBe(BaselineOutcome.UNVERIFIED)
    expect(meta.baseline.command).toBe(null)
    expect(meta.baseline.summary).toMatch(/nadie/)
  })
})

describe('renderKickoff — the baseline is in the seed, not in an order to the agent (#96)', () => {
  const kickoff = () => renderKickoff(SLICE, { repo: 'o/r', dispatchCheckPath: '/x/d.mjs', conventionsDir: '/plugin/conventions' })

  it('it no longer orders pwd/branch to be confirmed nor the baseline left green before touching anything', () => {
    expect(kickoff()).not.toMatch(/baseline verde ANTES/)
    expect(kickoff()).not.toMatch(/confirma pwd\/rama/)
  })

  it('it points at the `baseline:` field of .agent/SLICE.md as the place where it is already measured', () => {
    expect(kickoff()).toMatch(/`baseline:`.*\.agent\/SLICE\.md/)
  })
})
