# The local API

What `backend/` answers, endpoint by endpoint. This is the contract the frontend
codes against.

Every shape below was read from a running server, not from the source alone. The
`curl` lines reproduce it.

## Reaching it

| Fact | Value |
|---|---|
| Base URL | `http://127.0.0.1:8787` |
| Port | `CT_API_PORT`, default `8787` |
| Interface | loopback only (`127.0.0.1`) |
| Start | `make run-backend` |
| Endpoints | 7 (`POST` 3, `GET` 4) |

In development the vite dev server proxies these paths to the backend and strips
the `Origin` header (`frontend/vite.config.ts`). A new endpoint must be added to
`API_PATHS` there, or the dev server answers the page's HTML instead of the API.

## Rules that apply to every endpoint

1. **Decide by `code`, never by status.** Every refusal answers the same body:
   `{"code": "<kebab-case>", "detail": "<one sentence>"}`. One refusal adds a
   third field: `no-plan-started` carries `failed`.
2. **An application refusal answers 400.** The status stopped being the signal.
   405 keeps its own status because it is the protocol answering, not the
   application: it is decided before any request reaches a use case.
3. **A `POST` must declare `Content-Type: application/json`.** Otherwise 415.
4. **A body over 8 KiB is refused** with 413 `body-too-large`.
5. **An unknown field in a `POST` body is refused**, not ignored.
6. **Trailing slashes are collapsed**, so `/active-plans/` is `/active-plans`.
7. **A foreign `Origin` is refused** with 403 `foreign-origin`. No `Origin` at
   all is admitted, which is why `curl` works.
8. **A wrong method answers 405** with an `Allow` header naming the right one.
9. **An unknown path answers 404** `not-found`.
10. **An unexpected crash answers 400** `request-failed`, and the reason only
    reaches the backend's stderr. If the UI shows `request-failed`, the detail
    is in the terminal running the backend.

### Codes every endpoint can answer

| Status | `code` | When |
|---|---|---|
| 403 | `foreign-origin` | the `Origin` is not the page this server hosts |
| 404 | `not-found` | no route matched |
| 405 | `method-not-allowed` | the path exists, the method does not |
| 413 | `body-too-large` | the body exceeds 8 KiB |
| 415 | `unsupported-media-type` | a `POST` did not declare JSON |
| 400 | `request-failed` | anything unforeseen; the reason is in stderr |

---

## `POST /start-plan`

Starts a plan: cuts a worktree, opens the plan issue, launches the agent. It is
slow — it runs the target repository's baseline test suite before answering, and
that can take minutes. There is no progress signal while it waits.

**It has two modes**, told apart by which fields name the target. Send `repo` and
`path` for one repository, or `repo_list` for several. Sending both is refused.

| Field | Type | Required | Shape |
|---|---|---|---|
| `id` | string | one of `id` / `user_comment` | a user story key, `ABC-123`, or a GitHub issue url, `https://github.com/owner/name/issues/123` |
| `user_comment` | string | one of `id` / `user_comment` | free text, not blank |
| `repo` | string | single mode | `owner/name` |
| `path` | string | single mode | absolute path of the local clone |
| `repo_list` | array | list mode | one or more `{"repo": "...", "path": "..."}` |

`id` and `user_comment` may both be sent. Omit a field to leave it unsaid; do
not send `null`, which is a malformed value. A `repo_list` entry holds those two
keys and **nothing else** — an extra key makes the whole list malformed.

### Single mode — 202 Accepted

```json
{"status":"started","id":"ABC-123","repo":"owner/name",
 "issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},
 "agent":"workspace:4","branch":"feat/7",
 "worktree":"/repo/checkout/.worktrees/7","root":"/repo/checkout",
 "baseline":{"outcome":"verde","command":"npm test","summary":"42 passed"}}
```

`agent` is the handle `POST /implement-plan` demands later. `root` is git's
canonical path for the checkout, which may differ from the `path` that was sent;
keep the answered one.

`baseline` is what the target repository's suite answered in the worktree that
was just cut, **the same measurement that is sown into `.agent/SLICE.md`** for
the agent to read — one measurement, two readers, so the page and the agent
cannot disagree about it.

