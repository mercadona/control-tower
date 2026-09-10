# #183 — Repository-selected plugins around mandatory prescriptive planning

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Tasks close contracts, names, boundaries and assertions. Implement
> bodies test-first. The existing prescriptive plan remains the mandatory output.

## 1. Context and goal

Issue: https://github.com/mercadona/control-tower/issues/183. Related consumer:
https://github.com/mercadona/control-tower/issues/142. The issue has no description;
the requirements below record the explicit design agreed with José in the planning conversation.
This is a proposed implementation plan for review, not an implementation or an approval.

Inspected base: `origin/main`, commit `cbf78c6`. The current checkout used earlier in
the conversation was older: the backend is now TypeScript, including executable scripts.

Today `StartPlan.execute` confirms repositories, reads the story and creates a plan issue,
worktree and agent for each target. `PlanAgentBrief.errandFor` requires
`control-tower-loop:writing-plans-prescriptive`. `PlanContractProgress.of` runs the
existing `dispatch-check --check-plan` and checks that the plan directory is committed.
The backend already recovers active agents and separates uncertain implementation starts.
There is no repository-selected provider of additional planning context or obligations.

### Desired end state

- A governed repository opts into installed plugins through `.agent/plugins.json`.
- Plugin packages live under `backend/plugins/<id>/`, with `plugin.json`, `SKILL.md`
  and deterministic TypeScript scripts. The host has no provider-specific URL rules.
- The backend prepares plugin context before starting the mandatory planner. A durable
  state machine records preparation, launch, validation and approval boundaries.
- The agent receives story + existing instructions + resolved plugin instructions and
  evidence. It writes exactly the existing nine-section prescriptive plan.
- Additional validation checks reference coverage and declared controls; the backend
  cannot announce readiness or issue GO for an invalid plugin-backed plan.
- Controls travel as ordinary existing Verification commands and run through `ct-step`.
- Removing a plugin changes future plans; an existing plan keeps its pinned inputs.
- No configuration means the current planning behavior, prompt and public responses.

### Out of scope

The production Ursula reader belongs to #142: this issue supplies its extension contract
and proves it with a synthetic executable plugin. No mockup creation, component-catalog
export, production browser automation or claim that a static graph proves UI behavior.
No provider/model switch from #139, new human approval, plugin marketplace, dynamic
installation, automatic source refresh, arbitrary hook DAG or frontend redesign.
No change to the prescriptive skill, template, parser, base validator or task-brief format.
The new orchestrator serves backend-launched plans; standalone `/ct-next` integration is
a separate consumer, not silently introduced into a separately distributed package.
Crash recovery does not make GitHub issue creation exactly-once: an uncertain create or
agent launch is reconciled, never repeated on faith.

## 2. Closed decisions (take as given)

### Ownership and compatibility

| Decision | Exact value and provenance |
|---|---|
| Mandatory planner | `control-tower-loop:writing-plans-prescriptive`; user decision. Never a selectable plugin. |
| Installation | `backend/plugins/<id>/plugin.json` plus `SKILL.md` and `scripts/*.ts`; user location, current backend convention. |
| Repo selection | `.agent/plugins.json`, committed on the repository base used to cut the worktree; user decision. A dirty/untracked config is rejected for enabled planning. |
| Configuration | Strict JSON `{schemaVersion:1,plugins:[{id,options}]}`. `options` defaults to `{}`; every other field is required. IDs match `[a-z][a-z0-9-]{0,63}` and are unique. Remove the entry to disable it. |
| Admission flag | `CT_PLAN_PLUGINS`: absent or `0` is OFF, `1` is ON, any other value is refused at startup. An environment flag follows this backend's existing startup configuration mechanism. |
| OFF path | Select the existing collaborators at composition time. Do not load manifests, inspect repo plugin configuration, run scripts or change prompts for legacy plans. |
| Existing plans | A persisted plugin run is authoritative irrespective of later admission-flag/config changes. OFF stops new plugin-backed admissions; it does not waive existing obligations. |
| No applicable plugin | Preserve the original agent brief byte-for-byte. Keep a backend-only not-applicable record for configured runs; no companion artifacts in the governed repo. |
| Ordering | Configured plugin IDs sorted lexicographically; run serially. Preserve provider item order. No automatic last-writer-wins merging. |
| Public API | Existing success bodies and SSE `writing`/`ready` remain unchanged. New failures use explicit kebab-case `code` and `detail`. |
| Dependency direction | Backend may import `plugin/scripts/plan-contract.js` and `plan-tasks.js`; `plugin/` never imports `backend/`. |
| Base protection | Keep `plugin/skills/writing-plans-prescriptive/`, `plugin/scripts/plan-contract.js`, `plan-tasks.js`, `ct-step.mjs` and task-brief unchanged. |

### Plugin protocol v1

The manifest has exactly `schemaVersion`, `id`, `version`, `instructions`, `optionsSchema`,
`scripts`, and `files`. `schemaVersion` is 1; `version` is an exact semver, not a range;
`instructions` is `SKILL.md`; `scripts` has `prepare`, `validatePlan`, and `verify`, each
a package-relative `.ts` path. `files` is the exhaustive sorted list of runtime files,
including the manifest, skill, option schema and scripts. The host hashes and snapshots
these bytes. No shell commands or repository-relative executable paths in repo config.
In v1 hook code is self-contained: Node built-ins and package-relative declared files only;
no bare third-party imports or imports from the backend source tree. The host may use Ajv,
but a frozen hook must not depend on where the backend's node_modules happens to live.

`optionsSchema` points to a JSON Schema object. Use Ajv 8, added as an exact dependency
through the lockfile, for config/protocol schemas; refuse unknown fields, remote references
and schema errors. Options are validated against the installed plugin's schema.
Provider-specific options such as Ursula's `requiredWhenReferenced` belong there.

