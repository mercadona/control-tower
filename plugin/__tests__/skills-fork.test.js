import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROLE_BUDGETS, CODE_BUDGETS } from '../scripts/plan-contract.js'

// F32 — the fork of superpowers 6.0.3 inside the plugin (decision closed in
// F31 §5: the 11 skills actually used are forked into control-tower-loop:* and
// superpowers is uninstalled). This test pins three things:
//
//   1. The SCOPE of the fork: exactly the 11 skills decided, no more and no
//      fewer, each one with its SKILL.md.
//   2. That the fork is CLOSED over itself: no reference to the
//      superpowers:* namespace nor to the two discarded skills
//      (requesting-code-review, using-superpowers) may survive — a future
//      cherry-pick from upstream that reintroduces them falls here.
//   3. The THREE rewritten SEAMS (F31 §5): both that the new text is there
//      and that the old terminal is no longer there are checked. They are
//      prose, not code, but they are the contract of the cycle: if a
//      cherry-pick steps on them, the cycle goes back to merging on its own
//      or to skipping the freeze.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'skills')

// The 11 from the real-use sweep of F31 §5 (2,704 transcripts). Discarded:
// dispatching-parallel-agents (0 uses; CT occupies its gap between slices),
// requesting-code-review (0 direct uses; its code-reviewer.md travels as a
// file INSIDE subagent-driven-development) and using-superpowers (meta).
const FORKED = [
  'brainstorming',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
]

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })
}

const read = (...parts) => readFileSync(join(SKILLS, ...parts), 'utf8')

describe("the fork's scope — the 11 skills of F31 §5, with their attribution", () => {
  it.each(FORKED)('skills/%s/SKILL.md exists', (name) => {
    expect(existsSync(join(SKILLS, name, 'SKILL.md'))).toBe(true)
  })

  it('code-reviewer.md travels inside subagent-driven-development (orphan of requesting-code-review)', () => {
    expect(existsSync(join(SKILLS, 'subagent-driven-development', 'code-reviewer.md'))).toBe(true)
  })

  it("upstream's MIT license travels with the fork", () => {
    const license = read('LICENSE-superpowers')
    expect(license).toContain('MIT License')
    expect(license).toContain('Jesse Vincent')
  })

  it('FORK.md records the 6.0.3 source version for future cherry-picks', () => {
    expect(read('FORK.md')).toContain('6.0.3')
  })
})

describe('the fork is closed — nothing points outside control-tower-loop', () => {
  // A single sweep of ALL of skills/ (state-template included): the old
  // namespace and the two skills that were not forked cannot appear in any
  // file, not even in the ones that do not mention them today. The one
  // exemption: FORK.md, whose job is precisely to NAME what was discarded so
  // that a future cherry-pick knows.
  const FORBIDDEN = [
    'superpowers:', // old namespace — the fork is invoked as control-tower-loop:*
    'requesting-code-review', // discarded; its prompt lives as ./code-reviewer.md
    'using-superpowers', // discarded (meta-skill of the upstream installation)
  ]

  it.each(FORBIDDEN)('no file under skills/ contains "%s"', (needle) => {
    const offenders = walk(SKILLS)
      .filter((p) => !p.endsWith('FORK.md'))
      .filter((p) => readFileSync(p, 'utf8').includes(needle))
    expect(offenders).toEqual([])
  })
})

