# Project readiness assessment: mo.ntc.control.api

Tracking: https://github.com/mercadona/control-tower/issues/275

Reference implementation: https://github.com/mercadona/mo.ntc.control.api/issues/5036

## Initial verdict

**Changes required for predictable local plan execution.** Repository inspection
and read-only local probes expose resource and worktree compatibility gaps.
Fresh-environment startup, test execution, cancellation, and application journeys
remain **unverified**. This is not a reproduction of the beta tester's slowdown.

The patch-validation follow-up below records subsequent execution in a disposable
environment. It does not establish the state of the beta tester's machine.

## Evidence scope of the initial assessment

- Assessment date: 2026-09-10.
- Control Tower checkout: `82ff09a`.
- Local reference repository: `160247ca8ef33b438dedcad2f7921ef781fb11a0`, branch
  `alcaptar/ct-init-control-tower-loop`. Existing untracked work was preserved.
- GitHub default-branch files were also inspected; its head was observed as
  `3de152de97ad4c8f11ba956c133b62805fb4534d` at the end of inspection. Earlier
  default-branch reads were not pinned to that commit and are corroborating
  observations, not a single immutable snapshot.
- The local machine is the investigator's, not the beta tester's. It has 10
  physical/logical processors and 16 GiB of memory. Docker's active context is
  Colima, exposing 6 processors and 12,514,516,992 bytes (about 11.66 GiB).
- Docker was reachable. Six unrelated containers were running. The two existing
  `control-ntc-api` containers were stopped; neither reported `OOMKilled`.
- No application containers were started, tests executed, images rebuilt, or
  existing worktrees modified. No credentials or environment values were copied.

## Findings and verification criteria

### R1 — Full-suite parallelism has no explicit local resource budget

**Evidence:** `AGENTS.md:12` declares `make env-start test`. `Makefile:56-57`
executes `scripts/test-command.sh`, whose line 3 uses `pytest -n auto`.
Resolved Compose configuration has no `cpus`, `mem_limit`, or deployment resource
limits. Existing stopped app and database containers also have zero configured
CPU quota and memory limits.

`auto` chooses worker processes from the processors detected inside the runtime;
it does not mean a fixed fraction of the developer's machine. The actual worker
count in the tester's run is unknown. `src/conftest.py` also creates a unique test
database and schema for each worker session that exercises integration fixtures.

**Impact:** concurrent worktrees multiply Python processes and database work while
sharing Docker's processor and memory allocation. Container separation does not
reserve resources, contrary to the claim in `.claude/knowledge/workflow.md:5`.

**Proposed correction:** provide a bounded, configurable local test-worker default
and a declared concurrency budget; propagate the worker setting through Make and
Compose into the test process. Size application and database limits together.
Choose final values from measurements, rather than treating two workers or a
particular memory limit as universally sufficient.

**Verification:** inspect the effective arguments and container limits, then run a
representative targeted test with an explicit small worker count in an isolated
environment. Record duration, peak memory, processor use, and worker count. Expand
to the supported concurrent-worktree count only after the single-run measurement.

### R2 — External worktrees resolve to an unmounted container path

**Evidence:** `Makefile:13-17` removes the main-checkout prefix and prepends `/app`.
The application bind mount contains only the main checkout. A dry run of this
Makefile from the existing external `monitoring_stable` worktree produced
`/app/Users/acapdev/orca/workspaces/mo.ntc.control.api/monitoring_stable/src`.
That location is not supplied by the declared mount. This probe deliberately
selected the main checkout's Makefile; it tests that adapter with an external
layout, not the external branch's older Makefile.

**Impact:** Control Tower's nested `.worktrees/<n>` layout fits this assumption;
external worktrees used by other launchers do not. A generic worktree claim would
be incorrect.

**Proposed correction:** explicitly declare the supported layout or mount the
selected worktree at a stable container path. Verify actual code provenance.

**Verification:** resolve the command and mounts for the main checkout, a nested
worktree, and an external worktree. In a disposable environment, verify that an
import resolves inside the selected worktree and observes its changed code.

### R3 — Running environment provenance can differ from declared configuration

**Evidence:** resolved Compose expects the local main checkout at `/app`, but the
existing stopped `control-ntc-api-app-1` mounts the external
`mandangas_con_celia` worktree. It was created on 2026-08-05. Its database's dataset
mount also points to that worktree. No reconciliation was attempted.

**Impact:** source inspection alone cannot certify that an existing container runs
the intended code. This observation describes old local containers, not #5036.

