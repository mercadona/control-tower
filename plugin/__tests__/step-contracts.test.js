// What crosses the boundary between the session and its subagents
// (scripts/step-contracts.js): what is accepted as an answer and what the
// plugin writes.
//
// The argv of `claude -p` is gone: it went with the program-conductor (D-4
// postponed). What is left is the schema, which with a subagent on the other
// side matters MORE and not less — the binary used to impose it, now this
// validation does.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  readVerdict, readReport, outcomeOfVerdict, commitMessage, findingLocation,
  VERDICT_SCHEMA, REPORT_SCHEMA, IMPLEMENTER_TOOLS, JUDGE_TOOLS, VERDICT_RULES,
  PACKAGE_SECTIONS, RUBRIC_OUTCOMES,
  readSliceVerdict, outcomeOfSliceVerdict, sliceVerdictCommitMessage,
  SLICE_VERDICT_RULES, SLICE_VERDICT_SCHEMA, SLICE_JUDGE_TOOLS, SLICE_PACKAGE_SECTIONS, RECONCILER_TOOLS,
  REVIEW_TOKEN_LABEL, reviewToken, reviewTokenLine, reviewTokenOf,
  readAdvice, ADVICE_SCHEMA, ADVISOR_TOOLS, ADVICE_PACKAGE_SECTIONS,
} from '../scripts/step-contracts.js'
import { findClosingKeywords } from '../scripts/closing-keywords.js'
import { PluginYardstick } from '../scripts/plugin-yardstick.js'

const JUDGE_AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-judge.md')
const SLICE_JUDGE_AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-slice-judge.md')
const RECONCILER_AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-reconciler.md')
const ADVISOR_AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'agents', 'ct-advisor.md')

// The `tools:` line of the reconciler's frontmatter (Branch reconciliation,
// Task 9) — the same pattern as `judgeAgentTools()`/`sliceJudgeAgentTools()`,
// over `agents/ct-reconciler.md`.
const reconcilerAgentTools = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(RECONCILER_AGENT, 'utf8'))
  return m ? m[1].trim() : null
}

// The `tools:` line of the SLICE judge's frontmatter — the same pattern as
// `judgeAgentTools()` for ct-judge.md, over §3.7-B's own file.
const sliceJudgeAgentTools = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(SLICE_JUDGE_AGENT, 'utf8'))
  return m ? m[1].trim() : null
}

// The headings of the slice judge's rubric — "### 1. `estado-final` — ..." —
// in the order the agent walks them. The same pattern as `judgeAgentRules()`,
// parameterised by file because there are now TWO agents with this same rubric
// shape.
const rulesOfAgent = (file) => {
  const text = readFileSync(file, 'utf8')
  const regex = /^### \d+\.\s+`([a-z-]+)`/gm
  const rules = []
  let m
  while ((m = regex.exec(text)) !== null) rules.push(m[1])
  return rules
}

// The ```json block of the slice judge's "What you write" — the same pattern
// as `judgeAgentSchema()`, parameterised by file.
const schemaOfAgent = (file) => {
  const text = readFileSync(file, 'utf8')
  const m = /## What you write[\s\S]*?```json\n([\s\S]*?)```/.exec(text)
  return m ? m[1] : ''
}

// The headings of the review package that the slice judge's "What you are
// given" cites. The same pattern as `packageSections()`, over the "The
// slice review package." paragraph instead of "The review package.".
const slicePackageSections = () => {
  const text = readFileSync(SLICE_JUDGE_AGENT, 'utf8')
  const paragraph = /- \*\*The slice review package\.\*\*([\s\S]*?)\n- \*\*The plan/.exec(text)
  if (!paragraph) return []
  const normalized = paragraph[1].replace(/\s+/g, ' ')
  const regex = /`## ([^`]+)`/g
  const sections = []
  let m
  while ((m = regex.exec(normalized)) !== null) {
    const section = m[1].trim()
    if (!sections.includes(section)) sections.push(section)
  }
  return sections
}
// The `tools:` line of the frontmatter, which is what really decides what the
// judge can do. The module's constant is a copy of it.
const judgeAgentTools = () => {
  const m = /^tools:\s*(.+)$/m.exec(readFileSync(JUDGE_AGENT, 'utf8'))
  return m ? m[1].trim() : null
}

const IMPLEMENTER_PROMPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'task-implementer.md')

// Point 3 of the implementer's prompt, isolated up to point 4: it is where
// e473c97's mirror sentence lives ("Rules to obey... Open both before you
// write"). It is bounded because the prompt ALREADY contained the word
// "boundary" before this slice, in the point "You do not touch files outside
// the task" (the boundary of the task's SCOPE, a subject unrelated to
// architecture boundaries) — a match against the whole file would pass just
// the same with the mirror sentence deleted.
const implementerPoint3 = () => {
  const m = /^3\.\s[\s\S]*?(?=^4\.\s)/m.exec(readFileSync(IMPLEMENTER_PROMPT, 'utf8'))
  return m ? m[0] : ''
}

const PLAN_TEMPLATE = join(
  dirname(fileURLToPath(import.meta.url)), '..',
  'skills', 'writing-plans-prescriptive', 'plan-template.md',
)
// The plan template's `## 3. Reference patterns`: the section that declares
// what is admitted as a yardstick. It is isolated up to the next `## ` because
// the rest of the template also names skills and not all of them are the
// judge's yardstick.
const templateSection3 = () => {
  const m = /^## 3\. Reference patterns$([\s\S]*?)^## /m.exec(readFileSync(PLAN_TEMPLATE, 'utf8'))
  return m ? m[1] : ''
}

// The rubric's `patrones` item, isolated up to the next heading: it is the only
// place where the judge is ordered to open the repo's yardstick.
const rubricItem5 = () => {
  const m = /^### 5\. `patrones`[\s\S]*?(?=^### |^## )/m.exec(readFileSync(JUDGE_AGENT, 'utf8'))
  return m ? m[0] : ''
}

// Item 5 with its whitespace normalised. Markdown's line wrapping can split
// across two lines of the file a sentence that in the text is a single one, so
// an expression looking for the distinctive sentence against the raw text would
// go red on reflowing a paragraph without anything having been deleted. The
// same device `packageSections` uses, for the same reason.
const rubricItem5Normalized = () => rubricItem5().replace(/\s+/g, ' ')

// The `alcance` item, isolated up to the next heading, with the same trim as
// `item5DeLaRubrica`: it is the only place where the judge is told that a diff
// of the plan file inside a task is an amendment it has to rule on, not a path
// out of scope.
const item8DeLaRubrica = () => {
  const m = /^### 8\. `alcance`[\s\S]*?(?=^### |^## )/m.exec(readFileSync(JUDGE_AGENT, 'utf8'))
  return m ? m[0] : ''
}

// The `test-desiderata` item, isolated up to the next heading, with the same
// trim as `rubricItem5`: it is the only place where the judge is told what
// it looks at in the tests the task has JUST written.
const rubricItem9 = () => {
  const m = /^### 9\. `test-desiderata`[\s\S]*?(?=^### |^## )/m.exec(readFileSync(JUDGE_AGENT, 'utf8'))
  return m ? m[0] : ''
}

// The list of identifiers the `rule` bullet of "What you write" shows the
// judge. It is a THIRD copy of VERDICT_RULES —after the array and the
// headings— and the one that breaks nothing by falling short: an identifier
// that does not appear there is an item the judge walks but from which it never
// dares emit a finding.
const identifiersTheJudgeMayWrite = () => {
  const m = /- `rule` is one of the[\s\S]*?(?=\n- `path`)/.exec(readFileSync(JUDGE_AGENT, 'utf8'))
  return m ? m[0].replace(/\s+/g, ' ') : ''
}

// Point 1 of the implementer's prompt (the loading of the TDD skill), isolated
// up to point 2: it is where this item's mirror sentence lives.
const implementerPoint1 = () => {
  const m = /^1\.\s[\s\S]*?(?=^2\.\s)/m.exec(readFileSync(IMPLEMENTER_PROMPT, 'utf8'))
  return m ? m[0] : ''
}

// The headings of the rubric — "### 1. `objetivo` — ..." — in the order the
// agent walks them. VERDICT_RULES is a copy of them: this repo already suffered
// the same decoupling with JUDGE_TOOLS (it diverged from the agent's
// frontmatter and the constant was left behind), and here the risk is worse
// because there is no schema error to give it away — a `rule` renamed in the
// code does not break ct-judge.md, it only makes EVERY verdict using that
// `rule` be discarded at run time until the run is exhausted.
const judgeAgentRules = () => {
  const text = readFileSync(JUDGE_AGENT, 'utf8')
  const regex = /^### \d+\.\s+`([a-z-]+)`/gm
  const rules = []
  let m
  while ((m = regex.exec(text)) !== null) rules.push(m[1])
  return rules
}