Each hook is `node <snapshot-script.ts>` with one JSON document on stdin and one JSON
document on stdout. Stderr is diagnostic only. A hook returns exit 0 for a valid response,
including a negative validation verdict; nonzero, signal, malformed JSON and timeout
are execution/protocol failures. The host validates stdout before any transition.
Do not import plugin code into the long-lived backend process.

Policy budgets, injected into adapters: 120 seconds per hook, 1 MiB stdout, 64 KiB stderr,
32 MiB total prepared artifacts, 64 configured plugins and 100 references per plugin.
Exceeding a limit is failure, never truncation presented as complete context. No automatic
retry after a reported hook failure in v1. A failed start is corrected and submitted as a new
start; the plan-check CLI retries a failed validation against the existing locked input.
Preparation may read external references but writes only its assigned staging directory;
validation reads the locked local snapshot; verification reads the implementation and
writes evidence only to its assigned evidence directory. These are trusted installed
programs with a declared contract, not an OS sandbox. Scripts must not leave child processes.

Host-owned `HookRequest` fields are `schemaVersion`, `phase`, `runId`, `pluginId`, `input`,
`paths`. `phase` is `prepare`, `validate-plan` or `verify`. `paths` contains absolute
`packageRoot`, `workspaceRoot`, `snapshotRoot`, and `outputRoot`, chosen by the host.
Preparation `input` contains options and the frozen story's origin, title, description,
manual comment and base revision. The origin is the Jira key, GitHub URL, or null for text.
The plugin owns discovery and returns `not-applicable` or `prepared`; the host never
infers that a provider was consulted from a hostname in the prompt.

A prepared response declares relative artifact paths, source references, observations,
instructions and required controls. Each observation has a local key, source-reference key
and factual text; its stable identity is `<plugin-id>:<local-key>`. Each control has a local
key and `scope` equal to `task` or `global`. The executable is always the manifest's `verify`
hook, selected by control key. No command supplied by downloaded prototype content executes.
Artifact paths must remain inside the output root after realpath resolution, including
symlinks. Source and instruction digests are computed by the host, not accepted from stdout.

`validatePlan` returns `valid` or `invalid` with findings carrying stable `id`, `message`
and optional observation ID. `verify` returns `passed`, `failed` or `unverifiable`, with
findings and evidence paths. Only `passed` permits that Verification command to succeed.
The synthetic plugin exercises every response; #142 will implement actual Ursula discovery.

### Artifacts, coverage and the unchanged plan

For applicable plugins materialize `docs/superpowers/plans/context-<issue>/`:
`plugins.lock.json`, `instructions.md`, `<plugin-id>/source.json`, provider artifacts,
and `coverage.json`. The backend writes all except `coverage.json`, which the planner writes.
Using `context-<issue>` avoids accidentally matching `planFilesForIssue`'s `issue-<n>-`
pattern for companion Markdown files. Commit this directory together with the plan.
Internal journal, receipts and execution evidence stay under the backend state root.

The lock declares run ID, repository, issue, worktree identity, base SHA, normalized config,
source digest, package digests and artifact digests. Canonical JSON sorts object keys;
array order is preserved, UTF-8, LF, SHA-256 hex. The state root's copy of the lock digest
is authoritative: deleting or replacing the worktree's lock does not disable validation.
Local absolute runtime paths are in journal/brief only, never the committed lock.
Record the exact Node runtime version used for hook preparation; a different runtime on
recovery is an explicit compatibility failure until inputs are reviewed again. Credentials
are runtime dependencies and never serialized into snapshots or hashes of environment maps.

Coverage is strict JSON `{schemaVersion:1,items:[...]}`. Each item has `observationId`,
`disposition` (`included`, `excluded`, `unresolved`), `reason`, and `bindings`.
Included items have nonempty bindings: `{task, testNames, expected, controls}`. `task` is
the exact existing Task number; test names occur in that task's Tests list; `expected`
is a concrete observable predicate also present in the task text. Excluded items require
a reason and no bindings. Unresolved items block readiness. Missing, duplicate or unknown
observation IDs fail. Multiple plugins remain namespaced; contradictory prescriptions
are resolved explicitly in Closed decisions and reviewed, never resolved by plugin order.

The generic coverage validator checks these structural relationships using `extractTasks`;
the provider validator checks its own semantics. Neither claims to prove that the agent
understood a screen or that a test body asserts the right behavior. Expected assertions
remain human-reviewable, and actual behavior is measured during implementation.

Instructions tell the planner to put goals in §1, decisions in §2, existing local reference
paths in §3, test strategy in §6, per-task behavior in §7, and commands in existing
Verification fences. Each included observation ID and its requirement must appear inside
the assigned task; references alone in §5 are insufficient because §5 does not travel.
Required global controls occur in §8, task controls in the corresponding Verification.

### State machine and lifecycle

`PlanningPlugins` owns a closed transition table. State is journaled by run ID; the
repository/issue/worktree index locates it after agent recovery. Internal phases:
`resolving`, `preparing`, `context-ready`, `launch-pending`, `planning`, `validating`,
`ready`, `approval-pending`, `approved`, `blocked`, `uncertain`.
Blocked records retain the failed phase and typed cause. No arbitrary transition is legal.

| Event | Required transition/effect |
|---|---|
| Config/package resolution succeeds | resolving → preparing; freeze packages and source input. |
| Every configured hook answers | preparing → context-ready; atomically publish artifacts, or record no applicability. |
| Before agent launch | context-ready → launch-pending, persist before calling the existing launcher. |
| Existing launcher confirms handle/sentinel | launch-pending → planning; bind its actual handle. |
| Plan validation requested | planning/ready → validating; read current files, verify locked evidence, run base then plugin checks. |
| Invalid plan | validating → planning with findings for the same agent; no automatic unbounded correction loop. |
| Valid committed plan | validating → ready, with digest of plan + coverage + locked artifacts. |
| Valid uncommitted draft | validating → planning; CLI succeeds, but readiness still waits for commit. |
| Human asks implementation | ready → approval-pending, revalidate, pin the exact digest, then invoke existing GO/resume. |
| Existing implementation start confirmed | approval-pending → approved. |
| Process/API failure | blocked; retain snapshots, reject readiness and GO. |
| Crash in a non-repeatable launch/GO window | uncertain until existing agent/run evidence resolves the outcome. |

