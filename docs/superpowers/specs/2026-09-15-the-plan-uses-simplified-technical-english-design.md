# The plan uses Simplified Technical English

## The problem

`writing-plans-prescriptive` decides the structure of a slice plan, the taxonomy of its code
blocks and the literality of its citations, and `plan-contract.js` measures all three. Nothing
decides how the plan's **prose** reads. So a plan arrives with 33-word sentences, passive voice
("the file is read by the analysis"), gerund chains and a vocabulary that changes word between
Task 2 and Task 6 — "verify", "check" and "validate" for the same act.

That prose is not decoration. It is what the implementer reads as its task brief, what the judge
blocks against, and what a human approves at the `plan` gate. A long passive sentence hides who
does what, which is exactly the information a zero-context subagent needs.

ASD-STE100 (Simplified Technical English) is the aerospace standard for that problem: one word
per meaning, active voice, short sentences, one instruction per sentence. It was designed for
readers who must act on a text without asking its author — the same reader this plan has.

## The decision

Every slice plan is written in ASD-STE100, and `dispatch-check --check-plan` measures it. A plan
whose prose breaks the rule does not pass the gate, so it never reaches the human and never
reaches the implementer. The rule is machine-checked, not advisory: "always" means a gate, not a
sentence in a skill.

`--release` runs the same check later, so the rule also holds for the plan as committed.

Four things are now non-negotiable and machine-checked in a plan: the fixed structure, the
literality rule, the block taxonomy, and the language.

## What the rule measures

### The seam

A new module, `plugin/scripts/plan-ste.js`, exports one pure function:

```
steViolations(lines) -> string[]
```

`lines` is the array `annotate` already builds inside `plan-contract.js`: one object per line of
the plan, with `.line` and `.structural`. The module receives the whole annotated plan, so it
finds §8 and the task markers by itself. It reads no files and takes no ports; its test needs
neither a repo nor a disk.

`validatePlan` gains four lines, next to the rules it already runs:

```
for (const detail of steViolations(lines)) push('ste', detail)
```

One rule name, `ste`. The sub-rule travels inside the detail, so the gate's message teaches what
to fix and the tests can filter one bucket.

### Where it looks

Only lines that `annotate` marks `structural`. Code blocks are out whole: verbatim citations,
contracts, call sites, final text and command blocks are never measured. A plan may quote a file
whose content breaks every rule of the standard.

Of the structural lines, these are dropped before anything is measured:

- blank lines;
- headings — `^#{1,6} `;
- role label lines — `Current state (…):`, `Contract (…):`, `Call site (…):`, `Final text (…):`;
- table separator rows — `^\|[\s:|-]+\|$`.

What survives is transformed, in this order:

1. a blockquote marker `^>\s?` is removed;
2. a list marker `^\s*([-*+]|\d+\.)\s+` is removed;
3. a markdown link `[text](url)` becomes `text`;
4. an inline code span `` `…` `` becomes one token;
5. a bare URL, and any token that carries a slash, becomes one token;
6. emphasis markers `**`, `*` and `_` are removed.

Step 4 and step 5 are what keep `--check-plan` and `server/src/analysis/git.ts` counting as one
word each.

### Paragraphs, not lines

Markdown prose in this repository wraps at about 100 characters, so a sentence normally spans two
or three lines. Measuring line by line would split sentences at the wrap and under-count every
one of them.

So the module first groups the surviving lines into **paragraphs**: a run of consecutive measured
lines with no blank line and no structural break between them (a heading, a fence, a table
separator or a role label ends the run). It joins each run with a single space, then splits the
joined text into sentences on `.`, `!` or `?` followed by whitespace or the end of the text. A
period between two digits does not split.

A table row is its own paragraph: the row is split on `|` and each non-empty cell becomes one
sentence.

### The six sub-rules

| Sub-rule | What fails |
|---|---|
| `length` | A sentence carries more words than its limit |
| `paragraph` | A paragraph carries more than 6 sentences |
| `passive` | A form of `be` is followed by a past participle |
| `gerund` | An `-ing` word opens a sentence, or follows a preposition directly |
| `word` | A word or phrase of the non-approved list appears |
| `one-sentence` | A paragraph that starts with `**Objective:**` carries more than one sentence |

