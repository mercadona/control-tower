# In-process migration coverage ledger

Scope of the first delivery: Slices 1–4 of the plan for [#418](https://github.com/mercadona/control-tower/issues/418). The full local plan is `.aiplans/in-process-command-tests/plan.md` in the planning checkout. The implementation sequence is baseline inventory → API composition → runtime/ct-step seam → full ct-step migration and payoff review.

## Baseline guarantees

The Node 24 baseline passes 4372 plugin cases and 2386 backend cases at `c67db23c`. The JSON reports retain every assertion name; `docs/testing/measure-suite.mjs ... cases` emits the ct-step/API assertion inventory for before/after comparison.

| Source family | Guarantees to retain | Replacement / independent oracle | Status |
|---|---|---|---|
| ct-api | Port, empty sessions, invalid invocation, tool probes and metrics configuration | Two executable cases; in-process startup/composition with real HTTP | Pending |
| ct-api | Jira/GitHub story routing, progress/adviser phase, events, spec freeze, gate 2, retired endpoints | Composition tests asserting real adapter requests and disk effects | Pending |
| ct-api | Configured transcript recovery, absent transcript, concurrent opening | Composition tests with real transcript/record files and injected native spawn | Pending |
| ct-api | Both planning entrances, recorded headless call identity and large issue output | Real composition with strict tool and worker-boundary conversations | Pending |
| ct-api, added since issue baseline | Close, replacement and restart; real process-group ownership | Separate in-process composition and native mechanism evidence before reducing the process case | Pending |
| ct-step oracle | Invocation, nontransitioning next, generated brief, wrong-step refusals and environment | CtStep.run with real files and strict IO; executable edge | Pending |
| ct-step index/amendment | Declared scope, staged paths, reset/discard, amendments | Literal Git requests plus real index/commit boundary | Pending |
| ct-step verdict/advice | Ruling validation, retries, malformed evidence, advisor cut points | Existing decision scenarios through CtStep.run | Pending |
| ct-step package | Task/slice review bytes, conventions, reconciliation contents | Captured boundary input and real generated files | Pending |
| ct-step checks/global | Exact shell command, result/output, budget and global closure | Strict shell conversation and runner execution boundary | Pending |
| ct-step delivery/slice-judgement/e2e | Ordered transitions, commit count, slice/e2e artifacts, delivered closure | Existing journeys in process; independently measured real Git semantics | Pending |
| ct-step telemetry | Runtime identity, metrics files, attempts, signal and yardstick bytes | Real temporary filesystem and explicit environment/clock | Pending |
| ct-step seal | Dispatch attempt/scope binding and evidence refusal | Existing seal scenarios in process | Pending |
| ct-step merge-base | Exclusion of base/merge commits and correct run count | Exact Git argv plus independent real history boundary | Pending |
| branch reconciliation unreadable base | Two doubled decisions and one real Git refusal | Move doubled cases to ordinary suite; retain real boundary | Pending |

## Current implementation checkpoint

`ct-api-composition.test.ts` now has 25 passing cases through real HTTP and the actual composition graph, with tool, native spawn, worker spawn and process inspection injected. The original 19 executable cases have been replaced by this matrix and two executable-edge cases in `ct-api-real-process.test.ts`. The real PTY and detached-worker suites remain independent mechanism oracles; the table above remains pending final integrated verification rather than declaring the slice complete.

The composition cases cover the old invocation/probe/progress/recovery/retired-route guarantees, concurrent opening, both planning entrances and their recorded worker identities, large paginated output routing, close/replacement/restart, session stream/input/resize/attention, the remaining gate routes and record lookups. Native process-group survival and protection of unrelated processes remain asserted by `pty-live-sessions-real-process.test.ts`.

Combined verification on 2026-09-18 passed 50 cases and failed four cases in the unchanged native PTY suite: the 3000 ms terminal-output deadline, two aborted process identity inspections and an unverifiable surviving child. Those native cases had passed the baseline. Neither the adapter nor the native test file has a diff. Work is paused under the repository control rule; do not report the migration or its timing comparison as complete, and do not remove or relax those native assertions.

The user subsequently authorized investigation. [PTY validation findings](pty-validation-findings.md) records the unchanged five-file run passing 54/54, measured host contention, fixture synchronization corrections, and the remaining production 500 ms inspection bound. The native fixture now has a diff; its production adapter still does not. Corrected native scenarios pass 10/10 in isolation, while final combined verification remains required.

Each migration carries before/after family evidence. Changing only a filename or excluding a case does not count as a speedup.

### API acceptance

The complete backend passed 2397 cases with no failures or skips after the host load subsided, using the same Node 24 invocation, default parallelism and production bounds. All API rows above are now covered by the 25 in-process composition cases, two executable cases and retained native mechanism suites. API summed duration: 42.290 s before, 5.286 s after. The first five rows are complete; ct-step and reconciliation rows remain pending.

### Command-boundary migration

All 199 old ct-step scenarios now invoke `CtStep.run` through explicit IO. The original behavior assertions remain. External answers and file effects are captured from real tools with per-request consumption and mutation cut-point assertions; see the [capture contract](../../plugin/__tests__/fixtures/step-captures/README.md). The recording workflow is explicit and separate from ordinary tests, which refuse actual subprocess calls.

The dispatch-seal file loses its `-real-process` marker because it no longer launches one. The sole wording change to an old case name replaces “every verb is a fresh process” with “every verb reloads it from disk.” Source-text checks follow the moved implementation in `ct-step.js`, while the executable edge proves the retained `.mjs` delegates to it.

Independent real boundaries now cover:

- `ct-step-entrypoint-real-process.test.js`: actual node argv, path with spaces, emitted brief and dispatch seal.
- `ct-step-commit-real-process.test.js`: approved path set/trailer, refused real index mutation and `read-tree` restoration, multi-value/mixed trailers, and actual run counts after an advanced-base merge.
- Existing reconciliation and Bash/awk equivalence files remain real. The two doubled unreadable-base cases move into `branch-reconciliation.test.js`; their native case remains marked.
- `process-runner-real-process.test.js`: status/streams, stdin/env/cwd, missing executable, deadline/signal and large output.
- `command-io.test.js`: literal routing/options and the distinction between command refusal and unmeasured termination.
- `ct-step-invocation.test.js`: early usage refusal, interleaved roots without global cwd mutation, and a nested usage exit that must not become an unnamed exception.

Four non-contract diagnostics are translated to comply with repository rules: `plan no ejecutable` → `plan is not executable`, `Intento` → `Attempt` in the advice package, `Tocado y no declarado` → `Touched but not declared`, and `Declarado y no tocado` → `Declared but not touched`. Parsed headings, input verdict enums, YAML keys and stored state fields retain their spelling.

Focused verification after extraction and source-check updates passed **1005 tests**. Full suite measurements and mutation evidence follow in the final acceptance record.

The mechanical before/after case-name comparison retains **199/199** original cases, with eight additional invocation/native cases. Artifact assertions that used to inspect only captured `git show` output now also inspect the actual verdict/metrics files, and the real commit test checks byte identity between the committed artifacts and disk.

The first whole-plugin run passed 4401 cases and timed out in the unchanged historical ct-init upgrade scenario at 120000 ms. That exact scenario subsequently passed unchanged in isolation in 52.069 s. Host load was high again (five-minute average 61.44), so this run is retained as a failed integration attempt rather than a final acceptance measurement. No initializer code, assertions or timeout was modified.
