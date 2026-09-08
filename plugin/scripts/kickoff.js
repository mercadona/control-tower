import { homedir } from 'node:os'
import { join } from 'node:path'
import { renderState } from './state.js'
import { BaselineResult } from './baseline.js'
import { resolveGatesForAgent, renderGateKickoffLines, resolveE2e } from './gates.js'
// F22: the kickoff is received ONLY by a slice agent, so there is no ambiguity
// to resolve here — its state file is always `.agent/SLICE.md`. The constant is
// imported instead of writing the string by hand so that the day that path
// changes there are no messages left sending the agent to a file that is no
// longer its own (which is exactly the defect this round fixes).
import { SLICE_REL_PATH } from './state-paths.js'
// parseSignalCell (Slice 10): the SAME classifier the groom uses — one single
// discriminator of "declared signal / exemption / nothing" for groom, kickoff
// and (in prose) the slice judge's rubric, one that cannot diverge between
// whoever validates the cell and whoever announces the line.
import { EPIC_CONTEXT_HEADING, INHERITED_CONTEXT_HEADING, FROZEN_DECISIONS_HEADING, parseSignalCell } from './groom.js'
import { NO_MILESTONE_KEY } from './gh-issue-map.js'

// SIGNAL_ABSENT (Slice 10): the value of the `senal:` field when the issue does
// not carry the "## Señal de observabilidad" section — the absence is DECLARED,
// not omitted (the same criterion as `gates:`/`blocked:`: a field that only
// exists when there is something is a field nobody writes when they need it).
// It is ONE single constant, imported by ct-step.mjs too (the other writer: the
// fallback of the judge's package when the SLICE.md was seeded by a plugin
// predating the column), so that the two writers cannot diverge. Its opening
// "(sin señal declarada" is literally what ct-slice-judge's rubric recognises
// as sin-vara.
export const SIGNAL_ABSENT = '(sin señal declarada — el issue no trae la sección "## Señal de observabilidad"; el juez de slice mide su ítem observabilidad como sin-vara)'

// AGENT_BIN — the name of the agent's executable that gets typed into the cmux
// session. ONE, with no accounts: F35 took away ACCOUNT_MAP and the whole
// resolution of «which account does what», so the agent starts up with the
// ambient configuration of whoever launches it.
//
// The override exists for what F29 documented, and it is still true: in the
// machine's real .zshrc, `claude` was an interactive shell FUNCTION («¿Qué
// cuenta? 1/2») and a login shell resolves the function ahead of any PATH — the
// agent hung on the `read` forever while /ct-next counted it as LAUNCHED (the
// sentinel is written before invoking the agent, and `command -v` returns 0 for
// a function). If that happens, the way out is to point CT_AGENT_BIN at a
// non-interactive wrapper; not to put an account map back in.
export const AGENT_BIN = process.env.CT_AGENT_BIN || 'claude'

// Exported (F3): ct-groom.mjs needs the set of recognised `Tipo` values in
// order to warn when the spec carries a value that matches no key of this
// object — `renderKickoff`, further down, does `ADDENDA[slice.type] || ''` in
// silence, so a `Tipo` that is none of these keys leaves the dispatched agent
// WITHOUT any addendum at all, with nothing flagging it. Exporting the object
// (instead of keeping a separate list of "valid types" in ct-groom.mjs) is the
// only way for that warning to derive the recognised set from the ONE source of
// truth: if a new addendum is added here tomorrow (or a typo in an existing key
// is corrected), ct-groom.mjs's warning reflects it on its own, without touching
// that file and without risking the two lists diverging.
//
// F21 — ADDENDA NO LONGER CONTAINS ANY GATE. Until this round, the ONLY human
// gate in the whole plugin was half a sentence inside this object ("gate de
// screenshot obligatorio", in `ui`; "apply solo tras review", in `infra`).
// Consequence: `Tipo` decided the TECHNICAL reminder and the HUMAN GATE at
// once, two axes that do not always coincide — the real case was a `Tipo:
// backend` slice (a migration with a backfill) that the spec marked as needing
// a visual gate "porque la barra es lo más visible de todo el spec": it
// received the backend addendum and no gate at all, and nothing flagged it.
//
// The two gate sentences have been MOVED to scripts/gates.js, which resolves
// them separately (see renderKickoff, further down). Only technical reminders
// are left here. That they are not left here TOO is part of the fix, not a
// cosmetic tidy-up: a `Tipo: ui` that WAIVES its gate in the spec would go on
// receiving "gate de screenshot obligatorio" from its addendum, and the kickoff
// would contradict itself.
export const ADDENDA = {
  ui: 'Addendum UI: respeta el design system; no cambies tokens de marca.',
  backend: 'Addendum backend: migración forward+rollback, respeta contratos, reporta el cambio de API.',
  infra: 'Addendum infra: dry-run/plan primero, nunca secretos en claro.',
  bugfix: 'Addendum bugfix: reproduce-first (test que falla con el síntoma exacto), causa raíz, fix mínimo, test de regresión.',
}