describe('seam 1 — brainstorming ends in an execution spec + freeze, not in writing-plans', () => {
  const skill = () => read('brainstorming', 'SKILL.md')

  it('the terminal state is the execution spec in DRAFT and the request for the freeze', () => {
    expect(skill()).toContain('docs/superpowers/specs/')
    expect(skill()).toContain('-execution.md')
    expect(skill()).toContain('CONGELADA')
  })

  it('every frozen decision carries provenance and a "propuesta" is not frozen', () => {
    const s = skill()
    for (const p of ['hablada', 'deducida', 'propuesta']) expect(s).toContain(p)
  })

  // The execution spec's template already travels with the plugin and
  // `ct-init` seeds it at a KNOWN path. While the skill said only "the repo's
  // `_TEMPLATE-execution-spec.md`", with no path, whoever ran step 8 had to
  // guess where it was — and in a repo where nobody had copied it by hand, it
  // was nowhere at all.
  it('it names the concrete path of the template ct-init seeds', () => {
    expect(skill()).toContain('docs/superpowers/specs/_TEMPLATE-execution-spec.md')
  })

  it('the old terminal (invoking writing-plans) is no longer there', () => {
    // Fragile and DECLARED, not fixed: seam 6 was hardened by widening
    // 'superpowers:' to /superpowers/i, but here that same widening collides
    // with the NEW and correct prose — the file today says "Do NOT invoke
    // writing-plans, frontend-design, or any other implementation skill.",
    // which literally CONTAINS "invoke writing-plans". A wide regex over that
    // sentence (e.g. `/invok\w*.*writing-plans/i`) would flag as a failure the
    // very negation that closes the seam. Telling the old affirmation from the
    // new negation asks for looking at the context (who precedes "invoke"),
    // and that is exactly the kind of tight regex that breaks at the first
    // reformat — the literal check is kept, more fragile but honest.
    expect(skill()).not.toContain('The terminal state is invoking writing-plans')
    expect(skill()).not.toContain('Invoke the writing-plans skill')
  })
})

describe('seam 2 — SDD with no plan writes the plan now, scoped to the issue', () => {
  const skill = () => read('subagent-driven-development', 'SKILL.md')

  it('the "no plan" branch sends you to writing-plans-prescriptive with the issue as the spec', () => {
    const s = skill()
    expect(s).toContain('Write the plan now')
    expect(s).toContain('control-tower-loop:writing-plans-prescriptive')
    expect(s).toContain('scoped to the issue')
  })

  it('the old "brainstorm first" branch is no longer there', () => {
    // Fragile and DECLARED, same reason as seam 1: the new prose says
    // "Do NOT go back to brainstorming", which contains the very word that
    // would have to be banned if the ban went wide. Widening to /brainstorm/i
    // would flag that same negation as a failure. The literal is kept.
    expect(skill()).not.toContain('brainstorm first')
  })
})

