# #330 — The groom and gate 2

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

Gate 1 landed. The cabin already reads the governed checkout's execution spec
(`DiskEpicSpecs.mostRecent`), knows whether it is frozen (`EpicSpec#isFrozen`), writes the state
line, commits both documents, pushes the epic's branch and opens its pull request
(`FreezeSpec`), and hands the page a key that only a same-origin browser request ever receives
(`GateKey`). `SpecFreezePanel` renders all of that and says that the groom is waiting for that
pull request to merge.

Nothing after that exists. The groom is still a command a person types:
`node plugin/scripts/ct-groom.mjs <spec> --repo owner/name --milestone T [--dry-run]`, whose
stdout under `--dry-run` is the plan as JSON and whose real run creates the milestone, the labels
and one issue per row of the spec's slices table, every one of them born at `status:backlog`. And
the promotion to `status:ready` is `gh issue edit` run by hand — the plugin's own reminder on
stderr says so. Nobody checks the freeze before grooming either: `ct-groom` reads the
clarification markers and the hypothesis, never the state line.

This slice makes both an **act of the program**. The cabin shows the dry run's product before
anything mutates, runs the real groom — refused while the spec is not frozen or its committed
copy is not readable on the repository's default branch — and then offers the button that adds
`status:ready` to the epic's issues and nothing else. A groom that fails is shown in the words
`ct-groom` itself printed.

### Desired end state

- `GET /epic-groom` answers, for the checkout the coordinating session holds, one of seven
  states, every one derived from evidence and none of them stored: `none` (no coordinating
  session), `no-spec`, `draft` (the spec is not frozen: gate 1 first), `awaiting-publication`
  (frozen, and its committed copy is not readable on the default branch), `groomable` (with the
  dry run's product and the gate key), `groomed` (with the epic's issues and the gate key) or
  `authorised` (no issue left to promote).
- The dry run's product is `ct-groom --dry-run`'s own stdout, projected to what will be created:
  the milestone, and per issue its order, its title and its labels.
- `POST /epic-groom` runs the real groom over the same spec and milestone and answers the issues
  the milestone holds afterwards. It refuses `spec-not-frozen` while the state line is not
  `CONGELADA` and `spec-not-published` while `gh api repos/<repo>/contents/<spec>` cannot read
  the committed copy on the default branch, touching nothing in either case.
- A `ct-groom` that exits with anything other than 0 or 3 becomes `epic-not-groomed`, whose
  `detail` is that program's own stderr, and the cabin shows it untranslated.
- `POST /epic-promotion` adds `status:ready` to every open issue of the milestone standing at
  `status:backlog`, removing `status:backlog` from it, and touches no other label, no other
  issue and no other field. It answers the issues and which ones it promoted.
- Both presses are refused with `gate-not-from-the-page` unless they carry the key the page was
  handed, which is D-22's mechanism, already built by gate 1 and reused here.
- The cabin renders gate 2's panel in every phase in which it can act, under gate 1's, and the
  backend leaves one record line per act naming what was planned, what the milestone holds and
  what was promoted.

### Out of scope

- 🚫 `plugin/scripts/ct-groom.mjs` — invoked as a program and not modified, and neither are
  `plugin/scripts/groom.js`, `plugin/scripts/slices.js` or `plugin/scripts/gh-issue-map.js`,
  whose `resolveStatus` is imported.
- `--reconcile`, `--project` and the Project v2 with its Sprint field: the plugin marks the first
  experimental and no acceptance criterion asks for the other two.
- The dispatcher, `/start-plan`, `/implement-plan`, the plan events, the harvest and gate 1 keep
  their behaviour, their use cases and their adapters exactly as they are.
- The merge and any write to a pull request (D-7). No merge button, anywhere.
- Choosing which slice is next, claiming it or launching it: that is slice 6.
- A repository column on the milestone or on the dry run's product: issue #348 adds it later, and
  nothing here shapes the product so that adding one stops being additive.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · The entrance is a conversation with a real terminal | the cabin hosts the brainstorming and spec session as an interactive `claude` in a PTY streamed to the page, not a structured chat and not a step left outside the app. |
| D-6 · Gates 1 and 2 are acts of the app, with its own yardstick | the freeze and the promotion are buttons the program answers for, never lines the conversation's agent writes. |
| D-7 · GATE 3 is entirely human and stays on GitHub | the merge is the only act with a permanent external effect and no program performs it: a person merges on GitHub, and all the app does is notice, by sweeping, so that it can dispatch whatever the merge unblocked. The app never writes to a pull request, there is no merge button anywhere in the cabin, and no automation may acquire one without reopening this decision. |
| D-10 · Everything new under `backend/` is TypeScript | and the plugin stays JavaScript, which is the repository's own rule for what the plugin ships. |
| D-11 · A yardstick is imported from the plugin, never reimplemented | `analyzeSpecFreeze` and `analyzeSlicesTable` are the freeze's yardstick and `ct-groom.mjs` is the groom; the backend grows no second opinion about whether a spec is freezable. |
| D-13 · No phase is stored | every phase is derived from evidence that survives a restart: the spec and its state line, the milestone and its issues, a `status:ready` label, a worktree, a record, a pull request, a closed issue. |
| D-18 · There is a coordinating session and it is the boss of all of them | the entrance conversation stays as the milestone's coordinator and the human's single interlocutor. What it never does is decide the order or the phase — that is the program's. It commands by invoking the backend's endpoints and the plugin's programs, while the backend owns the processes, makes the call of each step, keeps the record and measures. |
| D-21 · The coordinating session is always in the front, and it is recoverable | the cabin offers a place to talk to it in **every** phase, and most explicitly once the implementation is running: no phase of the page may hide it, replace it with a progress panel or disable its input. |
| D-22 · The gates are the human's and no session can trigger them | the coordinating session commands the backend, but not here: writing `Estado: CONGELADA`, promoting to `status:ready` and anything around the merge are triggered only from the front, by a person's click. There is no endpoint for them that a session can call, and an attempt is refused with an explicit code rather than obeyed. Everything else does travel through the boss: starting work already authorised, asking for changes, unblocking what is stuck. This is the repository's own doctrine — the go the agent cannot write — applied to the coordinator now that it has hands. |
| D-23 · After the freeze the app publishes the spec, and the groom waits for its merge | pressing gate 1 commits the state line and then does what a person would do next: push the epic's branch and open its pull request with the design and the spec in it. The groom stays refused until the spec's committed copy is readable on the **default** branch, and what achieves that is the human merging that pull request — not a fourth gate, but D-7 again: the app never merges. The reason the branch is not enough is written in `spec-link.js`: the issue's link resolves against the default branch on purpose, because a feature branch is deleted on merge and the link would rot. Grooming earlier gives every issue a text reference instead of a link, and fixing it afterwards needs `--reconcile`, which the plugin marks experimental. |
| D-14 · The `plan` gate stops being implied | only `visual` and `apply` survive as human gates; the protocol behind the go is documented as debt in A-3 and retired in later work. |
| D-25 · The context of every call is composed by the plugin and relayed verbatim | the backend hands over paths and pastes none of that text into a prompt. |
| Every other decision of the epic | D-2, D-3, D-4, D-5, D-8, D-9, D-12, D-15, D-16, D-17, D-19, D-20, D-24 and D-26 are in the issue and bind unchanged; none of them adds a constraint this slice can violate, because none of them speaks about the groom, the epic's issues or the promotion. |

## 3. Reference patterns