**The two limits of `length`.** The standard allows 20 words in a procedural sentence and 25 in a
descriptive one. The gate classifies by position, never by meaning:

- 20 words in a paragraph that starts with a task marker — `**Objective:**`, `**Files:**`,
  `**TDD:**`, `**Tests:**` or `**Verification:**` — and in every paragraph between
  `## 8. Global verification` and `## 9. Assumptions`;
- 25 words everywhere else.

The marker itself is removed before the words are counted, so `**Objective:**` does not spend one
of the 20. The paragraph keeps its limit all the same: the marker is what chose it.

**A test name travels inside backticks.** `**TDD:**` carries a literal name such as
`it('the header is read before the body')`, and that name belongs to the test, not to the plan's
prose. Inside backticks it becomes one token and the gate leaves it alone. Outside them it fires
`passive` for a name the author is not free to reword.

**How `passive` decides.** A be-form (`is`, `are`, `was`, `were`, `be`, `been`, `being`, `am`)
followed by a past participle: a word that ends in `-ed`, or a word of the irregular list. At
most two tokens may stand between them, and each one has to be an adverb — a word ending in
`-ly`, or one of `not`, `never`, `already`, `also`, `only`, `then`, `now`, `still`, `always`.
That guard is what stops "it is a written plan" from firing: `a` is not an adverb, so the chain
breaks.

**How `gerund` decides.** A token that ends in `-ing` fires in two positions only: first token of
a sentence, or immediately after one of `by`, `for`, `of`, `after`, `before`, `without`, `when`,
`while`, `on`, `in`, `at`, `from`, `with`. Adjacency is required, so "of the following" does not
fire. Tokens of the `-ing` exception list never fire.

### The three lists

All three live in `plan-ste.js` and are exported. If they pass about 100 lines together, they
move to a file of their own.

**The non-approved list** starts with 48 entries, each with its approved replacement, which
the gate's message names: `utilize → use`, `prior to → before`, `subsequent to → after`,
`in order to → to`, `due to → because of`, `as well as → and`, `via → with`,
`ensure → make sure`, `obtain → get`, `commence → start`, `terminate → stop`, `attempt → try`,
`assist → help`, `provide → give`, `approximately → about`, `additional → more`,
`numerous → many`, `however → but`, `therefore → so`, `thus → so`, `hence → so`,
`whilst → while`, `regarding → about`, `concerning → about`, `in terms of → for`,
`with respect to → about`, `with regard to → about`, `leverage → use`, `facilitate → help`,
`initiate → start`, `finalize → finish`, `indicate → show`, `require → need`, `comprise → have`,
`in the event that → if`, `at this point in time → now`, `a number of → some`,
`the majority of → most`, `it should be noted that → remove it`, `please note → remove it`,
`e.g. → for example`, `i.e. → that is`, `etc. → name the items`, `alternatively → or`,
`furthermore → also`, `moreover → also`, `nevertheless → but`, `per → for each`.

**Two kinds of word never enter that list.**

1. A value a contract fixes. `create` and `modify` are the two words `**Files:**` is written
   with; `modify` on the list would fail every plan ever written. The task markers, the parsed
   headings of `CLAUDE.md` and the GitHub labels of the ladder are the same case.
2. The repository's ubiquitous language. `dispatch`, `harvest`, `slice`, `judge`, `gate`,
   `yardstick` and what `docs/glossary.md` fixes are domain terms, and the standard allows a
   project's own technical vocabulary. A term translated two ways is worse than a term left
   alone.

**The irregular participle list** carries the forms `-ed` does not catch: `written`, `built`,
`run`, `made`, `done`, `taken`, `given`, `seen`, `known`, `shown`, `held`, `kept`, `left`,
`read`, `sent`, `set`, `put`, `lost`, `found`, `told`, `said`, `brought`, `bought`, `caught`,
`taught`, `thought`, `chosen`, `driven`, `spoken`, `broken`, `frozen`, `grown`, `drawn`,
`thrown`, `torn`, `worn`, `begun`, `become`, `come`, `gone`, `been`, `had`.