describe("seam 4 — the slice's plan is written by writing-plans-prescriptive (a skill of our own)", () => {
  it('our own skill exists with its template', () => {
    expect(existsSync(join(SKILLS, 'writing-plans-prescriptive', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(SKILLS, 'writing-plans-prescriptive', 'plan-template.md'))).toBe(true)
  })

  it('it is ours, not forked: outside the FORKED list', () => {
    expect(FORKED).not.toContain('writing-plans-prescriptive')
  })

  it('SDD no longer names plain writing-plans as the destination of the "no plan" branch', () => {
    const s = read('subagent-driven-development', 'SKILL.md')
    expect(s).not.toMatch(/control-tower-loop:writing-plans[^-]/)
  })

  it('the skill imposes the literalness and the naming convention the --release gate looks for', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toContain('Current state (')
    expect(s).toContain('issue-<n>-')
    expect(s).toContain('--check-plan')
  })

  // F-jjponz-3 — while the gate read the tree at --release, a plan that
  // modified an existing file could only release by relabelling its
  // citations as prose, and that takes them out of the check in silence. Now
  // that the citations are verifiable against the base, the skill has to say
  // both things: that you cite as normal, and that relabelling is not a way
  // out.
  it('it says where each citation is verified and forbids relabelling them to dodge the gate', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toMatch(/base of the branch/i)
    expect(s).toMatch(/never relabel/i)
  })

  // F-jjponz-4 — the skill ordered pasting "the complete final content" of
  // each file, and that produced a 74k-character plan with 65% code, carrying
  // five defects that travelled pasted along. The new doctrine lives in the
  // prose, but the NUMBERS are dictated by plan-contract.js: if they diverge,
  // the agent writes plans the validator rejects and nobody knows which of the
  // two rules.
  it('it enumerates the four block roles', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    for (const rol of ['Current state (', 'Contract (', 'Call site (', 'Final text (']) {
      expect(s).toContain(rol)
    }
  })

  it("its budgets are the validator's: the prose and the code cannot diverge", () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    const numeros = [...Object.values(ROLE_BUDGETS), CODE_BUDGETS.task, CODE_BUDGETS.chars]
    for (const n of numeros) expect(s).toContain(String(n))
  })

  it('it says every TASK fits on one A4 page, and that if it does not fit the task is two', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toMatch(/one A4 page/i)
    expect(s).toMatch(/the task is two/i)
    // And it does not go back to asking for what the agent CANNOT do from a
    // frozen issue: splitting the slice.
    expect(s).not.toMatch(/the slice is two/i)
  })

  it('the dumping doctrine is no longer there', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).not.toMatch(/paste the code the plan shows/i)
    expect(s).not.toMatch(/complete final content/i)
  })

  it("it describes the brief ct-step really delivers, with the plan's yardstick", () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    const ctStep = readFileSync(join(ROOT, 'scripts', 'ct-step.mjs'), 'utf8')
    expect(ctStep).toContain('--with-plan-context')
    expect(s).toContain('--with-plan-context')
    expect(s).toContain('## 2. Closed decisions')
    expect(s).toContain('## 3. Reference patterns')
    expect(s).not.toMatch(/extracts that task and nothing more/i)
  })

  it('it says configuration travels as prose and that a test travels as a name and an assertion', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toMatch(/configuration travels as prose/i)
    expect(s).toMatch(/a test travels as two things/i)
  })

  it('it closes with the list of steps, and validates per task before going on', () => {
    const s = read('writing-plans-prescriptive', 'SKILL.md')
    expect(s).toContain('## The steps, in order')
    expect(s).toMatch(/one todo per step/i)
    expect(s).toMatch(/One task at a time: write it, then run `--check-plan`/)
  })

  it('the skill and its template have a budget: growing forces a trim', () => {
    const bytes = (f) => Buffer.byteLength(read('writing-plans-prescriptive', f))
    // Cap raised from 16314 to 16604: it pays for restoring, inside SKILL.md,
    // the precedence rule with its two directions for whoever writes the plan.
    // That rule has no other durable copy — the kickoff is delivered once, in
    // a prompt, and it is not a file the agent can reopen afterwards —, so
    // this is the place for it to live. The cap is still a ratchet: the next
    // raise needs its own reason written right here, precedent is not enough.
    //
    // Cap raised from 16604 to 16616 when merging main into the branch of ct's
    // yardstick. That reason above IS STILL IN FORCE and is not withdrawn:
    // what this raise adds is what the merge pays for, and that is the two
    // halves that arrived by different routes and that neither of them could
    // pay for alone, because each side grew up to its own cap measuring only
    // against itself.
    //
    //   - From main: `## Decisiones congeladas` as an input of the plan, with
    //     its destination named (`## 2. Closed decisions`) and the duty to
    //     respect it without reinterpreting it, plus step 1 of the final list
    //     that enumerates it. Without it whoever writes the plan does not know
    //     that section of the issue exists, and an epic decision nobody poured
    //     into the plan is a decision the `decisiones-cerradas` judge cannot
    //     measure.
    //   - From this branch: ct's yardstick as a SECOND yardstick, with
    //     precedence in both of its directions —ct wins where the two speak
    //     about the same thing, the repo binds whole where ct is silent— and
    //     step 2 that orders reading the four documents before writing the
    //     plan. It is the reason for the previous raise, and it still has no
    //     other durable copy.
    //
    // The 12 bytes are the net balance: both sides paid part of their own by
    // trimming prose in place (main shortened the paragraph about the 73,868
    // character plan; this branch trimmed the third copy of the precedence
    // rule), and what is left is what could not be trimmed without losing one
    // of the two halves. The ratchet is not loosened: the cap goes to the
    // EXACT size of the merged file, with no slack, and the next raise needs
    // its own reason written here — this merge is not a precedent either.
    //
    // Cap raised from 16616 to 17207 when closing the gaps the run of slice #7
    // of rust-monitoring measured. And a debt of the previous raise is paid
    // here too: this ratchet was ALWAYS measuring itself against the previous
    // cap and never against the first one, which is the way to give ground by
    // accumulation without any single raise looking big. The accumulated total
    // since the first cap (16,314) is +893 bytes, 5.5%, and it is written down
    // so that the next raise has to look at it.
    //
    // What the 591 bytes of this raise buy is a rule no other place can carry:
    // **no check may nail down the test count of the whole suite**. It was
    // measured on #7 — the plan nailed "52 passed" in four checks, the judge
    // demanded one more test, and the expired number had to be corrected in
    // seven places; with the total nailed down there was no room left to drive
    // in red the two branches `conventions/testing.md` demands, so they were
    // delivered with no assertion. It lives here because whoever writes the
    // checks is this skill: the judge can only declare the clash once it is
    // already written, and `plan-contract.js` can only reject it once it has
    // been written. Preventing it is the only thing that saves the whole round.
    //
    // Cap raised from 17207 to 17492: it pays for the variant of `grep -c`
    // with two or more files, which prints `file:count` per line and leaves
    // the `test` that wraps it red forever. Trimming inside the same section
    // was attempted and there was nowhere to trim from: every sentence there
    // pays for a measured incident, and removing one to make room for the next
    // swaps one lesson for another instead of adding it. The reason of this
    // raise's own: the skill taught ONLY the pipe form, which returns a
    // number, so nobody advised against the variant with files as arguments —
    // and it blocked slice #35 of repo-pulse on its fifth task, with a human
    // having to decide about an already approved plan. The validator rejects
    // it from this very branch, but that warns at VALIDATE time; this warns at
    // WRITE time, which is earlier.
    // The accumulated total since the first cap (16,314) is already +1,178
    // bytes, 7.2%, and the debt the previous raise wrote down —look at the
    // accumulated total, not just the previous step— is paid right here: the
    // next raise still has to add up from 16,314, not from 17,492.
    //
    // Cap raised from 17,492 to 17,495: three bytes, and they buy no content.
    // The skill was translated from Spanish to English along with the rest of
    // the repository, and English says the same thing slightly longer. Trimming
    // was not attempted on purpose: there is nothing to trim, because nothing
    // was added — a sentence removed here would pay for a translation with a
    // measured lesson, which is the exact trade the previous raise refused. The
    // ratchet is deliberately set to the new size and not to a round number, so
    // the next real addition still has to argue for itself. Accumulated since
    // 16,314: +1,181 bytes, 7.2%.
    expect(
      bytes('SKILL.md'),
      'SKILL.md is over its cap: trim inside the same section, or raise the cap by writing the reason for the raise right here — precedent is not a reason.'
    ).toBeLessThanOrEqual(17495)
    expect(
      bytes('plan-template.md'),
      'plan-template.md is over its cap: trim inside the same section, or raise the cap by writing the reason for the raise right here — precedent is not a reason.'
    ).toBeLessThanOrEqual(6377)
  })

  it('the template does not ask for the complete final state and its gaps name the roles', () => {
    const t = read('writing-plans-prescriptive', 'plan-template.md')
    expect(t).not.toMatch(/the complete final state/i)
    expect(t).toContain('Contract (')
    expect(t).toContain('No code — ')
  })
})