// The schema the rubric SHOWS the judge: the ```json block of "What you
// write", which is the only thing the agent reads in order to know the shape of
// the file it writes. If the validator demands a field that block does not
// show, the judge cannot get it right even by accident and every verdict is
// discarded until the run is exhausted — the same decoupling as JUDGE_TOOLS and
// VERDICT_RULES, with the bill paid in round trips.
const judgeAgentSchema = () => {
  const text = readFileSync(JUDGE_AGENT, 'utf8')
  const m = /## What you write[\s\S]*?```json\n([\s\S]*?)```/.exec(text)
  return m ? m[1] : ''
}

// The walk through the rubric exactly as the schema demands it: every item,
// each one exactly once, each one with what it gave. It is built from
// VERDICT_RULES and not from a hand-written list for the same reason the schema
// does not duplicate the list either: two copies of the identifiers diverge,
// and the test that tied them together would stop looking at all of them.
const fullWalk = () => VERDICT_RULES.map((rule) => ({ rule, result: 'sin hallazgos', outcome: 'conforme' }))

// Slice 11 — these tests do not care WHICH token the verdict carries, only
// that readVerdict demands it and preserves it: any 64-char hex will do, and it
// is not typed twice for the same reason fullWalk is not typed out.
const TOKEN = 'a'.repeat(64)