The plan-check CLI may retry a blocked validation by entering validating with the same
snapshot. An interrupted preparation with unfinished output becomes blocked; it is not
silently rerun. Recovery can launch a context-ready record exactly once because no launch
intent was persisted yet; launch-pending always requires reconciliation. Persist the
PlanBriefing identity and baseline before context-ready so this path needs no second baseline.

No journal state is fabricated from the agent's acknowledgement. Serialize transitions
per run with an exclusive lock and atomic rename; concurrent validation/approval cannot
overwrite a newer revision. Re-read digests before publishing ready or issuing GO;
mutation during validation fails as `plugin-input-changed`. Once approved, its digest is
immutable. Changing a plan after approval requires the existing review/amendment process,
not silently blessing a new digest. Runtime verification checks the approved inputs.
The lock records owner PID and process start identity. Reclaim it only after proving that
owner is gone on this host; inability to prove ownership leaves the run blocked. A wall-clock
age alone never authorizes stealing a live validation or approval lock.

Normal preparation failures after worktree creation clean only host staging artifacts and
use the existing undo/requeue compensation before returning a start failure. Backend-only
snapshots remain for diagnosis. Crash recovery retains the worktree and refuses duplicate
launch until `WorktreePlans` and the launcher sentinel conclusively identify what ran.
Existing issue-creation semantics stay unchanged; no reissue of `gh issue create` on an
uncertain response. A fresh POST is not advertised as a retry of a lost start request.

### Backend integration without changing the base planner

Add an optional preparation step to `StartPlan`, injected only when admission is enabled.
Run it after the current worktree/baseline preparation and before the existing launcher,
with the already-read story, comment, target and issue. This avoids a second story read.
Before preparing, read configuration from the cut base and check the checkout's config
agrees; missing config/list-empty short-circuits. The existing multi-target loop keeps
per-target plugin failures in `failed` while other repositories can start.

`PluginPlanAgents` decorates the existing `PlanAgents` port to journal launch/resume
boundaries. `PluginPlanAgentBrief` extends the existing brief builder and appends a
host-rendered context section on launch, review and implementation. It keeps the original
brief as an unchanged prefix and the mandatory skill invocation. The context section
includes the exact local paths, expected artifact digest, and the extra validation command.
Recovered sessions derive context from repo/issue/worktree journal identity, not memory.

`PluginPlanProgress` decorates `PlanProgress`: invoke the current `PlanContractProgress`
first; for ready plugin-backed plans require matching committed artifacts and successful
extra validation. Missing context, missing package snapshot or script failure cannot
become plain ready. `ImplementPluginPlan` wraps `ImplementPlan`: validate and persist
approval-pending before the existing mint/answerGo/resume calls. The route's present
fail-open handling of an unreadable review is not sufficient for plugin-backed plans;
the wrapper's own failure prevents GO. Legacy behavior stays on the old collaborator.

A new backend CLI, `backend/src/infrastructure/plan-plugin-check.ts`, accepts exactly
`--issue N --repo owner/name --phase plan|verify` and, for verify, `--plugin ID --control ID`.
It derives the worktree from cwd and the run from the backend registry, not caller-supplied
artifact paths. Plan phase calls the current base validator and the additional validator;
verify runs the pinned provider control against the actual current workspace. Exit 0 means
valid/passed, 6 means a plan needs changes, 2 means invocation failure, 7 means control red,
and 8 means execution/context unavailable. Stdout is structured result, stderr diagnostics.
Both CLI and backend compose the same application services. No new HTTP endpoint is needed.

The appended brief requires the current base check AND this CLI's plan phase before
publication. Backend readiness and implementation admission independently enforce the
same checks even if the agent skips the command. Required verify invocations are ordinary
literal commands in the plan and therefore executed by the existing `ct-step` machinery.
The published plan necessarily refers to this backend installation's executable, as its
current brief already refers to absolute `dispatch-check` and `ct-step` paths. Recovering
on another installation regenerates the local command binding and requires plan review.

## 3. Reference patterns

Files to imitate:
- `backend/src/application/actions/start-plan.ts` — ordered side effects and compensation.
- `backend/src/application/actions/implement-plan.ts` — existing GO boundary.
- `backend/src/infrastructure/plan-agent-brief.ts` — mandatory planning instructions.
- `backend/src/infrastructure/plan-contract-progress.ts` — readiness from real checks.
- `backend/src/infrastructure/active-plan-recovery.ts` — uncertainty and recovery.
- `backend/src/infrastructure/disk-implementation-start-registry.ts` — durable identity.
- `backend/src/infrastructure/tool-runner.ts` — literal subprocess results.
- `backend/src/infrastructure/invocation.ts` — startup configuration.
- `backend/__tests__/application/start-plan.test.ts` — outside-in tests and scenario mothers.
- `backend/__tests__/infrastructure/plugin-contract.test.ts` — cross-package contract tests.
- `plugin/scripts/plan-contract.js` and `plugin/scripts/plan-tasks.js` — import, never reimplement.

Rules to obey:
- `AGENTS.md` and `backend/conventions/this-repository.md`.
- `plugin/conventions/architecture.md`, `plugin/conventions/boundaries.md`.
- `plugin/conventions/domain.md`, `plugin/conventions/decisions.md`.
- `plugin/conventions/defects.md`, `plugin/conventions/simplicity.md`.
- `plugin/conventions/style.md`, `plugin/conventions/testing.md`.

All backend runtime code, helpers and tests are TypeScript, erasable syntax, exact `.ts`
relative imports, classes rather than free functions, no code comments. Ports describe
collaborators, application orchestrates, infrastructure owns JSON, filesystem and processes.
New failure families go in the existing domain exception catalogue, with execution and
unreadable-answer causes separated. Tests use named mothers and observable effects.

