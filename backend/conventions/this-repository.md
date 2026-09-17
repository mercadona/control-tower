# What only this repository decides

What binds here and does not travel with the plugin.

## Precedence

1. This document — what is specific to this backend.
2. `plugin/conventions/` — the travelling yardstick; it binds on every diff
   here too, and this document never restates it. The header every brief
   carries states how the two resolve when they clash.
3. The `backend-best-practices` skill — general guidance; it yields to both.
   Where it shows something else — its Object Mothers section illustrates
   with a test of a domain entity on its own — the travelling yardstick's
   three outside-in testing rules win. An example teaches by imitation; this
   is the rule.

## No declared debt

There is no declared debt in `backend/`: every rule that binds here binds on
every diff, old module or new. `plugin/conventions/style.md` and
`plugin/conventions/architecture.md` grant a declared-debt exemption to a
module that was already there — the one exemption in the whole travelling
yardstick — and this repository does not take it.

## The backend is TypeScript

Every module, test and test helper under `backend/` is `.ts`. There is no
JavaScript left here and none arrives: the migration that converted the 143
JavaScript files this backend started with is over, and with it went the
baseline census and the boundary that held it open.

`__tests__/typescript-only.test.ts` keeps the rule live. It walks `backend/`,
skipping `node_modules`, and fails on any `.js` or `.mjs` it finds. It needs no
list of what is allowed, because nothing is: the answer is the empty set, and
the test proves its own census walks by finding the JavaScript in a tree built
to contain some.

Node.js executes the backend by stripping types and never checks them, so
`npm run typecheck` is what says the graph is sound and it runs before the
suite. Only erasable syntax reaches the tree: no enums, parameter properties,
runtime namespaces, decorators or path aliases, and `erasableSyntaxOnly`
refuses them before a reviewer has to. A relative import names the extension
the file really has — `.ts` inside `backend/`, and `.js` for everything the
backend reads out of `plugin/`, which is JavaScript and stays JavaScript.
`allowJs` survives in `tsconfig.json` for exactly that reason: it is what lets
those imports resolve, and it is no longer a statement about this backend.

## Ubiquitous language

