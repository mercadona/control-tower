# Plan: Recover global verification after its telemetry commit

Address the two review findings on PR #503. Repository policy makes feature flags opt-in; this correction has no flag or parallel implementation.

### Slice 1 — Persist the telemetry commit before verification

- In `plugin/scripts/ct-step.mjs`, save the incremented `sliceCommits` immediately after a successful telemetry commit, before executing any global verification command.
- Add `an interrupted global verification resumes without losing or duplicating its telemetry commit` to `plugin/__tests__/ct-step-global-verification.test.js`: a verification command kills its own ct-step parent once, using an ignored run-directory marker. A fresh `next` and repeated `global` must succeed, the clean-tree predicate must hold, and the telemetry commit must be counted exactly once.
- Preserve the existing clean-tree, foreign-index, ignored-path, N/A and failed-command behavior. No modules are removed and no new architectural convention is introduced.
- Verification: `npx vitest run __tests__/ct-step-global-verification.test.js`. Demonstrate the new test failing before the production correction and passing afterwards.
- Commit the correction, test and planning documents together.

### Slice 2 — Account for telemetry in downstream assertions

- Update commit counts in `plugin/__tests__/ct-step-delivery.test.js`, `plugin/__tests__/ct-step-index.test.js`, `plugin/__tests__/ct-step-slice-judgement.test.js` and `plugin/__tests__/ct-step-verdict.test.js`.
- Update `sliceCommits` expectations for a successful slice verdict and a refused foreign index. Preserve assertions that unreviewed code and rejected verdicts are not committed.
- Verification: `npx vitest run __tests__/ct-step-delivery.test.js __tests__/ct-step-index.test.js __tests__/ct-step-slice-judgement.test.js __tests__/ct-step-verdict.test.js`, then `npm test` in `plugin/` and `npm test` in `backend/`.
- Run suites with an isolated temporary HOME and with inherited CT_STATE_DIR and CLAUDE_CONFIG_DIR unset, so they do not consult a live personal backend. Restore generated build artifacts only if verification rewrites them; they are outside this source correction.
- Commit the assertion updates and completed implementation log.

## Scope limits

The small crash window between Git creating the commit and saving its counter is not made transactional. The correction closes the long window occupied by verification commands. Telemetry failures still warn, and a foreign index is still left uncommitted. No rollout or production comparator is introduced.
