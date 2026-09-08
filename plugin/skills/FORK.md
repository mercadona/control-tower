# Fork of superpowers — origin and seams

The skills in this directory (except `state-template` and
`writing-plans-prescriptive`, which are our own) are a
fork of **superpowers 6.0.3** (Jesse Vincent, MIT — see
[LICENSE-superpowers](./LICENSE-superpowers)), taken from the local cache
`~/.claude/plugins/cache/claude-plugins-official/superpowers/6.0.3/` on
2026-08-07 (F32). They are invoked as `control-tower-loop:<name>`.

## Scope

**Forked (11)** — the ones really used according to the sweep of 2,704
transcripts of F31 §5: brainstorming · executing-plans ·
finishing-a-development-branch · receiving-code-review ·
subagent-driven-development · systematic-debugging · test-driven-development ·
using-git-worktrees · verification-before-completion · writing-plans ·
writing-skills.

**Discarded, and why:**

- `dispatching-parallel-agents` (0 uses): CT occupies its gap between slices,
  with real isolation; inside the slice the design is sequential on purpose.
- `requesting-code-review` (0 direct invocations): its only real consumption
  was `code-reviewer.md` as a file from subagent-driven-development — that
  file now travels INSIDE `subagent-driven-development/`.
- `using-superpowers` (meta-skill of the upstream installation): the plugin
  itself plays its role.
- `frontend-design` (2 uses): it exists standalone.

## The rewritten seams (F31 §5 and F-jjponz) — do NOT step on them in cherry-picks

1. **brainstorming**: the terminal state is NO longer invoking writing-plans — it
   is writing the execution spec (`docs/superpowers/specs/*-execution.md`, DRAFT,
   provenance per decision) and asking for the freeze (15 lines). The design doc
   is kept as `Handoff origen:`.
2. **subagent-driven-development**: the "no plan" branch NO longer sends you to
   brainstorm — it sends you to write the plan now with writing-plans, scoped to
   the issue.
3. **finishing-a-development-branch**: new step 0 — if `.agent/SLICE.md` exists
   (a CT dispatch) there is no menu: PR + `--release` + STOP.
   The merge is human.
4. **subagent-driven-development** (second seam over the same file,
   F-jjponz-1): the "no plan" branch no longer sends you to writing-plans but to
   `writing-plans-prescriptive` — a skill OF OUR OWN (it does not exist
   upstream), with a mechanical contract in `scripts/plan-contract.js` and a hard
   gate in `--release`. A cherry-pick from upstream that restores writing-plans
   here disarms the gate: `skills-fork.test.js` watches it (costura 4).
5. **subagent-driven-development** (third seam over the same file,
   F-jjponz-4): model selection took for granted that the task carried the
   complete code —"when the task's plan text contains the complete code to
   write, the implementation is transcription plus testing: use the cheapest
   tier"— and since the plan carries contracts and not bodies that is false for
   EVERY task: it would route to the cheapest tier precisely the link that now
   writes the code. The floor becomes the mid tier for every implementer, and
   the cheap tier is left for mechanical one-file fixes. A cherry-pick that
   restores the shortcut brings the regression back: `skills-fork.test.js`
   watches it (costura 5).
6. **test-driven-development** (F39): `prompts/task-implementer.md` no longer
   carries the cycle written inside it — it loads
   `control-tower-loop:test-driven-development`. From here on, a cherry-pick from
   upstream over that skill changes the behaviour of `ct-step`'s implementer,
   which used to be immune. The fork was taken from 6.0.3; check what changed in
   the cycle before bringing it in. `skills-fork.test.js` watches it (costura 6).

A mechanical rewrite in all of them: the upstream namespace `superpowers:`
became `control-tower-loop:`, and the references to
`../using-superpowers/references/` and to `../requesting-code-review/` were
removed or repointed.

## Cherry-picks from upstream

Compare against 6.0.3 (the local cache or the upstream tag), bring the diff, and
re-apply the seams if the diff touches them. `__tests__/skills-fork.test.js`
watches the seams and watches that no reference to the old namespace survives:
if a cherry-pick breaks it, the test says so.
