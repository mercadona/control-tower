# Global telemetry recovery: review specification

> Review layer for [plan.md](plan.md). Each slice names its verification; the plan adds execution detail.

## Summary

- Persist the telemetry commit count before global verification begins, so an interrupted verification can resume.
- Keep the existing clean-tree and foreign-index checks, and align downstream assertions with the additional commit.
- Verify with the real-process interruption regression, the affected suites, and the full plugin and backend suites.

## Flags and parallel change

| Flag | Purpose | Rollout | Retirement |
|---|---|---|---|
| None | Repository policy makes flags opt-in | Direct correction | Not applicable |

Slice 1 adds the regression and corrects persistence; slice 2 verifies downstream behavior. No shadow path or production comparator is introduced. Recovery must not create a second telemetry commit. The remaining crash window between Git commit and state persistence is outside this correction.

## Final architecture

```text
Before: global -> telemetry commit -> in-memory count -> verification -> save
After:  global -> telemetry commit -> count + save   -> verification -> save
```

Deleted modules: none. New conventions: none.

## Guaranteed behavior

The scenarios use the repository's required English documentation language.

```gherkin
Feature: Resume global verification
  Scenario: Interrupted verification retains its telemetry commit
    # Test: an interrupted global verification resumes without losing or duplicating its telemetry commit
    Given the tasks and reconciliation have completed
    When a global verification command terminates its ct-step parent once
    Then a fresh next invocation succeeds
    And global verification can resume with a clean-tree predicate
    And exactly one telemetry commit is counted
```

## Deliberately retained behavior

Changing these outcomes would be a separate contract change.

```gherkin
Feature: Preserve evidence handling
  Scenario: Foreign staged work is not committed
    # Test: a foreign path staged before global is not taken inside the telemetry commit: nothing is committed and §8 sees the dirty tree
    Given a foreign path is staged before global verification
    When global verification runs its clean-tree predicate
    Then no telemetry commit is created
    And the dirty-tree verification fails

  Scenario: Ignored telemetry does not introduce a commit
    # Test: with the telemetry path gitignored nothing is pending: no commit, no warning, and the verification runs unchanged
    Given the telemetry path is ignored
    When global verification runs
    Then verification proceeds without a telemetry commit
```

## Equivalence oracles

Slice 1 runs all of `ct-step-global-verification.test.js`, including N/A and failed-command cases. Slice 2 preserves the delivery, foreign-index, PASS, FAIL and discarded-verdict assertions while accounting for the telemetry commit. Full `npm test` in `plugin/` and `backend/` checks integration. There is no production comparator.

## Slices and execution

| # | Slice | Deliverable | Tests | Verification |
|---|---|---|---|---|
| 1 | Persist the telemetry commit before verification | Immediate state save and recovery regression | Plan slice 1 | `npx vitest run __tests__/ct-step-global-verification.test.js` |
| 2 | Account for telemetry in downstream assertions | Correct counts with existing safety assertions preserved | Plan slice 2 | `npx vitest run __tests__/ct-step-delivery.test.js __tests__/ct-step-index.test.js __tests__/ct-step-slice-judgement.test.js __tests__/ct-step-verdict.test.js`; `npm test` in `plugin/` and `backend/` |

Acceptance: the implementation's tests must match those named in the plan. Both slices are executed in this session.

## Deferred changes

Transactional persistence across Git and the run file is outside scope.

## Review reservations

The new regression covers interruption inside verification, after the commit and state save. It does not simulate disk failure during the save or a crash between Git commit and save.
