# First delivery: in-process API and ct-step decisions

Implements Slices 1–4 of the local `.aiplans/in-process-command-tests/plan.md` for [#418](https://github.com/mercadona/control-tower/issues/418). Remaining command families, initializer sharing and distribution-lane relocation belong to later deliveries.

### Slice 1 — Baseline and ownership

Capture full Node 24 plugin/backend reports, assign process-test owners, and retain a guarantee migration ledger. Complete: `process-budget.md`, `in-process-coverage.md` and `measure-suite.mjs`.

### Slice 2 — API composition

Make CtApi importable with explicit tool/native/worker/scheduling dependencies, real HTTP and production composition in tests, deterministic per-instance shutdown and two actual executable tests. Preserve every old guarantee and cover all mounted route classes. Complete: 25 composition cases, two executable cases, complete backend suite green; see the measurement and PTY investigation records.

### Slice 3 — Runtime and ct-step seam

Move command state into `CtStep.run(argv, io)`, leave `ct-step.mjs` as the executable boundary, and introduce a tested process runner plus strict tool conversations. Keep real temporary files and preserve cwd, environment, stdin, buffers, timeout/signal and output semantics. First verify the legacy suite through the extracted command, plus an in-process invocation pilot.

### Slice 4 — Full ct-step migration

Move the existing decision scenarios to the importable boundary; retain actual Git index/commit/trailer and Bash parsing mechanisms in focused marked tests. Record exact tool requests, disk/output effects and old-to-new guarantee mapping. Measure the complete family before calling the pilot successful. Do not reduce coverage or change the final whole-plugin acceptance metric to make this partial delivery look complete.

The implemented double uses explicitly recorded per-scenario tool conversations rather than a handwritten Git model. Reply lookup is by literal request; required-consumption checks catch omitted/excess requests and mutation cut points retain ordering guarantees. The 199 original scenario assertions stay in place. A dedicated regeneration config records real external responses; the ordinary suite has no automatic recording or real-tool fallback. The capture metadata and independent marked tests document which guarantees belong to each side.

## Verification

Use Node 24 for both install/native builds and Vitest. Run backend typecheck, the affected families and full integrated plugin/backend suites. Keep all required controls. Every retained process consumer is explicitly named and justified; the complete marker enforcement for the residual families is later work.