## 4. Inventory

The task Files lists are the authoritative create/modify inventory, including tests.

| Area | Action | Consumer | Tasks |
|---|---|---|---|
| Backend plugin configuration, contracts, registry and protocol | create | preparation/validation use cases | 1–3 |
| Frozen artifacts and state journal | create | planner, progress, approval and recovery | 4–5 |
| Start preparation and contextual agent collaborators | create/modify | existing start and review flow | 6–7 |
| Coverage, validation and control execution | create | progress, implementation and CLI | 8–10 |
| Composition root and API refusal projections | modify | backend entrypoint | 11 |
| Installed-plugin documentation and fixture package | create | plugin author and test suite | 3, 12 |
| Base prescriptive skill, template and plugin scripts | protected | existing consumers | no edits |

## 5. Interfaces

Consumes: `StartPlanParams`, `UserStory`, `PlanComment`, `PlanTarget`, `PlanIssue`,
`WorkspaceLocation`, `PlanBriefing`, `PlanAgents`, `PlanProgress`, `ImplementPlanParams`.
Backend adapters consume `checkPlans`/`validatePlan` and `extractTasks` from the existing
JavaScript package; literal protocol fields terminate at infrastructure boundary models.

Produces: `PreparePluginPlan.execute(PreparePluginPlanParams): Promise<PreparedPluginPlan>`
for StartPlan; `ValidatePluginPlan.execute(ValidatePluginPlanParams): Promise<ValidatedPluginPlan>`
for readiness/approval/CLI; `VerifyPluginControl.execute(VerifyPluginControlParams): Promise<VerifiedPluginControl>`
for ordinary Verification commands; `PlanningPlugins.after(event)` for the journal policy.
The three use cases have immutable parameter/result objects beside their owner. Independent
cross-layer values live in value-objects; protocol models remain with their sole adapter.

Collaborator ports: `PlanPlugins` (installed packages/config and hook conversations) and
`PlanningContexts` (snapshot, journal, identity, approval receipt and locks). They grow
methods for their existing collaborator rather than one port per hook. New types referenced
in a task's contract are created in that task or in an explicitly earlier task.

## 6. Test strategy

Outside-in: use cases with ports doubled, then adapters against literal captured inputs,
then one happy-path integration through the edge. Synthetic-provider fixtures are explicitly
synthetic; they do not claim to be an Ursula response. Real-process tests carry the
`-real-process.test.ts` suffix and kill children in afterEach, including on failed assertions.

Separate OFF and ON test groups. OFF pins existing prompts, ordering, replies, compensation
and absence of plugin IO. ON pins selection, immutable context, durable transition ordering,
coverage and enforcement. Removing config after start, deleting the lock, changing the plan
after validation, backend restart and concurrent approval are first-class cases.
At least one real child process must implement prepare/validate/verify and demonstrate a
red result when the controlled implementation fixture is wrong; a scripted `passed` response
alone does not prove executable controls work.

Verification commands below run from the repository root. They are baseline commands,
not claims that future tests already pass. Baseline on `cbf78c6`: backend typecheck passed;
backend suite passed (57 files, 1434 tests); prescriptive/parser/brief subset passed (3 files,
146 tests). The full plugin suite exceeded a 120-second planning-session budget; it is not
claimed green. Node 24 is used for the plugin subset because its Vitest 5 engine excludes
the shell's Node 25. New code must pass the backend suite and typecheck as it lands.
Each task names its new tests explicitly; the whole-backend command includes them once added.

## 7. Tasks

### Task 1 — Resolve repository selections without changing legacy planning

**Objective:** A repository selects installed plugins with a strict, versioned configuration.

**Files:** `backend/src/application/actions/prepare-plugin-plan.ts` (create), `backend/src/domain/ports/plan-plugins.ts` (create), `backend/src/domain/value-objects/plugin-selection.ts` (create), `backend/src/infrastructure/disk-plan-plugins.ts` (create), `backend/src/domain/exceptions.ts` (modify), `backend/__tests__/application/prepare-plugin-plan.test.ts` (create), `backend/__tests__/infrastructure/disk-plan-plugins.test.ts` (create).

Contract (backend/src/domain/value-objects/plugin-selection.ts):
```ts
export type PluginSelectionKind = 'absent' | 'empty' | 'configured'
export type PluginOption = null | boolean | number | string | readonly PluginOption[] | { readonly [key: string]: PluginOption }
```

Create frozen PluginSelection/SelectedPlugin values with domain questions for applicability;
raw JSON maps stay in the adapter. PlanPlugins initially exposes selection and package
resolution. PreparePluginPlan initially resolves only; later tasks extend the same use case.
Read config through git at the cut base, compare checkout bytes, distinguish ENOENT from
unreadable git/config. Enforce §2's 64-plugin limit, duplicates and fields. Unknown installed
ID is an error, never an ignored entry. Add PluginContextNotRead/NotUnderstood under
PlanFailure; keep format parsing at the adapter boundary.

**TDD:** 'an unknown configured plugin prevents preparation' — no hook or launch request after resolution fails.

**Tests:** added: 'an unknown configured plugin prevents preparation', 'an absent or empty configuration asks no plugin to run', 'configuration order cannot change preparation order', 'malformed duplicate and excessive selections are refused', 'dirty and untracked configuration cannot silently become the planning input'; no removals.

**Verification:** Existing whole-backend baseline; also includes these new tests after implementation.
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 2 — Define and validate the installed plugin contract

**Objective:** Only a complete, compatible installed package can participate in a plan.

**Files:** `backend/src/domain/value-objects/planning-plugin.ts` (create), `backend/src/infrastructure/disk-plan-plugins.ts` (modify), `backend/plugins/plugin.schema.json` (create), `backend/plugins/hook.schema.json` (create), `backend/package.json` (modify), `backend/package-lock.json` (modify), `backend/tsconfig.json` (modify), `backend/__tests__/infrastructure/disk-plan-plugins.test.ts` (modify).

