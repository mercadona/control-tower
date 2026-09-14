# #329 — Gate 1: the freeze

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

The cabin already hosts the conversation that writes the spec. `POST /coordinating-session`
spawns an interactive `claude` in the **governed checkout** and `CoordinatingSessions.held()`
keeps it for the rest of the backend's run, with the repository and the checkout root inside
`HeldCoordinatingSession.conversation`. The brainstorming skill that session invokes writes two
documents into that checkout — `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` and
`…-execution.md`, the second one from the plugin's `_TEMPLATE-execution-spec.md`, whose header
carries `**Handoff origen:**`, `**Fecha de congelación:** —` and `**Estado:** DRAFT`.

Nothing in the app has ever read those documents. The freeze is today a line the conversation's
own agent types into the spec, and **nobody checks it**: `ct-groom` says in the text of its own
errors that "groom only accepts FROZEN specs", but no code anywhere reads the state line. The
yardstick that would judge a freeze already exists and is exported —
`analyzeSpecFreeze` in `plugin/scripts/groom.js` returns every `[NEEDS CLARIFICATION` marker with
its line number and its raw text, plus whether `## Hipótesis` is absent, empty or present.

On the publishing side the backend can read a pull request (`GhPullRequests.openOf`, by the
branch of an issue) but has never opened one, and `GitWorkspace` drives `git -C <root>` only to
cut and remove worktrees. `Home` renders `SessionsPanel` and `CoordinatingSessionStatus` inside
its `home__sessions` section, outside every stage branch.

This slice makes the freeze an **act of the program**: the cabin reads the spec of the governed
checkout, shows the yardstick's failures as the imported module reports them, and offers a button
that — only to the page the backend serves — writes `**Estado:** CONGELADA` with the date, commits
the two documents, pushes the epic's branch, opens its pull request and says that the merge of
that pull request is what the groom is waiting for.

### Desired end state

