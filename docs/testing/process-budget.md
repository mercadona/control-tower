# Process budget

Issue: [#418](https://github.com/mercadona/control-tower/issues/418). This inventory distinguishes decisions to migrate from external mechanisms that must remain real. A marked filename is a selection mechanism, not permission for redundant process calls.

## Measurement

Baseline: `c67db23c`, macOS arm64, Node `v24.21.0`, plugin Vitest `5.0.0`, backend Vitest from its lockfile. Each package ran independently with default worker configuration, installed lockfile dependencies, and the JSON reporter. Backend `node-pty` was rebuilt under Node 24 before taking the valid baseline. The initial Node 25 ABI mismatch report is discarded as a timing comparison, not reported as a product failure.

| Suite / family | Files | Cases | Summed file seconds | Observed report span seconds |
|---|---:|---:|---:|---:|
| Plugin | 159 | 4372 | 3200.440 | 418.789 |
| ct-step, including e2e | 14 | 199 | 1497.614 | — |
| ct-next | 13 | 196 | 297.681 | — |
| ct-groom | 7 | 206 | 223.437 | — |
| dispatch-check | 6 | 75 | 126.835 | — |
| ct-init | 3 | 125 | 331.053 | — |
| ct-watch | 2 | 34 | 27.522 | — |
| distribution checker | 1 | 10 | 40.385 | — |
| Plugin remainder | 113 | 3527 | 655.912 | — |
| Backend | 113 | 2386 | 113.199 | 43.040 |
| ct-api | 1 | 19 | 42.290 | — |

Both valid baselines passed without skipped cases. The observed span runs from reporter start to the last file end, not installation or build time. Summed file duration includes parallel overlap; it is not elapsed time or an isolated measurement of V8 startup.

Run from each package:

```sh
npx --yes --package=node@24 -- node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=<absolute-report-path>
```

From the repository root, summarize with:

```sh
node docs/testing/measure-suite.mjs <absolute-report-path> <plugin-or-backend> summary
node docs/testing/measure-suite.mjs <absolute-report-path> <plugin-or-backend> inventory
node docs/testing/measure-suite.mjs <absolute-report-path> <plugin-or-backend> cases
```

The inventory mode reports direct imports and recursive test-helper imports, including unmarked consumers of a spawning harness. It is a candidate census, not runtime proof: imported process APIs may be used only to arrange or may be injected doubles; conversely production code can launch on behalf of an importing test. Final marker enforcement therefore also requires the runtime check planned for Slice 9.

## Conversion ownership

Paths below are relative to `plugin/__tests__/`. Every listed file retains its behavioral cases until their replacement is measured. Family globs are only shorthand for the exact names listed here.

| Slice | Files | Boundary / disposition |
|---|---|---|
| 3–4 | `ct-step-advice`, `ct-step-amendment`, `ct-step-delivery`, `ct-step-dispatch-seal-real-process`, `ct-step-global-verification`, `ct-step-index`, `ct-step-merge-base`, `ct-step-oracle`, `ct-step-package`, `ct-step-plan-and-checks`, `ct-step-slice-judgement`, `ct-step-verdict`, `ct-step-yardstick-and-telemetry`, `e2e-ct-step` | `.test.js`; migrate decisions and shared `fixtures/ct-step-harness.js`; retain independent actual Git commit/index/trailer and script-format evidence. |
| 5 | `ct-next-base`, `ct-next-baseline`, `ct-next-claim`, `ct-next-conventions`, `ct-next-dryrun`, `ct-next-exit-code-contract`, `ct-next-honest-messages`, `ct-next-launch-verification`, `ct-next-preconditions`, `ct-next-signal-interrupt`, `ct-next-signal-killed-claim`, `ct-next-staleness`, `ct-next-watch-go` | `.test.js`; migrate dispatch decisions; retain focused OS-signal/checkpoint and launch mechanism evidence. |
| 6 | `ct-groom-decisions`, `ct-groom-dryrun`, `ct-groom-freeze-gate`, `ct-groom-labels-gate`, `ct-groom-reconcile`, `ct-groom-spec-link`, `ct-groom-status-vocabulary`, `e2e-groom-aborts` | `.test.js`; strict GitHub conversations and real spec files. |
| 7 | `dispatch-check-collect-bq-real-process`, `dispatch-check-collect`, `dispatch-check-dryrun`, `dispatch-check-merge-base`, `dispatch-check-truncation`, `dispatch-check-watch-merge`, `dispatch-guard-real-process`, `dispatch-integration-seams`, `e2e-release-correspondence`, `session-start`, `stop` | `.test.js`; callable command/hook decisions, retained bundled entry checks. |
| 8 | `ct-init`, `ct-init-conventions-seed`, `ct-init-dispatch-contract` | `.test.js`; Bash remains real, one immutable result per distinct scenario; preserve historical provenance. |
| 9 | `ct-status`, `ct-watch-go`, `ct-watch-merge`, `ct-harvest-bq-real-process`, `ct-harvest-real-process`, `ct-harvest-schema`, `judge-bench-real-process` | `.test.js`; remaining command seams, strict tool conversations, controllable polling. |
| 9 | `conventions-output`, `conventions`, `yardstick-candidates`, `e2e-agents-md`, `task-brief`, `run-metrics`, `loop-states` | `.test.js`; separate pure readers from executable/seed/history consumers; retain independent Bash parsing oracle. |
| 9, using seams from 5–7 | `f15-field-loose-ends`, `f16-channel-and-blockers`, `f17-issue-closure`, `f18-bounded-reads`, `f18-what-disappears`, `f19-verify-the-start-up`, `f20-no-typing`, `f21-gate-and-type`, `f22-slice-state`, `f26-inherited-context`, `f27-closing-keywords`, `f27-commit-keyword-guard`, `f35-account-resolution-removed`, `f38-the-plan-gate-go` | `.test.js`; cross-command historical regressions must name their corresponding invocation/adapter oracle before moving. |
| 10 | `dist-matches-sources.test.js` | Preserve every checker case in the existing required distribution job. |

Residual ordering after the ct-step pilot: watchers/status; harvest/BQ; convention/yardstick and shell helpers; cross-command historical regressions; complete census/fast-lane enforcement. Re-measure before scheduling those merge units.

## Retained mechanism budget

These are reasons for retaining a real boundary, not final accepted counts. The final inventory must include newly added edge/runner cases and the remaining Bash scenarios.

| Package | Current file / planned boundary | Current cases | Why the mechanism stays real |
|---|---|---:|---|
| backend | `tool-runner-real-process.test.ts` | 12 | Actual process invocation, failures, output, cwd/env and timeout. |
| backend | `tool-runner-whole-output-real-process.test.ts` | 2 | Actual large-output collection. |
| backend | `claude-calls-real-process.test.ts` | 3 | Detached worker ownership and deadline/process-group termination. |
| backend | `claude-conversations-real-process.test.ts` | 1 | Shell interpretation of paths with spaces. |
| backend | `git-workspace-real-process.test.ts` | 5 | Real worktree removal. |
| backend | `pty-live-sessions-real-process.test.ts` | 10 | Native PTY and process ownership mechanics changed in #413. |
| backend | `session-channel-real-process.test.ts` | 3 | Retain only channel-specific native evidence not already proved below it. |
| backend | `ct-api-real-process.test.ts` | 19 before conversion | Reduce wiring cases only after composition coverage; preserve executable/port edge and independently justified new lifecycle mechanics. |
| backend | `yardstick-real-process.test.ts` | 1 | Real repository/tool boundary. |
| plugin | `baseline-real-process.test.js` | 3 | Shell command execution itself. |
| plugin | `cmux-real-process.test.js` | 2 | Tool invocation boundary. |
| plugin | `branch-reconciliation-production-real-process.test.js` | 4 | Real merge/history/marker interpretation. |
| plugin | `branch-reconciliation-real-process.test.js` | 2 | Actual Git conflict-marker queries. |
| plugin | `branch-reconciliation-unreadable-base-real-process.test.js` | 3 before split | Keep the actual Git case; move two doubled decisions into the ordinary suite. |
| plugin | `plan-section-real-process.test.js` | 8 | Actual Bash/awk versus JavaScript parsing; source baseline differs from the issue's older count. |
| plugin | New `process-runner-real-process.test.js` | Planned | Timeout, absent binary, output and runtime option behavior. |
| plugin | New `ct-step-commit-real-process.test.js` | Planned | Actual staged paths, commit trailer production and parsing, mixed history refusal. |
| plugin | One happy-path executable check per migrated entrypoint | Planned | Supported path, argv parsing, stdout and exit-code wiring. |
| plugin | Focused ct-next signal/checkpoint test | Planned | OS delivery and poll-phase yielding cannot be proved by a cancellation double. |
| plugin | ct-init scenarios | Pending Slice 8 | The initializer is Bash; preserving its behavior requires executing it. |
| plugin | Distribution checker | 10 | Required committed-source/bundle equivalence and negative checker cases. |

Backend tests importing process-capable infrastructure (`api-server`, `claude-calls`, `claude-plan-calls`, `headless-dispatch-dry-run`, `headless-plan-agents`, `recorded-plan-recovery`) must be classified by their actual injected boundary, not by a transitive import alone. `makefile-local-env.test.ts` executes Make/shell and belongs in the final marker audit.

## Acceptance accounting

The issue's approximate 35-case budget is not an acceptance count. The original retained list alone sums to 40; current main also contains the new close-session lifecycle behavior. Preserve every distinct guarantee and publish the resulting count. The first PR covers Slices 1–4, so the under-300-second whole-plugin target remains a later milestone, not a claim of that PR.

## API migration measurement

After Slice 2, on the same base and Node 24 runner: **2397 backend tests passed**, zero failed or pending, **89.228 s** summed file duration and **22.155 s** observed report span. The API family moved from **19 process cases / 42.290 s** to **25 in-process composition cases plus two executable cases / 5.286 s**. Host contention varied during the work; [the investigation record](pty-validation-findings.md) retains both failed and successful runs rather than presenting a controlled microbenchmark.