| `outcome` | Meaning | What the UI does |
|---|---|---|
| `verde` | the suite ran and passed | nothing |
| `rojo` | the suite ran and failed | say so: the agent will build on a broken repository and cannot tell its own failures from the ones already there |
| `no-verificado` | there was nothing to run | say so: the repository declares no test command |

`command` is the literal command that ran, `null` when there was none. `summary`
is capped at 240 characters by the measuring code.

The three values are the plugin's vocabulary, in Spanish, because they are what
`.agent/SLICE.md` carries and what the agent reads; they move when that
vocabulary does. **A plan starts whatever the outcome** — whether to work on a
baseline that is not green is a person's decision, and until now that person was
never told: the verdict went to the backend's error channel and the page said
the request had completed.

### List mode — 202 Accepted, and it may be partial

The answer is never flat. The seven fields above move into `started`, one entry
per repository that got a plan, and `failed` names each repository that did not.

```json
{"status":"started",
 "started":[{"id":"ABC-123","repo":"owner/one",
   "issue":{"number":7,"url":"https://github.com/owner/one/issues/7"},
   "agent":"workspace:4","branch":"feat/7",
   "worktree":"/one/.worktrees/7","root":"/one"}],
 "failed":[{"repo":"owner/two","code":"plan-issue-not-created","detail":"gh refused"}]}
```

**A 202 does not mean every plan started.** Both arrays are always present, and
`failed` is often non-empty while the status still says `started`. The UI must
read both. A `failed` entry carries the same `code` and `detail` the single mode
would have refused with, plus the `repo` it belongs to.

When **no** plan started, the answer is a 400 that keeps the same evidence:

```json
{"code":"no-plan-started",
 "detail":"no plan started: every repository of repo_list failed",
 "failed":[{"repo":"owner/one","code":"plan-issue-not-created","detail":"gh refused"},
           {"repo":"owner/two","code":"plan-agent-not-launched","detail":"cmux refused"}]}
```

This is the one refusal in the API with a third field beside `code` and `detail`.

### The list is checked as a whole before anything starts

Two failures behave differently, and the difference is deliberate:

| Cause | What happens |
|---|---|
| A path is not a checkout of the repo beside it, git cannot be asked, or the tracker holding the story refuses | the **whole request** is refused flat, before any side effect; no plan starts, no `failed` array |
| Opening the issue, claiming it, cutting the worktree or launching the agent fails | that repository lands in `failed`, and the others still start |

So one bad pairing in one entry stops every other repository, and the answer
looks like the single mode's — `{code, detail}`, no `failed`. Do not assume list
mode always answers with arrays.

### Refusals

Shared by both modes:

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-id` | 400 | `id` is not a story key such as `ABC-123` nor a GitHub issue url such as `https://github.com/owner/name/issues/123` |
| `malformed-user-comment` | 400 | `user_comment` is blank or not text |
| `nothing-to-plan` | 400 | neither `id` nor `user_comment` was sent |
| `malformed-repo` | 400 | a repo is not `owner/name`; `detail` names which field |
| `malformed-path` | 400 | a path is not absolute; `detail` names which field |
| `checkout-not-confirmed` | 400 | a path is not a checkout of its repo; `detail` names both the repo asked for and the one the path holds |

`malformed-repo` and `malformed-path` name their field, so the UI can point at
the offending input: `repo` in single mode, `repo_list[1].repo` in list mode.

Only in list mode:

| `code` | Status | Meaning |
|---|---|---|
| `target-said-twice` | 400 | `repo_list` came with `repo` or `path` beside it |
| `malformed-repo-list` | 400 | not a list, empty, or an entry is not exactly `{repo, path}` |
| `repo-listed-twice` | 400 | the same repo appears twice; `detail` names it |
| `no-plan-started` | 400 | every repository failed; carries `failed` |

From a tool refusing, in either mode:

| `code` | Meaning |
|---|---|
| `user-story-not-read` | the tracker holding the story refused — Jira for a story key, GitHub for an issue url |
| `user-story-not-understood` | the tracker holding the story answered something unreadable |
| `plan-issue-not-created` | `gh issue create` refused |
| `plan-issue-not-named` | the created issue could not be identified |
| `plan-issue-not-claimed` | the claim on the issue failed |
| `plan-agent-not-launched` | cmux refused |
| `plan-agent-not-named` | cmux launched but gave no handle |
| `workspace-not-prepared` | the worktree could not be cut |
| `workspace-not-read` | git refused when surveying |
| `workspace-not-understood` | git answered something unreadable |