// TWO IDENTIFIER SPACES, and they are not interchangeable (D4, defect 4 — it
// has bitten us before):
//   - `slice.n`     = the GitHub ISSUE number. It is what the dispatcher uses
//                     for the branch (`feat/<n>`), the worktree
//                     (`.worktrees/<n>`) and the claim (`dispatch-check <n>`).
//                     gh-issue-map.js#mapGhIssue produces it as `i.number`.
//   - `slice.order` = the ORDER number of the spec's §9 table (the "#"
//                     column), the one /ct-groom writes into the
//                     `<!-- ct-order:N -->` marker and into the issue title.
// They are different numberings: an epic's §9 slice #1 can be issue #47. Any
// text shown to the agent has to say WHICH of the two it is naming — an agent
// that confuses issue "#3" with order "#3" hydrates from the wrong issue.
// (Note: `slices.js`, the §9 table's parser, calls its ORDER number `n` — that
// struct never reaches this far, but it is the historical origin of the
// confusion.)
function issueRefOf(slice) {
  return slice.issue || (slice.n != null ? `#${slice.n}` : '(sin número de issue)')
}

// `slice.order === slice.n` is NOT announced. gh-issue-map.js#mapGhIssue fills
// in `order: order ?? i.number` — that is, when an issue does NOT carry the
// `<!-- ct-order:N -->` marker (one created by hand, or predating /ct-groom),
// its "order" is a synthetic COPY of the issue number, not a real order of the
// §9 table. Announcing it as "slice #47 de la tabla §9" would be inventing
// exactly the datum this fix exists in order not to confuse. When the two
// numbers genuinely coincide (issue #3 with ct-order:3), omitting it loses
// nothing: the number is already there in front, as an issue number.
function orderSuffixOf(slice) {
  if (slice.order == null || slice.order === slice.n) return ''
  return ` (slice #${slice.order} de la tabla §9 del spec — numeración DISTINTA del número de issue)`
}

// F17 — THE BASE BRANCH WAS NOT A DATUM THE AGENT HAD.
//
// `buildStateSeed` has received `base` since the first version; `renderKickoff`
// did not. In the normal case it made no difference, because `gh pr create`
// without `--base` points at the repo's default branch and ct-next resolves
// that SAME branch when no `--base` is passed. But ct-next DOES accept `--base
// <another-branch>` and creates the worktree with it (`git worktree add -b
// feat/<n> <wt> <resolvedBase>`): the agent would open its PR against the
// default branch, that is, against a base that is not the one it came out of,
// with a diff that is not its own. The kickoff named the base nowhere.
//
// With no known base it is NOT filled in with "main": the bug W-D fixed in
// ct-next.mjs was exactly that (assuming "main" in silence). It refers instead
// to the branch the worktree came out of, which is a fact the agent can check
// (`git log`), rather than an invented name.
function baseRefOf(base) {
  return typeof base === 'string' && base.length > 0
    ? `\`${base}\``
    : 'la rama base de la que salió este worktree'
}

// resolveE2eRunsForAgent — TASK 9: the journeys, resolved with the SAME
// two-source criterion `resolveGatesForAgent` (just above, F21) uses for the
// gates: `mapGhIssue` (gh-issue-map.js) already rebuilds the slice from the
// ISSUE — the dispatcher (/ct-next) does not open the spec — and there it
// extracts the body's "## E2E" section into an array, `slice.e2eRuns`. When
// that field is defined (the real dispatch path) it is used as it is; it only
// falls back to `resolveE2e(slice.e2e).runs` —the raw cell of the §9 table,
// with escaped commas— when it is NOT, which is /ct-groom's path (it reads the
// spec directly) or that of a test slice built by hand.
//
// The result is ALWAYS an array, never `undefined`: a slice with no journeys
// gives `[]`, the same criterion as `blocked: null` in state.js — an absent
// field would be indistinguishable from a version of the plugin that did not
// yet know how to fill it in.
function resolveE2eRunsForAgent(slice) {
  return slice.e2eRuns !== undefined ? slice.e2eRuns : resolveE2e(slice.e2e).runs
}