Files to imitate: `backend/src/domain/value-objects/freeze-finding.ts` (a small frozen value
object), `backend/src/domain/ports/epic-specs.ts` (a port whose methods throw "must implement"),
`backend/src/infrastructure/dispatch-check-workbench.ts` (an adapter that runs a plugin script
through `node` and projects its exit codes), `backend/src/infrastructure/plan-contract-progress.ts`
(the same, with static argv builders and a `cwd`), `backend/src/infrastructure/gh-plan-issues.ts`
(a `gh` adapter over the `Gh` idiom, with its argv builders, its JSON reading and its typed
errors), `backend/src/infrastructure/gh-pull-requests.ts`,
`backend/src/application/queries/read-spec-freeze.ts` (a query that derives a state from
evidence), `backend/src/application/actions/freeze-spec.ts` (an action that refuses before
mutating), `backend/src/infrastructure/spec-freeze-route.ts` (a route with GET and POST, a
`Projection` of refusals, the gate key and `PlanCollapse`),
`backend/src/infrastructure/http.ts` (`Answer`, `Refusal`, `Browsers`),
`backend/__tests__/application/read-spec-freeze.test.ts`,
`backend/__tests__/application/freeze-spec.test.ts`,
`backend/__tests__/infrastructure/spec-freeze-route.test.ts` (a controller through a real
listening server), `backend/__tests__/infrastructure/gh-plan-issues.test.ts`,
`backend/__tests__/infrastructure/dispatch-check-workbench.test.ts`,
`frontend/src/app/spec-freeze/client.ts`, `frontend/src/app/spec-freeze/useSpecFreeze.ts`,
`frontend/src/app/spec-freeze/components/spec-freeze-panel/SpecFreezePanel.tsx`,
`frontend/src/app/spec-freeze/components/spec-freeze-panel/SpecFreezePanel.css`,
`frontend/src/__scenarios__/SpecFreezeMother.ts`,
`frontend/src/pages/home/__tests__/Home.specFreeze.test.tsx`.