// F-jjponz-4 — seam 5. SDD's model selection took for granted that the task
// carried the complete code ("transcription plus testing") and for that reason
// sent those tasks to the cheapest tier. Since the plan carries contracts and
// not bodies, NO task is transcription: that shortcut would route to the
// cheapest model precisely the link that now writes the code.
describe('seam 5 — SDD no longer assumes the task carries the complete code', () => {
  const skill = () => read('subagent-driven-development', 'SKILL.md')

  it('the "transcription" shortcut no longer exists', () => {
    // Fragile and DECLARED, same reason as seams 1 and 2: the new prose says
    // "never transcription", so widening the ban to /transcription/i would
    // flag as a failure that very negation which closes the seam. The
    // concrete sentence of the old shortcut is kept.
    expect(skill()).not.toMatch(/contains the complete code to write/i)
  })

  it("the implementer's floor is the mid tier, and it says why", () => {
    const s = skill()
    expect(s).toMatch(/mid-tier model as the floor/i)
    expect(s).toMatch(/contract/i)
  })

  it('FORK.md documents it as a seam, so that a cherry-pick does not step on it', () => {
    const fork = readFileSync(join(SKILLS, 'FORK.md'), 'utf8')
    expect(fork).toMatch(/costura 5/i)
    expect(fork).toMatch(/subagent-driven-development/)
  })
})

