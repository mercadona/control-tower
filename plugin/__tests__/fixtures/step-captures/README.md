# Captured ct-step tool conversations

These fixtures preserve the external boundary of the 199 pre-existing ct-step scenarios while the command itself runs in process. They are captured responses from actual Git, shell and task-brief executions, not an implementation of Git in a double. Reports, verdicts, plans, logs and command artifacts still use real temporary files.

## Provenance

Each JSON file records its source revision, Git version, Node version, platform, fixed fixture clock and the SHA-256 of `scripts/ct-step.js` at capture time. The initial migration capture used Node 24.21.0 and Apple Git 2.50.1 on macOS. The extraction was in the working tree above the named revision; the command-source digest identifies those exact bytes. The source revision alone is not a claim that it already contained the extraction.

The final recording run passed 207 cases: the original 199 scenarios, three invocation checks and five retained executable/real-Git checks. Captures are produced only by the scenarios that use `StepScenario`; the other eight cases independently validate the real boundary. Captured fixture input includes the legacy scenarios' Spanish user text, filenames and external contract values verbatim. Program identifiers, diagnostics added by this change and test names are English.

## What replay asserts

- Every reply is selected by invocation, binary, literal argv array and operational options. A single argument containing a space differs from two arguments.
- Identical captured replies share a content-addressed entry in `responses`; request lookup and required consumption remain per scenario. `docs/testing/compact-step-captures.mjs` verifies decoded semantic equality before writing a compact corpus.
- Repeated requests consume the responses explicitly recorded for that request. Unknown or excess requests fail; omitted requests remain unconsumed and fail teardown, even when production catches a tool failure.
- Ordering is pinned at mutation cut points. Reads can reorder within a read-only interval, but cannot cross reset, stage, commit, merge, shell or script effects. This preserves the report reset-before-status guarantee without making response selection depend on a single global call counter.
- File effects are captured at the external boundary, applied only below the scenario's temporary roots, and preserve content, deletions and file mode. Git object storage is not simulated.
- `$TEMP0`, `$TEMP1`, `$PLUGIN` and `$NODE` replace machine-specific paths. Path-returning Git probes are expanded for the actual temporary checkout. Historical diff/text answers stay normalized so content-addressed evidence does not depend on the random temporary directory name. They are declared external snapshots, not a claim that a live Git index exists during replay.
- The default Vitest setup refuses imported spawn/exec/fork requests from an unmarked ct-step decision test, including requests whose exception is caught. `process-tripwire-real-process.test.js` validates that control in a separate runner and proves the attempted child never writes its marker.

The old fixture setup's command-shaped calls remain as explicit conversation requests to preserve the existing cases with a reviewable assertion diff. Those calls launch nothing during the ordinary suite. Shared real-Git tests independently establish actual index restoration, commit scope, trailers, mixed histories and the run/base commit-count expression. The Bash/JavaScript plan-section suite remains real too.

Assertions that formerly inspected artifact payloads only through `git show` also read the newly written verdict/metrics files directly. A captured Git reply must not approve a serializer that wrote the wrong payload. The retained native commit boundary checks that the committed payload bytes equal those on disk.

## Regeneration

From `plugin/`, after installing dependencies with the same Node major used to execute them:

```sh
npx --yes --package=node@24 -- node node_modules/vitest/vitest.mjs run --config ../docs/testing/record-step-conversations.config.mjs
```

This explicitly selected developer workflow launches real tools, replaces the normal process-tripwire setup and writes the captures. It is not the normal test lane. The recorder refuses to publish a failing test's result. Review changed requests and replies and require the complete recording run to pass before accepting new captures; do not regenerate to approve an unexplained behavior change.

The normal command, including `npm run test:fast`, only reads these files. It never regenerates a missing or stale answer and never falls back to a real tool.