| Term | Meaning |
|---|---|
| **User story** | The work to plan, named either the way Jira calls a ticket, by its key (`ABC-123`), or by the url of the GitHub issue that describes it |
| **Plan issue** | The GitHub issue that hosts a plan: the plan is posted there, the GO is answered there, the dispatcher reads its labels |
| **Plan agent** | A headless Claude conversation the backend prepares, records and launches for planning, then resumes for implementation or fixes; its UUID is durable identity, not a window title |
| **GO** | The legacy distributed protocol's human `-OK <nonce>` on an issue. The backend-driven milestone entrance does not mint or read one: gate 2 authorises the work and successful publication continues automatically |
| **Repository name** | `owner/name`; validated because it becomes an argument of `gh` |
| **Checkout root** | The absolute path of the local git clone where a plan's worktree is cut; validated because it becomes an argument of `git -C` |
| **Registered checkout** | The pair `{repo, path}` this backend records once a checkout root has been confirmed to hold that repository: the registry of where each repository is checked out on this machine. It answers a question a bare path cannot — *where is `owner/name` checked out?* — which is what the plugin's dispatcher asks it before dispatching a slice of a milestone's target repository. A path registered before the pair was recorded keeps serving the harvest sweep and answers that question with *not registered*, because a path whose repository was never written down cannot say what it holds |
| **Prepared workspace** | A worktree `.worktrees/<n>` on branch `feat/<n>` that a plan agent works in |
| **Harvest** | Collecting what a delivered slice left behind — its worktree, its branch, its agent — once its pull request merged; the plugin's `dispatch-check --collect` does it, the backend only decides when |
| **Harvest ledger** | The BigQuery table where every harvested slice leaves its row, shared by every team and told apart by `repo`; the plugin loads it, the backend only says which table (`CT_HARVEST_BQ_TABLE`) |
| **Live session** | A process the backend owns and keeps: the cabin lists it, reads what it prints and writes into it, and closing the page ends the subscription and nothing else |
| **Metrics delivery** | Whether a merged slice's row reaches the harvest ledger at all: an option of this backend's start-up (`CT_HARVEST_BQ_TABLE`), validated once and read-only from then on. Disabled it costs no plan and no collection — only the row, and with it every comparison of coding tools that row would have fed. Enabled it makes `bq` a tool that blocks, because a slice whose row did not land is kept undeleted and retried |
| **Pull request** | Where a delivered slice waits for a person: the agent opens it on `feat/<n>` and stops |
| **Change asked** | One thing a person asked for on that pull request, with its anchors `file:line`; GitHub's native reviews are where it is read from |
| **Plan issue status** | Which rung of the loop's ladder the issue stands at — `backlog`, `ready`, `in-progress`, `in-review` — or none, which is a status too and not an absence |
| **Delivery state** | What that status means once a pull request is open: waiting for a person (`in-review`), fixing what was asked (`fixing`), or nobody on it (`unattended`) |
| **Workbench** | Where a slice goes back to when a person asks for changes; the plugin's `dispatch-check --reopen` puts it there, and the backend only decides when |
| **External tool** | A binary Control Tower drives that has to be usable before work starts: `gh`, `acli`, `claude`, `git` and `bq`. Which five lives in `probed-tool-sessions.ts`; `gh`, `acli`, `git` (through `ssh`) and `bq` (through `gcloud`) are probed, while Claude authentication is not observable from this process |
| **Tool session** | Whether what is asked of that tool works right now: `ready`, `missing`, or `unknown` — when the login is not observable from this process, or when the binary the row is probed with is absent and nothing was asked at all. `unknown` is not a failure, and the `fix` beside it repairs what was asked about: the credential when the row was asked, the absent probe when it could not be, and the login of a tool whose own binary is absent, which presupposes an installation `installed` says separately you do not have. The `fix` column is product copy that lives in this backend: `ToolsStatus` renders it to the screen untranslated, and the product's decision is to keep it English because it is mostly literal shell commands — which is why `plugin/conventions/style.md` does not reach it |
| **Coordinating session** | The entrance conversation: an interactive `claude` this backend spawns in the governed checkout, no worktree cut and no branch created, and holds in memory for the rest of the backend's run. `POST /coordinating-session` opens it, `GET /coordinating-session` answers what this backend currently holds, and it is resumed rather than reopened across a backend restart |
| **Phase prompt** | What the coordinating session is told to do, written once to a file under the state root and read by the session itself; its path travels in `CT_PHASE_PROMPT`, never its text, so the backend hands over a path and pastes nothing into a prompt |
| **Conversation** | The identity of a coordinating session across a restart: an id minted once, a repository and a checkout root, recorded on disk so `records.recall()` can find it again; a conversation Claude Code no longer holds answers `unresumable` instead of being silently reopened as a different one |
| **Headless call** | One immutable invocation record under `harness/<conversation>/calls/<call>/`: purpose, request identity, cwd, binary, argv and operational bounds are published before its detached worker is spawned; output and completion are separate evidence |
| **Reported call total** | Claude CLI's `total_cost_usd` retained exactly as reported. It is attributable to an initial invocation, but a resumed total has `unverified-resume` attribution and contributes `null` attributable cost; totals are never differenced, summed as invocation spending or replaced by token-price estimates |
| **Run admission** | The immutable `harness/<conversation>/run/admission.json` written for every new plan before planning starts. It proves that the conversation belongs to the backend driver; it is not a flag or setting, and its absence does not by itself prove legacy ownership |
| **Run journal** | The immutable manifest and linked request/receipt chain under `harness/<conversation>/run/`. It records exact oracle argv, cwd, plan hash, process output and before/after run bytes; it is execution evidence rather than a second phase, cursor or transition table |
| **Session attention** | Whether the coordinating session is `working` or `waiting`, with the live question while it waits; moved by `POST /session-hooks` from Claude Code's own `UserPromptSubmit`, `Notification` and `Stop` hooks, and dropped the moment the session works again |
| **Execution spec** | The epic's central document in the governed checkout, `docs/superpowers/specs/*-execution.md`; gate 1 reads its state line to know whether the epic is frozen, and is what writes it |
| **Gate 1** | The freeze as an act of this program: `analyzeSpecFreeze`'s findings on screen and a button that writes the state line and the date, commits both documents, pushes the epic's branch and opens its pull request. Only the page this backend serves can press it |
| **Groom plan** | What `ct-groom --dry-run` prints, kept as what will be created: the milestone, its **home repository** — the one the coordinating session holds — and, per row of the spec's slices table, the order, the title, the labels and the repository the real run would give its issue. A row lands in the home repository unless its `Repo` cell names another, and one row never spans two. The cabin shows it before anything mutates, naming the repository of every row that does not land home |
| **Epic issue** | One issue of the epic's milestone as GitHub holds it today: its number, its url, its title, whether it is open, which rung of the loop's ladder it stands at (read with the plugin's own `resolveStatus` so this backend keeps no second opinion), and its order — the plugin's own `<!-- ct-order:N -->` marker, read with `extractOrder`, its own identity across a rename that never touches the title |
| **Epic issue listing** | The answer to asking GitHub for a milestone's issues: every epic issue read, and whether the read is exhausted. `gh issue list` exposes no cursor, so exhaustion is inferred by climbing `--limit` until an answer comes back shorter than what it asked for; past a named ceiling with no short answer yet, the listing is not exhausted and carries, in words, the reason it could not be — never a confident list that might silently stop short of the milestone's real issues |
| **Gate 2** | The authorisation as an act of this program: the groom run from the cabin over a spec the default branch holds as this checkout holds it, and a button that adds `status:ready` to the epic's issues and nothing else. Only the page this backend serves can press either — and the groom also runs unpressed when a merged re-slicing of the branch already authorised it |
| **Groom conversation** | The groom as a phase of the coordinating session: `PhasePrompt.groom` points an interactive `claude` at the plugin's own `ct-groom` skill so a person can walk the spec's slices table with it, in the same checkout and with no worktree and no branch switch. It creates nothing — the issues are gate 2's, and a change to the slicing is an edit of that table which this program publishes |
| **Re-slicing** | A correction of a frozen spec's slices table. The spec stays `CONGELADA`: neither the state line nor the freeze date moves, because this is a correction and not a second freeze. It travels on the milestone branch in a pull request whose body announces **which spec and which revision of it** the merge would approve, and that merge is the authorisation — gate 2 creates the issues from the table the default branch now holds with no further click. The announcement names the revision because a branch is reusable: two milestones published from one branch, or a later edit of the same spec, must not inherit an approval given to something else |
| **Published spec** | Whether the default branch holds the spec **as this checkout holds it**: the spec's revision — `SpecRevision`, the git blob sha of its text — against the `sha` the contents API reports. Existence is not publication: after the first freeze the path always exists, and answering by existence would groom a table nobody approved. The same revision is what a re-slicing's announcement pins, so one policy decides what «the same spec» means on both doors |

## Naming an exception family

Every family under `PlanFailure` names its two causes: **the command
failed** (`*NotRead`, `*NotCreated`, `*NotLaunched`) and **it answered
something we cannot read** (`*NotUnderstood`, `*NotNamed`). The boundary
projects each cause to its own `code`.

The former boundary sentence, “Jira, GitHub, cmux, acli and gh exist only in
`infrastructure/`,” remains historical context for the repository-specific
rule. The current backend no longer uses cmux; Jira, GitHub, acli and gh remain
infrastructure words.

## Delivery boundary after headless continuation

`ContinuePlan` remains the legacy outer implementation path. Every new admission
instead enters `RunPlanAgents` before planning and, after successful publication,
`DriveRun` follows the unchanged plugin oracle in the original conversation.
This is unconditional composition in the existing entrypoint: no feature flag,
toggle, environment setting or configurable alternate path exists. The driver
ends at the plugin's delivered result. It owns neither pull-request publication
nor checked release, and the existing post-review fix path remains separate.

Durable provenance, not configuration, chooses compatibility behavior. A valid
admission identifies driver work unless contradictory legacy evidence exists.
Legacy delegation requires one initial planner and one resumed outer
implementation whose request id is exactly bound to that planner, with no
manifest, operation or driver request. Missing admission, planner-only, fix-only,
unknown request ids, mixed ownership and identity or cwd mismatch refuse rather
than guess. Restart recovery reads the manifest, journal, calls and descriptors
before live-process knowledge; unowned or ambiguous operations remain inspect
only and are never replayed automatically.

The journal is an immutable linked chain, not a backend copy of the plugin's
transition table. Requests and receipts retain exact oracle argv, cwd, plan hash,
exit code, stdout, stderr and before/after run bytes. A prepared dispatch is
sealed from the plugin's printed paths, role files, schema, tools and agent
definition. Implementer, task judge, advisor, slice judge and `ct-reconciler`
are supported. E2E and slice-agent reconciliation fallback are refused while the
plugin supplies no complete role package for them.

Issue #331 records whole outer calls only. Issue #332 adds private immutable
`measurements-v1.json` projections beside completed call evidence: source hashes,
wall duration, diagnostics and available CLI-reported values. Missing metric keys
are omitted, zero is retained, and existing nullable completion/history fields
are unchanged. A resumed `total_cost_usd` is an `unverified-resume` reported
total, never an incremental own-call bill; totals are not differenced, summed as
invocation spending or replaced by token-price estimates. The backend writes no
plugin attempt rows. Issue #379 owns any future ingestion into those rows.

Deployment uses the existing entrypoint. Rollback means redeploying an older code
revision only after driver-owned admissions are stopped or drained and their
records preserved for compatible recovery. An older binary cannot safely adopt
driver records as legacy work; no runtime toggle, automatic migration, deletion
or automatic downgrade makes that safe.

## The backend leans on the plugin, never the reverse

`backend/` imports the plugin's pure renderers and readers
(`plugin/scripts/groom.js`, `gh-issue-map.js`, `gates.js`, `scope.js`) instead
of transcribing their headings or their formats: the plugin is the authority on
what an issue says and how it is read. The plugin is distributed alone and must
never import from `backend/`. What the plugin does not export is copied here
as a literal, with a contract test that renders the plugin's own output and
compares — `backend/__tests__/infrastructure/plugin-contract.test.ts` — the
declared-copy rule for the one contract that crosses this boundary.

## Talking to a tool

Four steps, each with one job — the concrete types of this backend:

```
ToolRunner      launches a binary with its budget
ExternalTool    the conversation: asks the policy whether a failure is worth retrying
Gh (idiom)      what only `gh` writes
<tool>-<port>   the adapter: the argv, the parsing, the typed errors
```

- **The flag is named `safeToRepeat`.** `gh issue create` never gets `true`.
- **A missing label is a datum, not a failure**: read which one, sow it with
  `--force` (the benign-race argument is `ct-groom.mjs`'s), retry the
  creation, and never sow a label that is not ours.
- **Bare `#N`, `owner/repo#N`, GitHub URLs and `@handles` are fenced as
  code** before text from another system reaches an issue.

## The layout

The root folder is `src/`. Inside it, `domain/value-objects`, `domain/ports`
and `domain/policies` are the three kinds of domain inhabitant apart from
each other, and `application/actions` and `application/queries` are the two
kinds of use case. Every domain exception lives together in the one file
`exceptions.ts`, the catalogue exemption `plugin/conventions/architecture.md`
allows for a kind declared together on purpose.

A controller under `infrastructure/` is named `<endpoint>-route.ts`, one
file per endpoint.

What each file under `infrastructure/` is, concretely, in this backend — the
repository's own choice of names, not a pattern:

```
infrastructure/
  ct-api.ts          the entrypoint
  api-server.ts      what every endpoint shares: mounting, the last net, listen, stop
  http.ts            generic plumbing: answering, routing hygiene, the origin filter, the body reader
  harvest-clock.ts   the sweep: every minute, asks a registry which clones
                      it served a plan for and surveys each in turn
  invocation.ts      moved out of the entrypoint until it is observable
                      without spawning a process — the reason it exists
```

## Answering HTTP in this API

- **This API is a backend for one frontend, and that frontend decides by
  `code`, not by status.** Every refusal answers `{code, detail}` — one shape,
  so the frontend has one thing to parse regardless of which door refused it.
- **A refusal our own application judged always answers 400**: the request was
  malformed, a tool refused, a tool answered something we cannot read, nobody
  is watching that issue. The status stopped being the signal, so it stopped
  needing to vary.
- **A refusal of the protocol itself keeps the status HTTP already gives it**:
  the wrong method, an unreadable or oversized body, a foreign origin, a route
  that does not exist. That one is not a decision about a request that reached
  the application; its body is `{code, detail}` too, so the shape stays one
  across the whole API.
- **The wire format of a `code` is kebab-case.**
- **An `Origin` is admitted only when it is the page this server hosts**,
  vouched by a loopback `Host`; any other page on any port is a foreign site.

## Where the suite runs

From `backend/`, never the repository root. The fast subset is `npx vitest run --exclude '**/*-real-process.test.ts'`. During a working session, run the fast subset per change and the whole suite before handing anything over.

## Testing: a failing test must not leak a process

This suite launches real processes by design. Every spawned child is
killed in `afterEach`, not after the assertion.