describe('seam 3 — finishing-a-development-branch in a governed repo: PR + release + STOP', () => {
  const skill = () => read('finishing-a-development-branch', 'SKILL.md')

  it('it detects the CT dispatch by .agent/SLICE.md and offers no menu', () => {
    // This used to check the two strings LOOSE, anywhere in the file: a decoy
    // could leave them with no relation to each other (mentioning
    // '.agent/SLICE.md' in one place and '--release' in another, without the
    // detection leading to "there is no menu") and still pass. Now the
    // property the test name promises is demanded, in a single sentence and
    // in the same block: that detecting the file declares "no menu", and that
    // the fixed path that follows includes the `--release`.
    const s = skill()
    expect(s).toMatch(/\.agent\/SLICE\.md`?\s+exists,\s+there is no menu/i)
    expect(s).toMatch(/no menu[\s\S]{0,300}--release/i)
  })

  it('the merge is explicitly left in human hands', () => {
    expect(skill()).toMatch(/merge is (a )?human/i)
  })
})

// F39 — seam 6. `prompts/task-implementer.md` no longer carries the TDD
// (Test-Driven Development) cycle written inside it: it loads the forked
// skill. A cherry-pick from upstream over test-driven-development now changes
// the behaviour of `ct-step`'s implementer, which used to be immune because it
// depended on no skill of the fork.
describe("seam 6 — ct-step's implementer loads the fork's skill, not upstream's", () => {
  const prompt = () => readFileSync(join(ROOT, 'prompts', 'task-implementer.md'), 'utf8')

  it("seam 6: the implementer loads the plugin's skill, not upstream's", () => {
    const p = prompt()
    expect(p).toContain('control-tower-loop:test-driven-development')
    // A wide ban and not the literal `superpowers:`: what is watched is that
    // the implementer does not end up hanging from upstream by ANY route —
    // not the skill prefix, not a URL (github.com/obra/superpowers-skills),
    // not the project name loose in prose. The literal with the colon lets
    // any of those other forms through.
    expect(p).not.toMatch(/superpowers/i)
  })
})
// Issue 161, revisión — el hallazgo que dejaba el slice sin entregar: el
// mecanismo de la enmienda existía y NADIE se lo decía al único que puede
// usarlo. Un implementador obediente seguía chocando con el bloqueo.
describe('el prompt del implementador le dice que puede enmendar el **Files:** de su tarea', () => {
  const prompt = () => readFileSync(join(ROOT, 'prompts', 'task-implementer.md'), 'utf8')

  it('nombra la enmienda, y con sus tres límites', () => {
    const texto = prompt()
    expect(texto).toMatch(/amend/i)
    expect(texto).toMatch(/additions only/i)
    expect(texto).toMatch(/stay\s+exactly as they are/i)
    expect(texto).toMatch(/rides\s+inside your task/i)
  })

  it('ya no le dice que lo de fuera de la línea sólo se declara y se deja', () => {
    expect(prompt()).not.toMatch(/say so\s+in your report and leave it there/)
  })

  it('ya no le dice que la vara varía de longitud según el alcance', () => {
    expect(prompt()).not.toMatch(/which is why the list varies in length/)
  })
})