**The `-ing` exception list** carries the words that end in `-ing` and are not verb forms:
`during`, `string`, `strings`, `nothing`, `something`, `anything`, `everything`, `thing`,
`things`, `according`.

### What the message says

One line per violation, in the shape the other rules of this validator already use: the line
number, the sub-rule, the offending text and what to do.

```
line 42: length — the sentence "The analysis is read by …" carries 31 words and the limit here is 25. Split it.
line 51: word — "prior to" is not an approved word. Write "before".
line 63: passive — "is executed" is passive. Name who executes, and write it active.
```

## The template and the skill

**`plan-template.md`.** The fixed blockquote is rewritten in ASD-STE100, and with it the constant
`BLOCKQUOTE_MARKER` of `plan-contract.js:24`. Today's marker sentence — *"This plan is written to
be executed by task-scoped subagents"* — is passive twice, so no compliant sentence can contain
it. The new marker is *"Task-scoped subagents execute this plan"*: six words, active, and still
distinctive as an anchor.

Nobody runs the loop yet, so no committed plan is stranded by that change, and the alternative
cost is permanent: a list of exemptions inside `plan-ste.js`, and a template that breaks the rule
it teaches.

Every `{{…}}` guidance line of the template is rewritten in ASD-STE100 too. The template is what
the author copies, so it is where the rule is learned.

**`SKILL.md`.** A new section, *The plan uses Simplified Technical English*, carries the six
sub-rules, the two limits, one before/after example and the path of the lists. The opening line
that says "Three things are non-negotiable and machine-checked" says four. Steps 5 and 7 already
run `--check-plan` in a loop, so the skill gains no step.

That new section is itself written in ASD-STE100, so it demonstrates the rule. The other 269
lines of `SKILL.md` stay as they are: the skill is not a plan, and rewriting that prose is a
different piece of work.

## Testing

**`plugin/__tests__/plan-ste.test.js`** — one test per sub-rule, each with the case that fails and
the neighbouring case that passes (19 words pass where 21 fail, "is a written plan" passes where
"is written" fails). Plus four seam tests:

- a code block is never measured;
- a backticked path counts as one word;
- a sentence that wraps across two lines is measured whole;
- the `word` message names the approved replacement.

**`plugin/__tests__/plan-contract.test.js`** — one wiring test: a plan with a 31-word sentence
yields a violation whose rule is `ste`. And the fixtures whose prose now breaks the rule get
fixed; at least one does today — *"And it is checked like this:"* is passive.

**The loop closes on the template.** `steViolations` over `plan-template.md` returns an empty
list. That test is what stops the template from teaching what the gate forbids.

## Out of scope

- The full approved dictionary of the standard, about 900 words, as a whitelist. The list here is
  a blacklist that grows when the gate meets a new word.
- The prose of `SKILL.md` outside the new section, and the prose of the other skills.
- The eight documents of `plugin/conventions/`. Binding the judge to the language rule is a
  separate decision, and the plan gate is enough for the plan.
- Spanish product copy. The rule covers the plan, which is English by `CLAUDE.md`.
- The historical plans of `docs/superpowers/plans/`. `checkPlans` only reads the plan of the issue
  being released, so no past plan is measured.

## Assumptions

1. **`plan-ste.js` is JavaScript, not TypeScript.** `backend/conventions/this-repository.md:25`
   binds `backend/` only, and its line 44 says everything the backend reads out of `plugin/` "is
   JavaScript and stays JavaScript". `plugin/` has no build and no typecheck. Provenance: repo
   convention.
2. **One rule name, `ste`, with the sub-rule inside the detail.** The existing rules are single
   words (`title`, `sections`, `roles`, `budget`, `literality`), and "the plan is not in STE" is
   one class of finding. Provenance: own call.
3. **The 20/25 split is decided by position, never by meaning.** A marker paragraph and §8 are
   procedural; everything else is descriptive. Provenance: own call, so that the classification
   is mechanical.
4. **A false positive costs one rewrite, not a blocked slice.** The planning agent runs
   `--check-plan` in a loop and rewords the sentence. That is why `passive` and `gerund` are
   measured at all, and why there is no escape marker. Provenance: own call.
5. **This spec is written in plain English, not in ASD-STE100.** The rule binds the plan, which
   the gate measures. Provenance: own call.
