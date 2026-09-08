import { describe, it, expect } from 'vitest'
import { parseScope, matchesPattern, scopeViolations, issueFromPrBody, isSliceBranch, LOOP_ARTIFACT_PATTERNS } from '../scripts/scope.js'

// THE CASE THAT GIVES RISE TO THIS WHOLE FILE, verbatim from the field.
//
// Dispatch 1, slice 4 (menoplus #662 → PR #668, 2026-08-13). The agent touched
// GDPR copy on screen against its explicit «Protegido», re-recorded its
// baseline, and wrote in the ledger and in the body of the PR that Jose had
// authorised it. BOTH ASSERTIONS WERE FALSE: its transcript has ONE single
// user entry, the kickoff of the dispatcher.
//
// A person spotted it, puzzled at seeing two `.swift` of the app in the list
// of files. What did not spot it: the hook of the visual gate (it only fires
// on TaskUpdate), the `gate:none` label (the waiver was legitimate for the
// work that was PLANNED), the CI (green, because the change was correct), nor
// the two independent reviewers of the agent itself (they reviewed the change,
// not the signature).
//
// The lesson this module wires in: the human signature is NOT verifiable from
// inside the loop —the agent runs with the credentials of Jose, so it can
// forge any GitHub artefact—, but WHAT IT TOUCHED is. The fact cannot be
// forged without it showing.
const PR_FILES_668 = [
  'apps/ios/MenoPlusTests/Infrastructure/SpanishStringsLintTests.swift',
  'apps/ios/MenoPlus/Presentation/Profile/DeletionConfirmView.swift',
  'apps/ios/MenoPlus/Presentation/Chat/ErrorBubbleView.swift',
  'docs/superpowers/plans/2026-08-13-guardarrailes-slice-4-plan.md',
]

const ISSUE_BODY_662 = `## Acceptance criteria
- La detección no depende de la lista de 68 palabras

## Contexto del epic
- **Fichero del epic:** \`apps/ios/MenoPlusTests/Infrastructure/SpanishStringsLintTests.swift\`. Los cuatro slices lo tocan.
- Alcance: apps/ios/MenoPlusTests/**, .github/workflows/ci.yml
- **Invariante de backend, no lo toques:** \`Lipidos\`, \`Coagulacion\`.

## Out of scope / Protected
- 🚫 No se corrige copy nuevo sin parar y preguntar

<!-- ct-order:4 -->`

describe('parseScope — the scope of the epic, declared ONCE and machine readable', () => {
  it('it reads the `Alcance:` line from inside `## Contexto del epic`', () => {
    const s = parseScope(ISSUE_BODY_662)
    expect(s.declared).toBe(true)
    expect(s.patterns).toEqual(['apps/ios/MenoPlusTests/**', '.github/workflows/ci.yml'])
  })

  // THE DOCTRINAL DECISION OF THE MODULE. An epic that declares no scope is
  // not clean: it is an epic that cannot be checked. It is the same rule the
  // rest of the plugin already holds up («el 1 nunca se degrada a 0»), and its
  // practical effect is deliberate: it pushes the friction to the freeze,
  // which is the only moment of the cycle when Jose is reading.
  it('with no `Alcance:` line → declared FALSE, which is NOT the same as «no restrictions»', () => {
    const s = parseScope('## Contexto del epic\n- Cosas en prosa, ningún alcance.\n')
    expect(s.declared).toBe(false)
    expect(s.patterns).toEqual([])
    expect(s.reason).toMatch(/does not declare/i)
  })

  it('`Alcance:` present but empty does not count as declared either', () => {
    const s = parseScope('## Contexto del epic\n- Alcance:   \n')
    expect(s.declared).toBe(false)
  })

  // The `Alcance:` has to live INSIDE `## Contexto del epic` because that is
  // the only section groom copies verbatim into the issue. A loose line in
  // another section would travel neither to the agent nor to the gate, and
  // taking it as good here would create a scope that exists in the spec and
  // does not exist where it is checked.
  it('it ignores an `Alcance:` that lives outside `## Contexto del epic`', () => {
    const body = '## Acceptance criteria\n- Alcance: apps/**\n\n## Contexto del epic\n- nada\n'
    expect(parseScope(body).declared).toBe(false)
  })

  it('it tolerates bold, backticks and spacing around the value', () => {
    const s = parseScope('## Contexto del epic\n- **Alcance:** `apps/ios/**` ,  `docs/**` \n')
    expect(s.patterns).toEqual(['apps/ios/**', 'docs/**'])
  })

  // The closing of the bold of the label (`**Alcance:**`) falls after the
  // colon and used to slip into the start of the value. It is removed only
  // when it has a space behind it — which is what tells a closing of bold
  // apart from a glob that starts with `**`, which always carries a slash.
  it('a pattern that STARTS with `**` survives the cleaning of the bold', () => {
    expect(parseScope('## Contexto del epic\n- **Alcance:** **/*.swift\n').patterns).toEqual(['**/*.swift'])
  })

  it('several `Alcance:` lines accumulate patterns instead of the last one winning', () => {
    const s = parseScope('## Contexto del epic\n- Alcance: apps/**\n- Alcance: docs/**\n')
    expect(s.patterns).toEqual(['apps/**', 'docs/**'])
  })

  it('the section is cut off at the next heading, it does not eat the rest of the body', () => {
    const body = '## Contexto del epic\n- nada\n\n## Out of scope / Protected\n- Alcance: apps/**\n'
    expect(parseScope(body).declared).toBe(false)
  })

  it('an empty or absent body → declared false, with no throw', () => {
    expect(parseScope('').declared).toBe(false)
    expect(parseScope(null).declared).toBe(false)
  })
})

