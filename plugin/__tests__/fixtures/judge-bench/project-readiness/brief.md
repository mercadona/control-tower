### Desired end state

The existing project status view receives a readiness report: worker counts above
the configured maximum require changes; otherwise the database must be healthy.
Unusable source responses remain errors rather than invented observations.

### Out of scope

Starting containers, modifying Git configuration, changing the view or the command runner.

## 2. Closed decisions

| Decision | Value |
|---|---|
| Query | `InspectProject.execute` takes `InspectProjectParams` and returns `InspectProjectResult`. |
| Maximum | The maximum worker count is injected; a count equal to it is allowed. |
| Database | Only `healthy` satisfies readiness; `starting` and `unhealthy` require changes. |
| Sources | Failed commands raise `ProjectNotRead`; unrecognized output raises `ProjectNotUnderstood`. |

## 3. Reference patterns

Files to imitate: N/A — this is the first project assessment in this fixture.

Rules to obey: the ct conventions appended by the program; no repository additions.

Responsibility trace: `InspectProject.execute` conducts the assessment;
`ProjectReadiness` owns the verdict; `ShellProjectSetup.inspect` obtains observations.

### Task 1 — expose project readiness

**Objective:** Supply the existing view with the readiness verdict for the worker count and database health, preserving source errors.

**Files:** `src/application/queries/inspect-project.js` (create), `src/infrastructure/shell-project-setup.js` (create), `test/inspect-project.js` (create).

**TDD:** `it('accepts the worker limit with a healthy database')` — two workers with maximum two and a healthy database yield `ready` through `InspectProject`.

**Tests:** added `accepts the worker limit with a healthy database`, `requires changes above the limit without asking the database`, `requires changes while the database is not healthy`, `preserves command failures`, and `rejects unrecognized observations`; none removed.

**Verification:**

```bash
node --test test/inspect-project.js
```