// The headings of the review package cited by the "The review package."
// paragraph of "What you are given" — the only place in the rubric that talks
// about the package `writeReviewPackage` writes. That paragraph is isolated before
// searching, because the rest of the file also cites headings between backticks
// (the BRIEF's: `## 2. Closed decisions`, `### Out of scope`...) and those do
// not belong to this package. The whitespace is normalised because Markdown's
// line wrapping can split a backticked span across two lines of the file
// without splitting the text it represents. The paragraph names each heading as
// it introduces it and may name it again afterwards (to explain where the list
// comes from); a repetition does not add a second entry, only the first mention
// of each one counts.
const packageSections = () => {
  const text = readFileSync(JUDGE_AGENT, 'utf8')
  const paragraph = /- \*\*The review package\.\*\*([\s\S]*?)\n- \*\*The task brief/.exec(text)
  if (!paragraph) return []
  const normalized = paragraph[1].replace(/\s+/g, ' ')
  const regex = /`## ([^`]+)`/g
  const sections = []
  let m
  while ((m = regex.exec(normalized)) !== null) {
    const section = m[1].trim()
    if (!sections.includes(section)) sections.push(section)
  }
  return sections
}

describe('who can do what', () => {
  it('the judge has no shell, and what takes it away is the agent declaration', () => {
    // The binary used to take it away with --tools; now agents/ct-judge.md
    // declares it. The property is the same: structural, not a promise inside
    // the prompt. That is why the FILE is looked at and not only the constant.
    expect(judgeAgentTools()).not.toMatch(/Bash|Edit/)
    expect(JUDGE_TOOLS).not.toMatch(/Bash|Edit/)
    expect(IMPLEMENTER_TOOLS).toMatch(/Bash/)
  })

  it('the constant cannot diverge from the agent that gets dispatched', () => {
    // They diverged: on giving the judge `Write` —without it it cannot deliver
    // its verdict and the step never closes— the constant was left behind, and
    // `ct-step next` went on to announce tools that were not the real judge's.
    // A pure module cannot read the file, so what stops it happening again is
    // this test and not the code.
    expect(JUDGE_TOOLS).toBe(judgeAgentTools())
  })

  it('the judge can write its verdict: it is the channel it answers through', () => {
    expect(judgeAgentTools()).toMatch(/Write/)
  })

  it('the implementer can load skills: without that it cannot follow its own rubric', () => {
    expect(IMPLEMENTER_TOOLS).toMatch(/\bSkill\b/)
  })

  it('the judge can load skills: the secondary yardstick §3 admits is not a path', () => {
    // Defect §3.1 of the handoff. `Rules to obey:` allowed a skill to be
    // declared and the rubric ordered it opened, but the frontmatter was `Read,
    // Grep, Glob, Write`: a skill name is not a path `Read` can open, and
    // `plan-contract` deliberately does not check it on disk. The secondary
    // yardstick was unreachable in silence — the judge would have said
    // `conforme` about a document it never opened.
    expect(judgeAgentTools()).toMatch(/\bSkill\b/)
    expect(JUDGE_TOOLS).toMatch(/\bSkill\b/)
  })

  it('nobody can admit a skill as a yardstick without giving the judge something to open it with', () => {
    // The three ends of the defect, tied together: the plan template admits it,
    // the rubric orders it opened, the frontmatter grants it. The first time,
    // two of the three were done and nothing noticed. If somebody later takes
    // option B of §3.1 (removing skills from §3), this test goes red and forces
    // them to remove it from all three places, not from one.
    expect(templateSection3()).toMatch(/skill/i)
    expect(rubricItem5()).toMatch(/skill/i)
    expect(judgeAgentTools()).toMatch(/\bSkill\b/)
  })

  it('boundaries is measured inside patrones: item 5 aims the gaze at imports and injection', () => {
    // §3.6 of the handoff, closed as ABSORBED. The directed question: when a
    // rules document talks about boundaries, the lines of the diff that answer
    // are its imports, its constructors and its signatures. Without that
    // direction, the judge audits literal text and does not look at the
    // architecture (measured in rust-monitoring run-4 task 2).
    expect(rubricItem5()).toMatch(/boundar/i)
    expect(rubricItem5()).toMatch(/import/i)
    expect(rubricItem5()).toMatch(/inject/i)
  })

  it("boundaries is not a ninth item: §3.6's decision is pinned", () => {
    // An item of its own only when the subject+yardstick pair is new. The
    // yardstick of boundaries is the Rules to obey that patrones already opens:
    // a heading of its own would only duplicate the sin-vara in repos with no
    // architecture convention.
    expect(VERDICT_RULES).not.toContain('boundaries')
    expect(judgeAgentRules()).not.toContain('boundaries')
  })

  it('the yardstick of boundaries is the same on both sides: the implementer reads it before writing', () => {
    // e473c97's property: the judge is no surprise because implementer and
    // judge measure with the same text. The distinctive sentence is demanded
    // (not just /boundar/i) inside the isolated point 3: the file already
    // carried "boundary" in another point and another subject before this
    // slice, so a loose match against the whole file would not detect this
    // sentence being deleted.
    expect(implementerPoint3()).toMatch(/rules speak about boundaries/i)
  })

  it('the delivery pattern is measured inside patrones: item 5 asks whether it is THE pattern the convention prescribes', () => {
    // §3.10 of the handoff, and what its own rubric calls «el check que un
    // verificador que solo mira la implementación deja pasar» (quoted as it is
    // written there): the pattern can
    // be well executed and coherent with itself and still not be the one the
    // repo prescribes for THIS kind of change. Without the directed question
    // the judge compares idioms and nobody opens the delivery one. The
    // trigger's words —signature, constructor, public contract— are demanded
    // too, because they are what tell it where to look in the diff.
    const item = rubricItem5Normalized()
    expect(item).toMatch(/well executed and coherent with itself/i)
    expect(item).toMatch(/expand-contract/)
    expect(item).toMatch(/signature, a constructor or a public contract/i)
  })

  it("rollout is not a tenth item: §3.6's decision is pinned for the delivery pattern too", () => {
    // The same rule that closed `boundaries`: an item of its own only when the
    // subject+yardstick pair is new. The delivery pattern's yardstick is the
    // same `Rules to obey:` that `patrones` already opens, so a heading of its
    // own would buy no vigilance: it would duplicate the `sin-vara` in every
    // repo that does not write down how it delivers.
    expect(VERDICT_RULES).not.toContain('rollout')
    expect(judgeAgentRules()).not.toContain('rollout')
  })

  it("the delivery pattern's yardstick is the same on both sides: the implementer reads it before writing", () => {
    // e473c97's property again: the judge is no surprise because the two of
    // them measure with the same text. The distinctive sentence is looked for
    // inside the isolated point 3 and with whitespace normalised, not a loose
    // match against the whole file.
    const point3 = implementerPoint3().replace(/\s+/g, ' ')
    expect(point3).toMatch(/how a change of this kind must reach production/i)
    expect(point3).toMatch(/expand-contract/)
  })

  it('the alcance item tells the judge that a diff of the plan is an amendment it has to rule on', () => {
    // Task 5: the `alcance` item no longer vetoes by reflex, nor ignores, a diff
    // of the plan file inside a task — it is an AMENDMENT written by the
    // implementer and it falls to this item to rule on whether it was justified.
    const item = item8DeLaRubrica()
    expect(item).toMatch(/\bamendment\b/i)
    expect(item).toMatch(/plan file/i)
  })

  it('the alcance item does NOT promise the judge that only additions reach it', () => {
    // The pull request's review: the text asserted «what reaches you only ADDS»,
    // and that is false — the program's guard only looks at the **Files:** of
    // THE task, so an amendment that rewrites its Verification or deletes its
    // Tests arrives unchecked. Promising it otherwise lowers its guard exactly
    // where there is no net.
    const item = item8DeLaRubrica()
    expect(item).not.toMatch(/only ADDS/)
    expect(item).toMatch(/\*\*Verification:\*\*/)
    expect(item).toMatch(/unchecked/i)
  })

  it('the judge no longer reads that the program filters the yardstick by each document\'s scope', () => {
    // Task 1 deleted the filter: the eight documents reach every task. Two
    // places in the file went on asserting the opposite, and one of them sits
    // three lines above the heading that says nothing is filtered.
    const texto = readFileSync(JUDGE_AGENT, 'utf8')
    expect(texto).not.toMatch(/picked them by the scope each one/)
    expect(texto).toMatch(/all eight/i)
  })

  it('test-desiderata is the ninth item, and it goes behind alcance', () => {
    // §3.6 settled it as an item of its OWN (unlike boundaries and rollout,
    // absorbed into patrones): a new subject (the tests the task has just
    // written) and a new yardstick (properties of the test, not conventions of
    // the repo). The POSITION is a decision too: the array's order is the order
    // of the walk, and slotting it in would renumber six headings without
    // changing anything measurable.
    expect(VERDICT_RULES.at(-1)).toBe('test-desiderata')
    expect(judgeAgentRules().at(-1)).toBe('test-desiderata')
  })

  it('item 9 names the three violations that block, and discards the medium', () => {
    const item = rubricItem9()
    expect(item).toMatch(/determinis/i)
    expect(item).toMatch(/isolat/i)
    expect(item).toMatch(/real behaviour/i)
    expect(item).toMatch(/never reports `medium`/i)
  })

  it('item 9 judges the new tests and hands the pre-existing ones back to manipulacion-tests', () => {
    // §3.5 of the handoff: a relaxed assert in a test that ALREADY existed is
    // one defect and not two. Without the sentence, the two items overlap and
    // the per-rule count the telemetry reads counts the same finding twice.
    expect(rubricItem9()).toMatch(/manipulacion-tests/)
  })

  it('item 9 measures with the same skill the implementer was under orders to follow', () => {
    // The judge runs in the TARGET REPO's worktree: the plugin's skills/ is not
    // a path `Read` can reach there, and that is why this item was impossible
    // before Slice 1. And it is the SAME copy the implementer's prompt names: a
    // judge that blocks with a text the implementer never received is a
    // surprise, which is exactly what e473c97's mirror exists to prevent.
    expect(rubricItem9()).toMatch(/control-tower-loop:test-driven-development/)
    expect(readFileSync(IMPLEMENTER_PROMPT, 'utf8')).toMatch(/control-tower-loop:test-driven-development/)
    expect(judgeAgentTools()).toMatch(/\bSkill\b/)
  })

  it('the list of identifiers the judge may write does not fall short', () => {
    // The headings are already tied together; this list was not. An identifier
    // missing here breaks no schema: it merely makes the judge walk the item
    // and not dare emit a finding of its own, because the file tells it that
    // `rule` is not one of the valid ones.
    const list = identifiersTheJudgeMayWrite()
    for (const rule of VERDICT_RULES) expect(list).toContain(`\`${rule}\``)
  })

  it('the yardstick of the new tests is the same on both sides: the implementer reads it before writing', () => {
    const point1 = implementerPoint1()
    expect(point1).toMatch(/determinis/i)
    expect(point1).toMatch(/isolat/i)
    expect(point1).toMatch(/real behaviour/i)
  })

  it("VERDICT_RULES cannot diverge from the rubric's headings", () => {
    // Renaming a rule in the code without touching the agent (or the other way
    // round) breaks no schema: it merely makes a verdict with that `rule` be
    // discarded on every execution. This test is what turns it into a test
    // failure instead of a silent failure in production.
    expect(VERDICT_RULES).toEqual(judgeAgentRules())
  })

  it('the rubric shows the judge the walk field instead of asking for it in prose', () => {
    // The walk through the items used to be asked for in prose, at the end of
    // the file, and it was asked for the subagent's ANSWER — which is not
    // persisted. It is now a field of the verdict, so the block the judge
    // copies has to show it: a validator that demands what the agent cannot see
    // discards every verdict of the run without any of them being the judge's
    // fault.
    expect(judgeAgentSchema()).toMatch(/"rubric"/)
    expect(judgeAgentSchema()).toMatch(/"result"/)
  })

  it('the rubric shows the judge the two new fields, or it cannot get them right even by accident', () => {
    // The same argument as the test above, applied to `outcome` and to
    // `evidence`: the validator demands them, so the block the judge copies has
    // to show them. A field that lives only in the validator discards every
    // verdict of the run without any of them being the judge's fault.
    expect(judgeAgentSchema()).toMatch(/"outcome"/)
    expect(judgeAgentSchema()).toMatch(/"evidence"/)
  })

  it('the rubric shows the judge the two location fields, and no longer the old one', () => {
    // The same argument as `outcome` and `evidence`: a mandatory field that
    // lives only in the validator discards every verdict of the run without any
    // of them being the judge's fault. And the `not`: an example that also
    // shows the old `where` is a judge that fills in the old one, brings no
    // `path`, and burns MAX_DISCARDS with a correct verdict inside.
    expect(judgeAgentSchema()).toMatch(/"path"/)
    expect(judgeAgentSchema()).toMatch(/"line"/)
    expect(judgeAgentSchema()).not.toMatch(/"where"/)
  })

  it('the three outcome values are in the rubric, spelled exactly as in the enum', () => {
    // The enum is closed and the judge can only write what the rubric shows it.
    // If the code renames `sin-vara` and the file goes on saying what it said
    // before, the judge writes the old value and the verdict is discarded.
    const text = readFileSync(JUDGE_AGENT, 'utf8')
    for (const value of RUBRIC_OUTCOMES) expect(text).toContain(value)
  })

  // Slice 11 — the mandatory field has to be in what the judge reads: a field
  // that lives only in the validator discards the whole run without any of the
  // verdicts being the judge's fault.
  // The field is written by `ct-step verdict`, so the block the judge copies
  // does NOT carry it: showing it to the judge meant asking for 64 hex
  // characters typed by hand, and a copying error discarded a whole verdict
  // from opus.
  it('the json block of ct-judge.md no longer asks it for the review_token: the program writes it', () => {
    expect(judgeAgentSchema()).not.toMatch(/"review_token"/)
  })

  it("the judge's rubric tells it that field is not its own, naming the package line it no longer copies", () => {
    const text = readFileSync(JUDGE_AGENT, 'utf8')
    expect(text).toContain(`${REVIEW_TOKEN_LABEL}:`)
    expect(text).toMatch(/There is no `review_token` for you to write/)
    expect(text).not.toMatch(/copied verbatim/)
  })

  it('PACKAGE_SECTIONS cannot diverge from the headings the rubric cites by name', () => {
    // The same failure JUDGE_TOOLS and VERDICT_RULES already had, with an
    // aggravating factor: here there is not even a schema to discard anything.
    // If `writeReviewPackage` renames a heading without touching the rubric, the
    // judge goes on receiving instructions to read a section that does not
    // exist, and nothing notices except this test.
    expect(PACKAGE_SECTIONS).toEqual(packageSections())
  })

  // The package's first section is not written by `writeReviewPackage`: it is
  // written by `PluginYardstick.composePathSection`, with its own constant. Two
  // hand-written strings for the same heading are the decoupling JUDGE_TOOLS
  // and PACKAGE_SECTIONS already suffered, and here it would be mute: the judge
  // would read a section the package titles differently.
  it('the yardstick section is titled by the module that writes it, and PACKAGE_SECTIONS cannot diverge from it', () => {
    expect(PACKAGE_SECTIONS[0]).toBe(PluginYardstick.PATH_SECTION)
  })
})