export function renderKickoff(slice, { repo, dispatchCheckPath, ctStepPath, conventionsDir, base }) {
  // `dispatchCheckPath` and `ctStepPath` go inside commands the agent EXECUTES:
  // if the caller omits them, the failure is noisy (a command that does not
  // start). `conventionsDir`, on the other hand, is only interpolated into a
  // sentence of prose — omitted, it would produce "los documentos de undefined"
  // and nobody would see it fail. The asymmetry is closed at the source:
  // without this datum there is no kickoff, and the error belongs to the caller
  // (ct-next.mjs must resolve it as an absolute path, just like its two
  // sisters), not to renderKickoff.
  if (!conventionsDir) {
    throw new Error(
      'renderKickoff: falta conventionsDir — fallo de cableado del llamador (ct-next.mjs), no del kickoff.'
    )
  }
  const addendum = ADDENDA[slice.type] || ''
  // F21 — THE GATES, AT LAST SEPARATED FROM THE TYPE. `resolveGatesForAgent`
  // (see gates.js) prefers what the issue DECLARES (its `gate:` labels, which
  // is what survives a re-dispatch) and only falls back to the `Tipo` for
  // issues predating this round. The gate lines go right after the addendum and
  // BEFORE the PR-closing block, not at the end: they are the condition for
  // that closure to be able to happen at all.
  const gateLines = renderGateKickoffLines(resolveGatesForAgent(slice))
  // TASK 9 — the journeys, NAMED literally. `gateLines` already says
  // "atraviesa los recorridos que trae la sección ## E2E de tu issue"
  // (gates.js#GATES.e2e), so that prose is NOT repeated here: the journeys are
  // merely listed as they are and tied to the command that closes the step
  // (`ct-step e2e`, which is the one ct-step.mjs expects — see ct-step.mjs:221
  // and this task's brief). When there is none, this line is not added — no
  // empty section and no "not applicable": the .filter(Boolean) further down
  // discards it.
  const e2eRuns = resolveE2eRunsForAgent(slice)
  const e2eLine = e2eRuns.length
    ? `Recorridos e2e de este slice (ejecútalos tal cual, ni uno más ni uno menos): ${e2eRuns.map((r) => `"${r}"`).join('; ')}. Al terminarlos, cierra el paso con \`ct-step e2e\`, tecleado tal cual: es el comando que registra el veredicto.`
    : ''
  return [
    `Estás implementando UN slice (${slice.name}) del repo ${repo}, issue ${issueRefOf(slice)}${orderSuffixOf(slice)}.`,
    // F32 — the division of roles lives HERE and not only in the forked skills,
    // because the kickoff is the only text the dispatched agent reads FOR SURE
    // (seam 3 of finishing-a-development-branch imposes the same thing, but only
    // if the agent gets as far as invoking that skill). The worktree is named
    // because using-git-worktrees travels in the fork and would offer to create
    // one for it: the isolation was already put in place by the dispatcher, and
    // telling it WHERE it is is what closes that offer. The "when you finish
    // leave the PR ready and STOP" that used to close this line went away in
    // exchange: the closing line below already says it, with the literal
    // command.
    //
    // #99 — the line used to be three prohibitions in capitals. It says the
    // same thing as a division of labour: whose each act is. What really
    // prevents the merge and somebody else's dispatch is the hook with `deny`,
    // not this prompt.
    `Es human-gated y el reparto es éste: el merge del PR y el arranque del siguiente slice son de la sesión coordinadora; lo tuyo es este slice, en el worktree que te preparó el dispatcher — ya estás en él.`,
    // #96 — the baseline is measured by the dispatcher (scripts/baseline.js)
    // while preparing the worktree and seeded as a DATUM in the seed: pwd,
    // branch and cut have already been verified by the program. This line
    // points at where it is; it does not order it.
    `El baseline ya está medido: su resultado (verde, rojo o no-verificado), el comando y el resumen están en el campo \`baseline:\` de ${SLICE_REL_PATH}. Léelo ahí; no lo vuelvas a ejecutar para afirmarlo.`,
    // F21, second finding of the same lens ("no demand the spec makes of the
    // agent can depend on the agent reading the spec"): the `Protegido` column
    // DOES reach the issue body, but this kickoff enumerated the acceptance
    // criteria one by one and NEVER named what falls out of scope. "Hydrate
    // from the issue" is strictly weaker than naming the section: what is
    // enumerated gets read, and what is left to "it will see it anyway"
    // competes with the rest of the body. The text is not interpolated (unlike
    // the ACs) because `Protegido` is prose of arbitrary length and the kickoff
    // is typed whole into a pty; the exact section is named, which is what it
    // takes for the agent to go looking for it.
    `Hidrátate de ${SLICE_REL_PATH} y del issue de GitHub; los criterios de aceptación son ${slice.ac.join(', ') || '(ver issue)'}. Lee además la sección "## Out of scope / Protected" del issue: lo que hay ahí se queda tal cual está, aunque parezca parte del trabajo.`,
    // The same criterion as the "Out of scope / Protected" line just above, and
    // for the same two reasons: the sections are NAMED and their text is not
    // interpolated —it is prose of arbitrary length and this gets typed whole
    // into a pty—, and they are enumerated instead of trusting "hydrate from
    // the issue", because what is enumerated gets read and what is left to "it
    // will see it anyway" competes with the rest of the body.
    //
    // The final sentence covers the two different cases in which there is
    // nothing to read: the section is there and is empty, or it is not there at
    // all (an issue created before these sections existed never receives the
    // inherited one). Without it, an agent that does not find what it has just
    // been pointed at goes looking for it outside the issue, which is precisely
    // what it cannot do.
    `Lee también las secciones "${EPIC_CONTEXT_HEADING}" y "${INHERITED_CONTEXT_HEADING}" del issue: traen lo que el spec y los slices ya mergeados condicionan sobre este trabajo y que queda fuera de los criterios de aceptación. El issue es la fuente entera de lo heredado: una sección vacía o ausente significa que lo heredado es nada.`,
    `Lee también la sección "${FROZEN_DECISIONS_HEADING}" del issue: son decisiones del epic con consecuencia sobre este trabajo, que DEBES respetar tal como están escritas y que van a "## 2. Closed decisions" de tu plan, con las mismas palabras. El issue es la fuente entera: si la sección falta, las decisiones congeladas son cero.`,
    // Slice 10 — the signal, NAMED when the issue declares it: "no demand the
    // spec makes of the agent can depend on the agent reading the spec" —
    // without this line, the slice judge would demand what nobody named to the
    // implementer. Conditional like the gate lines: with a reasoned exemption
    // or with nothing declared, NO line at all (nothing to demand; the silence
    // when there is nothing to say is what keeps the lines that do come out
    // useful). The discriminator is parseSignalCell, the SAME one the groom uses
    // — not a second reading of the cell that could diverge.
    parseSignalCell(slice.senal || '').kind === 'senal'
      ? 'Este slice declara una SEÑAL DE OBSERVABILIDAD (sección "## Señal de observabilidad" del issue): lo que esa señal promete tiene que emitirlo el código de PRODUCCIÓN de este slice, instrumentado como ya instrumenta este repo y con todas sus labels acotadas — el juez del slice entero lo comprueba contra el diff acumulado antes del PR.'
      : '',
    // F32 — the two-level model (§4.3 of the handoff): epic level = CT, slice
    // level = the skills FORKED into this plugin (control-tower-loop:*, see
    // skills/FORK.md) — never the superpowers: namespace, which task 6
    // uninstalls. The slice's plan is written HERE and not in the spec because
    // it is written against the real code, at the right moment; the issue
    // carries the ACs (EARS), "Protegido" and the "Contexto del epic" —
    // exactly the input writing-plans asks for as a spec. And with the plan
    // committed, the driving is NO LONGER subagent-driven-development's: in
    // this fork D-4 is taken — the sequence is dictated by ct-step, the machine
    // being consulted. The line below is the socket
    // `d4-sigue-siendo-de-jose.test.js` was guarding, and that test was deleted
    // in the same commit as this line, as its own header asked. `ctStepPath`
    // arrives resolved as an absolute path from ct-next.mjs, for the same
    // reason as `dispatchCheckPath` (the ${CLAUDE_PLUGIN_ROOT} token does not
    // exist in a plain-text prompt).
    // §7 of the design: the plan is written BEFORE ct-step exists in the cycle,
    // so if ct's yardstick were only pasted into the task brief the plan would
    // come out without it — and a plan that ignores it leaves the implementer
    // between the judge's veto and the scope check's. This is where it reaches
    // whoever plans.
    // The REPO's one already reached it: the skill orders it to start from
    // `.agent/conventions.md` and to select in §3.
    // A plan that prescribes a field, a guard or a public symbol without having
    // read `simplicity.md` prescribes exactly what the judge will flag
    // afterwards — and the implementer is under orders to follow the plan, so
    // the defect comes in armed by the contract. Leaving the whole reading on
    // demand ("the document you need, when you need it") was reasonable when
    // the yardstick said nothing about what a diff adds; it now says something.
    // Only the two the plan always has open are named: `simplicity.md` decides
    // whether what the plan asks for is needed, and `decisions.md` is where a
    // decision already taken lives, so that it is written down only once. The
    // rest stay available by path, on demand.
    `La vara de ct vive en ${conventionsDir} y el programa la lleva a cada tarea: al implementador pegada, al juez por ruta. Cómo se relaciona con las convenciones de este repo cuando chocan lo dice la CABECERA con la que viaja, que es donde está escrita esa regla y el único sitio donde está — léela ahí y sigue lo que dice tal cual. Antes de escribir el plan abre dos de ellos, porque el plan decide justo lo que miden: \`simplicity.md\` (la carga de la prueba está en lo que se añade, y que el plan lo pida la deja donde estaba) y \`decisions.md\` (dónde vive una decisión ya tomada, para escribirla una sola vez). Los demás quedan a mano por ruta, el que necesites para decidir algo concreto. Lo que el plan tiene que seleccionar sigue siendo la vara del REPO, en el \`Rules to obey:\` de §3, como hasta ahora.`,
    `Primer acto, con el baseline verde: escribe el plan del slice con control-tower-loop:writing-plans-prescriptive usando el issue como spec (sus AC, "Protegido", "${EPIC_CONTEXT_HEADING}" y "${FROZEN_DECISIONS_HEADING}" son la entrada que la skill pide; vuelca cada decisión congelada en "## 2. Closed decisions" del plan — son del epic y las DEBES respetar con sus mismas palabras). SOLO bloques esenciales, cada uno con su etiqueta de rol: contratos, call sites y el tramo que cambia — los cuerpos de los módulos y los ficheros de test los escribe el implementador con TDD, y la configuración se describe en prosa. Guárdalo como docs/superpowers/plans/YYYY-MM-DD-issue-${slice.n}-<slug>.md, valídalo con \`node ${dispatchCheckPath} ${slice.n} --repo ${repo} --check-plan\` hasta exit 0, y commitéalo: viaja en el PR, y el --release del final se negará (exit 6) sin un plan válido commiteado.`,
    `Con el plan commiteado y el gate 'plan' con OK humano, la secuencia de la implementación la dicta la máquina. Pregunta el paso con \`node ${ctStepPath} next --plan docs/superpowers/plans/<el-plan-que-commiteaste>.md --issue ${slice.n}\` y obedece LITERALMENTE lo que imprima en cada paso (donde diga \`ct-step\`, es \`node ${ctStepPath}\`): despacha el implementador como subagente con la rúbrica y el brief que te indique, luego \`ct-step report\`, \`ct-step controls\`, despacha el juez como subagente ct-judge (declarado sin Bash), \`ct-step verdict\` y \`ct-step commit\` — quien comitea es ct-step. Tras el commit de la última tarea quedan tres pasos más, que \`next\` también dicta: \`ct-step reconcile\` (fusiona la rama con su base; si hay conflicto, despacha ct-reconciler como subagente, declarado sin Bash y sin Write — quien stagea, comitea y aborta la fusión es el programa), \`ct-step global\` (la Global verification del plan la ejecuta el programa) y el juicio del slice entero — despacha ct-slice-judge como subagente (declarado sin Bash) y entrega su JSON con \`ct-step slice-verdict\`. Vuelve a \`next\` tras cada paso hasta "run delivered".`,
    addendum,
    ...gateLines,
    e2eLine,
    // W-C: the claim (status:ready → status:in-progress) is made by /ct-next in
    // code, BEFORE creating this worktree — not by the prompt. The release
    // (in-progress → in-review) IS deliberately left here (a decision already
    // taken), with the Phase 3 PR conformance gate as an eventual backstop. The
    // command is LITERAL, with issue/repo already substituted — not a
    // description the agent has to translate on its own and might not execute.
    //
    // Fix round 1 (W-C's review), finding 1: `${CLAUDE_PLUGIN_ROOT}` is NOT an
    // env var of the agent session's shell — only Claude Code substitutes it,
    // when rendering `commands/*.md`/`hooks/hooks.json`. A kickoff (a
    // plain-text prompt, not a command file) that emitted that literal token
    // would produce a `Cannot find module` on EVERY successful dispatch.
    // `dispatchCheckPath` arrives already resolved as a real absolute path
    // (ct-next.mjs computes it relative to its own location) and is interpolated
    // as it is — never the unexpanded token.
    // F7: the dispatched agent is the main WRITER of its state file, and until
    // now it had no way of saying "this cannot go on" other than prose inside
    // `next_action` — which the next session reads as a standing order. The
    // field exists; it has to be named to the agent here or it will not use it.
    `Si el trabajo queda BLOQUEADO (hace falta algo de fuera para seguir, más allá de que quede trabajo por hacer), márcalo en ${SLICE_REL_PATH} como \`blocked: {reason: "por qué", unblock: "qué haría falta"}\`: ese campo es el canal, y es lo que sobrevive a una re-hidratación. El hook de SessionStart lo anuncia y suspende el next_action en la siguiente sesión.`,
    // F17 — THE KICKOFF MANUFACTURED THE VERY DEADLOCK THE LOOP ITSELF
    // DESCRIBES AS A BREAKDOWN. This line said "open a PR" and nothing else: it
    // did not ask for `Closes #N`. The chain, whole and verifiable in this repo:
    //   1. the PR is merged and the issue is left OPEN (nothing closes it);
    //   2. since F13, an open issue in `status:in-review` HOLDS its
    //      `area:`/`touches:` tokens until the merge (claim.js:52-57), and the
    //      dispatcher cannot find out that it was already merged because what
    //      it looks at is the ISSUE's state;
    //   3. those tokens stay held INDEFINITELY, because there is nothing to
    //      close the issue;
    //   4. the next slice sharing any token —or needing the global serializing
    //      lane `migration`/`ci`/`pbxproj`— never gets out;
    //   5. and `merge-after` is satisfied EXACTLY when the issue is closed with
    //      `stateReason === 'COMPLETED'`
    //      (gh-issue-map.js#filterMergedIssues), which is what GitHub does when
    //      merging a PR with `Closes #N`: without that line, no dependent ever
    //      sees its dependency satisfied.
    // It is not theoretical: in the repo where the first real dispatch was going
    // to run, ten issues had been blocking the serializing lane for months from
    // this exact cause (work merged, issue open). And the dispatcher itself
    // ALREADY described that state as a breakdown and gave the remedy
    // (ct-next.mjs:726/787/901: "ciérralo como completed si el PR ya se mergeó
    // y nadie lo cerró porque le faltaba el Closes #N") — that the remedy
    // existed while the cause was produced by this very file was the
    // contradiction to close.
    //
    // "in the BODY of the PR": GitHub only interprets the closing keywords in
    // the PR body and in the branch's commit messages. A `Closes #N` in the
    // TITLE closes nothing, and "put it in the PR" is ambiguous precisely where
    // it cannot be.
    //
    // The number interpolated is `slice.n` — the ISSUE one, the SAME source as
    // this line's `--release` command. Never `slice.order` (see the issueRefOf
    // block, above): a `Closes #<order>` would close the wrong issue, or none.
    `Al acabar: commit refs al issue, actualiza ${SLICE_REL_PATH}, abre el PR contra ${baseRefOf(base)} con \`Closes #${slice.n}\` en el CUERPO del PR (el cuerpo es el único sitio donde GitHub lee las closing keywords), libera el claim con \`node ${dispatchCheckPath} ${slice.n} --repo ${repo} --release\`, deja el estado mergeable y PARA.`,
    // The why goes separately and not inside the line above on purpose: that
    // line is a list of six orders, and an order with no reason inside a list
    // of six is the first one to be dropped when the agent is short of context.
    // What it is given here is the consequence, which is what stops it being
    // dropped. `merge-after` is named WITHOUT a number: the `## Dependencias`
    // section writes it in §9 ORDER space, not issue space, and writing
    // "merge-after #<issue number>" here would be exactly the confusion between
    // the two identifier spaces this file already fights.
    `Ese \`Closes #${slice.n}\` es lo ÚNICO que cierra el issue al mergear el PR, y de ese cierre depende el resto del epic: un PR mergeado con su issue abierto deja este slice reteniendo sus tokens de \`area:\`/\`touches:\` para siempre — el vecino que comparta uno se queda en la cola, el carril serializante (\`migration\`/\`ci\`/\`pbxproj\`) sigue tapado, y cualquier dependiente con un \`merge-after\` sobre este slice sigue esperando. Si abres el PR a mano, o alguien edita su cuerpo después, comprueba que la línea sigue ahí.`,
  ].filter(Boolean).join('\n')
}

