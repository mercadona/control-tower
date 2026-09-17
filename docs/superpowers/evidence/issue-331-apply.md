# Issue #331 — Apply evidence

The apply gate remains a human decision. This dossier records an isolated rehearsal
of the headless dispatcher using scripted external boundaries.

## Rehearsal boundary

Revision `fbf80b1c7726dcd2bb0325a075502bf83cbffab2` was the checked-out revision
when the rehearsal was executed. The test creates a root named
`ct-331-headless-rehearsal-*` under the operating system's temporary directory
and removes it after every result. It makes one HTTP `POST /start-plan` request
with `{"milestone":"Headless delivery"}` through the real route,
`StartMilestonePlan`, `HeadlessPlanAgents`, `ContinuePlan`, and the production
candidate, claim, git-workspace, call-record, publication and recovery adapters.

The only scripted boundaries are GitHub, git, node-worker spawn and process
completion. Each GitHub, git and node command is accepted only when its full
argv and relevant cwd match the declared request. Mutations of the plan-check
issue, plan-check cwd, committed-plan path and comment issue were exercised and
rejected as unlisted commands. No Claude or network call, real issue claim,
real worktree, issue comment or pull request was made.

The observed trace was:

1. `dispatch-check` claim.
2. The actual `.agent/SLICE.md` write, after worktree preparation.
3. Immutable dispatch, planner prompt and planner descriptor present before the planner worker spawn.
4. Complete committed-plan comment publication.
5. Immutable implementation prompt and descriptor present before the resumed worker spawn.

The route answered 202 with issue 331, branch `feat/331`, the temporary
worktree and conversation `11111111-1111-4111-8111-111111111111`. The test
stopped at accepted implementation continuation. It did not fabricate a
successful resume or claim successful implementation.

At the first worker spawn, the rehearsal read the written seed and asserted its
`feat/331` branch, `main` base, 40-hex cut, GitHub issue 331 and measured green
`npm test` baseline. The seed trace is emitted by that write seam, not by the
earlier scripted `git worktree add` response; deleting the production seed
write therefore makes the rehearsal fail before planner acceptance.

## Durable evidence

Planning replayed the committed
`backend/__tests__/infrastructure/fixtures/claude-result-initial.jsonl` fixture
through `ClaudeCallResult`. It retained reported total USD `0.4208795`, one
turn and CLI duration 7071 ms, separately from the scripted measured wall
duration of 9000 ms. The publication body was asserted in full, including its
digest, source path and complete plan text.

A pre-existing `docs/superpowers/metrics/issue-331.jsonl` attempt file was read
before and after dispatch and recovery with byte-identical content. #331 does
not append a headless call as another task attempt. #332 owns per-step call
attribution and ingestion into existing attempt rows.

A new recovery graph then read the dispatch and both call descriptors with no
owned process. It recovered the same conversation UUID as `uncertain` because
the accepted implementation call had no completion, and its spawn boundary was
not invoked. Cleanup published a deliberately unavailable completion, released
the pending poll, observed the supervised failure and removed the temporary
root; no pending wait, child or fixture remained. `BoundedDrain` gives the
accepted-continuation wait and the supervised-diagnostic drain explicit 1000 ms
bounds. The HTTP `fetch` itself has no explicit abort signal or deadline; its
status is checked before the continuation wait so an early non-202 response does
not wait for a supervisor that was never installed. An unconditional `finally`
stops the server and removes the root even when setup, the first spawn assertion
or the HTTP request fails before supervision exists; cleanup waits for a
diagnostic only after the implementation spawn proves supervised work exists.

## Capture limits

The three committed captures and their provenance are:

- `backend/__tests__/infrastructure/fixtures/claude-result-initial.jsonl`: initial success.
- `backend/__tests__/infrastructure/fixtures/claude-result-resumed.jsonl`: resumed `error_max_budget_usd`.
- `backend/__tests__/infrastructure/fixtures/claude-result-turn-limit.jsonl`: `error_max_turns`.
- `docs/superpowers/evidence/issue-331-cli-captures.md`: source/report distinctions and omissions.

The resumed capture reports total USD `1.051838`, one turn and CLI duration
4876 ms. Its reported total exceeded the supplied `0.50` budget option, so no
enforced spending-ceiling claim is made. Its terminal usage is zero while the
preceding captured assistant event had nonzero usage. There is no successful
resume capture. A resumed reported total has `unverified-resume` attribution
and attributable cost remains `null`; it is not an incremental bill and must
not be summed, differenced or replaced by token pricing. CLI duration and wall
duration remain different measurements.

## Verification

From `backend/`:

```text
npm run typecheck
PASS

npm test -- __tests__/infrastructure/headless-dispatch-dry-run.test.ts __tests__/conventions-no-restatement.test.ts
PASS — 2 files, 7 tests

npm test -- __tests__/infrastructure/claude-calls.test.ts __tests__/infrastructure/claude-calls-real-process.test.ts __tests__/infrastructure/recorded-plan-recovery.test.ts __tests__/infrastructure/headless-plan-agents.test.ts __tests__/application/request-fixes.test.ts
PASS — 5 files, 39 tests
```

The lifecycle set covers descriptor-before-spawn, immutable-write conflicts,
worker acceptance loss, missing completion uncertainty, timeout escalation,
real-process output and deadline ownership, restart projection, supervised
continuation cleanup, and reopen-before-original-conversation fix ordering.
These are local process/fixture checks, not a live rollout.

## Apply status

The apply gate is **HUMAN / OPEN**. This evidence does not close it and does not
claim a production rollout. The remaining accepted limitation is the absence of
verified attributable cost for resumed calls. #332 remains responsible for
backend-driven per-step execution and evidence-based per-step attribution.