// ---------------------------------------------------------------------------
// THE SLICE JUDGE (§3.7-B of the handoff): material of its own,
// `agents/ct-slice-judge.md`, with its own TWO-item rubric. The same test
// patterns that already tie down the task judge, applied to the new file.
// ---------------------------------------------------------------------------
describe('the slice judge (§3.7-B)', () => {
  it("SLICE_VERDICT_RULES are the three headings of ct-slice-judge.md's rubric", () => {
    expect(SLICE_VERDICT_RULES).toEqual(rulesOfAgent(SLICE_JUDGE_AGENT))
    // Slice 10: `observabilidad` is the third item — §3.9's three checks
    // against the accumulated diff, THE SLICE's signal as the subject.
    expect(SLICE_VERDICT_RULES).toEqual(['estado-final', 'coherencia', 'observabilidad'])
  })

  // The order of the array IS the order of the walk and the headings are tied
  // down by test — slotting it in the middle would renumber ct-slice-judge.md's
  // headings without measuring anything different (the same argument by which
  // `test-desiderata` came in ninth in the task judge).
  it('observabilidad is the third and last: it comes in behind, never slotted in the middle', () => {
    expect(SLICE_VERDICT_RULES.at(-1)).toBe('observabilidad')
    expect(SLICE_VERDICT_RULES.slice(0, 2)).toEqual(['estado-final', 'coherencia'])
  })

  // The THIRD copy of the identifiers (after the array and the headings): the
  // list the `rule` bullet of "What you write" shows the judge — an identifier
  // that does not appear there is an item the judge walks but from which it
  // never dares emit a finding. The same reason as
  // `identifiersTheJudgeMayWrite` in the task judge.
  it("the rule bullet of ct-slice-judge.md names the three identifiers", () => {
    const text = readFileSync(SLICE_JUDGE_AGENT, 'utf8')
    const m = /- `rule` is one of the[\s\S]*?(?=\n- `path`)/.exec(text)
    const bullet = m ? m[0].replace(/\s+/g, ' ') : ''
    for (const rule of SLICE_VERDICT_RULES) {
      expect(bullet).toContain(`\`${rule}\``)
    }
  })

  // The telemetry (`findings_by_rule`) counts findings by rule NAME and
  // `aggregateVerdictMeasures` merges as it is everything that carries a
  // `ruling`: a name shared between the two judges would make their counts
  // indistinguishable.
  it('observabilidad does not clash with any rule of the task judge', () => {
    expect(VERDICT_RULES).not.toContain('observabilidad')
    // Complete disjunction: no identifier lives in both rubrics.
    expect(SLICE_VERDICT_RULES.filter((r) => VERDICT_RULES.includes(r))).toEqual([])
  })

  it('the slice judge has neither a shell nor Edit', () => {
    expect(sliceJudgeAgentTools()).not.toMatch(/Bash|Edit/)
    expect(SLICE_JUDGE_TOOLS).not.toMatch(/Bash|Edit/)
  })

  it('SLICE_JUDGE_TOOLS cannot diverge from the agent that gets dispatched', () => {
    expect(SLICE_JUDGE_TOOLS).toBe(sliceJudgeAgentTools())
  })

  it('the slice judge can write its verdict: it is the channel it answers through', () => {
    expect(sliceJudgeAgentTools()).toMatch(/Write/)
  })

  it('the ```json block of ct-slice-judge.md shows rubric, outcome, evidence and path', () => {
    const schema = schemaOfAgent(SLICE_JUDGE_AGENT)
    expect(schema).toMatch(/"rubric"/)
    expect(schema).toMatch(/"outcome"/)
    expect(schema).toMatch(/"evidence"/)
    expect(schema).toMatch(/"path"/)
  })

  it('the json block of ct-slice-judge.md does not ask it for the review_token either, and tells it who writes it', () => {
    expect(schemaOfAgent(SLICE_JUDGE_AGENT)).not.toMatch(/"review_token"/)
    const text = readFileSync(SLICE_JUDGE_AGENT, 'utf8')
    expect(text).toContain(`${REVIEW_TOKEN_LABEL}:`)
    expect(text).toMatch(/There is no `review_token` for you to write/)
  })

  it('SLICE_PACKAGE_SECTIONS opens with Vara and cannot diverge from the rubric', () => {
    expect(SLICE_PACKAGE_SECTIONS).toEqual(slicePackageSections())
    // Task 8: `Vara` FIRST, ahead even of `Señal`, for the same reason `Señal`
    // went ahead of the -U10 diff: buried further down nobody reads it. The
    // tie-down above forces package and agent to change in the SAME task.
    expect(SLICE_PACKAGE_SECTIONS).toEqual(['Vara', 'Señal', 'Commits', 'Files changed', 'Diff'])
  })

  it("the slice walk's schema does not duplicate the identifiers: it takes them from SLICE_VERDICT_RULES", () => {
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.items.properties.rule.enum).toBe(SLICE_VERDICT_RULES)
  })

  it('the slice schema asks for the whole walk: three items, not one more and not one less', () => {
    // Slice 10: the schema derives from SLICE_VERDICT_RULES.length — it goes up
    // to 3 on its own, without touching schemaFor or readSliceVerdict.
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.minItems).toBe(3)
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.maxItems).toBe(3)
  })

  const sliceWalk = () => SLICE_VERDICT_RULES.map((rule) => ({ rule, result: `mirado: ${rule}`, outcome: 'conforme' }))

  it('readSliceVerdict accepts a valid two-item walk', () => {
    const r = readSliceVerdict({ ruling: 'PASS', rubric: sliceWalk(), findings: [], review_token: TOKEN })
    expect(r.verdict).toEqual({ ruling: 'PASS', rubric: sliceWalk(), findings: [], review_token: TOKEN })
  })

  // Slice 11: the same field, the same validator — `readSliceVerdict` is
  // `readVerdict` with another rubric inside, so the token is demanded just the
  // same.
  it('the slice judge validates the same field, with the same readVerdict: absent is fine, another shape is not', () => {
    expect(readSliceVerdict({ ruling: 'PASS', rubric: sliceWalk(), findings: [] }).verdict.review_token).toBeNull()
    expect(readSliceVerdict({ ruling: 'PASS', rubric: sliceWalk(), findings: [], review_token: 'x' }).verdict).toBeUndefined()
  })

  it('readSliceVerdict discards a verdict with a TASK rule (e.g. "alcance")', () => {
    const r = readSliceVerdict({
      ruling: 'FAIL',
      rubric: sliceWalk(),
      findings: [{ rule: 'alcance', severity: 'high', what: 'x', path: 'y', evidence: 'z' }],
    })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/unknown rule/)
  })

  it('readSliceVerdict discards a PASS with a high finding, just like the task verdict', () => {
    const r = readSliceVerdict({
      ruling: 'PASS',
      rubric: sliceWalk(),
      findings: [{ rule: 'coherencia', severity: 'high', what: 'x', path: 'y', evidence: 'z' }],
    })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/contradicts the rubric/)
  })

  it('readSliceVerdict discards an incomplete walk: the rubric is 3 items', () => {
    const r = readSliceVerdict({ ruling: 'PASS', rubric: [sliceWalk()[0]], findings: [] })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/coherencia/)
    expect(r.why).toContain('3 items')
  })

  // The incomplete-walk message derives from `rules` and names what is
  // missing: a slice judge that answers the old two-item walk gets discarded
  // with the third one's name in the text it reads in order to retry.
  it('a slice walk with no observabilidad is discarded naming it', () => {
    const onlyTwo = sliceWalk().filter((p) => p.rule !== 'observabilidad')
    const r = readSliceVerdict({ ruling: 'PASS', rubric: onlyTwo, findings: [] })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/observabilidad/)
  })

  it('readVerdict (the TASK one) still demands the walk of nine: there is no regression', () => {
    const complete = VERDICT_RULES.map((rule) => ({ rule, result: 'ok', outcome: 'conforme' }))
    expect(readVerdict({ ruling: 'PASS', rubric: complete, findings: [], review_token: TOKEN }).verdict).toBeDefined()
    // That same TWO-item walk is not enough for a TASK verdict.
    expect(readVerdict({ ruling: 'PASS', rubric: sliceWalk(), findings: [] }).verdict).toBeUndefined()
  })

  it('outcomeOfSliceVerdict: FAIL is always failed', () => {
    expect(outcomeOfSliceVerdict({ ruling: 'FAIL', findings: [] })).toBe('failed')
  })

  it('outcomeOfSliceVerdict: PASS with a medium is still done — no round trip is paid for', () => {
    expect(outcomeOfSliceVerdict({ ruling: 'PASS', findings: [{ severity: 'medium' }] })).toBe('done')
  })

  it('outcomeOfSliceVerdict: a clean PASS is done', () => {
    expect(outcomeOfSliceVerdict({ ruling: 'PASS', findings: [] })).toBe('done')
  })

  it('sliceVerdictCommitMessage carries the issue, Co-Authored-By, and no closing keyword', () => {
    const msg = sliceVerdictCommitMessage({ issue: 42, tasksTotal: 3 })
    expect(msg).toContain('(#42)')
    expect(msg).toContain('Co-Authored-By: Claude <noreply@anthropic.com>')
    expect(findClosingKeywords(msg)).toEqual([])
  })

  // The `observabilidad` item, isolated — the same regex vara.test.js isolates
  // the task judge's item 5 with: the exact heading up to the next `###` or
  // `##` (here, `## What you do not judge`).
  const observabilityItem = () => {
    const text = readFileSync(SLICE_JUDGE_AGENT, 'utf8')
    const m = /^### 3\. `observabilidad`[\s\S]*?(?=^### |^## )/m.exec(text)
    return m ? m[0] : ''
  }

  // The MEDIUM finding of PR #36's review: the contract's sentence was read by
  // a human at groom time and by nobody else. This ties down the half that was
  // missing — the criterion is measured at judgement time, and with the
  // contract's words.
  it("the observabilidad item measures the redundant signal with the contract's rule", () => {
    const item = observabilityItem()
    expect(item).not.toBe('')
    const norm = item.replace(/\s+/g, ' ')
    expect(norm).toContain('se puede comprobar corriendo los tests, es un criterio de aceptación, no una señal')
    expect(norm).toContain('`señal redundante`')
    // The two conditions of the trigger, both inside the item: the test of the
    // accumulated diff, and the cell naming nothing that can be read in
    // production.
    expect(norm).toMatch(/test of the accumulated diff/)
    expect(norm).toMatch(/no metric, no log line, no event/)
  })

  // The number the item promises has to add up with what it lists. If somebody
  // adds a fourth blocking check, this test falls and forces them to update the
  // promise — which is what did not happen with «three checks» when the
  // sentence came in.
  it('the item promises three checks and lists three: the smell is not a fourth bullet', () => {
    const item = observabilityItem()
    expect(item.match(/^- \*\*/gm)).toHaveLength(3)
    const norm = item.replace(/\s+/g, ' ')
    expect(norm).toContain('three checks, and only these three')
    expect(norm).toContain('one smell')
  })

  // The vocabulary does NOT grow: it is a finding, not a new outcome. A `low`
  // turned into «redundante» would break the schema's closed enum and with it
  // `rubric_sin_vara`, which is the only thing that says today whether there
  // was a yardstick at all.
  it('the redundant signal is a finding, not a new outcome: the item stays conforme', () => {
    expect(observabilityItem().replace(/\s+/g, ' ')).toContain('still `conforme`')
    expect(SLICE_VERDICT_SCHEMA.properties.rubric.items.properties.outcome.enum).toBe(RUBRIC_OUTCOMES)
    for (const value of RUBRIC_OUTCOMES) expect(observabilityItem()).toContain(value)
  })

  // The item's severity calibration names the case: a judge that reads only
  // that paragraph cannot turn it into a veto or into a round trip paid for.
  it('the smell\'s severity also lives in «Severity, decided here»', () => {
    const sev = /\*\*Severity, decided here:\*\*[\s\S]*?(?=\n\n)/.exec(observabilityItem())
    expect(sev).not.toBeNull()
    expect(sev[0].replace(/\s+/g, ' ')).toContain('restated an acceptance criterion is `low`')
  })
})