// renderStateGates: the value of the seeded SLICE.md's `gates` field. A
// readable string (not a YAML list of tokens) because its reader is an agent
// re-hydrating itself: a bare "visual" tells it neither what it has to do nor
// that closing it is not its job. When there is none, that is stated
// explicitly — the same criterion as `blocked: null` (state.js): a field that
// only appears when something is wrong is a field nobody writes when they need
// it.
function renderStateGates(gates) {
  const list = gates || []
  if (!list.length) return 'ninguno (este slice no exige ningún gate humano antes de mergear)'
  return `${list.join(', ')} — GATES HUMANOS pendientes: los cierra quien revisa el PR, NO tú. Detalle en la sección "## Gates" del issue.`
}

// renderStateSenal (Slice 10): the value of the `senal:` field — the text of
// the issue's section, verbatim (a signal, or an `N/A — <razón>` exemption, as
// it is: the reader tells the exemption apart by its prefix alone), or
// SIGNAL_ABSENT when the issue declares nothing. Never a gap: the absence is
// declared, not omitted — see SIGNAL_ABSENT's comment.
function renderStateSenal(senal) {
  return (senal || '').trim() || SIGNAL_ABSENT
}

// #96 — `baseline`: the result of `Baseline.measure` (scripts/baseline.js) over
// the freshly cut worktree. Whoever seeds without having measured it (the
// dry-run, which has no worktree; the tests) gets the absence DECLARED, never a
// gap: `no-verificado` is a member of the vocabulary, not an optional — the
// agent hydrating itself has to be able to tell "nobody measured it" apart from
// "it was measured and came out red".
export const BASELINE_NOT_MEASURED = BaselineResult.notMeasured('nadie ejecutó el baseline al sembrar esta semilla')