Contract (backend/src/domain/value-objects/planning-plugin.ts):
```ts
export type PluginHook = 'prepare' | 'validate-plan' | 'verify'
export type PluginControlScope = 'task' | 'global'
```

Implement the exact manifest/request/response vocabulary in §2, with the JSON Schema
documents as the single wire contract. Domain values are immutable and constructed by
validated boundary models. Install Ajv 8 through npm with an exact package.json version
and lockfile; do not add remote schema resolution. Include `plugins/**/*.ts` in backend
typecheck. All declared files must exist, be regular, remain in the package after realpath,
and cover every runtime local dependency; no npm dependency installation by the loader.
Instructions are local files and source references are data. No generic priority or arbitrary
hook events beyond the three supported phases. Hash exact package bytes including manifest.

**TDD:** 'a package with a missing declared script is not executable' — package resolution fails before spawn.

**Tests:** added: 'a package with a missing declared script is not executable', 'unsupported versions and unknown manifest fields are refused', 'options obey the installed schema', 'a symlink cannot make a package read outside its root', 'the package fingerprint changes when instructions or a script changes'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 3 — Run real provider scripts through a bounded JSON protocol

**Objective:** The backend obtains measured hook results from executable plugins.

**Files:** `backend/src/infrastructure/process-plan-plugins.ts` (create), `backend/src/domain/ports/plan-plugins.ts` (modify), `backend/src/domain/value-objects/plugin-contribution.ts` (create), `backend/src/domain/exceptions.ts` (modify), `backend/__tests__/infrastructure/process-plan-plugins.test.ts` (create), `backend/__tests__/infrastructure/process-plan-plugins-real-process.test.ts` (create), `backend/__tests__/fixtures/planning-plugin/plugin.json` (create), `backend/__tests__/fixtures/planning-plugin/SKILL.md` (create), `backend/__tests__/fixtures/planning-plugin/options.schema.json` (create), `backend/__tests__/fixtures/planning-plugin/scripts/hook.ts` (create).

Contract (backend/src/domain/value-objects/plugin-contribution.ts):
```ts
export type ContributionKind = 'not-applicable' | 'prepared'
export type PluginVerdict = 'valid' | 'invalid'
export type ControlVerdict = 'passed' | 'failed' | 'unverifiable'
```

ProcessPlanPlugins owns the subprocess conversation and uses the same filesystem/package
collaborator through composition. Use node executable + argv, no shell, close stdin after
one request, read until child close. Inject all §2 budgets. Kill an over-budget child and
drain it before cleanup; never interpret partial stdout. Nonzero/timeout and unreadable
zero-exit output are distinct PluginHookNotRun/NotUnderstood failures. Stage files under
outputRoot; validate all returned paths before promotion. The synthetic hook selects
behavior by fixture options and actually reads a controlled source file during verify.

**TDD:** 'a timed out hook cannot publish partial context' — no prepared result or promoted files.

**Tests:** added: 'a timed out hook cannot publish partial context', 'stdout is parsed only after the process closes', 'nonzero and malformed success are different failures', 'output budgets fail rather than truncate', 'a negative verdict is not an execution failure', 'a real control fails on the wrong implementation bytes'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 4 — Freeze source, packages and context into durable snapshots

**Objective:** A prepared plan keeps reproducible inputs across updates and restarts.

**Files:** `backend/src/domain/ports/planning-contexts.ts` (create), `backend/src/domain/value-objects/planning-context.ts` (create), `backend/src/infrastructure/disk-planning-contexts.ts` (create), `backend/src/application/actions/prepare-plugin-plan.ts` (modify), `backend/__tests__/application/prepare-plugin-plan.test.ts` (modify), `backend/__tests__/infrastructure/disk-planning-contexts.test.ts` (create).

Contract (backend/src/domain/value-objects/planning-context.ts):
```ts
export type ContextKind = 'not-applicable' | 'prepared'
export type SnapshotDigest = string
```

PlanningContexts owns atomic snapshot publication and run lookup. Store immutable inputs
under `<stateRoot>/planning-plugins/<runId>/`; index by repository/issue/canonical worktree.
Capture original UserStory values, manual comment and base SHA once. Materialize exactly
the companion paths in §2 only when a contribution applies. Write instructions with plugin
provenance and source paths; distinguish trusted skill text from quoted source artifacts.
Hash canonical metadata and exact artifact/package bytes. The registry stores its own
digest, so deleting worktree context does not turn an opted-in run into a legacy one.
Do not copy backend state or local absolute paths into committed metadata.

**TDD:** 'a source update cannot change an already prepared context' — reload yields identical input/package/artifact digests without provider IO.

**Tests:** added: 'a source update cannot change an already prepared context', 'a partial snapshot is never discoverable as prepared', 'the same issue number in two repositories has separate context', 'deleting a worktree lock cannot erase a recorded obligation', 'no applicable contribution leaves the governed plan directory untouched', 'a different hook runtime cannot reuse a frozen context'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 5 — Drive preparation and recovery with a durable state machine

**Objective:** The machine can resume completed preparation without duplicating uncertain side effects.

**Files:** `backend/src/domain/policies/planning-plugins.ts` (create), `backend/src/domain/value-objects/plugin-planning-run.ts` (create), `backend/src/application/actions/prepare-plugin-plan.ts` (modify), `backend/src/application/actions/recover-plugin-plan.ts` (create), `backend/src/domain/ports/planning-contexts.ts` (modify), `backend/src/infrastructure/disk-planning-contexts.ts` (modify), `backend/__tests__/application/prepare-plugin-plan.test.ts` (modify), `backend/__tests__/application/recover-plugin-plan.test.ts` (create), `backend/__tests__/infrastructure/disk-planning-contexts.test.ts` (modify).

Contract (backend/src/domain/value-objects/plugin-planning-run.ts):
```ts
export type PluginPlanningPhase =
  | 'resolving' | 'preparing' | 'context-ready' | 'launch-pending'
  | 'planning' | 'validating' | 'ready' | 'approval-pending'
  | 'approved' | 'blocked' | 'uncertain'
```