All ten answer 400 and carry the tool's own message in `detail`. They are one
failure family split by cause, so the UI can treat them as one class and show
`detail`. In list mode they arrive inside a `failed` entry instead.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/start-plan \
  -d '{"id":"ABC-1","repo":"owner/name","path":"/repo/checkout"}'

curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/start-plan \
  -d '{"id":"ABC-1","repo_list":[{"repo":"owner/one","path":"/one"},
                                 {"repo":"owner/two","path":"/two"}]}'

curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/start-plan \
  -d '{"id":"https://github.com/owner/name/issues/123","repo":"owner/name","path":"/repo/checkout"}'
```

---

## `GET /plan-events/:issue?repo=owner/name`

Server-sent events. It reports whether the plan is written, committed or being
reworked. The stream stays open until the client disconnects, and polls in the
meantime.

It only serves an issue whose plan **this process** started or recovered. A
restarted backend has forgotten every session it did not recover from cmux.

**200** with `Content-Type: text/event-stream`. Three frame kinds:

```
data: {"state":"writing"}

data: {"state":"ready"}

data: {"state":"reviewing"}

event: error
data: {"code":"plan-progress-not-read","detail":"git status refused"}
```

`state` is `writing`, `ready` or `reviewing`. A frame is only sent when the
state **changes**, so expect nothing on the wire while the agent works. An
`error` frame does not close the stream; the next poll may succeed.

`reviewing` means changes were asked for on the plan and the agent has not
recommitted the reworked plan yet. It comes from comparing the newest
`-REVIEW` comment's date against the plan file's last commit, and the
endpoint asks GitHub nothing of its own: the date is recorded by the review
watch on its own 30-second sweep, so a `-REVIEW` just commented can take up
to that sweep to show as `reviewing`. It returns to `ready` by itself when
the agent recommits.

**Refusals** (before the stream opens, as JSON)

| `code` | Status | Meaning |
|---|---|---|
| `malformed-watched-issue` | 400 | `:issue` is not a positive whole number |
| `malformed-repo` | 400 | `repo` is missing or not `owner/name` |
| `not-watched` | 400 | this process started no plan for that issue |

```
curl -N 'http://127.0.0.1:8787/plan-events/7?repo=owner/name'
```

---

## `POST /implement-plan`

Answers the human gate: records the GO and tells the agent to implement.

**Request**

| Field | Type | Shape |
|---|---|---|
| `agent` | string | the handle `/start-plan` answered, no whitespace |
| `issue` | number | whole, from 1 |
| `repo` | string | `owner/name` |

**202 Accepted**

```json
{"status":"implementing","agent":"workspace:20","issue":33}
```

**It is idempotent.** A second call for a plan already implementing answers the
same 202 without touching anything, and concurrent calls for the same plan are
serialised.

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-agent` | 400 | `agent` is empty or holds whitespace |
| `malformed-issue` | 400 | `issue` is not a whole number from 1 |
| `malformed-repo` | 400 | `repo` is not `owner/name` |
| `no-live-planning-session` | 400 | no active plan matches that issue **or** its agent handle differs |
| `implementation-phase-uncertain` | 400 | the backend cannot tell whether implementation already began; a person must look before retrying |
| `go-not-recorded` | 400 | the GO marker could not be written |
| `plan-go-not-answered` | 400 | the GO comment on the issue failed |
| `plan-agent-not-resumed` | 400 | cmux would not take the line |

`no-live-planning-session` is the one to expect after a backend restart: send the
`agent` from `/active-plans`, not one the page remembered from an older run.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/implement-plan \
  -d '{"agent":"workspace:20","issue":33,"repo":"owner/name"}'