export function buildStateSeed(slice, { branch, base, baseSha = '', baseline = BASELINE_NOT_MEASURED }) {
  const issueNum = slice.issue != null ? parseInt(String(slice.issue).replace('#', ''), 10) : null
  return renderState({
    meta: {
      task: slice.name,
      // ====================================================================
      // F20/H3 — THE DIVISION OF ROLES LIVED ONLY INSIDE A KICKOFF.
      //
      // There are TWO live sessions per repo with opposite roles: the
      // COORDINATING one (it runs /ct-groom and /ct-next, reviews and merges)
      // and the DISPATCHED one (it implements a slice and stops). Nothing in
      // the observable state said which was which: the root's
      // `.agent/STATE.md` talks about the epic, the worktree's state —since
      // F22, `.agent/SLICE.md`— talks about the slice, and the division was
      // only written inside the kickoff — a prompt that ONE of the two
      // received and that is lost with that session's context. A dispatched
      // session re-hydrating from its state (a /clear, a resumption, a
      // SessionStart hook) had no way of knowing that merging or dispatching
      // the next slice is not its job.
      //
      // It goes in the frontmatter and not in prose for the same reason as
      // `blocked` (see state.js): what has to survive a re-hydration is a
      // FIELD, not a sentence inside another field. The value is readable text
      // and not an enum because its reader is an agent, not a parser — no code
      // of the plugin decides anything with it, and saying so here stops
      // somebody turning it into a gate by accident.
      role: 'slice-agent (sesión DESPACHADA por /ct-next): implementas ESTE slice y PARAS. No groomeas, no mergeas, no despachas el siguiente — de eso se encarga la sesión coordinadora del checkout principal.',
      // gates (F21) — THE SAME ARGUMENT AS `role` (F20) AND AS `blocked` (F7):
      // what has to survive a re-hydration is a FIELD, not a sentence inside a
      // prompt. The kickoff is lost with its session's context; the SessionStart
      // hook injects this file into EVERY new session of the worktree. Without
      // this field, a session re-hydrating after a /clear has no way of knowing
      // that its PR carries a pending human gate — and the gate would become
      // exactly what this round fixes: a demand written somewhere its addressee
      // no longer opens.
      //
      // It is readable text and not an enum for the same reason as `role`: its
      // reader is an agent, not a parser. NO code of the plugin decides anything
      // with this field — saying so here stops somebody turning it into a real
      // gate by accident; the executable gate is the issue's `gate:` labels.
      gates: renderStateGates(resolveGatesForAgent(slice)),
      // senal (Slice 10) — THE SAME ARGUMENT AS `gates` (F21): what has to
      // survive a re-hydration is a FIELD, not a sentence inside a prompt that
      // is lost with its session's context. It is ALWAYS seeded (the issue's
      // text verbatim, or SIGNAL_ABSENT — the absence is declared, not
      // omitted). Its readers: ct-step, which pastes it as the first section of
      // the slice judge's package —read from disk, with no agent in between,
      // §3.3's doctrine— and the agent itself when re-hydrating.
      senal: renderStateSenal(slice.senal),
      // e2e (TASK 9) — the journeys the spec's E2E column declares. Unlike
      // `gates` (readable text, and whose own comment above warns that "no code
      // of the plugin decides anything with this field"), THIS field IS read by
      // a program: `ct-step` needs it because it does not talk to GitHub — it
      // reads this seed and passes it as `e2eRuns` to `newRun`
      // (ct-step.mjs:221). That is why it is a LIST and not a sentence: a
      // program does not parse prose.
      //
      // And that is exactly why `dispatch-check --release` does NOT trust it:
      // this file is agent-reachable (the dispatched agent itself can edit it).
      // The seed is the working channel; the real proof is made against the
      // issue (Task 10).
      //
      // Resolved with `resolveE2eRunsForAgent` (above), which prefers
      // `slice.e2eRuns` — what the ISSUE carries, via mapGhIssue — and only
      // falls back to the spec's raw cell when the slice did not come from an
      // issue. Absent or empty gives `[]`, never `undefined`.
      e2e: resolveE2eRunsForAgent(slice),
      status: 'not_started',
      branch,
      base,
      // ------------------------------------------------------------------
      // `base_sha` (slice 1 of Capde's entries) — THE SHA OF THE CUT, IN A
      // FIELD NOBODY REWRITES.
      //
      // It is the exact SHA `origin/<base>` pointed at when ct-next cut this
      // worktree (`git rev-parse --verify --quiet origin/<base>^{commit}`,
      // ct-next.mjs:1676, right after the fetch that proves the ref exists). It
      // receives the SAME value as `last_commit` just below, and even so it has
      // to be a separate field: `last_commit` belongs to the turn-closing guard
      // and the agent OVERWRITES it on every work commit — by design, see
      // state.js ("`last_commit` se entiende como el último commit DE
      // TRABAJO"). Which means the only trace of the cut that gets seeded today
      // disappears from the file on the slice's first commit.
      //
      // NOBODY rewrites `base_sha` after the dispatch: no verb of ct-step, no
      // hook, and the closing guard's message asking the agent to refresh its
      // state enumerates the fields to touch (you_are_here, next_action,
      // tasks[], last_commit) without naming it (state.js:617).
      //
      // And `base` is no good for this: `base` is a BRANCH NAME (`develop`,
      // never `origin/develop` nor a sha) because `gh pr create`'s `--base`
      // comes out of it. Resolving that name later, inside the worktree, points
      // at the branch's LOCAL copy — which is exactly what `dispatch-check
      // --release`'s diff measured in slice 10's run, with the local `main` 7
      // commits behind its remote.
      //
      // THE ABSENCE IS OMITTED, not declared empty: if ct-next could not
      // resolve `origin/<base>` to a sha (ct-next.mjs:1679) the field does not
      // appear in the YAML and whoever reads it falls back to their own
      // fallback. It is a deliberate asymmetry with `last_commit`, which IS
      // seeded as `""`: `last_commit` is read by `describeStopRelation`, which
      // already tells the empty value ("unset", keep quiet) apart from a value;
      // `base_sha` will be read by a regex over the file's TEXT, and a field
      // present with an empty value is a field claiming to have a value. The
      // field that is not there deceives nobody.
      ...(baseSha ? { base_sha: baseSha } : {}),
      // F22: the base's sha, NOT the branch name. With the field empty —what
      // used to be seeded until now— `describeStopRelation` returns `unset` and
      // `classifyStopState` exits in silence: the `Stop` hook that forces the
      // state to be refreshed on every turn was left DISARMED for the whole
      // life of the slice. Measured in the field: 21 hours and 7 commits with
      // the seed intact.
      //
      // And it has to be a SHA, not `main`: a branch name is a moving target,
      // and as soon as the base advanced, the count of "commits above your
      // last_commit" would stop meaning anything. If it could not be resolved,
      // it is deliberately seeded empty — an invented sha would be worse than
      // none.
      last_commit: baseSha,
      // baseline (#96) — the repo's test command, EXECUTED by the dispatcher in
      // this worktree before launching the agent, with its result (verde | rojo
      // | no-verificado), the command and a summary of the output. It replaces
      // the kickoff's order «baseline verde ANTES de tocar nada»: incident 5 of
      // the catalogue is an agent that asserted a green it never ran. It is a
      // map and not a sentence for the same reason as `blocked`: its three
      // parts are fields a program can read.
      baseline: baseline.seedField,
      // D-4 — the epic, seeded at dispatch time and not asked for on every run.
      // The absence is DECLARED with the constant that already exists, neither
      // filled in nor left empty: it is the same rule that stopped ct-next
      // assuming `main` in silence when it did not know the base. Its reader is
      // ct-step's telemetry, which aggregates by epic.
      epic: slice.epic || NO_MILESTONE_KEY,
      github_issue: issueNum,
      // D4, defect 4: this field printed the ISSUE number calling it "slice #N"
      // — two different identifier spaces (see issueRefOf's comment, above)
      // fused into a single label, in the first file the agent reads on
      // starting up. It now says which is which, and it only names the §9 order
      // when that order is genuinely known.
      you_are_here: `worktree fresco para el issue ${issueRefOf(slice)} de GitHub${orderSuffixOf(slice)}`,
      next_action: `hidrátate del issue y empieza por el primer AC (${slice.ac[0] || 'ver issue'})`,
      // F7: `blocked: null` is seeded EXPLICITLY, not omitted. A freshly
      // dispatched slice is not blocked and that is a fact worth stating; but
      // above all, the field has to EXIST in the file the agent is going to
      // edit — a field that only appears documented in the plugin is a field
      // nobody writes when they need it. See state.js#readBlocked for the full
      // shape (`{reason, since, unblock}`) and for why silence is read as "not
      // blocked".
      blocked: null,
      verify: '',
      tasks: [],
    },
    body: '## Current State\n(slice recién despachado, sin trabajo aún)',
  })
}