Implement §2's total transition table in PlanningPlugins; return immutable next-state/effect
values, never booleans or raw maps. Each IO step stays behind the existing collaborator
ports. Disk journal updates acquire an exclusive per-run filesystem lock, use revision
compare-and-swap and atomic rename. Persist before non-repeatable effects. On startup,
RecoverPluginPlan reconciles launch/approval uncertainty with WorktreePlans and recorded
implementation evidence. Unknown outcomes remain uncertain; no blind replay. Completed
hooks reuse their frozen results; unfinished preparation is blocked and staging discarded.

**TDD:** 'recovery never relaunches an agent whose launch outcome is unknown' — launch port remains untouched and phase is uncertain.

**Tests:** added: 'recovery never relaunches an agent whose launch outcome is unknown', 'completed preparation is not repeated after restart', 'a transition out of order cannot alter the journal', 'two writers cannot publish the same next revision', 'a confirmed recovered agent resumes the recorded planning run', 'a live lock is never reclaimed by age alone', 'a prepared but unlaunched run can launch once after recovery'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 6 — Prepare plugin context before the existing agent launch

**Objective:** Backend starts with configured plugins cannot launch a planner before context is ready.

**Files:** `backend/src/application/actions/start-plan.ts` (modify), `backend/src/application/actions/prepare-plugin-plan.ts` (modify), `backend/src/domain/ports/plan-preparation.ts` (create), `backend/src/infrastructure/application-plan-preparation.ts` (create), `backend/src/infrastructure/plugin-plan-agents.ts` (create), `backend/__tests__/application/start-plan.test.ts` (modify), `backend/__tests__/infrastructure/plugin-plan-agents.test.ts` (create).

Current state (backend/src/application/actions/start-plan.ts):
```ts
    const sown = await this.#prepare(target, issue)
    const located = sown.located
    const agent = await this.#launch(target, story, issue, located)
```

Add optional `preparation` collaborator to StartPlan, absent in the legacy graph. The
PlanPreparation port's `beforeLaunch` takes target, issue, sown workspace, story detail
and manual comment; its adapter invokes PreparePluginPlan. Insert it between the cited
prepare and launch, preserving legacy call order. Catch preparation failure separately:
undo the newly prepared worktree and requeue the claim exactly once, preserving the original
cause. No duplicate baseline or story fetch. Existing launch compensation remains its owner.
PluginPlanAgents decorates PlanAgents, records launch-pending before delegate launch and
planning only after its confirmed handle; uncertain failure does not trigger blind relaunch.
Review/fix/resume delegate the existing operations with journal identity carried locally.

**TDD:** 'a required preparation failure never launches a planner' — undo/requeue once and exact failure in the target result.

**Tests:** added: 'a required preparation failure never launches a planner', 'the original planner receives only a fully published context', 'one plugin failure does not stop another repository from starting', 'legacy starts perform the original calls without plugin IO', 'launch is journaled before the delegate is asked'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 7 — Add instructions to the existing brief rather than replacing the skill

**Objective:** Launch, review and implementation see the same pinned plugin requirements.

**Files:** `backend/src/infrastructure/plugin-plan-agent-brief.ts` (create), `backend/src/infrastructure/plugin-plan-agents.ts` (modify), `backend/src/domain/value-objects/planning-context.ts` (modify), `backend/__tests__/infrastructure/plugin-plan-agent-brief.test.ts` (create), `backend/__tests__/infrastructure/plugin-contract.test.ts` (modify).

Current state (backend/src/infrastructure/plan-agent-brief.ts):
```ts
      'Escribe el plan con control-tower-loop:writing-plans-prescriptive, usando el issue como spec.',
```

PluginPlanAgentBrief extends PlanAgentBrief and obtains its context through a constructor-
injected synchronous journal lookup, populated before launch and recovered before use.
Each override calls the corresponding superclass renderer and appends one English section
only for prepared context. That section says to read the pinned instructions and artifacts,
place behavior in existing tasks and tests, write coverage.json, retain the base validation,
run the exact extra CLI command, and commit companions with the plan. It carries paths and
digest rather than an unbounded pasted HTML document. Add a review reminder to revalidate
the same snapshot. An absent contribution returns the superclass bytes exactly.
Exercise the real task extractor/brief script with a fixture plan to show §2/§3 and task
requirements reach implementers; do not change the base skill to introduce another planner.

**TDD:** 'plugin instructions cannot replace the mandatory prescriptive invocation' — base brief is an unchanged prefix and the original skill sentence is present.

**Tests:** added: 'plugin instructions cannot replace the mandatory prescriptive invocation', 'no applicable plugin leaves every brief byte identical', 'review uses the original snapshot rather than current configuration', 'an implementation task receives its assigned behavior and reference'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 8 — Validate plugin coverage using the unchanged plan parser

**Objective:** A syntactically valid base plan cannot omit plugin-backed behavior silently.

**Files:** `backend/src/application/actions/validate-plugin-plan.ts` (create), `backend/src/domain/value-objects/plugin-plan-coverage.ts` (create), `backend/src/domain/policies/plugin-coverage.ts` (create), `backend/src/infrastructure/disk-plan-coverage.ts` (create), `backend/plugins/coverage.schema.json` (create), `backend/src/domain/ports/planning-contexts.ts` (modify), `backend/__tests__/application/validate-plugin-plan.test.ts` (create), `backend/__tests__/infrastructure/disk-plan-coverage.test.ts` (create).

Contract (backend/src/domain/value-objects/plugin-plan-coverage.ts):
```ts
export type CoverageDisposition = 'included' | 'excluded' | 'unresolved'
export type PlanValidationKind = 'valid' | 'needs-changes' | 'unverifiable'
```