```

---

## `POST /review-plan`

Asks the plan-writing agent for changes, from the web page instead of typing
the `-REVIEW` token into GitHub by hand.

**The call does not talk to the agent.** Its only effect is a comment on the
plan's GitHub issue, of the shape `-REVIEW <changes>`. The agent reads it on
the review watch's next sweep, up to 30 seconds after this call answers — not
when it answers. A 202 means the comment was posted, not that the agent has
seen it yet.

**Request**

| Field | Type | Shape |
|---|---|---|
| `issue` | number | whole, from 1 |
| `repo` | string | `owner/name` |
| `changes` | string | what to change, not blank, no control characters other than newline, carriage return or tab |

The text is published quieted — mentions, `#123` and `owner/name#123`
references and GitHub URLs are wrapped in backticks, so the text notifies
nobody it would not already have notified by being a comment. Posting a comment
at all still reaches the issue's author, its assignee, its subscribers and
anyone watching the repository; quieting is about the text, not about the
comment. Two forms still get through: a mention preceded by a dot
(`.@someone`) and the `GH-123` form, which GitHub autolinks into a
cross-reference that notifies that issue's subscribers.

**202 Accepted**

```json
{"status":"changes-asked","issue":33}
```

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | `body must be a JSON object` |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-issue` | 400 | `issue must be a whole number from one` |
| `malformed-repo` | 400 | `repo must be a repository such as owner/name` |
| `malformed-changes` | 400 | `changes must say what to change` |
| `no-live-planning-session` | 400 | `no matching live planning session exists, so nobody would read the changes` |
| `plan-already-being-implemented` | 400 | `the plan is already being implemented, so its review watch is gone` |
| `implementation-phase-uncertain` | 400 | `implementation may have started; inspect the plan before retrying` |
| `plan-changes-not-asked` | 400 | `gh` refused to post the comment; `detail` carries its own message |

Those three are three different states, and only `code` separates them:
nothing is watching this issue, the plan moved on to being implemented, or this
process cannot tell which. The last one is the same code `POST /implement-plan`
emits, with the same meaning — a person has to look at the plan before
retrying.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/review-plan \
  -d '{"issue":33,"repo":"owner/name","changes":"parte la tarea 2"}'
```

---

## `GET /implement-progress/:issue?root=<abs path>&repo=owner/name`

Where the implementation stands. Poll it; there is no stream. **Both** query
parameters are required — `repo` since the answer may name a pull request.

**200 OK**

```json
{"step":"implement","task":2,"total_tasks":5,"name":"La ruta contesta",
 "attempt":2,"discards":1,"pull_request":null}
```

Six fields plus `pull_request`, always all seven present. `null` means *not
applicable at this step*, not *unknown*.

| Field | Type | Meaning |
|---|---|---|
| `step` | string | see the table below |
| `task` | number \| null | the task in progress |
| `total_tasks` | number \| null | tasks in the plan |
| `name` | string \| null | the task's heading, read from the plan file |
| `attempt` | number \| null | 1 plus every retry so far |
| `discards` | number \| null | work thrown away |
| `pull_request` | `{number, url}` \| null | set only under review |

**Steps**

| `step` | Meaning | Has `task` |
|---|---|---|
| `starting` | the worktree exists, no run file yet | no |
| `implement` | writing the task | yes |
| `controls` | running the controls | yes |
| `judge` | the judge is reading it | yes |
| `advise` | advice is being applied | yes |
| `commit` | committing | yes |
| `reconcile` | reconciling with the base | no |
| `global` | the global gates | no |
| `slice-judge` | the slice judge | no |
| `e2e` | the end-to-end gate | no |
| `delivered` | the pull request is open, nobody on it | no |
| `in-review` | waiting for a person on the pull request | no |
| `fixing` | applying what a person asked for | no |

`starting`, and every `no` row, answer `task`, `name` and `attempt` as `null`.

The last three are the same underlying delivery, told apart by the plan issue's
status: `in-review` from `in-review`, `fixing` from `in-progress`, and
`delivered` from any other. **`pull_request` is only sent for the first two**, so
a delivered slice whose issue never reached the review rung shows `delivered`
with `pull_request: null` even though a pull request is open.

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `malformed-root` | 400 | `root` is missing or not absolute |
| `malformed-progress-repo` | 400 | `repo` is missing or not `owner/name` |
| `implementation-progress-not-read` | 400 | see below |

`implementation-progress-not-read` is one code for three different situations —
the worktree is not there, the run file cannot be read, or it is not valid JSON.
Only `detail` tells them apart. Treat it as *keep polling*: a run file caught
mid-write reads as unparsable and the next poll succeeds.

