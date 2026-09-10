# Project readiness

The start-plan form offers **Comprobar preparación** after a repository name and
local path have been entered. It is an explicit inspection: no issue, worktree,
test run, image build, container startup, or configuration repair is performed.
A ticket is not required to inspect a project.

## Endpoint

`POST /project-readiness`, with `Content-Type: application/json`:

```json
{"repo":"owner/project","path":"/absolute/checkout"}
```

The endpoint uses the same origin restriction and request-body bound as the other
application endpoints. Unknown request fields are rejected. A successful response
contains `repo`, canonical `path`, `base_revision`, `observed_at`, `status`, and
`findings`. Every finding has `id`, `status`, technical `evidence`, and an `action`
code translated by the frontend.

- `ready`: the particular observation was established.
- `changes-required`: observed configuration needs attention.
- `unverified`: absent evidence, unsupported layout, unavailable tools, exhausted
  budgets, or a capability the inspection does not execute.

The report aggregates changes required before unverified before ready. It always
includes an unverified execution finding: configuration inspection alone cannot
certify test success, worktree isolation, cancellation, or application journeys.
Changing the repository or path discards the report and aborts the old request.

Aggregation is owned by the backend report. The frontend validates the response
vocabulary, constructs immutable report/finding values, and displays the supplied
classification rather than deriving a second one. Its request lifecycle is one
closed state, with the controller reference reserved for request cancellation.

Finding identifiers, actions, and statuses are closed backend types. The frontend
label keys are the other half of this cross-process vocabulary. Their exact type
equality is measured by `project-readiness-contract.test.ts` during backend
typechecking; the runtime assertions also require nonempty product copy. Run both
typechecking and tests when changing this contract.

## Observation scope

- Repository identity must match the checkout's GitHub `origin` remote.
- Declarations are read from the commit referenced by the locally known
  `refs/remotes/origin/HEAD`, matching the base used when preparing worktrees.
  No implicit `git fetch` occurs. Fetch/update separately when newer commits
  should be inspected; the report shows the exact commit it actually read.
- Build, test, and lint declarations must contain concrete commands. Convention
  paths in `.agent/conventions.md` must be backtick-delimited Markdown paths to
  tracked documents containing more than headings/placeholders.
- Tracked-file discovery supplies Compose candidates and drift paths. Only files
  whose contents are interpreted are read with `git show`; discovering a Compose
  file does not consume a second read of its contents before Docker resolves it.
- The test declaration uses the existing baseline declaration reader. Worker
  recognition currently covers explicit pytest counts and the reference
  `make [env-start] test` → `scripts/test-command.sh` path with `PYTEST_WORKERS`.
  Other frameworks and arbitrary wrappers are left unverified. An explicit
  worker count is not a guarantee that memory or total concurrency is sufficient.
  Unresolved shell expansion, other than the supported worker expression, also
  remains unverified.
- Configuration drift is compared with the base. Ignore rules are checked in the
  current checkout, including its local Git exclusions. Plans must remain visible
  while worktrees and runtime state are ignored.
- Docker inspection recognizes a single tracked conventional Compose file:
  `compose.yaml`, `compose.yml`, `docker-compose.yml`, `docker-compose.yaml`, or
  `docker/docker-compose.yml`. Zero or multiple candidates are unverified.
- Compose is resolved from that file in the current checkout, without resolving
  service environment files into the response. The effective configuration of an
  arbitrary Make wrapper or custom override stack is not inferred. The report names
  the file and project actually inspected.
- Resource limits, PostgreSQL health dependencies, fixed container names/ports,
  shared volume names, bind sources, and build context are inspected. Existing
  containers are selected by the resolved Compose project label; their bind mounts
  and image identities are compared with that configuration and local image tags.
  Container metadata is converted once into an owned projection before those
  comparisons. A service without an explicit image name retains that absence in
  its type and leaves image provenance unverified.
- Existing external-tools status remains a separate panel. The diagnostic does
  not create GitHub labels or infer write permission from read access. `/ct-groom`
  is not a prerequisite of the interface-driven flow, and no historical slash-command
  invocation is used as evidence of readiness.

## Bounds and privacy

The composition root provides a 30-second total budget, at most two seconds per
command, 128 KiB per subprocess output stream, 24 tracked file reads, and 12
containers/services. One inspection runs at a time per backend process; another
request returns an unverified finding instead of queuing more work. Diagnostic
commands run in owned process groups on POSIX hosts; timeouts and output overflow
terminate the group with `SIGKILL`, including the Compose child process. This mode
reports unsupported hosts as unverified rather than launching unbounded work.
The browser aborts after 35 seconds and on target changes
or unmount; a disconnected request's server inspection remains bounded by its own
budget.

Owned execution is configured together with its output bound. The legacy runner
does not acquire unused signal or output options. A process that cannot complete
normally is reported with execution-failure code `125`, distinct from a completed
command's exit code `1`; an unavailable ignore probe therefore remains unverified.

The adapter invokes fixed Git and Docker argument vectors without a shell. It
does not execute Make, pytest, or repository scripts. The frontend receives
selected technical facts, not raw subprocess errors, environment values, or the
full Docker inspection payload.

## Verification

```sh
npm run typecheck --prefix backend
npm test --prefix backend
npm test --prefix frontend
npm run build --prefix frontend
```

The adapter suite covers unknown and unavailable inputs, base drift, worker
recognition, container provenance, and budgets. Route tests cover request/origin
validation and report projection. Frontend tests cover explicit invocation, report
validation, retry, and stale-result cancellation.
The timeout test controls the clock and observes group termination signals. The
real descendant-cleanup test waits for the child to announce readiness before
triggering output overflow; it does not assert an elapsed wall-clock threshold.