Implement coverage.json's exact §2 contract. DiskPlanCoverage invokes existing checkPlans
and extractTasks and maps their outputs into domain values; it does not parse Markdown
again. Check full observation set, task number, literal test name, expected predicate,
inline observation reference and mandatory task/global control command. Reject an empty
bindings array for included observations and unresolved items. An excluded observation
has its reason printed in plan §2; the decision remains reviewable. Run each provider's
validatePlan against locked inputs after base/coverage success. Registry supplies the
expected lock, so a missing lock is failure. Recheck all input hashes before saving verdict.

**TDD:** 'a base-valid plan missing one observed state cannot become ready' — returns needs-changes with the missing ID.

**Tests:** added: 'a base-valid plan missing one observed state cannot become ready', 'coverage rejects unknown duplicate and unresolved observations', 'a claimed test must belong to the assigned task', 'required controls must occur in executable verification blocks', 'a reasoned exclusion stays visible for review', 'a changed input invalidates a verdict computed concurrently'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 9 — Enforce combined readiness and bind GO to the validated revision

**Objective:** Plugin-backed plans need valid committed context before readiness or human-triggered implementation.

**Files:** `backend/src/infrastructure/plugin-plan-progress.ts` (create), `backend/src/application/actions/implement-plugin-plan.ts` (create), `backend/src/infrastructure/implement-plan-route.ts` (modify), `backend/src/domain/ports/planning-contexts.ts` (modify), `backend/src/domain/exceptions.ts` (modify), `backend/__tests__/application/implement-plugin-plan.test.ts` (create), `backend/__tests__/infrastructure/plugin-plan-progress.test.ts` (create), `backend/__tests__/infrastructure/implement-plan-route.test.ts` (modify).

Current state (backend/src/application/actions/implement-plan.ts):
```ts
    const nonce = await this.goRegistry.mint({
      issueNumber: params.issue, repository: params.repository,
    })
```

PluginPlanProgress decorates PlanProgress, preserving committedAt and legacy results. It
requires base READY, committed companions, registry digest and additional validation before
READY; invalid maps to WRITING, IO/protocol error to PlanProgressNotRead. Reuse a successful
verdict only when every digest matches; polls do not rerun expensive hooks unnecessarily.
ImplementPluginPlan wraps ImplementPlan.execute: exclusively validate, persist approval-
pending for the exact committed plan/coverage/context digest, then call the existing use
case containing the cited mint. Invalid/unreadable/missing context means no mint, comment
or resume. Failed resume leaves uncertain approval for existing recovery, not another GO.
Add explicit plugin-plan-invalid/plugin-context-unavailable refusal projections. Live
config or admission OFF cannot bypass a journaled plugin obligation.

**TDD:** 'an invalid plugin-backed plan cannot mint a go even when base validation succeeds' — no original implementation side effect.

**Tests:** added: 'an invalid plugin-backed plan cannot mint a go even when base validation succeeds', 'removing configuration does not waive an existing plan obligation', 'a missing snapshot cannot become legacy readiness', 'two implementation requests cannot approve different revisions', 'an unreadable plugin check fails closed at implementation admission', 'the off path retains current implementation behavior'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 10 — Execute pinned controls through ordinary Verification commands

**Objective:** The existing implementation runner measures plugin-required controls on real implementation bytes.

**Files:** `backend/src/application/actions/verify-plugin-control.ts` (create), `backend/src/infrastructure/plan-plugin-check.ts` (create), `backend/src/infrastructure/plugin-runtime.ts` (create), `backend/src/domain/ports/planning-contexts.ts` (modify), `backend/__tests__/application/verify-plugin-control.test.ts` (create), `backend/__tests__/infrastructure/plan-plugin-check-real-process.test.ts` (create).

Contract (backend/src/infrastructure/plan-plugin-check.ts):
```ts
export const PluginCheckExit = Object.freeze({
  PASSED: 0, USAGE: 2, PLAN_INVALID: 6, CONTROL_FAILED: 7, UNAVAILABLE: 8,
} as const)
```

Implement the CLI grammar in §2, with typed boundary models and explicit exit projection.
PluginRuntime is the infrastructure composition shared by CLI and server. The caller cannot
choose arbitrary artifact/script paths; resolve cwd, issue and repo against the registry.
For verify, require approved input digests, declared control ID and current task/global
binding; execute the pinned verify hook. Evidence records actual implementation revision
and dirty-content digest of declared task files, command, result and source digest. Use
unique attempt directories. A pass against different bytes cannot satisfy this invocation.
The plan's existing Verification command invokes this CLI, so ct-step measures its exit;
no changes to the run machine or its report format. Validate-plan phase works before commit
for author iteration, while readiness/admission separately require committed inputs.

**TDD:** 'a required control failure is the exit observed by the existing runner' — real child returns 7 and cannot be treated as a pass.

**Tests:** added: 'a required control failure is the exit observed by the existing runner', 'an unknown control cannot execute a provider script', 'unverifiable and failed controls never return zero', 'changed approved inputs prevent verification', 'evidence identifies the bytes actually checked', 'the plan check command cannot bypass the base contract'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 11 — Wire admission, recovery and failure projection at the backend edge

**Objective:** The feature is opt-in and complete through start, restart, review and implementation.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify), `backend/src/infrastructure/invocation.ts` (modify), `backend/src/infrastructure/start-plan-route.ts` (modify), `backend/src/infrastructure/active-plan-recovery.ts` (modify), `backend/src/infrastructure/plugin-runtime.ts` (modify), `backend/src/domain/exceptions.ts` (modify), `backend/__tests__/infrastructure/invocation.test.ts` (modify), `backend/__tests__/infrastructure/start-plan-route.test.ts` (modify), `backend/__tests__/infrastructure/active-plan-recovery.test.ts` (modify), `backend/__tests__/infrastructure/planning-plugins-real-process.test.ts` (create).

Current state (backend/src/infrastructure/invocation.ts):
```ts
  static readonly HARVEST_TABLE_VARIABLE = 'CT_HARVEST_BQ_TABLE'
```