Rules to obey: `.agent/conventions-ack.md`, `CLAUDE.md` and `AGENTS.md` (English everywhere
except what a person reads in the product, which is Spanish; the loop's `status:` vocabulary and
the spec's parsed Spanish headings are contract and do not move),
`backend/conventions/this-repository.md` (the layout, the exception families and their two
causes, `{code, detail}` in kebab-case, which status a refusal answers, how a tool is talked to,
where the suite runs), `frontend/README.md` (the frontend yardstick, the design system mirrors,
the vite proxy). Skills named by the epic context:
`backend-engineering:backend-best-practices`, `frontend-engineering:frontend-best-practices`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/groom-plan.ts` | create | the query, the adapter | Contract (T1) |
| `backend/src/domain/ports/epic-groom.ts` | create | the query, the action | Contract (T1) |
| `backend/src/infrastructure/ct-groom-epic.ts` | create | `ct-api.ts` | Contract (T1) |
| `backend/src/domain/exceptions.ts` | modify | the adapters, `PlanCollapse` | Contract (T1, T2, T3) |
| `backend/src/infrastructure/start-plan-route.ts` | modify | the routes | none (body by TDD) |
| `backend/__tests__/infrastructure/plan-refusal.test.ts` | modify | the guard | none (body by TDD) |
| `backend/src/domain/ports/published-specs.ts` | create | the query | Contract (T2) |
| `backend/src/infrastructure/gh-published-specs.ts` | create | `ct-api.ts` | Contract (T2) |
| `backend/src/infrastructure/gh.ts` | modify | `GhPublishedSpecs` | Contract (T2) |
| `backend/src/domain/value-objects/epic-issue.ts` | create | the query, the actions | Contract (T3) |
| `backend/src/domain/ports/epic-issues.ts` | create | the query, the action | Contract (T3) |
| `backend/src/infrastructure/gh-epic-issues.ts` | create | `ct-api.ts` | Contract (T3) |
| `backend/src/infrastructure/gh-plan-issues.ts` | modify | `GhEpicIssues` | Current state (T3) |
| `backend/src/application/queries/read-epic-groom.ts` | create | the actions, the route | Contract (T4) |
| `backend/src/application/actions/groom-epic.ts` | create | the route | Contract (T5) |
| `backend/src/application/actions/promote-epic.ts` | create | the route | Contract (T6) |
| `backend/src/infrastructure/epic-groom-route.ts` | create | `api-server.ts` | Contract (T7) |
| `backend/src/infrastructure/epic-promotion-route.ts` | create | `api-server.ts` | Contract (T8) |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | the guard | none (body by TDD) |
| `backend/src/infrastructure/api-server.ts` | modify | the entrypoint | Current state, Call site (T9) |
| `backend/src/infrastructure/ct-api.ts` | modify | the entrypoint | Contract (T9) |
| `frontend/vite.config.ts` | modify | `make dev-frontend` | prose (config) (T9) |
| `backend/API.md` | modify | whoever reads the contract | prose (T10) |
| `backend/conventions/this-repository.md` | modify | every agent working here | Final text (T10) |
| `frontend/src/app/epic-groom/EpicGroom.types.ts` | create | the client, the hook, the panel | Contract (T11) |
| `frontend/src/app/epic-groom/client.ts` | create | the hook, the panel | none (body by TDD) (T11) |
| `frontend/src/app/epic-groom/useEpicGroom.ts` | create | the panel | none (body by TDD) (T11) |
| `frontend/src/__scenarios__/EpicGroomMother.ts` | create | every frontend test | none (body by TDD) |
| `frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` | create | `Home` | Contract (T12) |
| `frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.css` | create | the panel | none (T12) |
| `frontend/src/app/epic-groom/components/epic-groom-panel/index.ts` | create | `Home` | none (T12) |
| `frontend/src/pages/home/Home.tsx` | modify | the page | Current state, Call site (T13) |
| `frontend/src/pages/home/__tests__/helpers.tsx` | modify | every `Home` test | none (body by TDD) |
| `frontend/README.md` | modify | whoever works on the front end | none (body by TDD) |
| `/Users/jponzvan/git/control-tower-plugin/plugin/conventions` | read | every task | none (ct's yardstick) |

## 5. Interfaces

Consumes what slice 4 left in the tree, imported and not changed:
`CoordinatingSessions.held(): HeldCoordinatingSession | null`, whose `conversation` carries
`repository: RepositoryName` and `root: CheckoutRoot`;
`EpicSpecs.mostRecent(root: CheckoutRoot): Promise<EpicSpec | null>` with `EpicSpec#path`,
`EpicSpec#title(): string | null` and `EpicSpec#isFrozen(): boolean`;
`GateKey#forThePage({ origin, host, site }): string | null` and `GateKey#holds(offered): boolean`;
`PlanCollapse.of(cause: PlanFailure): Refusal`. From the plugin, imported and not modified:
`resolveStatus(labels: string[]): { status: string }` from `plugin/scripts/gh-issue-map.js`, and
the program `plugin/scripts/ct-groom.mjs`, run through `node`.

Produces, for slice 6 (the headless dispatcher):
`EpicIssues.ofMilestone({ repository, milestone }): Promise<EpicIssue[]>` and
`EpicIssue#isPromotable(): boolean`, which is the evidence "is work authorised";
`ReadEpicGroom#execute(params): Promise<EpicGroomRead>` with its `EpicGroomState` vocabulary,
which is the only place the epic's phase is derived from evidence;
`EpicGroom.planned(...)` and `EpicGroom.run(...)`;
`PublishedSpecs.holds({ repository, path }): Promise<boolean>`.

## 6. Test strategy

Outside-in, with the commands the epic context declares:
`npm --prefix backend run typecheck`, `npm --prefix backend test`, `npm --prefix frontend test`.
All three are green on this branch's base, measured before this plan was written.

The application layer is where `ReadEpicGroom`, `GroomEpic` and `PromoteEpic` are measured, with
`EpicSpecs`, `PublishedSpecs`, `EpicIssues` and `EpicGroom` doubled at construction; the
assertion is on what each port received and what the use case returned, and a refused groom also
asserts that the groom port was never asked to run. The adapters are cut right before the
external system: `CtGroomEpic` with its `node` scripted, `GhPublishedSpecs` and `GhEpicIssues`
with their `gh` scripted, each telling its two failure causes apart — the command refusing and
the command answering something unreadable. The controllers are measured through a real
listening server, status and literal body. No test spawns a real process, so no new file carries
the `-real-process` suffix and none requires cmux.

The domain has no tests of its own: `GroomPlan` and `EpicIssue` are frozen records reached
through the adapters and the use cases, which is where their one decision — `isPromotable` — is
pinned. On the front end, `EpicGroomPanel`, the client and the hook are measured with `fetch`
stubbed from `EpicGroomMother`, and `Home`'s existing suites gain nothing but the two new routes
in their shared stub.

## 7. Tasks

### Task 1 — The plugin's groom, driven by this backend

**Objective:** the backend asks `ct-groom.mjs` what it would create and asks it to create it,
turning any other exit into a typed failure carrying the program's own words.

**Files:** `backend/src/domain/value-objects/groom-plan.ts` (create),
`backend/src/domain/ports/epic-groom.ts` (create),
`backend/src/infrastructure/ct-groom-epic.ts` (create),
`backend/src/domain/exceptions.ts` (modify),
`backend/src/infrastructure/start-plan-route.ts` (modify),
`backend/__tests__/infrastructure/ct-groom-epic.test.ts` (create),
`backend/__tests__/infrastructure/plan-refusal.test.ts` (modify)

The argv is the one `plugin/commands/ct-groom.md` documents, `--dry-run` appended only for
`planned`, run with `cwd` at the checkout root so the program resolves the spec's path.
`0` and `3` are both success: the plugin's table calls `3` a third state and it still
prints the plan. Any other code raises `EpicNotGroomed` carrying `said.stderr.trim()` verbatim —
the criterion "a groom failure is shown in the program's own words", so nothing is rewritten or
cut. `planned` reads stdout as JSON, keeping `milestone` and, per issue, `order`, `title` and
`labels`; anything else raises `GroomPlanNotUnderstood`. Both leaves join `PlanCollapse` here.

Contract (backend/src/domain/value-objects/groom-plan.ts):

```ts
export class GroomPlanIssue {
  readonly order: number
  readonly title: string
  readonly labels: readonly string[]
  constructor({ order, title, labels }: { order: number, title: string, labels: string[] })
}
export class GroomPlan {
  readonly milestone: string
  readonly issues: readonly GroomPlanIssue[]
  constructor({ milestone, issues }: { milestone: string, issues: GroomPlanIssue[] })
}
```

Contract (backend/src/infrastructure/ct-groom-epic.ts):

```ts
export class CtGroomEpic extends EpicGroom {
  static readonly COMMAND = 'ct-groom.mjs'
  static readonly NO_DIVERGENCE = 0
  static readonly UNRECONCILED_DIVERGENCE = 3
  constructor({ node, ctGroom }: { node: ToolRunner['run'], ctGroom: string })
  static argvFor(asked: { ctGroom: string, spec: string, repository: RepositoryName, milestone: string, dryRun: boolean }): string[]
}
```

Contract (backend/src/domain/ports/epic-groom.ts):

```ts
type Grooming = { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string }
export class EpicGroom {
  async planned(asked: Grooming): Promise<GroomPlan>
  async run(asked: Grooming): Promise<void>
}
```

**TDD:** red first with
`it('the dry run asks for the plan and the real run is never mistaken for it')` — `argvFor` ends
in `--dry-run` for `planned` and never carries it for `run`, and the parsed plan holds the
milestone and one `GroomPlanIssue` per issue. Its boundary pair is
`it('exit 3 is the plan all the same and exit 2 is the plugin own words')` — code `3` returns the
plan, code `2` raises `EpicNotGroomed` holding the scripted stderr byte for byte.

**Tests:** in `ct-groom-epic.test.ts`: the two above,
`the real run passes the spec the repository and the milestone in the documented order`,
`stdout that is not the json the plugin prints raises GroomPlanNotUnderstood`. In
`plan-refusal.test.ts`, `FAMILIES` gains `'EpicGroomFailure'`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/ct-groom-epic.test.ts __tests__/infrastructure/plan-refusal.test.ts   # expected: exit 0
```

### Task 2 — The spec's committed copy on the default branch

**Objective:** the backend can say whether the execution spec is readable on the repository's
default branch, which is the evidence D-23 makes the groom wait for.

**Files:** `backend/src/domain/ports/published-specs.ts` (create),
`backend/src/infrastructure/gh-published-specs.ts` (create),
`backend/src/infrastructure/gh.ts` (modify), `backend/src/domain/exceptions.ts` (modify),
`backend/src/infrastructure/start-plan-route.ts` (modify),
`backend/__tests__/infrastructure/gh-published-specs.test.ts` (create)

`gh api repos/<owner>/<name>/contents/<path>` reads the **default branch** when no `ref` is
given, which is what D-23 asks for and what `spec-link.js` already relies on; each path segment
is percent-encoded before it becomes part of the url. Exit `0` is `true`. A `404` — `gh` prints
`gh: Not Found (HTTP 404)` on stderr and exits `1` — is `false`, and that is the only failure
that means "not published yet": anything else (a logged-out `gh`, a repository that is not
there) raises `PublishedSpecNotRead` with `gh`'s own message, so waiting for a merge is never
confused with a broken tool. `Gh.isNotFound` sits beside `Gh.labelMissingIn`, which is where this
backend already keeps what only `gh` writes. The leaf joins `PlanCollapse` as
`published-spec-not-read`.

Contract (backend/src/domain/ports/published-specs.ts):

```ts
export class PublishedSpecs {
  async holds({ repository, path }: { repository: RepositoryName, path: string }): Promise<boolean>
}
```

Contract (backend/src/infrastructure/gh-published-specs.ts):

```ts
export class GhPublishedSpecs extends PublishedSpecs {
  constructor({ gh }: { gh: Gh })
  static argvFor({ repository, path }: { repository: RepositoryName, path: string }): string[]
}
```

Contract (backend/src/infrastructure/gh.ts):

```ts
  static readonly #NOT_FOUND = /\(HTTP 404\)/
  static isNotFound(stderr: string): boolean
```

**TDD:** red first with
`it('a spec github cannot find on the default branch is not published and is no failure')` — the
scripted `gh` exits 1 with `gh: Not Found (HTTP 404)` and `holds` answers `false` with nothing
thrown. Its boundary pair is
`it('a gh that failed for any other reason raises instead of passing for not published')` — exit
1 with `gh: To use GitHub CLI, run: gh auth login` raises `PublishedSpecNotRead` carrying that
line.

**Tests:** in `gh-published-specs.test.ts`: the two above,
`a readable spec answers true and asks for the contents of the default branch with no ref`,
`a path with a space is percent-encoded before it becomes part of the url`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the port and the adapter type-check
npm --prefix backend test -- __tests__/infrastructure/gh-published-specs.test.ts   # expected: exit 0
test "$(grep -c 'ref=' backend/src/infrastructure/gh-published-specs.ts)" -eq 0   # expected: exit 0 — no ref is sent, so github answers the default branch
```

### Task 3 — The epic's issues on GitHub, read and promoted

**Objective:** the backend lists a milestone's issues with their rung, and moves one from
`status:backlog` to `status:ready` touching nothing else.

**Files:** `backend/src/domain/value-objects/epic-issue.ts` (create),
`backend/src/domain/ports/epic-issues.ts` (create),
`backend/src/infrastructure/gh-epic-issues.ts` (create),
`backend/src/infrastructure/gh-plan-issues.ts` (modify),
`backend/src/domain/exceptions.ts` (modify),
`backend/src/infrastructure/start-plan-route.ts` (modify),
`backend/__tests__/infrastructure/gh-epic-issues.test.ts` (create)

The rung is read with the plugin's own `resolveStatus`, the loop's declared criterion, which
already treats an issue with no `status:` label as `backlog`: this backend grows no second
opinion (D-11). Both labels come from `GhPlanIssues`, where the ladder is already mapped —
`BACKLOG_LABEL` joins the three below, so the vocabulary stays declared once. Issues come back
sorted by number ascending, the order the groom created them in; `--state all` is asked because a
closed issue is still the milestone's and `isPromotable` keeps it from being dragged back. Three leaves join `PlanCollapse` as `epic-issues-not-read`,
`epic-issues-not-understood` and `epic-issue-not-promoted`.

Current state (backend/src/infrastructure/gh-plan-issues.ts, lines 49-51):

```ts
  static IN_PROGRESS_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.IN_PROGRESS)!
  static IN_REVIEW_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.IN_REVIEW)!
  static READY_LABEL: string = GhPlanIssues.#LABEL_BY_STATUS.get(PlanIssueStatus.READY)!
```

Contract (backend/src/domain/value-objects/epic-issue.ts):

```ts
export class EpicIssue {
  readonly number: number
  readonly url: string
  readonly title: string
  readonly status: string
  readonly isOpen: boolean
  constructor(issue: { number: number, url: string, title: string, status: string, isOpen: boolean })
  isPromotable(): boolean
}
```

Contract (backend/src/infrastructure/gh-epic-issues.ts):

```ts
export class GhEpicIssues extends EpicIssues {
  static readonly LIMIT = 200
  static readonly OPEN = 'OPEN'
  constructor({ gh }: { gh: Gh })
  static listArgvFor(asked: { repository: RepositoryName, milestone: string }): string[]
  static promoteArgvFor(asked: { repository: RepositoryName, issue: EpicIssue }): string[]
}
```

**TDD:** red first with `it('only an open issue standing at backlog is promotable')` — four
`EpicIssue`s (no `status:` label, `status:backlog`, `status:in-progress`, a closed
`status:backlog`) and only the first two answer `true`. Its
boundary pair is `it('promoting adds status:ready and removes status:backlog and nothing else')`
— `promoteArgvFor` carries exactly those two flags and no other.

**Tests:** in `gh-epic-issues.test.ts`: the two above,
`the milestone is listed with every state and its issues come back sorted by number`,
`a gh that failed raises EpicIssuesNotRead and unreadable json EpicIssuesNotUnderstood`,
`a refused edit raises EpicIssueNotPromoted naming the issue`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/gh-epic-issues.test.ts __tests__/infrastructure/gh-plan-issues.test.ts   # expected: exit 0
test "$(grep -c "status:ready" backend/src/infrastructure/gh-epic-issues.ts)" -eq 0   # expected: exit 0 — the label is never spelled here
```

### Task 4 — Gate 2's state, derived from evidence

**Objective:** one query answers which rung the epic stands at, reading only the spec on disk,
GitHub's copy of it and the milestone's issues — and, when there is something to create, what
would be created.

**Files:** `backend/src/application/queries/read-epic-groom.ts` (create),
`backend/__tests__/application/read-epic-groom.test.ts` (create)

This is the only place the epic's phase is derived (D-13), and every other part of gate 2 asks
it. The evidence is gathered in ladder order and stops at the first rung that answers: no spec is
`NO_SPEC`; a spec whose state line is not `CONGELADA` is `DRAFT` and nothing is asked of GitHub;
a frozen spec whose committed copy `PublishedSpecs` cannot read is `AWAITING_PUBLICATION`; then
the milestone — whose title is the spec's own, `EpicSpec#title()` — is listed, and an empty
milestone is `GROOMABLE`, one with an issue still promotable is `GROOMED`, and one with none left
is `AUTHORISED`. `plan` is asked of the groom **only** in `GROOMABLE`: it is the one rung where
something is about to be created and the one where a dry run costs anything.

Contract (backend/src/application/queries/read-epic-groom.ts):

```ts
export const EpicGroomState = Object.freeze({
  NO_SPEC: 'no-spec', DRAFT: 'draft', AWAITING_PUBLICATION: 'awaiting-publication',
  GROOMABLE: 'groomable', GROOMED: 'groomed', AUTHORISED: 'authorised',
} as const)
export type EpicGroomStateValue = (typeof EpicGroomState)[keyof typeof EpicGroomState]
export class ReadEpicGroomParams {
  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName })
}
export class EpicGroomRead {
  readonly state: EpicGroomStateValue
  readonly spec: EpicSpec | null
  readonly milestone: string | null
  readonly plan: GroomPlan | null
  readonly issues: readonly EpicIssue[]
}
export class ReadEpicGroom {
  constructor({ specs, published, issues, groom }: {
    specs: EpicSpecs, published: PublishedSpecs, issues: EpicIssues, groom: EpicGroom,
  })
  async execute(params: ReadEpicGroomParams): Promise<EpicGroomRead>
}
```

**TDD:** red first with
`it('a frozen spec whose committed copy is not on the default branch waits and asks github for nothing else')`
— state `awaiting-publication`, and the `EpicIssues` and `EpicGroom` doubles were never asked.
Its boundary pair is
`it('a frozen and published spec with an empty milestone is groomable and carries what would be created')`
— state `groomable`, the plan is the one the groom double returned, and the milestone asked for
was the spec's title.

**Tests:** in `read-epic-groom.test.ts`: the two above,
`no execution spec is no-spec and nothing is asked of github`,
`a spec that is not frozen is draft and nothing is asked of github`,
`a milestone with an issue still at backlog is groomed and carries no plan`,
`a milestone whose issues are all promoted is authorised`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the query type-checks
npm --prefix backend test -- __tests__/application/read-epic-groom.test.ts   # expected: exit 0
test "$(grep -c 'planned' backend/src/application/queries/read-epic-groom.ts)" -eq 1   # expected: exit 0 — the dry run is asked for at one rung only
```

### Task 5 — The groom, as an act of the app

**Objective:** pressing the groom runs the plugin's program over the epic's spec, and is refused
without running it while the spec is not frozen or its committed copy is not published.

**Files:** `backend/src/application/actions/groom-epic.ts` (create),
`backend/__tests__/application/groom-epic.test.ts` (create)

It asks `ReadEpicGroom` — the one deriver of the phase — and refuses when what comes back is one
of the three rungs before the groom, returning that rung so the boundary can name it. Otherwise
it runs the groom over the spec and the milestone the read gave it and asks the read again, so
what it answers is what the milestone really holds afterwards and not what it hoped for. The plan
the first read carried travels in the result: it is the other half of the slice's signal, the one
the record line compares against the issues that now exist. Running the groom again over an epic
that already has issues is not refused — the plugin is idempotent by existence and says so.

Contract (backend/src/application/actions/groom-epic.ts):

```ts
export class GroomEpicParams {
  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName })
}
export class EpicGroomed {
  readonly state: EpicGroomStateValue
  readonly milestone: string | null
  readonly plan: GroomPlan | null
  readonly issues: readonly EpicIssue[]
}
export class GroomEpic {
  static readonly REFUSED: readonly EpicGroomStateValue[]
  constructor({ read, groom }: { read: ReadEpicGroom, groom: EpicGroom })
  async execute(params: GroomEpicParams): Promise<EpicGroomed>
}
```

**TDD:** red first with
`it('a spec that is not frozen refuses the groom and the program is never run')` — the result's
state is `draft` and the `EpicGroom` double's `run` was not called. Its boundary pair is
`it('a groomable epic runs the groom once and answers the issues the milestone holds afterwards')`
— `run` received the spec, the repository and the milestone the read gave, and the issues in the
result are the second read's, not the first's.

**Tests:** in `groom-epic.test.ts`: the two above,
`a spec whose committed copy is not published refuses the groom and the program is never run`,
`no execution spec refuses the groom and the program is never run`,
`an epic already groomed runs again because the plugin is idempotent by existence`,
`the plan the read carried travels in the result beside the issues that now exist`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the action type-checks
npm --prefix backend test -- __tests__/application/groom-epic.test.ts   # expected: exit 0
test "$(grep -c 'REFUSED' backend/src/application/actions/groom-epic.ts)" -eq 2   # expected: exit 0 — the three rungs are declared once and read once
```