```
curl -s 'http://127.0.0.1:8787/implement-progress/7?root=/repo/checkout&repo=owner/name'
```

---

## `GET /active-plans`

Every plan this backend knows about. No parameters. The page calls it on load to
recover a session it lost — a reload, or a backend restart.

**200 OK**

```json
{"plans":[{"phase":"planning",
  "request":{"id":"ABC-123","repo":"owner/name","path":"/repo/checkout"},
  "plan":{"id":"ABC-123","repo":"owner/name",
    "issue":{"number":7,"url":"https://github.com/owner/name/issues/7"},
    "agent":"workspace:4","branch":"feat/7",
    "worktree":"/repo/checkout/.worktrees/7"}}]}
```

`plans` is empty when nothing is running. Each entry carries `request` — what a
person would have typed — and `plan` — what starting it produced.

| `phase` | Meaning | What the UI can do |
|---|---|---|
| `planning` | the plan is being written | watch `/plan-events`, offer the GO |
| `implementing` | the GO was given | poll `/implement-progress` |
| `uncertain` | the GO was given, but the backend cannot tell whether the work began | show it, refuse the GO; `/implement-plan` answers `implementation-phase-uncertain` |

**Refusal**

| `code` | Status | Meaning |
|---|---|---|
| `active-plans-recovery-inconclusive` | **400** | cmux could not be asked, so the list would be a lie; `detail` carries what cmux answered |

It is the common failure on a fresh machine: recovery reads the live cmux
workspaces, and without cmux it refuses **every** call and never settles. The
page must show *I cannot tell what is running* rather than *nothing is
running*, and it must not treat this as an empty list.

`detail` carries the reason itself, not a fixed sentence — the same rule the ten
refusals of `POST /start-plan` follow. It is the one place a person sees why
without reaching the terminal running the backend, and it was measured to
matter: during the in-store run the reason lived only in a cmux tab nobody was
looking at, while the page said *no pudo preguntar a cmux* and nothing else.

When cmux answers with a schema this backend does not read, the reason names
the fields that **did** arrive. That one line is what tells a stale cmux apart
from a broken one: the machine this was measured on answered with `title` and no
`custom_title`, which is the shape of an older build still serving the socket.

The same reason also goes to the backend's error channel, prefixed
`plans in flight:`, and `GET /external-tools` answers the same question ahead of
time in its `cmux` row.

```
curl -s http://127.0.0.1:8787/active-plans
```

---

## `GET /external-tools`

Whether the six external tools this backend drives can be used right now. No
parameters. It exists to be asked **before** starting work: until now each of
these failed at the moment it was used, mid-flow, in the tool's own words.

Five of them are asked about a credential. `cmux` is asked about something else
— whether it answers the query this backend recovers plans with — because that
is what fails first on a machine whose cmux is too old or that is running this
backend from outside cmux, and it fails as `GET /active-plans` refusing
forever.

**200 OK**

```json
{"ready":true,"tools":[
  {"tool":"gh","installed":true,"session":"ready","fix":null},
  {"tool":"acli","installed":true,"session":"ready","fix":null},
  {"tool":"claude","installed":true,"session":"unknown",
    "fix":"claude, then /login \u2014 not observable from this process"},
  {"tool":"git","installed":true,"session":"ready","fix":null},
  {"tool":"bq","installed":true,"session":"ready","fix":null},
  {"tool":"cmux","installed":true,"session":"ready","fix":null}]}
```

Six rows, always, in that order. `ready` is the whole verdict: `true` when no
tool blocks. A tool blocks when it is not installed or its session is `missing`
— `unknown` never blocks, or `claude` would pin the verdict to `false` forever.

| `session` | Meaning | What the UI can do |
|---|---|---|
| `ready` | the credential works | nothing; `fix` is `null` |
| `missing` | the tool was asked and has no usable credential | show `fix` as the command to run |
| `unknown` | the credential cannot be observed from this process | show `fix` as guidance, never as a verdict |

`installed` is a `PATH` lookup, which never executes anything; probing does
execute a binary for every row but `claude` and any row whose probing binary is
absent. `fix` is the literal repair, and `null` exactly when the session is
`ready`. It repairs what was asked about — the **credential** for five of the
rows, the **query** for `cmux`.