Add `CT_PLAN_PLUGINS` and its exact §2 parsing beside existing startup configuration.
CtApi composes optional preparation and contextual collaborators only for ON admission;
legacy instances remain the OFF branch. The persisted-run lookup still enforces/recoveries
previously opted-in plans when new admission is OFF. Type startup/route collaborators by
their consumed execute interface so decorators fit without casts. Project new start failures
as plugin-config-unavailable, plugin-config-invalid, plugin-context-unavailable and
plugin-context-invalid, preserving original single/list response shapes. Add recovery of
plugin journals before existing active-plan registration; missing/corrupt snapshots remain
explicitly blocked/uncertain. No frontend state expansion in this issue. One real-process
integration uses a temporary installed synthetic plugin and literal source fixture, checks
context-before-launch, existing skill, readiness, human admission, red then green control.

**TDD:** 'disabled admission performs the legacy start without loading plugins' — exact legacy result and zero plugin operations.

**Tests:** added: 'disabled admission performs the legacy start without loading plugins', 'invalid admission values are refused at startup', 'enabled planning completes through a real installed plugin', 'restart recovers plugin context before presenting readiness', 'plugin failures preserve the existing partial-start response shape'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

### Task 12 — Publish the authoring contract and the Ursula handoff

**Objective:** Repository owners can enable/remove plugins and #142 can implement its provider without changing the planner.

**Files:** `backend/plugins/README.md` (create), `backend/plugins/repository-config.schema.json` (create), `backend/API.md` (modify), `README.md` (modify), `backend/__tests__/infrastructure/planning-plugin-contract.test.ts` (create).

Final text (backend/plugins/README.md):
```md
# Planning plugins

Planning plugins add context and executable obligations to the mandatory prescriptive plan.
Install a package under backend/plugins/<id>/ and select its ID in .agent/plugins.json.
Enable new plugin-backed planning with CT_PLAN_PLUGINS=1.
The prescriptive skill, its nine sections and its base validation remain mandatory.
Removing a selection affects new plans; an existing plan retains its pinned obligations.
```

Document the complete §2 wire contract, machine, CLI exits, limits, config example,
companion artifacts, validation retry and launch uncertainty, evidence ownership and existing-plan
behavior. Use the shared schema as the source of the example; test that the documented
example is accepted by the real reader, rather than testing wording. Explain that installed
code is trusted, package snapshots are self-contained, and no automatic npm installation
or provider source refresh occurs. Document #142 input: user-story prototype URL, exact
artifact snapshot, optional canvas/flow observations, explicit unknown interactions and
behavior-to-task/test coverage. Jira rich-link recovery and browser-derived behavior must
be supplied by that reader; the generic host's normalized description is not a complete
ADF document. Do not call the existing mockup-fidelity linter a React implementation test.

**TDD:** 'the documented plugin selection is accepted by the real configuration reader' — the actual documented JSON validates and resolves the installed fixture.

**Tests:** added: 'the documented plugin selection is accepted by the real configuration reader', 'the fixture hook responses obey the published schema', 'the prescriptive files remain identical to the protected base'; no removals.

**Verification:**
```bash
npm --prefix backend run typecheck
npm --prefix backend test
```

## 8. Global verification

Run from the repository root after all tasks. The first two commands were measured on
the inspected base; the third was measured using Node 24 for Vitest compatibility. The
last predicate verifies the exact protected files against the inspected commit and was
also measured on that base. No command pins a suite-wide test count.

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm exec --yes --package=node@24 -- npm --prefix plugin test -- plan-contract plan-tasks task-brief
git diff --exit-code cbf78c6 -- plugin/skills/writing-plans-prescriptive plugin/scripts/plan-contract.js plugin/scripts/plan-tasks.js plugin/scripts/ct-step.mjs plugin/skills/subagent-driven-development/scripts/task-brief
```

Implementation acceptance additionally requires the real-process plugin integration to
prove a negative control on wrong implementation bytes, and the existing backend-only
TypeScript and cross-package-boundary tests to remain green. Run the full repository CI
checks required at implementation time; the planning-session full-plugin timeout is a
baseline limitation, not permission to omit a required merge check.

Rollout: land the additive contracts/runtime behind OFF; prove legacy equivalence and the
synthetic provider; enable `CT_PLAN_PLUGINS=1` on a development backend and select the
fixture in a disposable repo; exercise restart, invalid coverage and red implementation
control; then use #142 to install Ursula for an opt-in repository. Removing repo selection
or switching admission OFF prevents new use while existing runs retain their snapshots.
After successful adoption, any removal of the admission flag is a separate explicit change;
repository selection remains the permanent product feature. No legacy planner is retired.

## 9. Assumptions

1. User decisions: backend/plugins location, repository opt-in, mandatory prescriptive
   planning, unchanged plan format, additive scripts and a preparation state machine.
2. Scope decision: #183 is the generic mechanism; #142 implements real Ursula behavior
   ingestion. The synthetic fixture is intentionally not a production plugin.
3. Author decision: environment admission flag defaults OFF; repo configuration is the
   permanent selection mechanism. This follows flag discipline and the repo's existing
   environment-based composition, without adding a remote flag service.
4. Author decision: companion JSON contains coverage and provenance so no extra Markdown
   section or marker is introduced. Semantic completeness remains a review responsibility.
5. Author decision: backend-launched plans are the first supported consumer. A standalone
   plugin installation has no backend runtime; extending /ct-next requires its own adapter.
6. Observed limitation: current AcliUserStories flattens text and loses href-only ADF links.
   A production Ursula plugin must recover those from the source origin or a later richer
   source adapter. This issue does not promise discovery of such links from plain text alone.
7. Observed baseline: backend typecheck and suite passed; relevant plugin subset passed;
   full plugin suite timed out at 120 seconds. No implementation tests exist yet.
8. Planning administration: Project 16 update failed because the token lacks read:project.
   José explicitly authorized continuing with documentation, validation and this comment;
   implementation still requires the repository's Project prerequisite to be satisfied.
9. This plan is written against main at cbf78c6, not the older feature checkout. Rebase
   and revalidate citations if the target advances before implementation.