**Proposed correction:** compare container project identity, actual mounts, working
directory, and image identity against the requested checkout before reporting it
ready. Explain stale environments and the scoped recreation needed.

**Verification:** a matching environment is distinguished from an old container
that has the expected name but mounts another checkout.

### R4 — Build inputs and image identity are shared across worktrees

**Evidence:** `Makefile:19-22` anchors Compose files to the main checkout. The
resolved build context is that checkout, the Dockerfile is `docker/Dockerfile`,
and the image tag is `mercadona/control-ntc-api:latestlocal` for all projects.

**Impact:** worktree changes to the Dockerfile or dependencies need not be included
in its built environment. Rebuilding the shared tag changes what later containers
use; existing containers keep their previous image. The worktree basename alone
also does not distinguish identical names from separate clones.

**Proposed correction:** identify environment ownership by checkout and worktree,
and make the intended dependency/build provenance explicit. Distinct containers
are insufficient evidence of dependency isolation.

**Verification:** a dependency change in one worktree affects its environment while
another worktree retains its own dependency set; inspect both image identities.

### R5 — Service startup does not establish database readiness

**Evidence:** resolved Compose uses `depends_on.db.condition: service_started`,
without health checks. `make env-start` runs `up -d` immediately before tests.
The last plan comment for #5036 explicitly records an unavailable Docker daemon
at initial baseline measurement.

**Impact:** daemon availability, container startup, database readiness, and test
success are different observations. A baseline failure alone cannot classify them.

**Proposed correction:** probe daemon availability first; use a bounded database
readiness check for fresh environments. Report the failed stage separately.

**Verification:** cold-start a disposable project, wait for database readiness, and
run a small integration check. Also verify unavailable-daemon and readiness-timeout
results without misreporting them as application test failures.

### R6 — Cancellation and cleanup need an ownership contract

**Evidence:** `plugin/scripts/baseline.js:63-69` times out the shell process with
`SIGKILL`. This is not evidence that a test process inside `docker compose exec`
was terminated. No cancellation experiment was run. The repository offers
project-scoped `destroy-containers`, but `env-destroy-worktrees` removes all matching
worktree projects and `docker-cleanup` also invokes global `docker system prune`.

**Impact:** time bounds do not establish resource cleanup. Broad cleanup commands
are not suitable for cleaning up one diagnostic or one completed plan.

**Proposed correction:** define probe and environment ownership, cancellation, and
cleanup for the selected run. Keep unrelated worktree and developer resources out
of that operation.

**Verification:** cancel a disposable long-running probe and confirm its processes
end; clean up its owned resources and confirm a sibling environment survives.

### R7 — Non-interactive tests and application journeys are unverified

**Evidence:** Make uses `docker compose exec` without an explicit non-interactive
mode. Its behavior with Control Tower's ignored input and captured output has not
been exercised here. Worktree Compose omits the local override that publishes
server ports; the documented worktree workflow is for checks. The application
journey section in `AGENTS.md:52-66` is empty. The frontend repository was not audited.

**Proposed correction:** provide non-interactive test commands and document the
backend/frontend startup, readiness, endpoint pairing, and scoped shutdown needed
for a journey. Report this capability independently from unit-test readiness.

**Verification:** execute through the same input/output arrangement as Control
Tower, and exercise a backend/frontend pair for the intended worktree layout.

### R8 — The implementation plan's targeted test paths repeat `src`

**Evidence:** the last published #5036 plan uses paths such as
`src/ntc_control/contrasting/tests/actions/test_retrieve_productivity_weeks.py`
with `make pytest-custom`. `Makefile:46,116-117` runs pytest with its working
directory already set to the selected tree's `src`. The inspected test is under
`src/ntc_control`, not `src/src/ntc_control`.

**Impact:** those targeted verification commands address the wrong path. This is
independent of the slowdown hypothesis and can block the implementation directly.

**Proposed correction:** use `ntc_control/...` in pytest arguments while retaining
repository-relative `src/...` paths in the plan's file lists. Explain the command's
working directory in the workflow documentation.

**Verification:** first collect the selected test with the corrected relative path
through the Make target, then execute it with `-n 0`. Both remain runtime checks to
perform in the selected worktree's environment.

## Relationship to the reported implementation

The last published plan for #5036 requests targeted tests without explicit
parallelism during most tasks, and `make test` during task 4 and global
verification. It records an unsuccessful initial baseline because Docker was
unavailable. The comments inspected contain no implementation process log or
resource measurements establishing which command caused the slowdown.