### Task 6 — Gate 2's press: the promotion

**Objective:** the promotion adds `status:ready` to the epic's issues that are waiting for it,
and to nothing else.

**Files:** `backend/src/application/actions/promote-epic.ts` (create),
`backend/__tests__/application/promote-epic.test.ts` (create)

It asks `ReadEpicGroom`, refuses when the milestone holds no issue at all — whichever rung that
is, there is nothing to authorise — and otherwise promotes **only** the issues that answer
`isPromotable()`, one call each, in the order they were listed. It then asks the read again and
answers what the milestone really holds, which is what makes "each one ends at `status:ready`"
something measured rather than assumed, and `promoted` names the numbers this press moved. An
epic already authorised promotes nothing and is not a failure: the answer carries an empty
`promoted`.

Contract (backend/src/application/actions/promote-epic.ts):

```ts
export class PromoteEpicParams {
  constructor({ root, repository }: { root: CheckoutRoot, repository: RepositoryName })
}
export class EpicPromoted {
  readonly state: EpicGroomStateValue
  readonly milestone: string | null
  readonly issues: readonly EpicIssue[]
  readonly promoted: readonly number[]
}
export class PromoteEpic {
  constructor({ read, issues }: { read: ReadEpicGroom, issues: EpicIssues })
  async execute(params: PromoteEpicParams): Promise<EpicPromoted>
}
```