Two rows are probed with a binary that is not their own: `git` with `ssh`, `bq`
with `gcloud`. When that binary is absent from `PATH` the row is never asked and
reads `unknown` — nothing was observed — carrying a `fix` that starts by
installing the probe. `installed` still answers for the tool's own binary, so
such a row reads `installed: true` beside `session: unknown`.

A tool whose **own** binary is absent is the other case, and it is not the same
one: it stays `missing`, because that blocks, and its `fix` still names the login
and presupposes an installation `installed` already says you do not have. So a
`missing` row is either a tool that was asked and has no usable credential, or a
tool that was never asked because it is not there — `installed` is what tells
them apart, and the UI reads both before it reads `fix`.

How each one is asked:

| tool | asked with | `ready` when |
|---|---|---|
| `gh` | `gh auth status` | it exited 0 |
| `acli` | `acli jira auth status` | it exited 0 |
| `claude` | nothing | never: its login is not observable from another process |
| `git` | `ssh -T git@github.com` | its stderr says `successfully authenticated`, **whatever the exit code** — it exits 1 on success |
| `bq` | `gcloud auth list --filter=status:ACTIVE` | it exited 0 and named an account |
| `cmux` | the workspace query `GET /active-plans` recovers with | it answered it conclusively |

The `cmux` row is the one that catches a failure no version number reveals: the
app serves its socket from the process that is **running**, so a cmux updated on
disk but not restarted keeps answering with the schema of the build it was
started from, while `cmux --version` already reports the new one. Measured on
2026-09-09: same binary, byte for byte, on two machines — one answering
`custom_title`, the other only the older `title`, and the recovery refusing to
guess.

**Refusals**

None of its own. A probe that fails is data, not a refusal: that tool reads
`missing` and the answer is still 200. Only the shared refusals apply — 405 for a
method other than `GET`, 403 for a foreign `Origin`.

Two costs worth knowing before the UI calls this on a timer, because it should
not: every probe is a read, so all of them are declared safe to repeat, and they
run one after another with `git`'s reaching the network. A pathological call is
minutes, not seconds. It is meant to be asked once, by a person.

`gh` answers `ready` on a token that lacks the `project` scope, so
`/ct-groom --project` can still fail against a `ready` row: one row per tool
cannot express a per-capability verdict.

```
curl -s http://127.0.0.1:8787/external-tools
```

---

## Where the frontend consumes each one

| Endpoint | Client | Types |
|---|---|---|
| `POST /start-plan` | `frontend/src/app/start-plan/client.ts` | `StartPlan.types.ts` |
| `GET /plan-events` | `frontend/src/app/plan-events/client.ts` | `PlanEvents.types.ts` |
| `POST /implement-plan` | `frontend/src/app/implement-plan/client.ts` | `ImplementPlan.types.ts` |
| `GET /implement-progress` | `frontend/src/app/implement-progress/client.ts` | `ImplementProgress.types.ts` |
| `GET /active-plans` | `frontend/src/app/active-plans/client.ts` | `ActivePlan.types.ts` |
| `GET /external-tools` | `frontend/src/app/external-tools/client.ts` | `ExternalTools.types.ts` |

A client validates the wire shape before it reaches a component, and projects
snake_case to camelCase. Add a field to the validator, or the component never
sees it.

`GET /external-tools` is rendered by `ToolsStatus`
(`frontend/src/app/external-tools/components/tools-status/`) in the home page's
top bar, which asks it once when it mounts and again when a person presses its
retry button — never on a timer, for the two costs named above. Its path is in
`API_PATHS` (`frontend/vite.config.ts`), so the dev server proxies it instead of
answering the page's HTML.

## Where the contract is decided

| Concern | File |
|---|---|
| One endpoint's request, refusals and answer | `backend/src/infrastructure/<endpoint>-route.js` |
| Mounting, the origin filter, the body limit, the last net | `backend/src/infrastructure/api-server.js`, `http.ts` |
| The `{code, detail}` doctrine | `backend/conventions/this-repository.md` |
| That two endpoints never share a `code` by accident | `backend/__tests__/infrastructure/refusal-codes.test.js` |
| The step and phase vocabularies | `domain/value-objects/implementation-state.ts`, `infrastructure/active-plans-route.ts` |