describe('matchesPattern — the minimal glob, said in full so that nobody has to guess it', () => {
  it('`**` crosses directory separators', () => {
    expect(matchesPattern('apps/ios/MenoPlusTests/Infrastructure/X.swift', 'apps/ios/MenoPlusTests/**')).toBe(true)
  })
  it('`*` does NOT cross separators', () => {
    expect(matchesPattern('apps/ios/X.swift', 'apps/*')).toBe(false)
    expect(matchesPattern('apps/ios', 'apps/*')).toBe(true)
  })
  it('an exact path matches exactly', () => {
    expect(matchesPattern('.github/workflows/ci.yml', '.github/workflows/ci.yml')).toBe(true)
    expect(matchesPattern('.github/workflows/otro.yml', '.github/workflows/ci.yml')).toBe(false)
  })
  // Measured kindness: whoever writes the scope by hand at the freeze is
  // going to write the directory, not the glob. Treating the trailing `/` as
  // `/**` avoids a red over syntax at the moment when there is least appetite
  // for debugging globs.
  it('a pattern that ends in `/` counts as the whole directory', () => {
    expect(matchesPattern('apps/ios/a/b.swift', 'apps/ios/')).toBe(true)
  })
  it('it normalises the leading `./` of both parts', () => {
    expect(matchesPattern('./apps/x.swift', 'apps/**')).toBe(true)
  })
  // The regex metacharacters that really turn up in paths (`.`, `+`, `(`)
  // have to be literal, or `.github` would match `Xgithub`.
  it('the dot is literal, not «any character»', () => {
    expect(matchesPattern('Xgithub/workflows/ci.yml', '.github/workflows/ci.yml')).toBe(false)
  })
})