// ---------------------------------------------------------------------------
// THE RECONCILER (Branch reconciliation, Task 9): `agents/ct-reconciler.md`.
// Unlike the two judges above, it inverts the asymmetry instead of repeating it
// — `Edit` instead of `Write`, and neither `Bash` nor `Write` — because git
// does not count a conflicted file as resolved until somebody stages it, and
// the only one that can is the program (`BranchReconciliation.conclude()`),
// never the agent. This invariant holds up ALL of the design's hygiene (a
// reconciler that could stage or create files could hide a bad resolution
// behind a green `git status`), so it is pinned with the ABSENCES checked
// explicitly and not only the presences.
// ---------------------------------------------------------------------------
describe('the reconciler (Branch reconciliation, Task 9)', () => {
  it('declares exactly Read, Grep, Glob, Edit — neither Bash nor Write', () => {
    expect(reconcilerAgentTools()).toBe('Read, Grep, Glob, Edit')
    expect(reconcilerAgentTools()).not.toMatch(/\bBash\b/)
    expect(reconcilerAgentTools()).not.toMatch(/\bWrite\b/)
  })

  it('the RECONCILER_TOOLS constant cannot diverge from the agent that gets dispatched', () => {
    // The same failure JUDGE_TOOLS and SLICE_JUDGE_TOOLS already suffered: a
    // hand-copied constant that falls behind the real frontmatter.
    expect(RECONCILER_TOOLS).toBe(reconcilerAgentTools())
    expect(RECONCILER_TOOLS).not.toMatch(/\bBash\b/)
    expect(RECONCILER_TOOLS).not.toMatch(/\bWrite\b/)
  })

  it('the reconciler can edit files that already exist: it is the only channel it resolves through', () => {
    expect(reconcilerAgentTools()).toMatch(/\bEdit\b/)
  })
})