**TDD:** red first with
`it('it promotes the issues waiting at backlog and asks nothing of the ones that are not')` — of
four issues (one at backlog, one with no status label, one in progress, one closed at backlog)
the `EpicIssues` double receives exactly the first two and `promoted` names those two numbers.
Its boundary pair is
`it('an epic with no issue at all is refused and nothing is promoted')` — the result's state is
the rung the read gave and `promote` was never called.

**Tests:** in `promote-epic.test.ts`: the two above,
`an epic already authorised promotes nothing and is no failure`,
`the issues it answers are the ones the second read gave, not the ones it started from`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the action type-checks
npm --prefix backend test -- __tests__/application/promote-epic.test.ts   # expected: exit 0
test "$(grep -c 'isPromotable' backend/src/application/actions/promote-epic.ts)" -eq 1   # expected: exit 0 — one filter decides who moves
```

### Task 7 — The endpoint that reads gate 2 and runs the groom

**Objective:** the cabin reads gate 2's rung with the key only it receives and runs the groom,
and every refusal arrives as `{code, detail}`.

**Files:** `backend/src/infrastructure/epic-groom-route.ts` (create),
`backend/__tests__/infrastructure/epic-groom-route.test.ts` (create),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

It takes no body, so neither `JsonBody` middleware is mounted, and it reads the repository and
the root out of `held().conversation`. The `GET` answers `{"status":"none"}` with no session,
then the rung: `draft` and `awaiting-publication` carry nothing else, `groomable` carries
`milestone` and `plan` as `{"issues":[{"order":n,"title":"…","labels":[…]}]}`, `groomed` and
`authorised` carry `milestone` and `issues` as
`[{"number":n,"url":"…","title":"…","status":"backlog"}]`, and `key` is attached only to
`groomable` and `groomed` — the two rungs with something to press — and only when one was minted.
The `POST` demands `GateKey.HEADER` first of all and answers `403` without asking anything;
`EpicGroomRefusal` then projects the three refused rungs with a `Projection`, and a `PlanFailure`
becomes `PlanCollapse`. After a successful groom it writes one `RECORD` line to `stderr` naming
the milestone, how many issues were planned and how many the milestone now holds.
`refusal-codes.test.ts` adds this vocabulary and declares `gate-not-from-the-page`,
`no-coordinating-session` and `no-epic-spec` as shared with gate 1 on purpose.

Contract (backend/src/infrastructure/epic-groom-route.ts):

```ts
export const EpicGroomOutcome = Object.freeze({
  ACCEPTED: 'accepted', NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session', NO_EPIC_SPEC: 'no-epic-spec',
  SPEC_NOT_FROZEN: 'spec-not-frozen', SPEC_NOT_PUBLISHED: 'spec-not-published',
} as const)
export class EpicGroomRoute {
  static readonly PATH = '/epic-groom'
  static readonly METHODS = 'GET, POST'
  static readonly RECORD = 'gate 2 groom'
  static reading(held: CoordinatingSessions, read: ReadEpicGroom, key: GateKey): RequestHandler
  static grooming(held: CoordinatingSessions, groom: GroomEpic, key: GateKey, stderr: (line: string) => void): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

**TDD:** red first with
`it('the read hands the gate key only at a rung with something to press')` — a `groomable` read
with the page's own `Origin` carries `key`, and an `authorised` one with the same `Origin` has no
`key` field at all. Its boundary pair is
`it('a post with no gate key is refused and the groom is never asked')` — `403`, the literal
body, and the `GroomEpic` double untouched.

**Tests:** in `epic-groom-route.test.ts`: the two above,
`a groomable read answers the milestone and what would be created`,
`a groomed read answers each issue with the rung it stands at`,
`a spec that is not frozen refuses the groom as spec-not-frozen`,
`a spec that is not published refuses the groom as spec-not-published`,
`a successful groom answers the issues and records what was planned and what exists`,
`another method is refused naming the allowed ones`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/epic-groom-route.test.ts __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0
```

### Task 8 — The endpoint of gate 2's press

**Objective:** the cabin presses the promotion with the key it was handed, and is refused with
`{code, detail}` when there is nothing to authorise.

**Files:** `backend/src/infrastructure/epic-promotion-route.ts` (create),
`backend/__tests__/infrastructure/epic-promotion-route.test.ts` (create),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

The same shape as its neighbour: no body, no `JsonBody` middleware, the checkout read out of
`held().conversation`, `GateKey.HEADER` demanded before anything is asked. `EpicPromotionRefusal`
projects with a `Projection` the four rungs at which the milestone holds no issue — `no-spec`,
`draft`, `awaiting-publication` and `groomable` — to the single `no-epic-issues`, whose detail
says the groom has to run first; every other rung is a `200`
`{"status":…,"milestone":…,"issues":[…],"promoted":[n]}`. After a successful press it writes one
`RECORD` line to `stderr` naming the milestone and which numbers moved to `status:ready`, which
is the half of the slice's signal that says where each issue ended.

Contract (backend/src/infrastructure/epic-promotion-route.ts):

```ts
export const EpicPromotionOutcome = Object.freeze({
  ACCEPTED: 'accepted', NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session', NO_EPIC_ISSUES: 'no-epic-issues',
} as const)
export class EpicPromotionRoute {
  static readonly PATH = '/epic-promotion'
  static readonly METHOD = 'POST'
  static readonly RECORD = 'gate 2 promotion'
  static promoting(held: CoordinatingSessions, promote: PromoteEpic, key: GateKey, stderr: (line: string) => void): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

**TDD:** red first with
`it('a post with no gate key is refused and the promotion is never asked')` — `403`, the literal
body, and the `PromoteEpic` double untouched. Its boundary pair is
`it('the same post carrying the key answers the issues and which numbers it moved')`.

**Tests:** in `epic-promotion-route.test.ts`: the two above,
`an epic with no issues is refused as no-epic-issues`,
`with no coordinating session it is refused without asking the promotion`,
`a successful press records the milestone and the numbers that moved`,
`another method is refused naming the allowed one`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/epic-promotion-route.test.ts __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0
```

### Task 9 — Wiring gate 2 into the server it runs in

**Objective:** the two endpoints are mounted and built by the entrypoint, and the dev server
proxies them instead of answering the page's HTML.

**Files:** `backend/src/infrastructure/api-server.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify), `frontend/vite.config.ts` (modify),
`backend/__tests__/infrastructure/api-server.test.ts` (modify),
`backend/__tests__/infrastructure/ct-api-real-process.test.ts` (modify)

`ApiCollaborators` gains `readEpicGroom`, `groomEpic` and `promoteEpic`, optional like their
neighbours, and the two paths are mounted next to `SpecFreezeRoute` with `Browsers.turnAwayForeign`
and no body middleware. `ct-api.ts` builds `GhPublishedSpecs` and `GhEpicIssues` over the `gh` it
already has, and `CtGroomEpic` over `process.execPath` with a budget of its own: the groom creates
a milestone, the labels and one issue per row, which does not fit the 30 second default.
`PluginTree` learns where `ct-groom.mjs` lives, and `API_PATHS` in `frontend/vite.config.ts` gains
`'/epic-groom'` and `'/epic-promotion'`.

Current state (backend/src/infrastructure/api-server.ts, lines 280-284):

```ts
    app.get(SpecFreezeRoute.PATH, Browsers.turnAwayForeign,
      SpecFreezeRoute.reading(this.coordinatingSessions!, this.readSpecFreeze!, this.gateKey!))
    app.post(SpecFreezeRoute.PATH, Browsers.turnAwayForeign,
      SpecFreezeRoute.freezing(this.coordinatingSessions!, this.freezeSpec!, this.gateKey!, this.freezesInFlight!))
    app.all(SpecFreezeRoute.PATH, SpecFreezeRoute.refuseOtherMethods)
```

Call site (backend/src/infrastructure/api-server.ts):

```ts
    app.all(SpecFreezeRoute.PATH, SpecFreezeRoute.refuseOtherMethods)
    app.get(EpicGroomRoute.PATH, Browsers.turnAwayForeign,
      EpicGroomRoute.reading(this.coordinatingSessions!, this.readEpicGroom!, this.gateKey!))
    app.post(EpicGroomRoute.PATH, Browsers.turnAwayForeign,
      EpicGroomRoute.grooming(this.coordinatingSessions!, this.groomEpic!, this.gateKey!, this.stderr!))
    app.all(EpicGroomRoute.PATH, EpicGroomRoute.refuseOtherMethods)
    app.post(EpicPromotionRoute.PATH, Browsers.turnAwayForeign,
      EpicPromotionRoute.promoting(this.coordinatingSessions!, this.promoteEpic!, this.gateKey!, this.stderr!))
    app.all(EpicPromotionRoute.PATH, EpicPromotionRoute.refuseOtherMethods)
```

Contract (backend/src/infrastructure/ct-api.ts):

```ts
  static readonly #GROOM_TIMEOUT_MS = 6 * 60 * 1000
  static ctGroom(): string
```

**TDD:** red first with
`it('the two paths of gate 2 refuse a method they do not serve naming the ones they do')` in
`api-server.test.ts` — `DELETE /epic-groom` answers `405` with `Allow: GET, POST` and
`GET /epic-promotion` answers `405` with `Allow: POST`. Its boundary pair, in
`ct-api-real-process.test.ts`, is `it('a started backend answers gate 2 with no session held')` —
`GET /epic-groom` answers `200` `{"status":"none"}` on a real listening process.

**Tests:** the two above. No test pins the vite proxy: it is development configuration no suite
loads.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/api-server.test.ts   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/ct-api-real-process.test.ts   # expected: exit 0
test "$(grep -c "'/epic-promotion'" frontend/vite.config.ts)" -eq 1   # expected: exit 0 — the proxy knows it
```

### Task 10 — Gate 2 written down

**Objective:** the three endpoints and the vocabulary they add are written where this backend
documents its contract and its ubiquitous language.

**Files:** `backend/API.md` (modify), `backend/conventions/this-repository.md` (modify)

`API.md` gains a section per verb, in the shape the other endpoints have and placed after
`POST /spec-freeze`: for `GET /epic-groom` the seven `200` bodies with an example of each, and
that `key` is attached only to `groomable` and `groomed` and only for the page's own request; for
`POST /epic-groom` the `x-gate-key` header, the `200` body and the table of its five refusal
codes with their status, plus the `PlanCollapse` codes this slice adds
(`epic-not-groomed`, whose `detail` is `ct-groom`'s own stderr, `groom-plan-not-understood`,
`published-spec-not-read`, `epic-issues-not-read`, `epic-issues-not-understood`,
`epic-issue-not-promoted`); for `POST /epic-promotion` its three refusal codes and its `200`
body with `promoted`. Both paths also get a row in "Where the frontend consumes each one",
naming `frontend/src/app/epic-groom/client.ts` and `EpicGroom.types.ts`.

Final text (backend/conventions/this-repository.md):

```md
| **Groom plan** | What `ct-groom --dry-run` prints, kept as what will be created: the milestone and, per row of the spec's slices table, the order, the title and the labels the real run would give its issue. The cabin shows it before anything mutates |
| **Epic issue** | One issue of the epic's milestone as GitHub holds it today: its number, its url, its title, whether it is open, and which rung of the loop's ladder it stands at, read with the plugin's own `resolveStatus` so this backend keeps no second opinion |
| **Gate 2** | The authorisation as an act of this program: the groom run from the cabin over a spec whose committed copy is already readable on the default branch, and a button that adds `status:ready` to the epic's issues and nothing else. Only the page this backend serves can press either |
```

**TDD:** No TDD — the deliverable is documentation, and the two claims that can be checked
mechanically are checked by this task's verification block.

**Tests:** N/A — no behaviour changes; `backend/__tests__/conventions-no-restatement.test.ts`
keeps measuring the document that grows here and stays green.

**Verification:**

```bash
npm --prefix backend test -- __tests__/conventions-no-restatement.test.ts   # expected: exit 0 — the document still declares only what no other repository inherits
test "$(grep -c 'POST /epic-promotion' backend/API.md)" -ge 1   # expected: exit 0 — the promotion is documented
test "$(grep -c 'Gate 2' backend/conventions/this-repository.md)" -eq 1   # expected: exit 0 — the vocabulary learned it once
```

### Task 11 — The cabin's client for gate 2

**Objective:** the page can read gate 2's state, run the groom and press the promotion with the
key it was handed.

**Files:** `frontend/src/app/epic-groom/EpicGroom.types.ts` (create),
`frontend/src/app/epic-groom/client.ts` (create),
`frontend/src/app/epic-groom/useEpicGroom.ts` (create),
`frontend/src/__scenarios__/EpicGroomMother.ts` (create),
`frontend/src/app/epic-groom/client.test.ts` (create),
`frontend/src/app/epic-groom/useEpicGroom.test.ts` (create)

`fetch` with no wrapper and the same shape as `app/spec-freeze/client.ts`: a body that does not
read as one of the seven states is `unavailable`, a `fetch` that throws is `unavailable` on the
read and `backend-unreachable` on either press. Both presses send `POST` with `x-gate-key` and no
body, and share one answer type: a `200` whose `status` is `groomed` or `authorised` is `acted`,
anything else that is not `{code, detail}` is `backend-unreachable`. `useEpicGroom` polls every
`POLL_INTERVAL_MS = 10000` — the two rungs it waits at change because a person merged a pull
request or froze a spec, not in two seconds — and **stops polling** once it reads `groomable`,
`groomed` or `authorised`, because from there only the page's own presses move it.

Contract (frontend/src/app/epic-groom/EpicGroom.types.ts):

```ts
export type GroomPlanIssue = { order: number; title: string; labels: string[] }
export type EpicIssue = { number: number; url: string; title: string; status: string }
export type EpicGroomOutcome =
  | { kind: 'none' } | { kind: 'no-spec' } | { kind: 'draft' } | { kind: 'awaiting-publication' }
  | { kind: 'groomable'; milestone: string; plan: GroomPlanIssue[]; key: string | null }
  | { kind: 'groomed'; milestone: string; issues: EpicIssue[]; key: string | null }
  | { kind: 'authorised'; milestone: string; issues: EpicIssue[] }
  | { kind: 'refused'; code: string; error: string } | { kind: 'unavailable' }
export type EpicGroomAskOutcome =
  | { kind: 'acted'; status: 'groomed' | 'authorised'; milestone: string; issues: EpicIssue[]; promoted: number[] }
  | { kind: 'refused'; code: string; error: string } | { kind: 'backend-unreachable' }
```

**TDD:** red first with
`it('stops asking once there is something to press and keeps asking while it waits')` in
`useEpicGroom.test.ts` — with `awaiting-publication` the timer fires again, and once the answer
is `groomable` no further request is made. Its boundary pair, in `client.test.ts`, is
`it('a groomable body with no key reads as a state with no key rather than as unavailable')`.

**Tests:** in `client.test.ts`: the second above,
`each of the seven states is read as its own kind`,
`a body that is none of them is unavailable`,
`the groom sends the key in x-gate-key and no body`,
`the promotion answers which numbers it moved`,
`a refusal carries the code and the detail the backend gave`. In `useEpicGroom.test.ts`: the
first above, `a fetch that throws leaves the read unavailable and keeps polling`.

**Verification:**

```bash
npm --prefix frontend test -- src/app/epic-groom   # expected: exit 0 — the client and the hook
test "$(grep -c '10000' frontend/src/app/epic-groom/useEpicGroom.ts)" -eq 1   # expected: exit 0 — one interval, declared once
```

### Task 12 — The panel of gate 2

**Objective:** the cabin shows what the groom will create, runs it, shows the issues it created
with the rung each stands at, and authorises them — showing any refusal in the backend's own
words.

**Files:** `frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` (create),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.css` (create),
`frontend/src/app/epic-groom/components/epic-groom-panel/index.ts` (create),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx` (create)

It takes no props and reads `useEpicGroom`. `connecting`, `none`, `no-spec`, `draft`,
`awaiting-publication` and `unavailable` render `null`: gate 1's panel is what is on screen then,
and it already says the groom is waiting for that pull request to merge. `groomable` renders a
`Panel` with the milestone, the count, one list item per planned issue as
`#<order> · <title>` with its labels, and the button; `groomed` renders the issues as
`#<number> · <title>` with the rung each stands at, and the promotion button; `authorised`
renders the same list and `AUTHORISED`. A button is disabled while its key is `null` or while its
press is in flight, and with no key the panel says where the gate opens from. A refusal renders a
`Banner` `type="error"` `role="alert"` with its detail **untranslated**, the way `SpecFreezePanel`
does: it carries `ct-groom`'s own stderr and translating it destroys the only useful thing in it.
Labels are Spanish; classes are BEM under `epic-groom-panel__`.

Contract (frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx):

```ts
const HEADING = 'Puerta 2 · El groom y la autorización'
const WILL_CREATE = 'Se van a crear estas issues'
const GROOM = 'Ejecutar el groom'
const GROOMING = 'Ejecutando el groom'
const CREATED = 'Issues del epic'
const PROMOTE = 'Autorizar el trabajo'
const PROMOTING = 'Autorizando el trabajo'
const AUTHORISED = 'Trabajo autorizado: el loop ya puede despachar el primer slice.'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const UNREACHABLE_MESSAGE = 'No se pudo contactar con el backend'
```

**TDD:** red first with
`it('shows what the groom will create before anything is created')` — with
`EpicGroomMother.groomable()` the milestone, the count and every planned issue's order, title and
labels are on screen and no request has been posted. Its boundary pair is
`it('pressing the groom sends the key and then shows the issues it created')`.

**Tests:** in `EpicGroomPanel.test.tsx`: the two above,
`a groomed epic offers the authorisation and shows the rung each issue stands at`,
`pressing the authorisation sends the key and says the work is authorised`,
`a refused groom is shown with the words the program printed`,
`without a key the buttons stay disabled and it says where the gate opens from`,
`there is nothing to show while gate 1 has not been pressed`.

**Verification:**

```bash
npm --prefix frontend test -- src/app/epic-groom   # expected: exit 0 — the panel, the client and the hook
test "$(grep -c 'Puerta 2' frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx)" -eq 1   # expected: exit 0 — the heading is written once
```

### Task 13 — The panel on the page

**Objective:** gate 2's panel is rendered by `Home` under gate 1's and outside every stage
branch, every existing `Home` suite stays green, and the front end's README says what
`app/epic-groom` consumes.

**Files:** `frontend/src/pages/home/Home.tsx` (modify),
`frontend/src/pages/home/__tests__/helpers.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.epicGroom.test.tsx` (create),
`frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx` (modify),
`frontend/README.md` (modify)

`Home` gains one import and one element, right after `SpecFreezePanel` and outside every
`currentStage` branch — `EpicGroomPanel` renders a `Panel`, which is already a `section` with its
own `aria-label`, so no wrapper is added. The three `fetch` stubs of `helpers.tsx`
(`backendAnswering`, `backendRecovering`, `backendPending`) each gain
`if (input === '/epic-groom') return responseFor(EpicGroomMother.none())`, and so does the
private stub of `Home.restoreWorkflow.test.tsx`, which is what keeps every existing `Home` suite
untouched: without it the panel's read on mount eats an answer meant for another route.
`frontend/README.md` gains a paragraph beside gate 1's: what `GET`/`POST /epic-groom` and
`POST /epic-promotion` are, that the dry run's product is shown before anything is created, and
that the two buttons carry the same gate key gate 1 uses. Every new file is measured by
`frontend/__tests__/yardstick.test.ts`.

Current state (frontend/src/pages/home/Home.tsx, lines 469-474):

```tsx
          <section className="home__sessions" aria-label="Sesiones en marcha" ref={sessionsRef}>
            <SessionsPanel opened={openedSession} />
            <CoordinatingSessionStatus read={coordinatingSession} />
          </section>

          <SpecFreezePanel />
```

Call site (frontend/src/pages/home/Home.tsx):

```tsx
          <SpecFreezePanel />

          <EpicGroomPanel />
```

**TDD:** red first with
`it('shows gate 2 in the request stage and still shows it while a slice is being implemented')`
in `Home.epicGroom.test.tsx` — with `/epic-groom` answering `EpicGroomMother.groomable()`, the
panel's heading is on screen with no workflow restored and again with one restored at
`implementing`. That pair is the boundary of "outside every stage branch".

**Tests:** the one above. Every other `Home` suite keeps its tests and its names: the only change
they take is the new route in their stubs.

**Verification:**

```bash
npm --prefix frontend test   # expected: exit 0 — every Home suite survived the new route
test "$(grep -c 'EpicGroomPanel' frontend/src/pages/home/Home.tsx)" -eq 2   # expected: exit 0 — the import and the one element
test "$(grep -c 'home__sessions' frontend/src/pages/home/Home.tsx)" -eq 1   # expected: exit 0 — one sessions section, as before
```

## 8. Global verification

Both suites and the type graph, plus the four structural claims this slice makes about where its
decisions live. With human eyes, and this is the `visual` gate a person closes on the pull
request: `make run-frontend`, open the cabin on a governed checkout whose execution spec is
frozen and merged, see gate 2's panel list what the groom will create, press it, see the issues
it created at `status:backlog`, press the authorisation and see every one of them at
`status:ready`.

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the whole graph is sound
npm --prefix backend test   # expected: exit 0 — the whole backend suite, real processes included
npm --prefix frontend test   # expected: exit 0 — the whole frontend suite
test -z "$(grep -rl 'resolveStatus' backend/src/application backend/src/domain)"   # expected: exit 0 — the plugin's ladder is read at the boundary, never re-decided inland
test "$(grep -rl 'EpicGroomState' backend/src/application | wc -l | tr -d ' ')" -eq 3   # expected: exit 0 — the query declares the rungs and the two actions read them
test "$(grep -c 'ct-groom.mjs' backend/src/infrastructure/ct-api.ts)" -eq 1   # expected: exit 0 — one place names the program
test "$(grep -c 'add-label' backend/src/infrastructure/gh-epic-issues.ts)" -eq 1   # expected: exit 0 — one place writes the promotion
```

## 9. Assumptions

1. **The milestone is the execution spec's own title**, `EpicSpec#title()` — the `# ` heading
   with `— Execution spec` stripped, which `DiskEpicSpecs` already refuses to return as `null`.
   Nothing in the cabin asks a human for a milestone name and no acceptance criterion adds a
   field for one. Provenance: own call, forced by there being no other source.
2. **"Readable on the default branch" is `gh api repos/<repo>/contents/<path>` with no `ref`**,
   which GitHub answers from the repository's default branch. Measured against this repository
   before writing this plan: the spec answers `200`, an invented path answers exit 1 with
   `gh: Not Found (HTTP 404)` on stderr. Provenance: D-23 and `spec-link.js`, which resolves the
   same way; own call on the mechanism.
3. **Both presses demand the gate key, not only the promotion.** D-22 names the promotion by
   name, and the epic's technical approach says the gate acts demand the key the backend hands
   only to the page. The groom mutates the governed repository's GitHub from a button of the same
   panel, so it is one of those acts. Provenance: the issue's D-22 plus the spec's approach; own
   call on extending it to the groom.
4. **`gate-not-from-the-page`, `no-coordinating-session` and `no-epic-spec` are shared with gate
   1's vocabulary on purpose**, declared in `SharedOnPurposeAcrossRequestVocabularies`: they mean
   exactly the same thing at both gates and inventing a second spelling would make the frontend
   parse two codes for one condition. Provenance: repo convention — that list exists for this.
5. **There is no in-flight registry for gate 2**, the way `FreezesInFlight` guards gate 1. The
   groom is idempotent by existence and the promotion is idempotent by construction, so a second
   press costs a repeated read, not a duplicated write; the buttons disable themselves while a
   press is in flight. Provenance: `plugin/commands/ct-groom.md` states the idempotence; own call.
6. **Exit `3` of `ct-groom` is success.** The plugin's own table calls it "something real is left
   unreconciled" — a third state, deliberately not an error — and under `--dry-run` it still
   prints the plan. Treating it as a failure would refuse every epic whose spec was edited after
   its groom. Provenance: `plugin/commands/ct-groom.md`.
7. **`--reconcile` and `--project` are not passed.** The plugin marks the first experimental and
   nothing in the issue asks for a Project v2. Provenance: the issue's acceptance criteria and
   `plugin/commands/ct-groom.md`.
8. **The promotion swaps rather than only adding.** Two `status:` labels on one issue make
   `resolveStatus` ambiguous and `GhPlanIssues` refuses to read such an issue at all, so
   "adds `status:ready`" is `--add-label status:ready --remove-label status:backlog`; nothing
   else on the issue is touched, and no issue that is closed or already past backlog is touched
   at all. Provenance: `plugin/scripts/gh-issue-map.js#resolveStatus`; own call on the swap.
9. **The panel renders nothing until gate 2 can act.** In `draft` and `awaiting-publication`
   gate 1's panel is already on screen saying what is missing, and repeating it would put the
   same sentence in two places. Provenance: own call, `conventions/simplicity.md` and
   `conventions/decisions.md`.
10. **The read is polled every ten seconds and stops at the first rung with something to press.**
    What it waits for is a person freezing a spec or merging a pull request, and each poll past
    `draft` costs a `gh` call; stopping at `groomable` bounds the cost to the waiting phase.
    Provenance: own call, with gate 1's own "stop polling once frozen" as the precedent.
11. **The record of each act is one `stderr` line written by its route**, naming the milestone,
    how many issues were planned, how many the milestone holds and which numbers were promoted.
    Its reader is whoever runs `make run-backend`, the same reader `harvest sweep:` and
    `coordinating session:` already answer to, and its labels are a milestone title and counts —
    all bounded. Provenance: the slice's observability signal; own call on the channel, which is
    the only one this backend has.
12. **The issues are answered sorted by number ascending**, which is the order the groom created
    them in and therefore the order of the spec's table. Reading each body for its `ct-order`
    marker would cost one call per issue to reproduce the same order. Provenance: own call.
13. **`GroomPlan` and `EpicIssue` do not re-validate what the adapter already checked.** The
    door — `CtGroomEpic` for the plugin's JSON, `GhEpicIssues` for `gh`'s — is where the shape is
    checked and where the typed failure is raised, and a second opinion downstream would defend
    against a caller that does not exist. Provenance: `conventions/simplicity.md`.
14. **The slice is thirteen tasks.** `writing-plans-prescriptive` calls twelve a badly cut slice
    and says that is fixed where there is a human, when the spec is frozen. The cut is the spec's
    slices table row and is not mine to change; each task here is one commit and none of them
    fits inside another. Provenance: the skill; declared rather than worked around.
15. **The dry run's product is a record per issue with named fields**, so the repository column
    issue #348 will add is one more field on that record and one more column on the panel's list.
    Nothing here flattens it into a string. Provenance: the coordinating session's brief; own
    call on the shape.