- `GET /spec-freeze` answers, for the checkout the coordinating session holds, one of four
  states, every one of them derived from evidence and none of them stored: `none` (no
  coordinating session), `no-spec` (no execution spec in the checkout), `draft` (with the
  yardstick's findings, each carrying the line number and the raw line the module gives) or
  `frozen` (with the freeze date and the pull request open on the epic's branch).
- The findings are `analyzeSpecFreeze`'s own: one per `[NEEDS CLARIFICATION` marker with its
  `line` and its `detail`, and one when `## Hipótesis` is absent or empty.
- `POST /spec-freeze` writes `**Estado:** CONGELADA` and `**Fecha de congelación:** <today>` into
  the execution spec, commits the spec and its design document, pushes the epic's branch and
  opens its pull request with both documents named in it, and answers the freeze date and that
  pull request.
- It refuses, with an explicit `{code, detail}` and without touching anything: while a
  clarification marker or an empty hypothesis remains (`spec-not-freezable`), when the spec is
  already frozen (`spec-already-frozen`), when there is no spec (`no-epic-spec`), when there is no
  coordinating session (`no-coordinating-session`) and — this is D-22's mechanism — when the
  request does not carry the gate key (`gate-not-from-the-page`), which only a request coming
  from the page this backend serves ever receives.
- The checkout's own branch is what gets pushed, and the gate refuses before committing anything
  when that branch is the remote's default one.
- The cabin shows the panel of gate 1 in every phase: the failures while the spec is a draft, a
  button that is disabled while any of them remains, and — once frozen — the date, the pull
  request and the sentence that the groom is waiting for its merge.
- The coordinating session is told, in its phase prompt, that it never writes that line.

### Out of scope

- 🚫 `plugin/scripts/groom.js` and `plugin/scripts/slices.js` — imported and not modified.
- 🚫 `plugin/skills/brainstorming/SKILL.md` and the rest of the distributed plugin: the
  instruction that the agent does not write the freeze line lands in the backend's own phase
  prompt, which is the only text the sessions this app drives are given.
- The groom, the `status:ready` promotion and `analyzeSlicesTable` — that is gate 2, slice 5.
- The merge and any write to a pull request after it is opened (D-7). No merge button, anywhere.
- `POST /start-plan`, `POST /implement-plan`, the plan events, the harvest and the dispatcher keep
  their behaviour, their use cases and their adapters exactly as they are.
- Creating the epic's branch: the gate pushes the branch the checkout is already on and refuses
  when it is the default one.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · The entrance is a conversation with a real terminal | the cabin hosts the brainstorming and spec session as an interactive `claude` in a PTY streamed to the page, not a structured chat and not a step left outside the app. |
| D-6 · Gates 1 and 2 are acts of the app, with its own yardstick | the freeze and the promotion are buttons the program answers for, never lines the conversation's agent writes. |
| D-7 · GATE 3 is entirely human and stays on GitHub | the merge is the only act with a permanent external effect and no program performs it: a person merges on GitHub, and all the app does is notice, by sweeping, so that it can dispatch whatever the merge unblocked. The app never writes to a pull request, there is no merge button anywhere in the cabin, and no automation may acquire one without reopening this decision. |
| D-10 · Everything new under `backend/` is TypeScript | and the plugin stays JavaScript, which is the repository's own rule for what the plugin ships. |
| D-11 · A yardstick is imported from the plugin, never reimplemented | `analyzeSpecFreeze` and `analyzeSlicesTable` are the freeze's yardstick and `ct-groom.mjs` is the groom; the backend grows no second opinion about whether a spec is freezable. |
| D-13 · No phase is stored | every phase is derived from evidence that survives a restart: the spec and its state line, the milestone and its issues, a `status:ready` label, a worktree, a record, a pull request, a closed issue. |
| D-16 · cmux leaves the backend | no module under `backend/src` names cmux, and it stops being probed as an external tool. |
| D-18 · There is a coordinating session and it is the boss of all of them | the entrance conversation does not die at the freeze: it stays as the milestone's coordinator and the human's single interlocutor. What it never does is decide the order or the phase — that is the program's. It commands by invoking the backend's endpoints and the plugin's programs, while the backend owns the processes, makes the call of each step, keeps the record and measures. |
| D-21 · The coordinating session is always in the front, and it is recoverable | the cabin offers a place to talk to it in **every** phase, and most explicitly once the implementation is running: no phase of the page may hide it, replace it with a progress panel or disable its input. |
| D-22 · The gates are the human's and no session can trigger them | the coordinating session commands the backend, but not here: writing `Estado: CONGELADA`, promoting to `status:ready` and anything around the merge are triggered only from the front, by a person's click. There is no endpoint for them that a session can call, and an attempt is refused with an explicit code rather than obeyed. Everything else does travel through the boss: starting work already authorised, asking for changes, unblocking what is stuck. This is the repository's own doctrine — the go the agent cannot write — applied to the coordinator now that it has hands. |
| D-23 · After the freeze the app publishes the spec, and the groom waits for its merge | pressing gate 1 commits the state line and then does what a person would do next: push the epic's branch and open its pull request with the design and the spec in it. The groom stays refused until the spec's committed copy is readable on the **default** branch, and what achieves that is the human merging that pull request — not a fourth gate, but D-7 again: the app never merges. |
| D-25 · The context of every call is composed by the plugin and relayed verbatim, never paraphrased by the backend | the backend hands over **paths** and pastes none of that text into a prompt. |
| Every other decision of the epic | D-2, D-3, D-4, D-5, D-8, D-9, D-12, D-14, D-15, D-17, D-19, D-20, D-24 and D-26 are in the issue and bind unchanged; none of them adds a constraint this slice can violate, because none of them speaks about the freeze, the spec's file or the cabin's gates. |

## 3. Reference patterns

Files to imitate: `backend/src/domain/value-objects/coordinating-conversation.ts` (a frozen value
object), `backend/src/domain/ports/pull-requests.ts` (a port whose methods throw "must
implement"), `backend/src/infrastructure/git-workspace.ts` (a git adapter: static argv builders,
typed errors, the two failure causes told apart),
`backend/src/infrastructure/gh-pull-requests.ts` (a `gh` adapter over the `Gh` idiom),
`backend/src/infrastructure/disk-conversation-records.ts` (a disk adapter with `read`/`write`
injected as functions), `backend/src/application/actions/open-coordinating-session.ts` (a use
case driving its ports in order), `backend/src/application/queries/read-implementation-progress.ts`
(a query), `backend/src/infrastructure/coordinating-session-route.ts` (a route with GET and POST,
a `Projection` of refusals and `PlanCollapse`), `backend/src/infrastructure/http.ts`
(`Answer`, `Refusal`, `Browsers.isOurOwnPage`),
`backend/__tests__/application/open-coordinating-session.test.ts` (a use case with every port
doubled), `backend/__tests__/infrastructure/coordinating-session-route.test.ts` (a controller
through a real listening server), `backend/__tests__/infrastructure/disk-conversation-records.test.ts`,
`backend/__tests__/infrastructure/git-workspace.test.ts`,
`backend/__tests__/infrastructure/plugin-contract.test.ts` (the declared copy of what the plugin
does not export), `frontend/src/app/coordinating-session/client.ts`,
`frontend/src/app/coordinating-session/useCoordinatingSession.ts`,
`frontend/src/app/coordinating-session/components/coordinating-session-status/CoordinatingSessionStatus.tsx`,
`frontend/src/app/implement-plan/components/implement-plan-action/ImplementPlanAction.tsx` (a
button that posts and renders the refusal it got), `frontend/src/__scenarios__/CoordinatingSessionMother.ts`.

Rules to obey: `.agent/conventions-ack.md`, `CLAUDE.md` and `AGENTS.md` (English everywhere except
what a person reads in the product, which is Spanish; the parsed Spanish literals of the spec are
contract and do not move), `backend/conventions/this-repository.md` (the layout, the exception
families and their two causes, `{code, detail}` in kebab-case, which status a refusal answers,
where the suite runs, how a tool is talked to), `frontend/README.md` (the frontend yardstick, the
design system mirrors, the vite proxy). Skills named by the epic context:
`backend-engineering:backend-best-practices`, `frontend-engineering:frontend-best-practices`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/epic-spec.ts` | create | the query, the action, the adapter | Contract (T1) |
| `backend/src/domain/value-objects/freeze-finding.ts` | create | `EpicSpec`, the route | Contract (T1) |
| `backend/__tests__/infrastructure/plugin-contract.test.ts` | modify | the declared copy | none (body by TDD) |
| `backend/src/domain/ports/epic-specs.ts` | create | the query, the action | Contract (T2) |
| `backend/src/infrastructure/disk-epic-specs.ts` | create | `ct-api.ts` | Contract (T2) |
| `backend/src/domain/exceptions.ts` | modify | the adapters, `PlanCollapse` | Contract (T2) |
| `backend/src/domain/ports/epic-branch.ts` | create | the query, the action | Contract (T3) |
| `backend/src/infrastructure/git-epic-branch.ts` | create | `ct-api.ts` | Contract (T3) |
| `backend/src/infrastructure/git-workspace.ts` | modify | `GitEpicBranch` | Current state (T3) |
| `backend/src/domain/ports/pull-requests.ts` | modify | the query, the action | Current state, Contract (T4) |
| `backend/src/infrastructure/gh-pull-requests.ts` | modify | `ct-api.ts` | Contract (T4) |
| `backend/src/application/queries/read-spec-freeze.ts` | create | the route | Contract (T5) |
| `backend/src/application/actions/freeze-spec.ts` | create | the route | Contract (T5) |
| `backend/src/infrastructure/gate-key.ts` | create | the route, `ct-api.ts` | Contract (T6) |
| `backend/src/infrastructure/spec-freeze-route.ts` | create | `api-server.ts` | Contract (T6) |
| `backend/src/infrastructure/start-plan-route.ts` | modify | the route | Contract (T6) |
| `backend/__tests__/infrastructure/plan-refusal.test.ts` | modify | the guard | none (body by TDD) |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | the guard | none (body by TDD) |
| `backend/src/infrastructure/api-server.ts` | modify | the entrypoint | Call site (T7) |
| `backend/src/infrastructure/ct-api.ts` | modify | the entrypoint | Call site (T7) |
| `backend/src/domain/value-objects/phase-prompt.ts` | modify | `OpenCoordinatingSession` | Current state (T7) |
| `backend/API.md` | modify | whoever reads the contract | Final text (T7) |
| `backend/conventions/this-repository.md` | modify | every agent working here | Final text (T7) |
| `frontend/vite.config.ts` | modify | `make dev-frontend` | prose (config) (T7) |
| `frontend/src/app/spec-freeze/SpecFreeze.types.ts` | create | the client, the hook, the panel | Contract (T8) |
| `frontend/src/app/spec-freeze/client.ts` | create | the hook, the panel | Contract (T8) |
| `frontend/src/app/spec-freeze/useSpecFreeze.ts` | create | the panel | Contract (T8) |
| `frontend/src/__scenarios__/SpecFreezeMother.ts` | create | every frontend test | none (body by TDD) |
| `frontend/src/app/spec-freeze/components/spec-freeze-panel/SpecFreezePanel.tsx` | create | `Home` | Contract (T9) |
| `frontend/src/app/spec-freeze/components/spec-freeze-panel/SpecFreezePanel.css` | create | the panel | none (body by TDD) |
| `frontend/src/app/spec-freeze/components/spec-freeze-panel/index.ts` | create | `Home` | none (body by TDD) |
| `frontend/src/pages/home/Home.tsx` | modify | the page | Current state, Call site (T10) |
| `frontend/src/pages/home/__tests__/helpers.tsx` | modify | every `Home` test | none (body by TDD) |
| `frontend/README.md` | modify | whoever works on the front end | Final text (T10) |
| `/Users/jponzvan/git/control-tower-plugin/plugin/conventions` | read | every task | none (ct's yardstick) |

## 5. Interfaces

Consumes: the issue's "Dependencias" section declares only `merge-after #3`, so what this slice
consumes is what slice 3 left in the tree —
`CoordinatingSessions.held(): HeldCoordinatingSession | null`, whose `conversation` carries
`repository: RepositoryName` and `root: CheckoutRoot`, and
`PhasePrompt.brainstorming({ story, comment, repository, root }): PhasePrompt`. From the plugin,
imported and not modified: `analyzeSpecFreeze(specMd): { hypothesis, clarifications }` and
`HYPOTHESIS_REASONS` from `plugin/scripts/groom.js`.

Produces, for slice 5 (the groom and gate 2):
`EpicSpecs.mostRecent(root: CheckoutRoot): Promise<EpicSpec | null>`;
`EpicSpec#isFrozen(): boolean` and `EpicSpec#frozenOn(): string | null`, which is the evidence
the groom is refused on until the spec's committed copy is readable on the default branch;
`EpicBranch.current(root: CheckoutRoot): Promise<string>`;
`PullRequests.openOfBranch({ branch, repository }): Promise<ReviewedPullRequest | null>`;
`GateKey#forThePage({ origin, host }): string | null` and `GateKey#holds(offered): boolean`,
which is the mechanism gate 2's own button reuses;
`ReadSpecFreeze#execute(params): Promise<SpecFreezeRead>`.

## 6. Test strategy

Outside-in, with the commands the epic context declares:
`npm --prefix backend run typecheck`, `npm --prefix backend test`, `npm --prefix frontend test`.
All three are green on this branch's base and every task keeps them green.

The application layer is where `ReadSpecFreeze` and `FreezeSpec` are measured, with `EpicSpecs`,
`EpicBranch` and `PullRequests` doubled at construction; the assertion is on what each port
received and what the use case returned, and a refused freeze also asserts that no port was asked
to write, commit, push or open anything. The adapters are cut right before the external system:
`DiskEpicSpecs` with `list`/`read`/`write` injected as functions, `GitEpicBranch` and the new
`GhPullRequests` methods with their `run`/`gh` scripted, each telling its two failure causes apart
— the command refusing and the command answering something unreadable. The controller is measured
through a real listening server, status and literal body. `plugin-contract.test.ts` feeds the
plugin's own `_TEMPLATE-execution-spec.md` to `EpicSpec`, which is the declared copy of the six
header literals the plugin does not export.

The domain has no tests of its own: `EpicSpec` and `FreezeFinding` are reached through the query,
the action and that contract test. On the front end, `SpecFreezePanel` is measured with `fetch`
stubbed from `SpecFreezeMother`, and `Home`'s existing suites gain nothing but the new route in
their stub.

## 7. Tasks

### Task 1 — The execution spec, as a value this backend can read and freeze

**Objective:** the backend can say whether an execution spec is a draft or frozen, name its design
document and its title, and produce the same text with the freeze written into it.

**Files:** `backend/src/domain/value-objects/epic-spec.ts` (create),
`backend/src/domain/value-objects/freeze-finding.ts` (create),
`backend/__tests__/infrastructure/plugin-contract.test.ts` (modify)

The six literals below are the header `plugin/templates/_TEMPLATE-execution-spec.md` seeds; the
plugin exports none of them, so this is the declared copy `backend/conventions/this-repository.md`
requires. `findings()` asks `analyzeSpecFreeze` (`plugin/scripts/groom.js`) and re-decides
nothing: one `CLARIFICATION_MARKER` per element of its `clarifications` carrying that element's
`line` and `raw`, one for `HYPOTHESIS_REASONS.ABSENT` and one for `.EMPTY`, projected
exhaustively. `dateOf` reads the local calendar day, never `toISOString`.

Contract (backend/src/domain/value-objects/epic-spec.ts):

```ts
export class EpicSpec {
  static readonly TITLE_SUFFIX = ' — Execution spec'
  static readonly HANDOFF_LINE = '**Handoff origen:**'
  static readonly DATE_LINE = '**Fecha de congelación:**'
  static readonly STATE_LINE = '**Estado:**'
  static readonly DRAFT = 'DRAFT'
  static readonly FROZEN = 'CONGELADA'
  readonly path: string
  readonly text: string
  constructor({ path, text }: { path: string, text: string })
  static dateOf(now: Date): string
  title(): string | null
  design(): string | null
  isFrozen(): boolean
  frozenOn(): string | null
  findings(): FreezeFinding[]
  isFreezable(): boolean
  frozenAt(on: string): string
}
```

Contract (backend/src/domain/value-objects/freeze-finding.ts):

```ts
export const FreezeFindingCode = Object.freeze({
  CLARIFICATION_MARKER: 'clarification-marker',
  HYPOTHESIS_ABSENT: 'hypothesis-absent',
  HYPOTHESIS_EMPTY: 'hypothesis-empty',
} as const)
export class FreezeFinding {
  readonly code: (typeof FreezeFindingCode)[keyof typeof FreezeFindingCode]
  readonly line: number | null
  readonly detail: string | null
  constructor(finding: { code: string, line: number | null, detail: string | null })
}
```

**TDD:** red first with
`it('the execution spec template the plugin seeds reads here as a draft that names its design document')`
— reads the real template off disk; asserts `isFrozen()` `false`, `frozenOn()` `null`, `title()` `'<Epic name>'`, `design()` `'docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md'`. Then
`it('freezing that template rewrites the two header lines the plugin left blank and nothing else')`
— `frozenAt('2026-09-14')` has `'**Estado:** CONGELADA'` and `'**Fecha de congelación:** 2026-09-14'`,
has neither `'**Estado:** DRAFT'` nor `'**Fecha de congelación:** —'`, and every other line is
byte-identical. The pair pins the state line's boundary.

**Tests:** the two named above, in `plugin-contract.test.ts`. `findings()` and `isFreezable()` get
none here: `conventions/testing.md` covers the domain on the use case's path, which is Task 5.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — both value objects type-check
npm --prefix backend test -- __tests__/infrastructure/plugin-contract.test.ts   # expected: exit 0 — the template still reads as a draft
test "$(grep -c 'CONGELADA' backend/src/domain/value-objects/epic-spec.ts)" -eq 1   # expected: exit 0 — one frozen literal
```

### Task 2 — The checkout's specs, read and written from disk

**Objective:** the backend finds the newest execution spec of a checkout, reads it and writes it
back, telling a disk that refused apart from a file that is no spec.

**Files:** `backend/src/domain/ports/epic-specs.ts` (create),
`backend/src/infrastructure/disk-epic-specs.ts` (create),
`backend/src/domain/exceptions.ts` (modify), `backend/src/infrastructure/start-plan-route.ts`
(modify), `backend/__tests__/infrastructure/disk-epic-specs.test.ts` (create),
`backend/__tests__/infrastructure/plan-refusal.test.ts` (modify)


"The newest" is the greatest file name: the brainstorming skill names every spec
`YYYY-MM-DD-<topic>-execution.md`, and `-design.md` and the plugin's
`_TEMPLATE-execution-spec.md` fall outside `SUFFIX`. `path` is relative to the checkout root: it becomes a
pathspec of `git add` and a line of the pull request's body. `list` answers `null` for a checkout
with no specs directory, which is no failure. The adapter is the door: it refuses a file whose
`EpicSpec#title()` is `null` with `EpicSpecNotUnderstood`. The three leaves
below join `PlanCollapse` in `start-plan-route.ts` in this same commit — `plan-refusal.test.ts`
demands a refusal per leaf — as `epic-spec-not-read`, `epic-spec-not-understood` and
`epic-spec-not-written`, and that test's `FAMILIES` gains `'SpecFreezeFailure'`.

Contract (backend/src/domain/ports/epic-specs.ts):

```ts
export class EpicSpecs {
  async mostRecent(root: CheckoutRoot): Promise<EpicSpec | null>
  async rewrite({ root, spec, text }: { root: CheckoutRoot, spec: EpicSpec, text: string }): Promise<void>
}
```

Contract (backend/src/infrastructure/disk-epic-specs.ts):

```ts
export class DiskEpicSpecs extends EpicSpecs {
  static readonly DIRECTORY = 'docs/superpowers/specs'
  static readonly SUFFIX = '-execution.md'
  constructor({ list, read, write }: {
    list: (path: string) => Promise<string[] | null>,
    read: (path: string) => Promise<string | null>,
    write: (path: string, text: string) => Promise<void>,
  })
}
```

Contract (backend/src/domain/exceptions.ts):

```ts
export class SpecFreezeFailure extends PlanFailure {}
export class EpicSpecNotRead extends SpecFreezeFailure {}
export class EpicSpecNotUnderstood extends SpecFreezeFailure {}
export class EpicSpecNotWritten extends SpecFreezeFailure {}
```

**TDD:** red first with
`it('answers the newest execution spec and leaves the design documents and the template out')`
— `list` answers `_TEMPLATE-execution-spec.md`, `2026-09-01-a-execution.md`,
`2026-09-11-b-design.md`, `2026-09-11-b-execution.md`; `read` is asked for
`/repo/docs/superpowers/specs/2026-09-11-b-execution.md`. The two dated executions are the
boundary: the older one must lose.

**Tests:** in `disk-epic-specs.test.ts`: the one above,
`answers nothing when the checkout has no specs directory`,
`a directory that cannot be listed is told apart from a file that carries no title`,
`writes the spec back to the path it was read from`,
`a write that fails becomes EpicSpecNotWritten instead of a disk error`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — port and adapter type-check
npm --prefix backend test -- __tests__/infrastructure/disk-epic-specs.test.ts __tests__/infrastructure/plan-refusal.test.ts   # expected: exit 0 — every leaf has its refusal
npm --prefix backend test -- __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0 — the codes stay distinct
```

### Task 3 — The epic's branch: committed, pushed, never the default

**Objective:** the backend commits the two documents on the checkout's own branch and pushes it,
refusing before any write when that branch is the remote's default.

**Files:** `backend/src/domain/ports/epic-branch.ts` (create),
`backend/src/infrastructure/git-epic-branch.ts` (create),
`backend/src/infrastructure/git-workspace.ts` (modify),
`backend/src/domain/exceptions.ts` (modify), `backend/src/infrastructure/start-plan-route.ts`
(modify), `backend/__tests__/infrastructure/git-epic-branch.test.ts` (create)

What the remote's default branch is stays ONE decision: the line below moves out of
`GitWorkspace#declaredBase` into a public `static declaredBranchIn(printed): string | null` it
then calls, and `GitEpicBranch` reads it with the public `GitWorkspace.defaultBranchArgvFor(root)`.
`publish` reads the current branch and the default, refuses with `EpicBranchNotPublished` when
they are the same — **before** any write — and only then adds, commits, pushes and answers the
branch. The argv: `currentArgvFor` is
`['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD']`, `addArgvFor`
`['-C', root, 'add', '--', ...paths]`, `commitArgvFor`
`['-C', root, 'commit', '-m', message, '--', ...paths]`, `pushArgvFor`
`['-C', root, 'push', '--set-upstream', GitEpicBranch.REMOTE, branch]`. `add` first: an
uncommitted design document is untracked and no `commit` pathspec reaches it.

Current state (backend/src/infrastructure/git-workspace.ts, line 280):

```ts
    const declared = asked.stdout.trim().match(GitWorkspace.#DECLARED)
```

Contract (backend/src/domain/ports/epic-branch.ts):

```ts
export class EpicBranch {
  async current(root: CheckoutRoot): Promise<string>
  async publish({ root, paths, message }: { root: CheckoutRoot, paths: string[], message: string }): Promise<string>
}
```

Contract (backend/src/infrastructure/git-epic-branch.ts):

```ts
export class GitEpicBranch extends EpicBranch {
  static readonly REMOTE = 'origin'
  static currentArgvFor(root: string): string[]
  static addArgvFor(root: string, paths: string[]): string[]
  static commitArgvFor(root: string, message: string, paths: string[]): string[]
  static pushArgvFor(root: string, branch: string): string[]
  constructor({ run }: { run: ToolLaunch })
}
```

`exceptions.ts` gains `EpicBranchNotPublished` and `EpicBranchNotUnderstood` under
`SpecFreezeFailure`; `PlanCollapse` gains their kebab-case codes.

**TDD:** red first with
`it('refuses before writing anything when the checkout sits on the branch the remote calls default')`
— `rev-parse --abbrev-ref HEAD` answers `main` and `symbolic-ref` `refs/remotes/origin/main`; it
raises `EpicBranchNotPublished` and no `add`, `commit` or `push` was launched. Its pair, on
`epic/the-loop`, is the boundary: it must reach all three.

**Tests:** in `git-epic-branch.test.ts`: the one above,
`commits the two documents and pushes the checkout's branch, and answers it`,
`current answers the branch the checkout is on`,
`a push git refused is told apart from an unreadable symbolic-ref`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/git-epic-branch.test.ts __tests__/infrastructure/git-workspace.test.ts   # expected: exit 0 — the extraction is safe
npm --prefix backend test -- __tests__/infrastructure/plan-refusal.test.ts   # expected: exit 0 — both leaves refuse
```

### Task 4 — The epic's pull request: found and opened

**Objective:** the backend finds the open pull request whose head is a branch, and opens one there
with a title and a body.

**Files:** `backend/src/domain/ports/pull-requests.ts` (modify),
`backend/src/infrastructure/gh-pull-requests.ts` (modify),
`backend/src/domain/exceptions.ts` (modify), `backend/src/infrastructure/start-plan-route.ts`
(modify), `backend/__tests__/infrastructure/gh-pull-requests.test.ts` (modify),
`backend/__tests__/infrastructure/plan-refusal.test.ts` (modify),
`backend/__tests__/application/read-fixes-asked.test.ts` (modify),
`backend/__tests__/application/read-implementation-progress.test.ts` (modify)

"Which open pull request has this head" becomes ONE decision: `openOfBranch` owns the `gh pr list`
lookup and `openOf` delegates to it with `${LOOP_BRANCH_PREFIX}${issueNumber}`. `createArgvFor` is
`['pr', 'create', '--repo', repository.text, '--head', branch, '--title', title, '--body', body]`
with `safeToRepeat: false`: what `this-repository.md` says of `gh issue create` binds any
creation. `gh pr create` prints the url, so `open` trims stdout, matches `CREATED` and answers
both; no match is `PullRequestNotUnderstood`, a refusing `gh` is
`EpicPullRequestNotOpened`. `exceptions.ts` gains that leaf under `SpecFreezeFailure`, and
`PlanCollapse` gains it plus `PullRequestNotRead` and `PullRequestNotUnderstood`:
`plan-refusal.test.ts` drops `PullRequestFailure` from the families it excuses and the test that
they have no refusal, because a request reads one now. The last two test files hold a double whose
`open` field collides with the new method.


Contract (backend/src/domain/ports/pull-requests.ts):

```ts
export class PullRequests {
  async openOfBranch({ branch, repository }: { branch: string, repository: RepositoryName }): Promise<ReviewedPullRequest | null>
  async open({ repository, branch, title, body }: {
    repository: RepositoryName, branch: string, title: string, body: string,
  }): Promise<ReviewedPullRequest>
}
```

Contract (backend/src/infrastructure/gh-pull-requests.ts):

```ts
  static readonly CREATED = /\/pull\/(\d+)$/
  static createArgvFor(asked: { repository: RepositoryName, branch: string, title: string, body: string }): string[]
```

**TDD:** red first with
`it('opens_the_pull_request_on_the_epic_branch_and_never_lets_a_creation_be_repeated')` — the argv
is written out literally, never built by calling `createArgvFor`, and the half of the name after
the `and` is pinned the way `gh-plan-issues.test.ts` pins the same flag: script a **transient**
failure and assert `gh` was launched once. The number is `42`, out of the url shape `LISTED`
captures. Its boundary pair is a stdout with no `/pull/<n>`, which must raise rather than
invent one. Snake_case names, like that file's rest.

**Tests:** in `gh-pull-requests.test.ts`: the one above,
`a_gh_that_refused_to_create_is_told_apart_from_a_gh_that_printed_no_pull_request_url`,
`open_of_branch_answers_the_open_pull_request_whose_head_is_that_branch`. The existing `openOf`
tests stay green, proving the delegation kept its behaviour.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/gh-pull-requests.test.ts __tests__/infrastructure/plan-refusal.test.ts   # expected: exit 0
test "$(grep -c "'pr', 'list'" backend/src/infrastructure/gh-pull-requests.ts)" -eq 1   # expected: exit 0 — one lookup
```

### Task 5 — Reading gate 1's state, derived and never stored

**Objective:** the backend answers, for a checkout, whether it holds no execution spec, a draft
with the yardstick's findings, or a frozen spec with its date and its pull request.

**Files:** `backend/src/application/queries/read-spec-freeze.ts` (create),
`backend/__tests__/application/read-spec-freeze.test.ts` (create)

Every answer is computed on the call and nothing is written down, which is D-13. `no-spec` when
`specs.mostRecent` answers `null`. `draft` when the spec is not frozen: `findings` is
`spec.findings()` and **neither** `branch` **nor** `pullRequests` is asked, because a draft has no
branch to publish and no pull request to find. `frozen` when `spec.isFrozen()`: `frozenOn` is
`spec.frozenOn()`, and only there does it ask `branch.current(root)` and then
`pullRequests.openOfBranch({ branch, repository })`, whose `null` — merged already, or never
opened — is a state and not a failure. This task also brings `EpicSpec#findings()` and
`#isFreezable()` under test, which is where `conventions/testing.md` puts the domain's coverage.

Contract (backend/src/application/queries/read-spec-freeze.ts):

```ts
export class ReadSpecFreezeParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName
  constructor(asked: { root: CheckoutRoot, repository: RepositoryName })
}
export const SpecFreezeState = Object.freeze({
  NO_SPEC: 'no-spec', DRAFT: 'draft', FROZEN: 'frozen',
} as const)
export class SpecFreezeRead {
  readonly state: (typeof SpecFreezeState)[keyof typeof SpecFreezeState]
  readonly spec: EpicSpec | null
  readonly findings: FreezeFinding[]
  readonly frozenOn: string | null
  readonly pullRequest: ReviewedPullRequest | null
}
export class ReadSpecFreeze {
  constructor(ports: { specs: EpicSpecs, branch: EpicBranch, pullRequests: PullRequests })
  async execute(params: ReadSpecFreezeParams): Promise<SpecFreezeRead>
}
```

**TDD:** red first with
`it('a spec with a clarification marker still pending answers draft with the module line and raw text, and asks neither git nor github')`
— a spec whose line 9 is `- [NEEDS CLARIFICATION: who signs the freeze?]` and whose `## Hipótesis`
carries a bet answers `draft` with exactly one finding, `clarification-marker`, `line` `9`,
`detail` that line trimmed; `branch` and `pullRequests` were never asked. Its boundary pair is the
same spec with that line deleted: `draft`, zero findings.

**Tests:** in `read-spec-freeze.test.ts`: the one above,
`a spec whose Hypothesis section holds only the template comment answers the hypothesis-empty finding`,
`a spec with no Hypothesis heading answers the hypothesis-absent finding`,
`a frozen spec answers its date and the pull request open on the checkout branch`,
`a checkout with no execution spec answers no-spec and asks nothing else`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/application/read-spec-freeze.test.ts   # expected: exit 0
```

### Task 6 — Pressing gate 1: the state line, the commit, the push and the pull request

**Objective:** the freeze writes `**Estado:** CONGELADA` with today's date, commits the spec and
its design document, pushes the epic's branch, opens its pull request and answers both.

**Files:** `backend/src/application/actions/freeze-spec.ts` (create),
`backend/__tests__/application/freeze-spec.test.ts` (create)

The order, and it stops at the first refusal without touching anything: `specs.mostRecent` `null`
is `NO_SPEC`; `spec.isFrozen()` is `ALREADY_FROZEN`; `!spec.isFreezable()` is `NOT_FREEZABLE` and
carries `spec.findings()`; `spec.design()` `null` raises `EpicSpecNotUnderstood`. Only then:
`on` is `EpicSpec.dateOf(now())`, `specs.rewrite` with `spec.frozenAt(on)`, `branch.publish` with
`paths` `[design, spec.path]`, and `pullRequests.open` on the branch `publish` answered. Whether a
spec can be frozen is asked of `EpicSpec#isFreezable()`, the same method Task 5's query asks, so
the yardstick is not decided twice. The three composed texts, English because a program wrote
them: the commit message `Freeze the execution spec of <title> (<on>)`; the pull request's title
`<title> — design and execution spec`; its body, the line
`The epic's two documents, with the execution spec frozen on <on>.`, a blank line, one `- <path>`
per document with the design first, a blank line, and `Control Tower's gate 1 wrote the state line
and committed both. The groom stays refused until this pull request merges.`

Contract (backend/src/application/actions/freeze-spec.ts):

```ts
export class FreezeSpecParams {
  readonly root: CheckoutRoot
  readonly repository: RepositoryName
  constructor(asked: { root: CheckoutRoot, repository: RepositoryName })
}
export const FreezeOutcome = Object.freeze({
  FROZEN: 'frozen', NO_SPEC: 'no-spec', ALREADY_FROZEN: 'already-frozen', NOT_FREEZABLE: 'not-freezable',
} as const)
export class SpecFrozen {
  readonly outcome: (typeof FreezeOutcome)[keyof typeof FreezeOutcome]
  readonly findings: FreezeFinding[]
  readonly on: string | null
  readonly pullRequest: ReviewedPullRequest | null
}
export class FreezeSpec {
  constructor(ports: { specs: EpicSpecs, branch: EpicBranch, pullRequests: PullRequests, now: () => Date })
  async execute(params: FreezeSpecParams): Promise<SpecFrozen>
}
```

**TDD:** red first with
`it('a spec with a pending clarification marker is refused and nothing is written, committed, pushed or opened')`
— the answer is `NOT_FREEZABLE` carrying that finding, and `specs.rewrite`, `branch.publish` and
`pullRequests.open` were never asked. Its boundary pair, the same spec without the marker, is
`it('writes the state line with today date, commits both documents, pushes and opens the pull request')`
— with `now` fixed at `2026-09-14`, the text handed to `rewrite` carries `**Estado:** CONGELADA`
and `**Fecha de congelación:** 2026-09-14`, `publish` got the design path first, and `open` got
the branch `publish` answered.

**Tests:** in `freeze-spec.test.ts`: the two above,
`a checkout with no execution spec answers no-spec and writes nothing`,
`a spec already frozen is refused instead of being frozen twice`,
`a spec that names no design document raises instead of publishing half the epic`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/application/freeze-spec.test.ts   # expected: exit 0
```

### Task 7 — The read of gate 1, and the key only the page gets

**Objective:** `GET /spec-freeze` answers gate 1's state, and hands a key that only a request
coming from the page this backend serves ever receives.

**Files:** `backend/src/infrastructure/gate-key.ts` (create),
`backend/src/infrastructure/spec-freeze-route.ts` (create),
`backend/__tests__/infrastructure/spec-freeze-route.test.ts` (create)

`GateKey` mints one hex key per backend run, and `forThePage` answers it only when
`Browsers.isOurOwnPage(origin, host)` does — what our own page is stays decided there. A session
curling loopback sends no `Origin`, so it never gets the key: that is the half of D-22's mechanism
this task builds, with the key never in a prompt, a repository file or an environment. The four
bodies, all `200`: `{"status":"none"}` with no coordinating session held;
`{"status":"no-spec"}`; `{"status":"draft","spec":…,"findings":[{"code":…,"line":…,"detail":…}]}`
with `"key"` present **only** when one was minted; and
`{"status":"frozen","spec":…,"on":…,"pullRequest":{"number":n,"url":u}|null}`. The route reads the
repository and the root out of `held().conversation`, so the page sends no parameters.

Contract (backend/src/infrastructure/gate-key.ts):

```ts
export class GateKey {
  static readonly HEADER = 'x-gate-key'
  static readonly BYTES = 32
  constructor(minted: { random: (size: number) => Buffer })
  forThePage(asked: { origin: unknown, host: unknown }): string | null
  holds(offered: unknown): boolean
}
```

Contract (backend/src/infrastructure/spec-freeze-route.ts):

```ts
export class SpecFreezeRoute {
  static readonly PATH = '/spec-freeze'
  static readonly METHODS = 'GET, POST'
  static reading(held: CoordinatingSessions, read: ReadSpecFreeze, key: GateKey): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

**TDD:** red first, through a real listening server, with
`it('the read hands the gate key only to a request carrying the page own origin')` — the same
draft read twice, once with `Origin: http://127.0.0.1:<port>` and once with none: the first body
carries `key`, the second has no `key` field at all. That pair is the boundary of D-22.

**Tests:** in `spec-freeze-route.test.ts`: the one above,
`a draft answers each finding with the line and the raw text the module gave`,
`a frozen spec answers its date and its pull request`,
`with no coordinating session it answers none without asking the read`,
`another method is refused naming the allowed ones`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/spec-freeze-route.test.ts   # expected: exit 0
```

### Task 8 — The press of gate 1, refused to anything that is not the page

**Objective:** `POST /spec-freeze` freezes and answers the date and the pull request, and refuses
with an explicit code — a caller with no key first of all — without asking the freeze.

**Files:** `backend/src/infrastructure/spec-freeze-route.ts` (modify),
`backend/__tests__/infrastructure/spec-freeze-route.test.ts` (modify),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

The `POST` demands `GateKey.HEADER` and answers `403` `gate-not-from-the-page` **without asking
the freeze**, then `400` `no-coordinating-session`, then projects `FreezeOutcome` with a
`Projection` to `no-epic-spec`, `spec-already-frozen` and `spec-not-freezable`, whose detail is
`the spec is not freezable: <n> finding(s) remain, the first on line <line>` — or
`…, the first is <code>` when that finding has no line, which is what makes a refusal name the
offending line. `FROZEN` answers `200`
`{"status":"frozen","on":<date>,"pullRequest":{"number":n,"url":u}}`, and a `PlanFailure` becomes
`PlanCollapse`. It takes no body, so it is mounted with neither `JsonBody` middleware.
`refusal-codes.test.ts` adds `SpecFreezeOutcome` to its request vocabularies.

Contract (backend/src/infrastructure/spec-freeze-route.ts):

```ts
export const SpecFreezeOutcome = Object.freeze({
  ACCEPTED: 'accepted', NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session', NO_EPIC_SPEC: 'no-epic-spec',
  SPEC_ALREADY_FROZEN: 'spec-already-frozen', SPEC_NOT_FREEZABLE: 'spec-not-freezable',
} as const)
  static freezing(held: CoordinatingSessions, freeze: FreezeSpec, key: GateKey): RequestHandler
```

**TDD:** red first with
`it('a post with no gate key is refused as gate-not-from-the-page and the freeze is never asked')`
— `403`, the literal body, and the `FreezeSpec` double untouched. Its boundary pair is the same
post carrying the key a `GET` handed to a request whose `Origin` was the server's own: `200` with
the date and the pull request.

**Tests:** added to `spec-freeze-route.test.ts`: the two above,
`a post carrying a key this run never minted is refused like one with none`,
`a refused freeze names the offending line in its detail`,
`a post with no coordinating session is refused without asking the freeze`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/spec-freeze-route.test.ts __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0
```

### Task 9 — Wiring gate 1 into the server it runs in

**Objective:** the running backend serves `/spec-freeze`, with the disk, the git and the `gh` this
entrypoint already builds, and `make dev-frontend` proxies it.

**Files:** `backend/src/infrastructure/api-server.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify), `frontend/vite.config.ts` (modify),
`backend/__tests__/infrastructure/api-server.test.ts` (modify),
`backend/__tests__/infrastructure/ct-api-real-process.test.ts` (modify)

`ApiCollaborators` gains `readSpecFreeze`, `freezeSpec` and `gateKey`, each optional and nullable
like every other one. `ct-api.ts` gains a `Disk.list(path)` that answers `readdir`'s names or
`null` on `ENOENT`, and builds `new DiskEpicSpecs({ list: Disk.list, read: Disk.read, write: Disk.write })`,
`new GitEpicBranch({ run: git })` on the `git` launcher it already has, `new GateKey({ random: randomBytes })`,
and the two use cases with the `GhPullRequests` it already has and `now: () => new Date()`.
`frontend/vite.config.ts`: `'/spec-freeze'` joins `API_PATHS`. That proxy strips `Origin`, so under
`make dev-frontend` the read hands no key and the button says so — the gate is operable from the
page the backend itself serves, which is what D-22 asks for.

Call site (backend/src/infrastructure/api-server.ts):

```ts
    app.get(SpecFreezeRoute.PATH, Browsers.turnAwayForeign,
      SpecFreezeRoute.reading(this.coordinatingSessions!, this.readSpecFreeze!, this.gateKey!))
    app.post(SpecFreezeRoute.PATH, Browsers.turnAwayForeign,
      SpecFreezeRoute.freezing(this.coordinatingSessions!, this.freezeSpec!, this.gateKey!))
    app.all(SpecFreezeRoute.PATH, SpecFreezeRoute.refuseOtherMethods)
```

**TDD:** red first with
`it('the_spec_freeze_read_is_served_and_another_method_on_its_path_is_refused')` in
`api-server.test.ts` — a `GET` reaches the doubled query and a `DELETE` answers `405` with `Allow:
GET, POST`. Then, in `ct-api-real-process.test.ts`,
`it('a_whole_request_to_spec_freeze_reaches_the_wiring_the_entrypoint_built')` — the entrypoint
started for real answers `200 {"status":"none"}`, which a mistyped collaborator could not do
because constructing it is what boots the server.

**Tests:** the two named above. No test pins the vite proxy: it is development configuration that
`make dev-frontend` exercises and no suite loads.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/infrastructure/api-server.test.ts   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/ct-api-real-process.test.ts   # expected: exit 0
test "$(grep -c "'/spec-freeze'" frontend/vite.config.ts)" -eq 1   # expected: exit 0 — the dev proxy knows the path
```

### Task 10 — The session is told the line is not its, and gate 1 is documented

**Objective:** the coordinating session's phase prompt says the freeze is the cabin's button, and
the two endpoints and the vocabulary they add are written down where this backend documents them.

**Files:** `backend/src/domain/value-objects/phase-prompt.ts` (modify), `backend/API.md` (modify),
`backend/conventions/this-repository.md` (modify),
`backend/__tests__/application/open-coordinating-session.test.ts` (modify),
`backend/__tests__/infrastructure/disk-conversation-records.test.ts` (modify)

The new sentence goes into the array below, after the line that says where the session is and
before the idea. It is the backend's own prompt and English, and it leaves
`plugin/skills/brainstorming/SKILL.md` alone: that skill ships to repositories with no cabin. Both
tests that compare the prompt's whole text take the new line in this same commit.
`API.md` gains a section per verb in the shape the other endpoints have — the four `200` bodies,
the `x-gate-key` header and why only the page holds it, the five refusal codes with their status —
plus a row each in "Where the frontend consumes each one".

Current state (backend/src/domain/value-objects/phase-prompt.ts, lines 22-26):

```ts
    return new PhasePrompt([
      `Invoke the skill ${PhasePrompt.BRAINSTORMING_SKILL}.`,
      `You are the coordinating session of the epic for ${repository.text}, in the checkout ${root.text}: you cut no worktree and you switch no branch.`,
      ...PhasePrompt.#idea({ story, comment }),
    ].join('\n'))
```

Contract (backend/src/domain/value-objects/phase-prompt.ts):

```ts
  static readonly FREEZE_IS_NOT_YOURS =
    'You never freeze the spec yourself: the state line and its date are written by gate 1 of the '
    + "cabin, on a person's click. Leave the spec at DRAFT, present the freeze summary and stop."
```

Final text (backend/conventions/this-repository.md):

```md
| **Execution spec** | The epic's central document in the governed checkout, `docs/superpowers/specs/*-execution.md`; gate 1 reads its state line to know whether the epic is frozen, and is what writes it |
| **Gate 1** | The freeze as an act of this program: `analyzeSpecFreeze`'s findings on screen and a button that writes the state line and the date, commits both documents, pushes the epic's branch and opens its pull request. Only the page this backend serves can press it |
```

**TDD:** red first with
`it('tells the coordinating session that the freeze is the cabin button and not a line it writes')`
in `open-coordinating-session.test.ts` — the recorded prompt's text contains
`PhasePrompt.FREEZE_IS_NOT_YOURS` and it sits between the checkout line and the idea.

**Tests:** the one above; the three existing prompt comparisons in
`open-coordinating-session.test.ts` and the `PROMPT_TEXT` of `disk-conversation-records.test.ts`
are updated, not removed.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — it type-checks
npm --prefix backend test -- __tests__/application/open-coordinating-session.test.ts __tests__/infrastructure/disk-conversation-records.test.ts   # expected: exit 0
test "$(grep -c 'POST /spec-freeze' backend/API.md)" -ge 1   # expected: exit 0 — the press is documented
test "$(grep -c 'Gate 1' backend/conventions/this-repository.md)" -eq 1   # expected: exit 0 — the vocabulary learned it once
```

### Task 11 — The cabin's client for gate 1

**Objective:** the page can read gate 1's state and press the freeze with the key it was handed.

**Files:** `frontend/src/app/spec-freeze/SpecFreeze.types.ts` (create),
`frontend/src/app/spec-freeze/client.ts` (create),
`frontend/src/app/spec-freeze/useSpecFreeze.ts` (create),
`frontend/src/__scenarios__/SpecFreezeMother.ts` (create),
`frontend/src/app/spec-freeze/client.test.ts` (create),
`frontend/src/app/spec-freeze/useSpecFreeze.test.ts` (create)

`fetch` with no wrapper and the same shape as `app/coordinating-session/client.ts`: `PATH` is
`/spec-freeze`, a body that does not read as one of the four states is `unavailable`, a `fetch`
that throws is `unavailable` on the read and `backend-unreachable` on the press. The press sends
`POST` with the header `x-gate-key` and **no body**; a non-`200` carrying `{code, detail}` is
`refused`. A `draft` with no `key` field reads as `key: null`. `useSpecFreeze` polls every
`POLL_INTERVAL_MS = 2000` exactly like `useCoordinatingSession`, and **stops polling once it reads
`frozen`**: nothing at gate 1 changes after that and the backend asks GitHub on every read.
`SpecFreezeMother` gives the scenarios by name: `none`, `noSpec`, `draftWithMarker`, `draftReady`,
`draftWithoutKey`, `frozen`, `notFreezable`, `notFromThePage`.

Contract (frontend/src/app/spec-freeze/SpecFreeze.types.ts):

```ts
export type FreezeFinding = { code: string; line: number | null; detail: string | null }
export type PullRequestRef = { number: number; url: string }
export type SpecFreezeOutcome =
  | { kind: 'none' }
  | { kind: 'no-spec' }
  | { kind: 'draft'; spec: string; findings: FreezeFinding[]; key: string | null }
  | { kind: 'frozen'; spec: string; on: string; pullRequest: PullRequestRef | null }
  | { kind: 'unavailable' }
export type FreezeAskOutcome =
  | { kind: 'frozen'; on: string; pullRequest: PullRequestRef }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
```

Contract (frontend/src/app/spec-freeze/client.ts):

```ts
export const SpecFreezeClient: {
  read(): Promise<SpecFreezeOutcome>
  freeze(key: string): Promise<FreezeAskOutcome>
}
```

**TDD:** red first with
`it('reads a draft with its key and every finding the backend named')` — the answer of
`SpecFreezeMother.draftWithMarker()` becomes `kind: 'draft'` with the finding's `code`, `line` and
`detail` untouched and the `key` it carried. Its boundary pair,
`SpecFreezeMother.draftWithoutKey()`, must read as `key: null` and not as `unavailable`.

**Tests:** in `client.test.ts`: the two above,
`the press sends the key in its header and reads the pull request back`,
`a refusal is read as its code and its detail`,
`a backend that does not answer is read as unreachable`. In `useSpecFreeze.test.ts`:
`stops asking once the spec is frozen`.

**Verification:**

```bash
npm --prefix frontend test -- src/app/spec-freeze   # expected: exit 0 — the client and the hook
test "$(grep -c "'/spec-freeze'" frontend/src/app/spec-freeze/client.ts)" -eq 1   # expected: exit 0 — one path
```

### Task 12 — The panel of gate 1

**Objective:** the cabin shows the yardstick's failures, a button that refuses while any remains,
and — once frozen — the date, the pull request and that the groom waits for its merge.

**Files:** `frontend/src/app/spec-freeze/components/spec-freeze-panel/SpecFreezePanel.tsx`
(create), `.../SpecFreezePanel.css` (create), `.../index.ts` (create),
`.../SpecFreezePanel.test.tsx` (create)

It takes no props and reads `useSpecFreeze`. `connecting`, `none`, `no-spec` and `unavailable`
render `null` — while the brainstorming is still writing, the gate has nothing to say. `draft`
renders a `Panel` with `heading={HEADING}`: the findings as a list, each one its label from
`FINDING` followed by `, línea <line>: <detail>` when it carries a line, and the button, disabled
while `findings.length > 0` or `key === null`; with no key it also renders `ONLY_FROM_THE_PAGE`.
Pressing calls `SpecFreezeClient.freeze(key)`; `refused` and `backend-unreachable` render a
`Banner` `type="error"` `role="alert"` with the detail; `frozen` is kept and rendered at once, and
the poll agrees on its next round. `frozen` renders `${FROZEN} ${on}.`, an anchor to the pull
request labelled `${PULL_REQUEST} #${number}` when there is one, and `WAITING`. The labels are
Spanish because `CLAUDE.md` keeps what a person reads in the product Spanish; the classes are BEM
under `spec-freeze-panel__`.

Contract (frontend/src/app/spec-freeze/components/spec-freeze-panel/SpecFreezePanel.tsx):

```ts
const HEADING = 'Puerta 1 · Congelación del spec'
const BLOCKED = 'La vara todavía no deja congelar'
const FINDING: Record<string, string> = {
  'clarification-marker': 'Marcador de clarificación sin resolver',
  'hypothesis-absent': 'El spec no tiene sección «## Hipótesis»',
  'hypothesis-empty': 'La sección «## Hipótesis» está vacía',
}
const FREEZE = 'Congelar el spec'
const ONLY_FROM_THE_PAGE = 'Esta puerta solo se abre desde la página que sirve el backend.'
const FROZEN = 'Spec congelado el'
const PULL_REQUEST = 'Pull request'
const WAITING = 'El groom espera al merge de este pull request.'
```

**TDD:** red first with
`it('refuses the freeze while a clarification marker remains and shows the line the backend gave')`
— with `SpecFreezeMother.draftWithMarker()` the button is disabled and the finding's line and raw
text are on screen. Its boundary pair, `draftReady()`, has the same button enabled.

**Tests:** in `SpecFreezePanel.test.tsx`: the two above,
`a spec with no hypothesis shows that finding and keeps the button disabled`,
`pressing it sends the key and then says the groom is waiting for that pull request to merge`,
`without a key the button stays disabled and says where the gate opens from`,
`a refused freeze is shown with the detail the backend gave`,
`there is nothing to show while the checkout has no execution spec`.

**Verification:**

```bash
npm --prefix frontend test -- src/app/spec-freeze   # expected: exit 0 — the panel, the client and the hook
test "$(grep -c 'merge de este pull request' frontend/src/app/spec-freeze/components/spec-freeze-panel/SpecFreezePanel.tsx)" -eq 1   # expected: exit 0 — the cabin says it once
```

### Task 13 — The panel on the page, in every phase

**Objective:** gate 1's panel is rendered by `Home` outside every stage branch, every existing
`Home` suite stays green, and the front end's README says what `app/spec-freeze` consumes.

**Files:** `frontend/src/pages/home/Home.tsx` (modify),
`frontend/src/pages/home/__tests__/helpers.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.specFreeze.test.tsx` (create),
`frontend/README.md` (modify)

`Home` gains one import and one element, right after the `home__sessions` section and outside
every `currentStage` branch — `SpecFreezePanel` renders a `Panel`, which is already a `section`
with its own `aria-label`, so no wrapper is added and `home__sessions` stays exactly one. The
three `fetch` stubs of `helpers.tsx` (`backendAnswering`, `backendRecovering`, `backendPending`)
each gain `if (input === '/spec-freeze') return responseFor(SpecFreezeMother.none())`, which is
what keeps every existing `Home` suite untouched. `frontend/README.md` gains a paragraph beside
the `app/coordinating-session` one: what `GET`/`POST /spec-freeze` are, that the button is
disabled while the yardstick reports a finding, and that under `make dev-frontend` the proxy
strips `Origin`, so no key is minted there and the gate is pressed from the page the backend
serves. Every new file is measured by `frontend/__tests__/yardstick.test.ts`.

Current state (frontend/src/pages/home/Home.tsx, lines 458-461):

```tsx
          <section className="home__sessions" aria-label="Sesiones en marcha">
            <SessionsPanel />
            <CoordinatingSessionStatus />
          </section>
```

Call site (frontend/src/pages/home/Home.tsx):

```tsx
          <section className="home__sessions" aria-label="Sesiones en marcha">
            <SessionsPanel />
            <CoordinatingSessionStatus />
          </section>

          <SpecFreezePanel />
```

**TDD:** red first with
`it('shows gate 1 in the request stage and still shows it while a slice is being implemented')` in
`Home.specFreeze.test.tsx` — with `/spec-freeze` answering `SpecFreezeMother.draftReady()`, the
panel's heading is on screen with no workflow restored and again with one restored at
`implementing`. That pair is the boundary of "outside every stage branch".

**Tests:** the one above. Every other `Home` suite keeps its tests and its names: the only change
they take is the new route in the shared stub.

**Verification:**

```bash
npm --prefix frontend test   # expected: exit 0 — every Home suite survived the new route
test "$(grep -c 'home__sessions' frontend/src/pages/home/Home.tsx)" -eq 1   # expected: exit 0 — one sessions section, as before
test "$(grep -c 'SpecFreezePanel' frontend/src/pages/home/Home.tsx)" -eq 2   # expected: exit 0 — the import and the one element
```

## 8. Global verification

Both suites and the type graph, plus the three structural claims this slice makes about where its
decisions live. With human eyes, and this is the `visual` gate a person closes on the pull
request: `make run-frontend`, open the cabin on a checkout whose execution spec still carries a
`[NEEDS CLARIFICATION` marker, see the finding with its line and the button refusing; resolve the
marker, see the button enable; press it and see the date, the pull request and the sentence that
the groom is waiting for its merge.

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the whole graph is sound
npm --prefix backend test   # expected: exit 0 — the whole backend suite, real processes included
npm --prefix frontend test   # expected: exit 0 — the whole frontend suite
test "$(grep -rl 'CONGELADA' backend/src | wc -l | tr -d ' ')" -eq 1   # expected: exit 0 — the frozen literal lives in one module
test -z "$(grep -rl 'analyzeSpecFreeze' backend/src/infrastructure)"   # expected: exit 0 — the yardstick is imported by the domain, never re-decided at the boundary
test "$(grep -c 'pr., .create' backend/src/infrastructure/gh-pull-requests.ts)" -eq 1   # expected: exit 0 — one place opens a pull request
```

## 9. Assumptions

1. **Gate 1's yardstick is `analyzeSpecFreeze` alone.** AC 1 names exactly a clarification marker
   and an empty hypothesis, and the slice's signal says a refusal names the offending line, which
   is the only line number that module gives. `analyzeSlicesTable` is not lost: `ct-groom` refuses
   on it at gate 2, in its own words, which is slice 5's own acceptance criterion. Provenance: the
   issue's acceptance criteria and signal; own call on the narrowing.
2. **The path is `/spec-freeze`, with `GET` and `POST`.** The issue names none. Provenance: repo
   convention — flat kebab-case paths, one route module per endpoint.
3. **D-22's mechanism is a gate key minted once per backend run**, handed only over a read whose
   `Origin` is the page this backend serves, and demanded in `x-gate-key` on the press. One per
   page would mean remembering every key a two-second poll mints; one per run is as strong here
   and grows nothing. The comparison is a plain `===`: a constant-time compare against something
   that can read this process's own memory would be theatre. Provenance: the issue's D-22 demands
   the refusal and the absence of an endpoint a session can call, and names no mechanism; own call.
4. **"Both documents" are the execution spec and the design document its `**Handoff origen:**`
   line names.** Provenance: the plugin's `_TEMPLATE-execution-spec.md` and the naming the
   brainstorming skill gives both files; deduced.
5. **The epic's branch is the one the governed checkout is already on**, and the gate refuses the
   remote's default rather than creating a branch. Slice 3 cuts none, so pushing without that
   refusal would put the freeze commit on the default branch. Provenance: D-23 says "push the
   epic's branch"; own call on the refusal.
6. **The commit message, the pull request's title and its body are English.** They are text a
   program composed; `CLAUDE.md`'s Spanish exemption covers only what a person reads in the
   product. Provenance: repo convention.
7. **`PullRequestNotRead` and `PullRequestNotUnderstood` gain refusals in `PlanCollapse`.**
   `plan-refusal.test.ts` excused them because only the already open stream read a pull request;
   from this slice a request reads one. Provenance: own call, forced by the query of Task 5.
8. **The panel renders nothing while the checkout holds no execution spec.** No acceptance
   criterion asks the cabin to narrate that, and the coordinating session is on screen saying what
   it is doing. Provenance: own call, `conventions/simplicity.md`.
9. **Under `make dev-frontend` the gate cannot be pressed**, because that proxy strips `Origin` and
   no key is minted; the button says where the gate opens from. Provenance: `frontend/README.md`
   plus assumption 3.
10. **`spec.title()` is the first `# ` heading with `— Execution spec` removed**, and that suffix
    travels with the other five header literals in the declared copy. Provenance: the plugin's
    template; deduced.
11. **The freeze date is the local calendar day**, not `toISOString`, which would name yesterday
    east of UTC before noon. Provenance: own call.
12. **The slice is thirteen tasks.** `writing-plans-prescriptive` calls twelve a badly cut slice
    and says that is fixed where there is a human, when the spec is frozen. The cut is the spec's
    §9 row and is not mine to change; each task here is one commit and none of them fits in
    another. Provenance: the skill; declared rather than worked around.
13. **No new `-real-process` test is added** beyond one case inside
    `ct-api-real-process.test.ts`, which already carries the marker, and no test requires cmux.
    Provenance: the issue's epic context.