describe('the verdict', () => {
  const v = (ruling, findings = [], rubric = fullWalk()) => readVerdict({ ruling, rubric, findings, review_token: TOKEN })

  it('a clean PASS reads and holds', () => {
    expect(v('PASS').verdict).toEqual({ ruling: 'PASS', rubric: fullWalk(), findings: [], review_token: TOKEN })
  })

  it.each([
    ['with no structured_output', null, /did not return structured_output/],
    ['with an invented ruling', { ruling: 'MAYBE', findings: [] }, /unknown ruling/],
    ['with findings that are not a list', { ruling: 'PASS', findings: 'ninguno' }, /is not a list/],
    ['with an invented severity', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'catastrophic', what: 'x', path: 'y', evidence: 'z' }] }, /unknown severity/],
    ['with a mute finding', { ruling: 'FAIL', findings: [{ rule: 'contrato', severity: 'high', what: '', path: 'y', evidence: 'z' }] }, /does not say what or where/],
    // Without pinning this case, a regression changing the condition to
    // `f.rule && !VERDICT_RULES.includes(f.rule)` would silently let through a
    // finding with no `rule` — it would only catch the INVENTED rule, not the
    // ABSENT one.
    ['with a finding with no rule', { ruling: 'FAIL', findings: [{ severity: 'high', what: 'x', path: 'y', evidence: 'z' }] }, /unknown rule/],
  ])('%s is discarded', (_case, structured, reason) => {
    const r = readVerdict(structured)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(reason)
  })

  it('a PASS with a serious finding is discarded: it contradicts itself', () => {
    // It is not read towards the prudent side. A judge that does not understand
    // itself has not judged, and asking again costs less than deciding for it.
    const r = v('PASS', [{ rule: 'contrato', severity: 'high', what: 'sql injection', path: 'db.js', line: 10, evidence: 'query(`… ${id}`)' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/contradicts the rubric/)
  })

  it('the finding names the rule it breaks', () => {
    const r = v('FAIL', [{ rule: 'manipulacion-tests', severity: 'high', what: 'debilitó una aserción', path: 'a.test.js', line: 12, evidence: '-  expect(x).toBe(3)' }])
    expect(r.verdict.findings[0].rule).toBe('manipulacion-tests')
  })

  it('a rule outside the enum discards the verdict', () => {
    // The same criterion that already applies to an invented ruling: a rule
    // that is not in VERDICT_RULES is not an unjustified finding, it is a datum
    // that is not understood — it is discarded and asked again, it is not an
    // error.
    const r = v('FAIL', [{ rule: 'me-lo-invento', severity: 'high', what: 'x', path: 'y', evidence: 'z' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/unknown rule/)
    expect(VERDICT_RULES).not.toContain('me-lo-invento')
  })

  // -------------------------------------------------------------------------
  // THE WALK THROUGH THE RUBRIC, measured in jjponz/rust-monitoring#10: the
  // three verdicts that travelled committed in that pull request were
  // `{"ruling": "PASS", "findings": []}` — exactly the artefact the rubric
  // itself declares indistinguishable from eight items nobody opened. The
  // rubric asked for the walk, but it asked for it in PROSE and for the
  // subagent's conversational answer, which is not persisted: nothing captured
  // it, and the schema that was validated and travelled was only
  // `{ruling, findings}`.
  //
  // And in that slice the empty PASS was the CORRECT result: four of the eight
  // items had no subject (a skeleton over an empty repo, with no patterns to
  // cite, no prior tests, no contracts). That is what hurts: it was correct and
  // nobody could know it by reading the file. That is why the walk is not an
  // informative field — it is the difference between "it did not apply" and "it
  // was not looked at", and the load is carried by the schema, not by the
  // prose.
  // -------------------------------------------------------------------------
  it('the verdict carries the walk through every item, and it travels inside it', () => {
    const r = v('PASS')
    expect(r.verdict.rubric.map((step) => step.rule)).toEqual(VERDICT_RULES)
  })

  it('the verdict that does not carry the walk is discarded: it is the file of the field run', () => {
    // rust-monitoring#10's literal payload. It used to be accepted; that it now
    // gets discarded is the whole fix.
    const r = readVerdict({ ruling: 'PASS', findings: [] })
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/walk of the rubric/)
  })

  it('a walk that names an item that is not of the rubric is discarded', () => {
    // The same criterion as an invented `rule` in a finding: an item that is
    // not in VERDICT_RULES is not a lax walk, it is a datum that is not
    // understood. It gets asked again.
    const walk = [...fullWalk().slice(1), { rule: 'me-lo-invento', result: 'bien', outcome: 'conforme' }]
    const r = v('PASS', [], walk)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/unknown item/)
  })

  it('a walk that repeats an item is discarded: one step too many is not one item more', () => {
    // One entry too many with every identifier present: without the check for
    // repeats, a count by set would take them all as walked and the duplicate
    // would pass. It is the same criterion readReport applies to a path
    // declared twice.
    const r = v('PASS', [], [...fullWalk(), { rule: 'alcance', result: 'otra vez', outcome: 'conforme' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/repeats/)
  })

  it('an incomplete walk is discarded, and the reason says which item is missing', () => {
    // Without naming the missing item, the discard costs a round trip and the
    // judge does not know where to come back to.
    const r = v('PASS', [], fullWalk().filter((step) => step.rule !== 'fixture-theater'))
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/fixture-theater/)
  })

  it("the discard's reason counts the items the rubric has today, not the ones it used to have", () => {
    // The message said "ocho" literally, and the ninth item turned it into a
    // lie aimed at precisely the agent that has to answer again.
    const r = v('PASS', [], fullWalk().filter((step) => step.rule !== 'test-desiderata'))
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/test-desiderata/)
    expect(r.why).toContain(String(VERDICT_RULES.length))
  })

  it('the item that is named but does not say what it gave is discarded: an empty text is the unopened item all over again', () => {
    // Eight identifiers with no result are the same artefact as the PASS with
    // empty findings, only longer.
    const walk = fullWalk().map((step) => (step.rule === 'patrones' ? { rule: 'patrones', result: '   ', outcome: 'conforme' } : step))
    const r = v('PASS', [], walk)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/patrones/)
  })

  // -------------------------------------------------------------------------
  // THE EMPTY YARDSTICK. The walk already told "it was not looked at" apart
  // from "it was looked at"; inside "it was looked at", two different things
  // went on collapsing together, and one of them is a hole: an item with no
  // SUBJECT (there are no prior tests to weaken) and an item with no INPUT (the
  // plan named no pattern at all). The second is a judge that said PASS
  // blindly, and in prose it reads just like the first. It is half of H5.
  // -------------------------------------------------------------------------
  it('every step of the walk says what class its result was', () => {
    const r = v('PASS')
    expect(r.verdict.rubric.every((step) => RUBRIC_OUTCOMES.includes(step.outcome))).toBe(true)
  })

  it('the step that does not say what class it was gets discarded: it is "N/A" indistinguishable from "conforme" all over again', () => {
    const walk = fullWalk().map(({ rule, result }) => ({ rule, result }))
    const r = v('PASS', [], walk)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/what class/)
  })

  it('an invented class is discarded, with the same criterion as an invented rule', () => {
    const walk = fullWalk().map((step) => (step.rule === 'patrones' ? { ...step, outcome: 'regular' } : step))
    const r = v('PASS', [], walk)
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/patrones/)
    expect(RUBRIC_OUTCOMES).not.toContain('regular')
  })

  it('an item with no yardstick travels in the verdict, and does not block: what it does is stop hiding', () => {
    // The rust-monitoring case, now legible. `patrones` with no pattern to cite
    // still gives a PASS —it is not a defect of the implementer's— but the file
    // now says that item was walked with nothing to measure against.
    const walk = fullWalk().map((step) => (
      step.rule === 'patrones'
        ? { rule: 'patrones', result: 'el plan dice "N/A": no hay patrón que comparar', outcome: 'sin-vara' }
        : step))
    const r = v('PASS', [], walk)
    expect(r.verdict.ruling).toBe('PASS')
    expect(r.verdict.rubric.find((step) => step.rule === 'patrones').outcome).toBe('sin-vara')
  })

  // -------------------------------------------------------------------------
  // THE CITATION. The rubric already demanded citing before blocking, but in
  // PROSE and in a file where it competes with eight items that genuinely have
  // to be walked. A mandatory field does not get forgotten.
  // -------------------------------------------------------------------------
  it('the finding that does not cite the evidence holding it up is discarded', () => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'la firma no casa', path: 'a.js', line: 3 }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/evidence/)
  })

  it('the citation is demanded on a medium too: that is the one that sends the implementer on a paid-for round trip', () => {
    // A field mandatory only for `high` gets forgotten just like the prose, and
    // a `medium` with no citation costs a there-and-back trip without saying
    // what to look at.
    const r = v('PASS', [{ rule: 'alcance', severity: 'medium', what: 'un helper que nadie pidió', path: 'a.js', line: 9 }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/evidence/)
  })

  // -------------------------------------------------------------------------
  // THE LOCATION, IN TWO FIELDS. It used to be the `"path:line"` string, and
  // what that prevented was aggregating: splitting a string a model wrote by
  // its last `:` is guessing. §3.13 of the handoff.
  // -------------------------------------------------------------------------
  it('the finding locates in two fields, and the verdict keeps them separate', () => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'la firma no casa', path: 'src/db.js', line: 10, evidence: 'function q(id, extra)' }])
    expect(r.verdict.findings[0].path).toBe('src/db.js')
    expect(r.verdict.findings[0].line).toBe(10)
  })

  it('the finding that does not say which file it is in gets discarded', () => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'la firma no casa', line: 10, evidence: 'z' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/does not say what or where/)
  })

  it.each([
    ['with no line', {}],
    ['with the line at null', { line: null }],
  ])('a whole-file finding holds %s: the line is not mandatory', (_case, extra) => {
    // Always demanding a line buys nothing but an invented number or one more
    // of the six discards that kill the run (§3.2 of the handoff).
    const r = v('FAIL', [{ rule: 'alcance', severity: 'high', what: 'este fichero no lo pide ninguna frase', path: 'src/de-mas.js', evidence: '**Files:** src/a.js', ...extra }])
    expect(r.verdict.findings[0].path).toBe('src/de-mas.js')
  })

  it.each([
    ['a string', '12'],
    ['a range', '12-18'],
    ['a zero', 0],
    ['a decimal', 3.5],
  ])('the finding whose line is %s gets discarded: what is not a number does not aggregate', (_case, line) => {
    const r = v('FAIL', [{ rule: 'contrato', severity: 'high', what: 'x', path: 'a.js', line, evidence: 'z' }])
    expect(r.verdict).toBeUndefined()
    expect(r.why).toMatch(/line that is not a number/)
  })

  // -------------------------------------------------------------------------
  // Slice 11 — THE PACKAGE'S TOKEN. The input was tied down (slice 6: a
  // consumed package cannot be reused); this ties down the other direction:
  // nothing bound the verdict.json TO the package. The package declares in its
  // header the sha256 of the diff it captured; the judge copies it into
  // `review_token`; and `readVerdict` demands that the field arrive shaped like
  // a sha256 — who decides whether it is THE PACKAGE'S is ct-step.mjs, which is
  // the one with git in front of it.
  // -------------------------------------------------------------------------
  it("the package's token is the sha256 of the diff it captures, and its line is written by the module", () => {
    const diff = 'diff --git a/uno.txt b/uno.txt\n@@ -0,0 +1 @@\n+uno\n'
    expect(reviewToken(diff)).toBe(createHash('sha256').update(diff, 'utf8').digest('hex'))
    expect(reviewTokenLine(reviewToken(diff))).toBe(`${REVIEW_TOKEN_LABEL}: ${reviewToken(diff)}`)
  })

  it("the token's reader cannot diverge from its writer: both come out of REVIEW_TOKEN_LABEL", () => {
    const t = reviewToken('lo que sea')
    expect(reviewTokenOf(`# Review package\n${reviewTokenLine(t)}\n\n## Diff\n`)).toBe(t)
  })

  it('a package with no such line, or with something that is not a sha256, declares no token at all', () => {
    expect(reviewTokenOf('# Review package\n\n## Diff\n')).toBeNull()
    expect(reviewTokenOf('Review token: no-soy-un-sha\n')).toBeNull()
    expect(reviewTokenOf(`Review token: ${'a'.repeat(63)}\n`)).toBeNull()
    expect(reviewTokenOf(null)).toBeNull()
  })

  // THE TOKEN IS WRITTEN BY THE PROGRAM (`ct-step verdict` injects it before
  // validating), so a verdict that does not carry it is NOT discarded: it is
  // accepted with the field at null, and who decides whether it binds to any
  // cut is ct-step, the only one that can read the package.
  it('a verdict with no review_token is accepted: the field is written by the program, not by the judge', () => {
    const r = readVerdict({ ruling: 'PASS', rubric: fullWalk(), findings: [] })
    expect(r.why).toBeUndefined()
    expect(r.verdict.review_token).toBeNull()
  })

  it('a review_token that is not a 64-hex sha256 gets discarded: it cannot be compared with anything', () => {
    for (const bad of ['12', 'a'.repeat(63), 'z'.repeat(64), 123]) {
      expect(readVerdict({ ruling: 'PASS', rubric: fullWalk(), findings: [], review_token: bad }).verdict).toBeUndefined()
    }
  })

  it('an upper-case review_token is accepted and stored in lower case: copying a hex is not typing a permission', () => {
    // The precedent is matchesGo: the token is compared in lower case so that a
    // reformat does not cost a discard with the correct verdict inside.
    const r = readVerdict({ ruling: 'PASS', rubric: fullWalk(), findings: [], review_token: 'A'.repeat(64) })
    expect(r.verdict.review_token).toBe('a'.repeat(64))
  })

  it('the review_token travels INSIDE the validated verdict: it is what gets committed and what gets compared', () => {
    expect(v('PASS').verdict.review_token).toBe(TOKEN)
  })

  it("review_token is NOT in the schema's required: it is the program's field, not the judge's", () => {
    expect(VERDICT_SCHEMA.required).not.toContain('review_token')
    expect(SLICE_VERDICT_SCHEMA.required).not.toContain('review_token')
    expect(VERDICT_SCHEMA.properties.review_token).toBeDefined()
  })

  it("the token's SHAPE is declared by ONE constant: the schema's pattern and the validator do not diverge", () => {
    // It is checked by BEHAVIOUR and not by comparing the constant with itself:
    // for every sample, what the schema's `pattern` accepts is exactly what
    // `readVerdict` accepts. If one of the two copies were changed —the most
    // likely one being putting the pattern in lower case— the upper-case sample
    // separates them and this falls.
    const pattern = VERDICT_SCHEMA.properties.review_token.pattern
    expect(SLICE_VERDICT_SCHEMA.properties.review_token.pattern).toBe(pattern)
    const re = new RegExp(pattern)
    // `undefined` and `null` are deliberately left out of the sample: the
    // schema treats them as an absent field (it is no longer `required`) and the
    // validator accepts them as the gap the program fills in, so they are not a
    // case of the token's SHAPE.
    for (const sample of ['a'.repeat(64), 'A'.repeat(64), 'aB3'.repeat(21) + 'f', 'a'.repeat(63),
                           'a'.repeat(65), 'z'.repeat(64), '', `${'a'.repeat(64)}\n`, ` ${'a'.repeat(64)}`]) {
      const schemaSaysSo = re.test(sample)
      const validatorSaysSo = readVerdict({ ruling: 'PASS', rubric: fullWalk(), findings: [], review_token: sample }).verdict !== undefined
      expect(validatorSaysSo, JSON.stringify(sample)).toBe(schemaSaysSo)
    }
  })
})