The backend's `GitWorkspace` also measures the declared baseline while preparing
the planning worktree, via the same `Baseline` implementation used by the plugin.
For this repository, that command starts the environment and requests the full
suite. A readiness diagnostic must not silently repeat that workload.

To close the incident hypothesis, obtain the tester's checkout revision, effective
command, selected worker count, Docker allocation, concurrent sessions, and resource
measurements from the affected run. Then compare a bounded run under the same
conditions. Processor saturation and memory pressure remain competing explanations.

## Priority for beta onboarding

1. Establish effective worker/resource budgets and classify environment startup
   failures before running expensive verification (R1, R5).
   Correct the targeted test paths in the reference plan immediately (R8).
2. Verify worktree paths and actual container/dependency provenance (R2–R4).
3. Demonstrate non-interactive execution, cancellation, and scoped cleanup (R6–R7).
4. Validate backend/frontend journeys for projects that require them (R7).

## Input to the executable diagnostic design

Start with explicit readiness checks for a selected checkout, using file inspection,
command resolution, Docker availability, and sanitized container metadata. Each
finding needs an identifier, outcome, evidence, suggested action, and observation
scope. Unsupported configurations and unperformed runtime checks stay unverified.

Expose the report in Control Tower before plan creation, because preparation already
executes the baseline. Report inspection readiness separately from proven test and
journey execution. Limit subprocess duration and output, and avoid launching an
unbounded suite or creating environments as an implicit side effect of inspection.

An initial deterministic diagnostic has a smaller maintenance surface than a
cross-framework automatic repair engine. Add runtime probes and further framework
adapters as concrete onboarding cases establish their contracts. The user approved
the proposed architecture and first-release scope before the unblock validation.

## Follow-up: unblock patch validation

The executable-diagnostic scope was approved. Before starting that implementation,
the user requested validation of the smallest unblock patch in the reference
repository while awaiting the colleague's `make worktree-info` output.

### Patch location and scope

- Repository worktree: `.worktrees/ct-275-test-runtime`.
- Branch: `fix/ct-275-test-runtime`, based on local commit
  `160247ca8ef33b438dedcad2f7921ef781fb11a0`.
- Four modified files: `Makefile`, `scripts/test-command.sh`,
  `docker/docker-compose.yml`, and `.claude/knowledge/workflow.md`.
- The full suite defaults to two workers; Make passes `PYTEST_WORKERS` into the
  container explicitly, including zero for non-distributed execution.
- Test and lint execution explicitly disables terminal allocation. Interactive
  shell targets retain their existing behavior.
- Compose waits for a PostgreSQL TCP readiness check before starting the app.
- Documentation corrects targeted-test paths and the resource-isolation claim.
- Changes are local and uncommitted. External-worktree mounting is not changed.

### Validation environment

Only the newly created Compose project `control-ntc-api-wt-ct-275-test-runtime`
was started and recreated. A temporary validation override imposed two processors
and 4 GiB on the app, one processor and 1 GiB on PostgreSQL. Those limits are not
part of the proposed repository patch and do not represent measured minimums.

The validation explicitly selected the patched Compose file with the main Docker
directory as `--project-directory`, preserving existing mount and environment-file
resolution. This matters because default Make targets still load Compose from
the main checkout: a Compose edit confined to a worktree would otherwise go unused.

The existing development image was used without rebuilding:
`sha256:e34bab0be21f62c9930596f3fe5fe218f32764761f73589a6f3d111a751b3e83`.
Runtime versions were Python 3.14.7, pytest 9.1.1, and pytest-xdist 3.8.0.

### Results

| Check | Result |
|---|---|
| Pre-patch targeted baseline, corrected path, `-n 0` | 2 tests passed |
| Before/after command assertions | Failed before the patch for missing worker propagation and non-interactive execution; passed afterwards for default, 0, 1, and 2 workers |
| Before/after Compose assertion | Initially `service_started`; patched configuration requires `service_healthy` and a TCP probe |
| Fresh-volume startup with patched Compose | Database reported healthy before the application started |
| `make linting` | mypy passed on 1,606 source files; Ruff checks passed; 1,446 files already formatted |
| `make test` with the patched default | **2,816 passed in 180.37 seconds**, with exactly two workers |
| `make test PYTEST_WORKERS=0` with a targeted selection injected through `PYTEST_ADDOPTS` | 2 tests passed; the real test script printed `pytest -n 0` |
| Syntax and whitespace | `bash -n scripts/test-command.sh` and `git diff --check` passed |
| Processes after normal completion | Only `sleep` remained in the application container; no test workers remained |
| Scoped cleanup | Validation containers, volume, and network were removed; the same six unrelated containers remained running |

