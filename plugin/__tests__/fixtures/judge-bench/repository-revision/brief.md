### Desired end state

The existing revision view can read the selected repository's current revision
through an application query and preserve an unreadable-source error.

### Out of scope

Changing the existing repository adapter, revision value, view or external command runner.

## 2. Closed decisions

| Decision | Value |
|---|---|
| Query | `ReadRevision.execute` takes `ReadRevisionParams` and returns `ReadRevisionResult`. |
| Lookup | Pass the requested root to `RepositoryHistory.current` and return its `Revision` unchanged. |
| Failure | Preserve `RevisionNotRead`; do not fabricate a revision. |

## 3. Reference patterns

Files to imitate: N/A — this is the first application query in this fixture.

Rules to obey: the ct conventions appended by the program; no repository additions.

Responsibility trace: `ReadRevision.execute` requests one lookup;
`GitRepositoryHistory.current` resolves the repository and reads its revision;
`Revision` carries that value. No business assessment is requested.

### Task 1 — expose the revision query

**Objective:** Return the repository revision through the application query used by the existing view, preserving source failures.

**Files:** `src/application/queries/read-revision.js` (create), `test/read-revision.js` (create).

**TDD:** `it('returns the selected repository revision')` — the result contains the revision returned by the history port, and that port receives the selected root.

**Tests:** added `returns the selected repository revision` and `preserves an unreadable revision instead of inventing one`; none removed.

**Verification:**

```bash
node --test test/read-revision.js
```
