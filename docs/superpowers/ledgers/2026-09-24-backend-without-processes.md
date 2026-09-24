# Ledger — the backend suite launches no process

One row per test case that a slice of this milestone deletes. The first cell names the case as
`file > test name`, with the path from `backend/`. The second cell names its substitute the
same way, or reads `deleted without substitute — decided`. Every slice appends its rows, and
`backend/__tests__/ledger.test.ts` reads each one.

The coverage gate: while a test on `ProcessRatchet.LISTED` still launches a process, `npm run coverage:compare` fails only when the covered lines of a file drop below `backend/coverage-baseline.json`, and prints branch differences as information; at the close (#556), with that list empty, branches become a strict gate too.

| Deleted case | Substitute |
|---|---|