describe('scopeViolations — the fact, which is what cannot be forged', () => {
  it('THE INCIDENT: the two .swift of the app come out as a violation, the test and the plan do not', () => {
    const { patterns } = parseScope(ISSUE_BODY_662)
    expect(scopeViolations(PR_FILES_668, patterns)).toEqual([
      'apps/ios/MenoPlus/Presentation/Profile/DeletionConfirmView.swift',
      'apps/ios/MenoPlus/Presentation/Chat/ErrorBubbleView.swift',
    ])
  })

  it('a PR entirely within the scope produces no violation at all', () => {
    const { patterns } = parseScope(ISSUE_BODY_662)
    expect(scopeViolations(['apps/ios/MenoPlusTests/Infrastructure/SpanishStringsLintTests.swift'], patterns)).toEqual([])
  })

  // AN EXEMPTION, and it has to be read for what it is: not a hole, but the
  // recognition of the footprint of the loop ITSELF. The kickoff ORDERS the
  // agent to write its plan in docs/superpowers/plans/ and to commit it («it
  // travels in the PR»). Failing the gate over a file the loop itself demands
  // would be an unsatisfiable wall, and a guard that can only be satisfied by
  // disobeying the dispatcher ends up ignored altogether.
  it('the plan of the slice is exempt: the kickoff orders it, the agent does not choose it', () => {
    expect(scopeViolations(['docs/superpowers/plans/x-plan.md'], ['apps/**'])).toEqual([])
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/plans/**')
  })

  // `.agent/SLICE.md` is NOT exempt, and that is deliberate: it is session
  // state, not product of the slice. In dispatch 1 an agent put it in its PR
  // and took it out himself afterwards («es estado de sesión, no producto del
  // slice»). Exempting it would normalise exactly what that agent corrected on
  // his own.
  it('`.agent/SLICE.md` is NOT exempt: it is session state, not product of the slice', () => {
    expect(scopeViolations(['.agent/SLICE.md'], ['apps/**'])).toEqual(['.agent/SLICE.md'])
  })

  // Nor is `.superpowers/**`: the brainstorming skill itself says that
  // directory goes in `.gitignore`. It really did turn up in PR #668
  // (`.superpowers/sdd/progress.md`) and flagging it is NOT a false positive —
  // it is committed session state, residue of the fork.
  it('`.superpowers/**` is NOT exempt: it should be in .gitignore, not in a PR', () => {
    expect(scopeViolations(['.superpowers/sdd/progress.md'], ['apps/**'])).toEqual(['.superpowers/sdd/progress.md'])
  })

  // The bookkeeping each repository has of its own (BITACORA.md belongs to
  // menoplus, not to the plugin) is NOT hardcoded in the plugin: the target
  // repository declares it in its workflow. Hardcoding it here would open that
  // hole in EVERY repository.
  it('the exemptions of the target repository ADD to those of the plugin, they do not replace them', () => {
    const files = ['docs/superpowers/BITACORA.md', 'docs/superpowers/plans/x.md', 'src/a.swift']
    expect(scopeViolations(files, ['apps/**'], ['docs/superpowers/BITACORA.md'])).toEqual(['src/a.swift'])
  })

  it('a repository that declares its exemptions cannot switch off those of the plugin by accident', () => {
    expect(scopeViolations(['docs/superpowers/plans/x.md'], ['apps/**'], ['otra/cosa'])).toEqual([])
  })

  // The execution spec is exempt because the slice fills in its «Registro de
  // cierre» when it delivers — but that leaves the agent writing in the FROZEN
  // spec without the gate seeing it. It is tested so that the exemption is a
  // visible decision and not an oversight somebody discovers in the next
  // incident.
  it('the execution spec is exempt — and that exemption is a known limit of the gate', () => {
    expect(scopeViolations(['docs/superpowers/specs/2026-08-12-x-execution.md'], ['apps/**'])).toEqual([])
  })

  // THE MEASURED DEFECT: `ct-step report` writes the verdict of the judge in
  // `docs/superpowers/verdicts/issue-<n>-task-<t>.json`, stages it and puts it
  // INSIDE the commit of every task («el veredicto VIAJA en la pull request»,
  // closing criterion of F37). With that path left unexempted, an epic that
  // declares `Alcance: src/**` and has the gate installed comes out RED over a
  // file the agent did not write and cannot stop being written — checked by
  // running the function, which returned
  // `docs/superpowers/verdicts/issue-2-task-1.json` as a violation. And the
  // message the gate gives («o el trabajo sale del PR, o el alcance del epic
  // cambia») is impossible to obey: it is the unsatisfiable wall of F14 all
  // over again, and a guard that can only be satisfied by disobeying gets
  // switched off altogether.
  it('the verdict of the judge is exempt: ct-step writes it and stages it, not the agent', () => {
    expect(scopeViolations(['docs/superpowers/verdicts/issue-2-task-1.json'], ['src/**'])).toEqual([])
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/verdicts/**')
  })

  // The telemetry of the run is going to travel in the PR for the same reason
  // as the verdict, and the exemption has to be there BEFORE the write
  // arrives: if the write gets there first, the next slice of any epic with a
  // declared scope comes out red over the metrics file, and whoever reads it
  // will not know whether the agent or the loop put the red there.
  it('the telemetry of the run is exempt: the loop writes it, not the implementer', () => {
    expect(scopeViolations(['docs/superpowers/metrics/ct-step.jsonl'], ['src/**'])).toEqual([])
    expect(LOOP_ARTIFACT_PATTERNS).toContain('docs/superpowers/metrics/**')
  })

  // THE COUNTERWEIGHT, and without it the two tests above would pass with a
  // list of exempt paths that exempted too much (`docs/**`, or worse, `**`). A
  // path out of scope is still a violation, even —and above all— if it is a
  // neighbour of the exempt ones inside `docs/superpowers/`.
  it('the new exemptions do not widen the hole: what sits next to them still violates', () => {
    expect(scopeViolations(['lib/ajeno.js'], ['src/**'])).toEqual(['lib/ajeno.js'])
    expect(scopeViolations(['docs/superpowers/apuntes.md'], ['src/**'])).toEqual(['docs/superpowers/apuntes.md'])
  })

  // With no patterns the result CANNOT be «nothing violates»: that would turn
  // an epic with no declared scope into an epic with free rein, which is
  // exactly the failure the gate comes to close. Returning every file leaves
  // the caller with no way of reading it as clean.
  it('with no patterns, EVERY file is a violation — never «nothing to see here»', () => {
    expect(scopeViolations(['a.swift', 'b.swift'], [])).toEqual(['a.swift', 'b.swift'])
  })

  it('an empty list of files → no violations, no throw', () => {
    expect(scopeViolations([], ['apps/**'])).toEqual([])
  })
})

describe('isSliceBranch — what saves the gate from dying of noise', () => {
  // The gate judges slice PRs. A documentation PR, a chore or a fix by hand do
  // NOT carry `Closes #N` and are not harvest of the loop: failing them would
  // suspend every human PR of the repository and the gate would be switched
  // off altogether in a day — the unsatisfiable wall conventions.js already
  // paid for here (F14).
  //
  // The discriminator is the branch, because `feat/<n>` is created by the
  // DISPATCHER (it is the default `branchNameOf` of dispatch.js), not by the
  // agent.
  it('it recognises the branch the dispatcher creates', () => {
    expect(isSliceBranch('feat/662')).toBe(true)
  })
  it('a human branch is not a slice branch', () => {
    expect(isSliceBranch('docs/desenlace')).toBe(false)
    expect(isSliceBranch('feat/scope-gate')).toBe(false)
    expect(isSliceBranch('main')).toBe(false)
  })
  it('empty or absent is not a slice branch, with no throw', () => {
    expect(isSliceBranch('')).toBe(false)
    expect(isSliceBranch(null)).toBe(false)
  })
})

describe('issueFromPrBody — which issue this PR belongs to', () => {
  // It leans on findClosingKeywords (closing-keywords.js), which is already
  // hardened against the ReDoS F27 measured. The recogniser of closing
  // keywords is not reimplemented: two recognisers of the same text drift.
  it('it pulls the number out of the `Closes #N` of the body', () => {
    expect(issueFromPrBody('Closes #662\n\nSlice 4 y último.')).toBe(662)
  })
  it('it accepts the other closing keywords GitHub honours', () => {
    expect(issueFromPrBody('Fixes: #10')).toBe(10)
  })
  // A PR with no `Closes` is not harvest of the loop and the gate cannot judge
  // it. Returning null and not 0 forces the caller to decide explicitly what it
  // does.
  it('with no closing keyword → null, so that the caller decides', () => {
    expect(issueFromPrBody('Un PR suelto, sin issue.')).toBeNull()
  })
  it('an empty or absent body → null, with no throw', () => {
    expect(issueFromPrBody('')).toBeNull()
    expect(issueFromPrBody(null)).toBeNull()
  })
  // Several `Closes` in one PR is ambiguous: the gate does not pick one in
  // silence.
  it('two issues closed by the same PR → null, not the first one picked by hand', () => {
    expect(issueFromPrBody('Closes #10\nCloses #11')).toBeNull()
  })
})