The full suite emitted six dependency deprecation warnings from Google GenAI and
Starlette; the same warning families were present in the pre-patch targeted run.
Neither validation container reported `OOMKilled` after execution.

Ten early resource samples observed app memory up to 1.526 GiB and database memory
up to 25.88 MiB. These are sampled observations during the first part of the run,
not whole-run peak measurements and not a comparison against `-n auto`.

The patch also changes the default for GitHub Actions because `.github/workflows/ci.yml`
invokes `make test`. An explicit `PYTEST_WORKERS` value remains available; workflow
execution and timing were not tested here.

The result validates the bounded test path and fresh database readiness for this
nested worktree and image. It does not reproduce the colleague's slowdown, validate
their unpushed #5036 implementation, certify external-worktree support, or prove
timeout cancellation and backend/frontend journeys.

## Follow-up: merged unblock patch and executable diagnostic

The unblock patch was published as
https://github.com/mercadona/mo.ntc.control.api/pull/5056 and merged on
2026-09-10 at 11:00:30 UTC. Its publication branch was based directly on
`master` at `3de152de9`, with only the four unblock files. Validation on that
base passed 2,805 tests in 106.70 seconds after `make install-ci-requirements`
installed the newly declared `pywebpush` dependency in the isolated container.
Types, style, formatting, and fresh-volume database readiness also passed.

The colleague's later transcript confirmed the nested test working directory
`/app/.worktrees/5036/src`. It also reported a stream failure and an agent-launch
classifier/model timeout, followed by another background agent. Those reports do
not attribute the machine slowdown to pytest; no additional runtime evidence was
available. The user chose to proceed with the evidence already collected.

The first executable diagnostic is now implemented locally in Control Tower:
`POST /project-readiness` and an explicit inspection button in the start-plan
form. Its contract and supported observation scope are documented in
`docs/project-readiness.md`.

Final automated verification:

- Backend type checking passed.
- Full backend suite: **1,449 tests passed**.
- Full frontend suite: **707 tests passed**.
- Production frontend build passed.
- A real HTTP smoke test served the built frontend and inspected the local
  Control NTC checkout through the new endpoint. The temporary server was stopped.

The real inspection returned 16 findings and `changes-required`. It inspected
the locally cached base `3de152de97ad4c8f11ba956c133b62805fb4534d`, which still
predated the merged patch; no fetch or checkout update was performed. It observed
automatic pytest workers, absent container resource limits/database readiness,
and old container mounts and image identity. Execution remained unverified.

Review findings were reproduced and fixed with regression tests: owned process
groups terminate diagnostic descendants on timeout, compound or overridden pytest
commands are not certified bounded, unexpected bind mounts are detected, all
replica images are checked, and every declared database consumer must wait for
health. The diagnostic implementation remains uncommitted in the Control Tower
worktree pending the user's publication request.

## Follow-up: adversarial convention corrections

The diagnostic was published in https://github.com/mercadona/control-tower/pull/300
at `932cab7b376eb4263c94589ec059794190e60079`. An independent adversarial convention
judge requested changes in 13 findings. The user approved applying those corrections.

- F1–F2: execution failures are distinguished from completed-command exit code 1,
  and unresolved shell expansions remain unverified.
- F3: finding identifiers and actions are closed backend types. The frontend
  vocabulary copy is compared during backend typechecking, with runtime checks
  for nonempty presentation text.
- F4/F8: container metadata is projected once with its resolved service; absent
  image names remain explicit null values.
- F5/F7/F12: unused signal/output options, unused content reads, repeated
  validation, and unsupported public helpers were removed.
- F6/F9/F10: the frontend accepts the backend classification, constructs immutable
  owned values, and maintains one request-lifecycle state.
- F11: the deadline test controls the clock; the real descendant test uses an
  interprocess readiness signal before triggering overflow and observing cleanup.
- F13: component functions belong to their named owner, with one public View.

Verification after the corrections: 1,461 backend tests and 709 frontend tests
passed; backend typechecking and the production frontend build passed. A real
HTTP smoke test again served the built frontend and inspected the local reference
checkout without running its tests or changing its environment.

The same independent judge re-read the corrected files and callers and marked
all F1–F13 resolved, with an APPROVE correction-review verdict. It ran no tests
or commands and raised no new correction-induced finding. This remains an
advisory whole-PR review, not a formal ct-step gate or a diagnosis of the original
beta tester slowdown.
