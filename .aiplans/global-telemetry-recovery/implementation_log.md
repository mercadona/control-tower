# Implementation log

## Slice 1 — Persist the telemetry commit before verification
- Estado: COMPLETADO
- Saved `sliceCommits` immediately after the telemetry commit, before verification commands.
- Regression reproduced the defect: a killed global process left `next` returning exit 8. After the correction, `npx vitest run __tests__/ct-step-global-verification.test.js` passed all 11 tests, including recovery without a duplicate commit (isolated HOME, CT_STATE_DIR and CLAUDE_CONFIG_DIR unset).

## Slice 2 — Account for telemetry in downstream assertions
- Estado: COMPLETADO
- Updated whole-run totals and `sliceCommits`; verdict-specific checks now assert their own commit delta, retaining checks on rejected verdicts and foreign staged work.
- The four affected downstream suites passed all 46 tests. Full plugin `npm test` passed 4,477 tests in 167 files; generated artifacts stayed unchanged.
- Full backend `npm test` passed 2,856 tests in 141 files when run alone. The first run, concurrent with the plugin suite, timed out polling session launch in `ct-api-real-process.test.ts:426`; that test passed alone and the complete backend rerun then passed without code or test changes.
- All suites ran on Node v25.9.0 with an isolated HOME and inherited CT_STATE_DIR and CLAUDE_CONFIG_DIR unset. npm reported the plugin's Vitest v5 engine range excludes Node 25; CI uses Node 24.