describe("from verdict to the table's result", () => {
  const o = (ruling, findings = []) => outcomeOfVerdict({ ruling, findings })

  it('FAIL is a veto', () => {
    expect(o('FAIL', [{ severity: 'high', what: 'x', path: 'y' }])).toBe('failed')
  })

  it('a clean PASS delivers', () => {
    expect(o('PASS')).toBe('done')
  })

  it('a PASS with findings of low severity only delivers just the same', () => {
    // If every triviality went back to the implementer, the loop would never
    // end.
    expect(o('PASS', [{ severity: 'low', what: 'nombre mejorable', path: 'a.js' }])).toBe('done')
  })

  it('a PASS with a medium finding is a grumble: it corrects, but it does not block', () => {
    expect(o('PASS', [{ severity: 'medium', what: 'falta un caso', path: 'a.test.js' }])).toBe('corrections-ordered')
  })
})

describe("the implementer's report", () => {
  it('it carries the paths it touched, which is what the program stages', () => {
    const paths = ['src/a.js', 'src/a.test.js']
    expect(readReport({ paths, summary: 'hecho' }).report.paths).toHaveLength(2)
  })

  it.each([
    ['an absolute path', ['/etc/passwd']],
    ['a path that leaves the worktree', ['../otro-repo/secreto.txt']],
  ])('it rejects %s: the list is written by a model, it is not trusted data', (_case, paths) => {
    const r = readReport({ paths, summary: 'hecho' })
    expect(r.report).toBeUndefined()
    expect(r.why).toMatch(/outside the worktree/)
  })

  it('a report with no paths is discarded instead of committing the index blindly', () => {
    expect(readReport({ summary: 'ya está' }).why).toMatch(/paths touched/)
  })

  // The same path twice used to DISCARD the whole report. Not any more: what
  // gets staged does not come out of this list but out of what the program
  // measures from the tree, so a duplicate leaves nothing undecidable — it is
  // counted once and it carries on. Discarding here cost a whole report, and one
  // of the six discards that kill the run, over a repetition that changes
  // nothing.
  it('the same path declared twice no longer discards the report: it is counted once', () => {
    const r = readReport({ paths: ['src/a.js', 'src/a.js'], summary: 'hecho' })
    expect(r.why).toBeUndefined()
    expect(r.report.paths).toEqual(['src/a.js'])
  })

  it("the report's schema asks for paths and summary, and nothing else", () => {
    expect(REPORT_SCHEMA.required).toEqual(['paths', 'summary'])
    expect(REPORT_SCHEMA.additionalProperties).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// REPORT_SCHEMA and VERDICT_SCHEMA are exported, but nothing executes them: the
// ones that really validate are readReport/readVerdict, hand-written further up
// in step-contracts.js. Without this test, the two schemas can diverge from the
// validator in silence — no suite notices until somebody reads the schema,
// believes what it says, and discovers that is not what is demanded.
//
// What IS tied down here: the REQUIRED each schema declares (at the root and in
// each array item) is exactly what the validator demands — removing any of
// those fields from an otherwise valid payload discards it.
//
// What is NOT tied down, and has to be said: both schemas declare
// `additionalProperties: false`, in the root object as well as in each item of
// paths/findings, and neither readReport nor readVerdict genuinely checks that
// no property is left over — an extra field passes today without either of the
// two noticing. Closing that gap means changing the validator, not adding a
// test, and it is not part of this fix.
// ---------------------------------------------------------------------------
describe('the declared schemas, tied to what really validates', () => {
  const validReport = () => ({
    paths: ['src/a.js'],
    summary: 'hecho',
  })
  const validVerdict = () => ({
    ruling: 'FAIL',
    rubric: fullWalk(),
    findings: [{ rule: 'contrato', severity: 'high', what: 'x', path: 'y', evidence: 'z' }],
    review_token: TOKEN,
  })

  it.each(REPORT_SCHEMA.required)('readReport demands "%s", as REPORT_SCHEMA.required declares', (field) => {
    const payload = validReport()
    delete payload[field]
    expect(readReport(payload).report).toBeUndefined()
  })

  it("every path in paths is a string, as the item's schema declares", () => {
    expect(REPORT_SCHEMA.properties.paths.items).toEqual({ type: 'string' })
  })

  it.each(VERDICT_SCHEMA.required)('readVerdict demands "%s", as VERDICT_SCHEMA.required declares', (field) => {
    const payload = validVerdict()
    delete payload[field]
    expect(readVerdict(payload).verdict).toBeUndefined()
  })

  it.each(VERDICT_SCHEMA.properties.findings.items.required)('every finding demands "%s", as the item\'s schema declares', (field) => {
    const payload = validVerdict()
    delete payload.findings[0][field]
    expect(readVerdict(payload).verdict).toBeUndefined()
  })

  it.each(VERDICT_SCHEMA.properties.rubric.items.required)('every step of the walk demands "%s", as the item\'s schema declares', (field) => {
    const payload = validVerdict()
    delete payload.rubric[0][field]
    expect(readVerdict(payload).verdict).toBeUndefined()
  })

  it("the walk's schema does not duplicate the identifiers: it takes them from VERDICT_RULES", () => {
    // Identity and not equality, on purpose. A second list with the same values
    // would pass a toEqual and would diverge on the first rename, which is the
    // failure this file already catches twice (JUDGE_TOOLS and VERDICT_RULES
    // against ct-judge.md).
    expect(VERDICT_SCHEMA.properties.rubric.items.properties.rule.enum).toBe(VERDICT_RULES)
  })

  it("the outcome's schema does not duplicate its three values either: it takes them from RUBRIC_OUTCOMES", () => {
    expect(VERDICT_SCHEMA.properties.rubric.items.properties.outcome.enum).toBe(RUBRIC_OUTCOMES)
  })

  it('the schema asks for the whole walk: not one step more, not one less', () => {
    expect(VERDICT_SCHEMA.properties.rubric.minItems).toBe(VERDICT_RULES.length)
    expect(VERDICT_SCHEMA.properties.rubric.maxItems).toBe(VERDICT_RULES.length)
  })
})

// The location is recomposed in a single place: the correction warning wants it
// in one piece, and the harvest will want it tomorrow.
describe("a finding's location, from two fields into one piece", () => {
  it('with a line it is `path:line`', () => {
    expect(findingLocation({ path: 'src/a.js', line: 4 })).toBe('src/a.js:4')
  })

  it.each([
    ['with no line', { path: 'src/a.js' }],
    ['with the line at null', { path: 'src/a.js', line: null }],
  ])('%s is just the file, which is what that finding says', (_case, f) => {
    expect(findingLocation(f)).toBe('src/a.js')
  })
})

// ---------------------------------------------------------------------------
// The commit message. The `commit-keyword-guard` hook is a PreToolUse over a
// SESSION's Bash tool: a `git commit` launched by a program does not go through
// that door, so the program looks at its own message.
// ---------------------------------------------------------------------------
describe('the message the program composes', () => {
  const msg = (name) => commitMessage({ issue: 42, task: 2, tasksTotal: 8, name })

  it('it names the task, the issue and how far along the slice is', () => {
    expect(msg('el cliente tipado de la API').split('\n')[0])
      .toBe('el cliente tipado de la API (#42, task 2/8)')
  })

  it("it NEVER carries a closing keyword, even if the task's name brings one", () => {
    // The name comes from the plan, that is, from an agent. In F27 a
    // documentation commit that MENTIONED "Closes #451" closed that issue.
    const m = msg('fixes #451 el parseo del carrito')
    expect(m).not.toMatch(/\bfixes\s*#\d+/i)
    expect(m).toContain('fixes issue 451')
  })

  it.each(['closes #1', 'resolved #99', 'Fixed #7'])('it defuses "%s" too', (keyword) => {
    expect(() => msg(keyword)).not.toThrow()
    expect(msg(keyword)).not.toMatch(/#\d+\b(?!, task)/)
  })

  it("the slice's own issue travels as a reference, not as a closing order", () => {
    expect(msg('una tarea')).toContain('(#42, task 2/8)')
  })
})

// ---------------------------------------------------------------------------
// Which model each subagent runs with. Omitting the model is not neutral: it
// inherits the session's, which is the most expensive one, and the implementer
// is the step dispatched most often in a run.
// ---------------------------------------------------------------------------
describe("each subagent's model", () => {
  const agentModel = (file) => {
    const m = /^model:\s*(.+)$/m.exec(readFileSync(file, 'utf8'))
    return m ? m[1].trim() : null
  }

  it.each([
    ['the task judge', JUDGE_AGENT],
    ['the slice judge', SLICE_JUDGE_AGENT],
    ['the reconciler', RECONCILER_AGENT],
    ['the advisor', ADVISOR_AGENT],
  ])('%s declares its model, it does not inherit the session\'s', (_, file) => {
    expect(agentModel(file)).toBe('opus')
  })
})

// ---------------------------------------------------------------------------
// THE ADVISOR (H9, `agents/ct-advisor.md`): the step the SECOND veto opens. Its
// answer is a JSON with an approach and the paths to reconsider, and what
// decides whether it is accepted is this schema — just as with the verdict, an
// advice that does not meet it is a DISCARD and gets asked again.
// ---------------------------------------------------------------------------
describe("the second veto's advisor", () => {
  const advisorAgentTools = () => {
    const m = /^tools:\s*(.+)$/m.exec(readFileSync(ADVISOR_AGENT, 'utf8'))
    return m ? m[1].trim() : null
  }

  const advicePackageSections = () => {
    const text = readFileSync(ADVISOR_AGENT, 'utf8')
    const paragraph = /- \*\*The advice package\.\*\*([\s\S]*?)\n\n/.exec(text)
    if (!paragraph) return []
    const normalized = paragraph[1].replace(/\s+/g, ' ')
    const regex = /`## ([^`]+)`/g
    const sections = []
    let m
    while ((m = regex.exec(normalized)) !== null) {
      const section = m[1].trim()
      if (!sections.includes(section)) sections.push(section)
    }
    return sections
  }

  const adviceFixture = (over = {}) => ({ approach: 'tíralo y empieza por el puerto', files_to_reconsider: ['src/uno.js'], ...over })

  it('the advisor cannot touch anything: it only reads', () => {
    expect(ADVISOR_TOOLS).toBe('Read')
    expect(advisorAgentTools()).toBe(ADVISOR_TOOLS)
  })

  it('an advice with an approach and paths is accepted, and repeated paths do not discard it', () => {
    const { advice, why } = readAdvice(adviceFixture({ files_to_reconsider: ['src/uno.js', 'src/uno.js'] }))
    expect(why).toBeUndefined()
    expect(advice.approach).toBe('tíralo y empieza por el puerto')
    expect(advice.files_to_reconsider).toEqual(['src/uno.js'])
  })

  it('an advice with no list of paths is accepted with the list empty: reconsidering none of them is an answer', () => {
    expect(readAdvice(adviceFixture({ files_to_reconsider: [] })).advice.files_to_reconsider).toEqual([])
  })

  it.each([
    ['with no approach', { approach: undefined }, /approach/],
    ['with an empty approach', { approach: '   ' }, /approach/],
    ['with the paths in prose', { files_to_reconsider: 'src/uno.js' }, /paths/],
    ['with a path that is not text', { files_to_reconsider: [7] }, /paths/],
  ])('an advice %s gets discarded, and the why names it', (_, over, reason) => {
    const { advice, why } = readAdvice(adviceFixture(over))
    expect(advice).toBeUndefined()
    expect(why).toMatch(reason)
  })

  it('an advice that names paths outside the worktree gets discarded', () => {
    expect(readAdvice(adviceFixture({ files_to_reconsider: ['/etc/passwd'] })).why).toMatch(/outside the worktree/)
  })

  it('with no structured_output there is no advice', () => {
    expect(readAdvice(null).why).toMatch(/structured_output/)
  })

  it('ADVICE_SCHEMA demands the two fields the program consumes', () => {
    expect(ADVICE_SCHEMA.required).toEqual(['approach', 'files_to_reconsider'])
    expect(ADVICE_SCHEMA.additionalProperties).toBe(false)
  })

  it('ADVICE_PACKAGE_SECTIONS cannot diverge from the headings the advisor cites by name', () => {
    expect(ADVICE_PACKAGE_SECTIONS).toEqual(advicePackageSections())
    expect(ADVICE_PACKAGE_SECTIONS).toEqual(['Brief', 'Intentos', 'Veredictos'])
  })

  it('the json block of ct-advisor.md shows the two fields and no others', () => {
    const schema = schemaOfAgent(ADVISOR_AGENT)
    expect(schema).toMatch(/"approach"/)
    expect(schema).toMatch(/"files_to_reconsider"/)
    expect(schema).not.toMatch(/"review_token"/)
  })
})
