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
| Endpoints | 21 (`POST` 11, `GET` 10) |

In development the vite dev server proxies these paths to the backend and strips
the `Origin` header (`frontend/vite.config.ts`). A new endpoint must be added to
`API_PATHS` there, or the dev server answers the page's HTML instead of the API.

## Rules that apply to every endpoint

1. **Decide by `code`, never by status.** Every refusal answers the same body:
   `{"code": "<kebab-case>", "detail": "<one sentence>"}`.
2. **An application refusal answers 400.** The status stopped being the signal.
   405 keeps its own status because it is the protocol answering, not the
   application: it is decided before any request reaches a use case.
3. **A `POST` that carries a body must declare `Content-Type: application/json`.** Otherwise 415.
   Three exceptions take no body at all and therefore mount neither body middleware: `POST
   /spec-freeze`, `POST /epic-groom` and `POST /epic-promotion` never answer 415, whatever they
   are sent.
4. **A body over 8 KiB is refused** with 413 `body-too-large`.
5. **An unknown field in a `POST` body is refused**, not ignored. The one
   exception is `POST /session-hooks`: Claude Code's own hook payload carries
   fields this backend does not read, and it ignores every one of them instead
   of refusing the call.
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

**It names one target**: a repository and the path of its local clone. The
`repo_list` field, which once named several at once, is retired — a body
carrying it is refused by name rather than parsed.

| Field | Type | Required | Shape |
|---|---|---|---|
| `id` | string | one of `id` / `user_comment` | a user story key, `ABC-123`, or a GitHub issue url, `https://github.com/owner/name/issues/123` |
| `user_comment` | string | one of `id` / `user_comment` | free text, not blank |
| `repo` | string | yes | `owner/name` |
| `path` | string | yes | absolute path of the local clone |

`id` and `user_comment` may both be sent. Omit a field to leave it unsaid; do
not send `null`, which is a malformed value.

### 202 Accepted

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

### Refusals

Of the request:

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-id` | 400 | `id` is not a story key such as `ABC-123` nor a GitHub issue url such as `https://github.com/owner/name/issues/123` |
| `malformed-user-comment` | 400 | `user_comment` is blank or not text |
| `nothing-to-plan` | 400 | neither `id` nor `user_comment` was sent |
| `repo-list-retired` | 400 | the body carried `repo_list`; `detail` says to send `repo` and `path` for one repository instead |
| `malformed-repo` | 400 | a repo is not `owner/name`; `detail` names which field |
| `malformed-path` | 400 | a path is not absolute; `detail` names which field |
| `checkout-not-confirmed` | 400 | a path is not a checkout of its repo; `detail` names both the repo asked for and the one the path holds |

`malformed-repo` and `malformed-path` name their field, so the UI can point at
the offending input: `repo` or `path`.

From a tool refusing:

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
`detail`.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/start-plan \
  -d '{"id":"ABC-1","repo":"owner/name","path":"/repo/checkout"}'

curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/start-plan \
  -d '{"id":"https://github.com/owner/name/issues/123","repo":"owner/name","path":"/repo/checkout"}'
```

---

## `GET /plan-events/:issue?repo=owner/name`

Server-sent events. It reports whether the plan is being written or is
committed. The stream stays open until the client disconnects, and polls in the
meantime.

It only serves an issue whose plan **this process** started or recovered. A
restarted backend has forgotten every session it did not recover from cmux.

**200** with `Content-Type: text/event-stream`. Two frame kinds:

```
data: {"state":"writing"}

data: {"state":"ready"}

event: error
data: {"code":"plan-progress-not-read","detail":"git status refused"}
```

`state` is `writing` or `ready`. A frame is only sent when the state
**changes**, so expect nothing on the wire while the agent works. An `error`
frame does not close the stream; the next poll may succeed.

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

## `GET /implement-history/:issue?root=<abs path>&repo=owner/name`

What already happened, one row per finished step. `ct-step commit` appends one
row per attempt to `docs/superpowers/metrics/issue-<n>.jsonl` inside the
slice's worktree; this route reads that file. **Both** query parameters are
required, same as `/implement-progress`.

**200 OK**

```json
{"steps":[{"step":"implement","task":1,"task_name":"the lookup looks where it says it looks",
 "tasks_total":2,"attempt":1,"outcome":"done","written_at":"2026-09-10T14:55:59.885Z",
 "duration_ms":null,"summary":"Renamed ...","ruling":null,"findings_total":null,
 "tool_total_tokens":4275995}]}
```

Entries come back in file order. Twelve fields always present. A measurement
the row does not carry answers `null` — `duration_ms` and `summary` on most
steps, `task`/`task_name` on a step of the slice rather than of one task
(`reconcile`, `global`, `slice-judge`), and `ruling`/`findings_total` on every
step but the judge's.

A worktree with no metrics file yet answers `{"steps":[]}`: nothing ran there,
not a refusal.

| Field | Type | Meaning |
|---|---|---|
| `step` | string | the same step vocabulary `/implement-progress` uses |
| `task` | number \| null | the task the row measures |
| `task_name` | string \| null | the task's heading, read from the plan file |
| `tasks_total` | number \| null | tasks in the plan |
| `attempt` | number \| null | which attempt of that step |
| `outcome` | string \| null | how the attempt closed |
| `written_at` | string \| null | when `ct-step commit` wrote the row |
| `duration_ms` | number \| null | how long the attempt took, where measured |
| `summary` | string \| null | what the agent did, on an `implement` row |
| `ruling` | string \| null | the judge's verdict, such as `PASS`, on a `judge` row |
| `findings_total` | number \| null | how many findings the judge raised, on a `judge` row |
| `tool_total_tokens` | number \| null | the coding tool's total tokens for the attempt |

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `malformed-root` | 400 | `root` is missing or not absolute |
| `malformed-history-repo` | 400 | `repo` is missing or not `owner/name` |
| `implementation-history-not-read` | 400 | see below |

`implementation-history-not-read` is one code for three different
situations — the worktree is not there, the metrics file cannot be read, or
one of its lines is not valid JSON. For the last, `detail` names the line
number so the malformed row can be found by hand.

```
curl -s 'http://127.0.0.1:8787/implement-history/298?root=/repo/checkout&repo=owner/name'
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

Whether the six external tools this backend drives can be used right now, and
whether a merged slice's metrics have anywhere to go. No parameters. It exists
to be asked **before** starting work: until now each of these failed at the
moment it was used, mid-flow, in the tool's own words.

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
  {"tool":"cmux","installed":true,"session":"ready","fix":null}],
 "metricsDelivery":{"enabled":true,"variable":"CT_HARVEST_BQ_TABLE",
  "destination":"my-project:control_tower.harvest"}}
```

Six rows, always, in that order. `ready` is the whole verdict: `true` when no
tool that is **required right now** blocks. A tool blocks when it is not
installed or its session is `missing` — `unknown` never blocks, or `claude`
would pin the verdict to `false` forever.

`bq` is the one row that is **conditionally** required, and `metricsDelivery`
says by which condition. With the delivery disabled a `bq` that is missing or
not installed does **not** move `ready`: nothing is being uploaded, so nothing
is broken. With the delivery enabled the same row does move it, because the
delivery that was configured cannot proceed: the merged slice stays **pending
collection**, sweep after sweep, until `bq` can upload its row. Nothing is
lost — see below — but nothing advances either.

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

### `metricsDelivery` — whether a merged slice's metrics go anywhere

| Field | Meaning |
|---|---|
| `enabled` | whether the harvest uploads anything at all |
| `variable` | the environment variable that decides it: `CT_HARVEST_BQ_TABLE` |
| `destination` | the `project:dataset.table` it uploads to, or `null` |

`enabled` is `true` exactly when `destination` is not `null`; the two can never
disagree, because `enabled` is derived from the destination and never stored
beside it.

**It is read-only, and it is read once.** The value comes from the invocation
this process started with (`invocation.js`), already validated against
`project:dataset.table` — a malformed one refuses the start rather than reaching
this answer. Nothing re-reads `process.env`, so the answer cannot drift from
what the harvest is actually doing, and **there is no endpoint that changes it**:
changing the destination means restarting the backend with a different value.

**What an unset variable costs.** Plans, dispatch and the harvest itself keep
working: a merged slice's worktree and branch are still collected. What does not
happen is the upload — the slice leaves no row in the harvest ledger, so it
never appears in any comparison of coding tools. The telemetry the slice
committed under `docs/superpowers/metrics/issue-<n>.jsonl` is not lost and a
later `/ct-harvest --bq` can still load that epic by hand.

**When it is enabled and `bq` is not usable**, the sweep loads nothing and
**deletes nothing**: `dispatch-check --collect --bq` refuses to remove a
worktree whose row did not land, so the next sweep retries it. That is why the
row moves `ready`: the work is not lost, but it piles up.

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

## `GET /sessions`

Every live session this backend owns right now. No parameters.

**200 OK**

```json
{"sessions":[{"id":"f8479639-6123-4d2d-8495-7c093a8bbd68","name":"zsh"}]}
```

`sessions` is always present, and it goes empty once the one session
`ct-api.ts` opens at start-up has exited. Nothing reopens it: `POST
/sessions/:id/input` types every keystroke into `$SHELL -il`, so an `exit` or
a `Ctrl-D` typed into it ends the shell, and from that moment this answers
`{"sessions":[]}` for the rest of the process's life. `id` names the session
`GET /sessions/:id/stream` and `POST /sessions/:id/input` address, and `name`
is the basename of the program the session runs — `$SHELL`, or its fallback
`/bin/sh` — read once, at the moment the session opened.

**Refusals**

None of its own. Only the shared refusals apply — 405 for a method other than
`GET`, 403 for a foreign `Origin`.

```
curl -s http://127.0.0.1:8787/sessions
```

---

## `GET /sessions/:id/stream`

Server-sent events. The first frame carries the session's scrollback so far;
every later frame carries the bytes the process prints from then on. The
stream never ends on its own — it stays open until the client disconnects —
so a `curl` against it needs its own `--max-time` or it hangs.

**200** with `Content-Type: text/event-stream`. One frame kind:

```
data: {"bytes":"\u001b[1m\u001b[7m%\u001b[27m\u001b[1m\u001b[0m   …"}
```

`bytes` is the literal text the terminal printed, escape sequences included,
and nothing else — no `kind` field is sent, because nothing reads a second
kind yet. The first frame's `bytes` is the scrollback kept so far, up to
262144 characters with the oldest dropped first; every frame after it carries
only what the terminal printed since the previous one.

**Closing the page ends the subscription and nothing else.** The stream stops
the moment the client disconnects, but the session, its process and its
scrollback all survive: a second `GET` on the same `:id` opens a new
subscription and replays the same scrollback from the top, as if nothing had
been watching.

**Refusals** (before the stream opens, as JSON)

| `code` | Status | Meaning |
|---|---|---|
| `session-not-live` | 400 | no live session answers to that id |

`session-not-live` is shared on purpose with `POST /sessions/:id/input`'s own
vocabulary: an id can go stale between the two calls, and both refuse it the
same way.

```
curl -N --max-time 5 http://127.0.0.1:8787/sessions/<id>/stream
```

---

## `POST /sessions/:id/input`

Writes text into the session's terminal, exactly as if it had been typed at
the keyboard.

**Request**

| Field | Type | Shape |
|---|---|---|
| `text` | string | not empty — a whitespace-only string still passes |

**202 Accepted**

```json
{"status":"typed","id":"f8479639-6123-4d2d-8495-7c093a8bbd68"}
```

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-text` | 400 | `text` is empty or not a string |
| `session-not-live` | 400 | no live session answers to that id |

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/sessions/<id>/input \
  -d '{"text":"echo hello\n"}'
```

---

## `POST /sessions/:id/resize`

Tells that session's pseudo-terminal what size the page is showing it at, so the
pty and the on-screen emulator agree on where a line wraps. The page sends it
after every fitted resize, and it is the one endpoint whose failure the front end
swallows: a size that never arrived is not something a person can act on.

**Request**

| Field | Type | Shape |
|---|---|---|
| `cols` | number | a positive integer, at most 500 |
| `rows` | number | a positive integer, at most 300 |

Both are required, and they are judged together: one bad value refuses the pair.
A zero, a negative, a non-integer, a string of digits and a value over its cap
all answer the same `malformed-size`.

**202 Accepted**

```json
{"status":"resized","id":"f8479639-6123-4d2d-8495-7c093a8bbd68","cols":120,"rows":40}
```

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-size` | 400 | `cols` or `rows` is not a positive integer inside its cap |
| `session-not-live` | 400 | no live session answers to that id |

`session-not-live` covers two different moments with one code: an id nothing
holds, and a session whose pty had already closed its descriptor when the resize
reached it. The second one is why it is a refusal and not a `request-failed` —
a terminal that died is an answer, not a crash.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/sessions/<id>/resize \
  -d '{"cols":120,"rows":40}'
```

---

## `POST /coordinating-session`

Confirms the checkout, resolves the idea, writes the phase prompt to a file,
installs the session hooks and spawns `claude` in the governed checkout. **No
worktree is cut and no branch is created** — this is the entrance conversation,
not a plan.

**Request** — the same shape as `POST /start-plan`, read through the very same
`PlanRequest`, so a body carrying the retired `repo_list` earns the same refusal
here as it does there.

| Field | Type | Required | Shape |
|---|---|---|---|
| `id` | string | one of `id` / `user_comment` | a user story key, `ABC-123`, or a GitHub issue url |
| `user_comment` | string | one of `id` / `user_comment` | free text, not blank |
| `repo` | string | yes | `owner/name` |
| `path` | string | yes | absolute path of the local clone |

`id` and `user_comment` may both be sent, the same as `POST /start-plan`. A
user story hydrates the conversation — the coordinating session starts already
knowing its summary and description — it does not replace it.

**202 Accepted**

```json
{"status":"brainstorming","conversation":"2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f",
 "repo":"owner/name","root":"/repo/checkout",
 "session":{"id":"f8479639-6123-4d2d-8495-7c093a8bbd68","name":"brainstorming"}}
```

`conversation` is the id `GET /coordinating-session` and `POST /session-hooks`
both key on. `session` is the same shape `GET /sessions` answers, and the same
`GET /sessions/:id/stream` streams — the coordinating session is a live session
like any other.

**Refusals**

Shared with `POST /start-plan`, because both read the body through the same
`PlanRequest`:

| `code` | Status | Meaning |
|---|---|---|
| `body-not-a-json-object` | 400 | the body did not parse, or is not an object |
| `unknown-field` | 400 | `detail` names the fields, sorted |
| `malformed-id` | 400 | `id` is not a story key nor a GitHub issue url |
| `malformed-user-comment` | 400 | `user_comment` is blank or not text |
| `nothing-to-plan` | 400 | neither `id` nor `user_comment` was sent |
| `malformed-repo` | 400 | `repo` is not `owner/name` |
| `malformed-path` | 400 | `path` is not absolute |
| `checkout-not-confirmed` | 400 | `path` is not a checkout of `repo` |
| `repo-list-retired` | 400 | the body carried `repo_list`; `detail` says to send `repo` and `path` for one repository instead |

It has no refusal of its own for a listed request any more: the field retired,
so no listed request can arrive.

From opening the conversation, once the body is well-formed:

| `code` | Meaning |
|---|---|
| `user-story-not-read` | the tracker holding the story refused |
| `user-story-not-understood` | the tracker holding the story answered something unreadable |
| `workspace-not-understood` | git answered something unreadable while resolving the checkout's canonical root |
| `conversation-not-started` | `claude` could not be spawned in the checkout |
| `conversation-not-recorded` | the phase prompt or the conversation record could not be written to disk |
| `session-hooks-not-written` | the checkout's `.claude/settings.local.json` could not be written |
| `session-hooks-not-understood` | that settings file exists but is not the JSON object the hooks are merged into |

All seven answer 400 and carry the tool's own message in `detail`, the same
convention `POST /start-plan`'s ten tool refusals follow.

`PlanCollapse` (`backend/src/infrastructure/start-plan-route.ts`) also declares
`conversation-not-understood`, the code for a conversation record that is on
disk but cannot be parsed. No endpoint answers it today: that record is only
read by `records.recall()` at the backend's start-up, before this route or any
other ever runs, and `ct-api.ts` awaits that recovery with nothing catching it
— an unreadable record currently crashes the backend at start-up instead of
being reported. That gap is open, not this task's to close.

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/coordinating-session \
  -d '{"id":"ABC-1","repo":"owner/name","path":"/repo/checkout"}'
```

---

## `GET /coordinating-session`

Whatever coordinating session this backend holds right now, in-memory. No
parameters. The page polls it to show the entrance conversation's state and to
recover it after a reload.

**200 OK** — three shapes, told apart by `status`.

Nothing has been opened yet:

```json
{"status":"none"}
```

A conversation is live:

```json
{"status":"live","conversation":"2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f",
 "repo":"owner/name","root":"/repo/checkout",
 "session":{"id":"f8479639-6123-4d2d-8495-7c093a8bbd68","name":"brainstorming"},
 "attention":{"status":"waiting","question":"should the button read Arrancar brainstorming?"},
 "timeline":[
   {"id":"3f1c...","kind":"opened","at":"2026-09-15T09:00:00.000Z","detail":null},
   {"id":"7a2e...","kind":"working","at":"2026-09-15T09:00:05.000Z","detail":null},
   {"id":"9b4d...","kind":"waiting-for-permission","at":"2026-09-15T09:02:00.000Z",
    "detail":"should the button read Arrancar brainstorming?"}
 ]}
```

`attention.status` is `working` or `waiting`, moved by `POST /session-hooks`.
`attention.question` carries the live question while `waiting`, and is `null`
otherwise — it is dropped the moment the session works again.

`timeline` is the ordered history of every session event the backend has
recorded for this conversation, oldest first, each with a stable `id`, a
`kind` — `opened`, `resumed`, `unresumable`, `working`, `waiting-for-permission`,
`completed` or `ended` — an ISO `at` timestamp and a `detail`, which carries
the live question for `waiting-for-permission` and is `null` for every other
kind. A `Stop` hook always projects `completed`: Claude Code's last message is
a completion summary, never a question, so it never becomes `detail`. The
timeline is rebuilt from this same field on every page reload, never kept only
in the browser, and it survives a backend restart: it is read back from
`<state root>/coordinating-session/<conversation>/timeline.json`, the same
directory `phase-prompt.md` and the conversation record already live in.

Claude Code no longer holds a conversation this backend tried to resume at
start-up:

```json
{"status":"unresumable","conversation":"2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f",
 "repo":"owner/name","root":"/repo/checkout",
 "detail":"claude code no longer holds this conversation: the coordinating session was not resumed",
 "timeline":[{"id":"3f1c...","kind":"opened","at":"2026-09-15T09:00:00.000Z","detail":null}]}
```

The cabin never opens a different conversation and presents it as this one: an
`unresumable` conversation stays `unresumable` until a person opens a new one
with `POST /coordinating-session`.

**Refusals**

None of its own. Only the shared refusals apply — 405 for a method other than
`GET` or `POST`, 403 for a foreign `Origin`.

```
curl -s http://127.0.0.1:8787/coordinating-session
```

---

## `POST /groom-session`

Gate 2's way into the conversation. It opens the coordinating session in the
**groom** phase: `PhasePrompt.groom` writes a prompt that invokes the plugin's
own `control-tower-loop:ct-groom` skill, names the milestone and its frozen
spec, and tells the session that the issues are not its to create and that a
change to the slicing is an edit of §9 which this program publishes. No
worktree is cut and no branch is created.

**Request** — no body. The checkout and the repository are the ones the
coordinating session this backend holds already names, so nothing is sent.
The gate key travels in `x-gate-key`, exactly as gate 1's and gate 2's other
buttons carry it.

**202 Accepted**

```json
{"status":"grooming","conversation":"9c3f1b7e-4d2a-4c8b-9a3e-6f2b1a6c2e8f",
 "repo":"owner/name","root":"/repo/checkout",
 "session":{"id":"f8479639-6123-4d2d-8495-7c093a8bbd68","name":"brainstorming"}}
```

The opened conversation becomes the one `GET /coordinating-session` answers,
live and `working`: there is one coordinating session and the groom phase takes
its place, which is why a live conversation has to end before this door opens.

**Refusals**

| Status | `code` | When |
|---|---|---|
| 403 | `gate-not-from-the-page` | the request carries no key, or not the one the page was given |
| 400 | `no-coordinating-session` | nothing is held, so there is no checkout to open the conversation in |
| 409 | `coordinating-session-already-live` | a conversation is live: it has to end first |
| 409 | `coordinating-session-opening` | another opening is in flight |
| 400 | `no-epic-spec` | no execution spec exists in this checkout to talk about |
| 400 | `conversation-not-started` | `claude` could not be spawned in the checkout |

```
curl -s -X POST http://127.0.0.1:8787/groom-session -H 'x-gate-key: <key>'
```

---

## `POST /session-hooks`

Where Claude Code's own `UserPromptSubmit`, `Notification` and `Stop` hooks
report in. It is not meant to be called by the page: `POST
/coordinating-session` installs it into the governed checkout's
`.claude/settings.local.json`, guarded by `$CT_SESSION_HOOKS_URL`, and Claude
Code invokes it on its own as the coordinating session works.

**Request** — Claude Code's own hook payload, read for three fields and
nothing else:

| Field | Type | Shape |
|---|---|---|
| `session_id` | string | not empty; matched against the held conversation's id |
| `hook_event_name` | string | one of `UserPromptSubmit`, `Notification`, `Stop` |
| `message` | string | optional; only read on `Notification`, as the live question |

**This is the one endpoint that ignores an unknown field instead of refusing
it** (the exception rule 5 above names): Claude Code's hooks send fields this
backend never reads, such as `transcript_path` and `cwd`, and every one of
them is dropped rather than turned into a refusal.

Each event projects to an attention:

| `hook_event_name` | Attention | `message` read |
|---|---|---|
| `UserPromptSubmit` | `working` | no |
| `Notification` | `waiting` | yes, as the live question |
| `Stop` | `waiting`, no question | no |

**202 Accepted** — sent only once the timeline event this hook produced is
durably recorded. Events from concurrent hooks are recorded one at a time, in
the order they arrived, so a restart right after this response never loses an
already-acknowledged event.

```json
{"status":"reported","attention":"waiting"}
```

**Refusals**

| `code` | Status | Meaning |
|---|---|---|
| `hook-not-understood` | 400 | the body is not JSON, not an object, or misses a known `hook_event_name` or a well-formed `session_id` |
| `conversation-not-live` | 400 | no held conversation answers to that `session_id` |
| `timeline-not-recorded` | 400 | the attention moved but the timeline event could not be recorded; the acknowledgement is never sent for an event that failed to persist |

```
curl -s -X POST -H 'Content-Type: application/json' \
  http://127.0.0.1:8787/session-hooks \
  -d '{"session_id":"2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f","hook_event_name":"Notification","message":"which repo?"}'
```

---

## `GET /spec-freeze`

Gate 1's own state for the checkout the held coordinating session sits in,
derived from the execution spec on disk and nothing stored. No parameters.
The cabin polls it to draw gate 1's panel.

**200 OK** — four shapes, told apart by `status`.

No coordinating session is held, so there is nothing to freeze:

```json
{"status":"none"}
```

A session is held, but the checkout carries no execution spec under
`docs/superpowers/specs/`:

```json
{"status":"no-spec"}
```

A spec exists and is not frozen yet:

```json
{"status":"draft",
 "spec":"docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md",
 "findings":[
   {"code":"clarification-marker","line":42,"detail":"[NEEDS CLARIFICATION: which button?]"},
   {"code":"hypothesis-absent","line":null,"detail":null}
 ],
 "key":"3f9c1a…"}
```

Every finding is `analyzeSpecFreeze`'s own (`backend/src/domain/value-objects/epic-spec.ts`
projects it): `clarification-marker` carries the `line` of a `[NEEDS
CLARIFICATION` marker and `detail` is that marker's raw line; `hypothesis-absent`
and `hypothesis-empty` both carry `line: null` and `detail: null` — the whole
`## Hipótesis` section is missing or blank, not one line inside it.

`key` is the value `POST /spec-freeze` demands in its `x-gate-key` header,
minted once when the backend starts (`backend/src/infrastructure/gate-key.ts`).
It is attached to the `draft` body **only** when the request is the page's own:
`Host` must be one of the loopback names and `Origin` must equal
`http://<Host>` exactly (`Browsers.isOurOwnPage`,
`backend/src/infrastructure/http.ts`). A plain `curl` call carries no `Origin`,
so it sees the same `draft` body with no `key` at all — nothing that is not
the browser page this backend serves is ever handed what presses gate 1.

The spec is frozen:

```json
{"status":"frozen",
 "spec":"docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md",
 "on":"2026-09-14",
 "pullRequest":{"number":341,"url":"https://github.com/owner/name/pull/341"}}
```

`pullRequest` is `null` when the branch that carries the frozen spec has no
open pull request `gh` can find today — the one `POST /spec-freeze` opened may
since have merged or closed.

**Refusals**

The shared ones — 405 for a method other than `GET` or `POST`, 403 for a
foreign `Origin` — and, with a 400 and its own `{code, detail}`, every tool
refusal this read can meet. Reading the spec runs on disk, so a specs directory
it cannot list is `epic-spec-not-read` and a file carrying no title is
`epic-spec-not-understood`; and on the frozen branch alone it also runs
`git rev-parse` and `gh pr list`, so a logged-out `gh` or a checkout git cannot
read surface here rather than as a generic failure. The cabin polls this route,
so a refusal it swallowed would be a panel that silently shows nothing.

```
curl -s http://127.0.0.1:8787/spec-freeze
```

---

## `POST /spec-freeze`

Gate 1's press. Writes `**Estado:** CONGELADA` and the freeze date into the
execution spec, commits it with its design document, pushes the branch it
publishes on and opens the pull request that publishes both. No request body —
the whole checkout is read from the held coordinating session, the same way `GET
/spec-freeze` does.

**The branch it publishes on.** A checkout sitting on any branch other than the
default one publishes on that branch, exactly as before. A checkout sitting on
the branch the remote calls default never commits there: gate 1 cuts
`milestone/` plus the spec's own file name without its `.md`, and carries on
without asking first — the spec's path names the branch, so the name is derived
and never slugged from a title. The cut is idempotent: a branch of that name the checkout
already holds is switched to, one only the remote holds is fetched under its own
name, and neither is ever cut a second time.

**What it publishes is what that branch holds.** Switching branch changes the
spec on disk, so the spec is read again at its own path once the branch is
resolved, and everything after that — whether it is freezable, which design
document it names, whether the freeze was already delivered — is decided on that
copy. A branch already carrying a frozen spec keeps it: gate 1 never writes back
over it the copy the press started from. A branch that does not carry the spec
yet is published with the copy the freeze read before switching.

**Which branch the remote calls default** is resolved in three steps, and the
gate never passes when none of them answers: `git symbolic-ref
refs/remotes/origin/HEAD` first, which is free and local; then, only if that
fails, `git ls-remote --symref origin HEAD`, the remote's own answer — a
repository born from `git init` plus `git remote add` never had the local ref
`git clone` writes; and, if the remote does not answer either,
`epic-branch-not-published`, naming `git remote set-head origin -a` as what
declares it. This backend never writes that ref into the governed repository
itself.

**Request header**

| Header | Required | Shape |
|---|---|---|
| `x-gate-key` | yes | the exact value `GET /spec-freeze` minted for the page |

**200 OK**

```json
{"status":"frozen","on":"2026-09-14","pullRequest":{"number":341,"url":"https://github.com/owner/name/pull/341"}}
```

**Refusals**

Checked before anything else, ahead even of whether a session is held:

| `code` | Status | Meaning |
|---|---|---|
| `gate-not-from-the-page` | 403 | `x-gate-key` is missing or does not match the key `GET /spec-freeze` minted for the page |

Then, once the key holds:

| `code` | Status | Meaning |
|---|---|---|
| `no-coordinating-session` | 400 | no coordinating session is held: there is nothing to freeze |
| `freeze-in-progress` | 409 | a freeze of this checkout is under way: wait for it to answer before pressing again |
| `no-epic-spec` | 400 | no execution spec exists in this checkout to freeze |
| `spec-already-frozen` | 400 | the spec is already frozen: it cannot be frozen twice |
| `spec-not-freezable` | 400 | a clarification marker or an absent/empty `## Hipótesis` remains; `detail` names how many findings remain and the first one, by line when it has one |

`freeze-in-progress` guards against two tabs pressing gate 1 at once: a synchronous reservation,
taken before the freeze starts and released once it answers (whether it froze the spec or was
refused), keyed by the checkout so a second press while the first is still running is turned away
instead of racing it into freezing — and possibly writing — the same spec twice.

None of these six touches the spec, a commit or the remote.

From writing the spec, publishing the branch and opening the pull request,
once the six above did not apply — the same `PlanCollapse` doctrine `POST
/coordinating-session` documents for its own tool refusals
(`backend/src/infrastructure/start-plan-route.ts`), reached here for the first
time because gate 1 is the only caller of `EpicSpecs`, `EpicBranch` and
`PullRequests.open`:

| `code` | Meaning |
|---|---|
| `epic-spec-not-read` | the execution spec could not be listed or read back from disk |
| `epic-spec-not-understood` | the spec carries no title, or names no design document under `**Handoff origen:**` |
| `epic-spec-not-written` | the state line and its date could not be written back to disk |
| `epic-branch-not-published` | `git` failed to resolve, cut, switch to, fetch, add, commit or push the branch gate 1 publishes on, or neither the checkout nor the remote could say which branch is default — the branch is resolved before anything is added, committed or pushed, though the spec's rewritten text can already sit on disk as an uncommitted change |
| `epic-branch-not-understood` | `git` printed something this backend cannot read while resolving the branch or the remote's default |
| `epic-pull-request-not-opened` | `gh pr create` failed |
| `pull-request-not-understood` | `gh` answered something this backend cannot read while opening the pull request |

All seven answer 400 and carry the tool's own message in `detail`, the same
convention every other tool refusal in this file follows.

```
curl -s -X POST -H 'x-gate-key: 3f9c1a…' http://127.0.0.1:8787/spec-freeze
```

---

## `POST /spec-reslicing`

Makes a correction of the frozen spec's slices table travel. The coordinating
session in the groom phase edits §9 and stops; this is what commits it on the
milestone branch, pushes it and opens the pull request whose **merge** authorises
the groom. It is gate 1's own path — `EpicBranch.publishing / committed / commit
/ pushed / push` and `PullRequests.openOfBranch / open`, the same two ports — in
a use case of its own, so a correction never reaches the default branch by
another door.

The spec stays `CONGELADA`: **nothing is written into the spec**, neither its
state line nor its freeze date. That is what makes this a correction and not a
second freeze.

**Request** — no body. The checkout and the repository are the ones the held
coordinating session names; the gate key travels in `x-gate-key`.

**200 OK**

```json
{"status":"published","pullRequest":{"number":13,"url":"https://github.com/owner/name/pull/13"}}
```

`pullRequest` is the pull request the correction travels in: the one already open
for that branch when there is one — pressing twice opens no second — and
otherwise the one this press created. Its body opens with the announcement

```
<!-- ct-groom:reslicing spec="docs/superpowers/specs/<spec>.md" revision="<40 hex>" -->
```

which names **which spec** and **which revision of it** the merge would approve —
the same git blob sha publication is compared by. That is what `GET /epic-groom`
reads later, and it is why an approval cannot be inherited: not by another
milestone published from the same branch, and not by a later edit of this spec.

**Refusals**

| Status | `code` | When |
|---|---|---|
| 403 | `gate-not-from-the-page` | the request carries no key, or not the one the page was given |
| 400 | `no-coordinating-session` | nothing is held, so there is no checkout whose slicing could be published |
| 409 | `reslicing-in-progress` | a publication of this slicing is under way |
| 400 | `no-epic-spec` | no execution spec exists in this checkout to publish |
| 400 | `spec-not-frozen` | the spec is not frozen: gate 1 owns a draft, not this door |

Plus every `PlanCollapse` code gate 1 can meet on the same path —
`epic-branch-not-published`, `epic-branch-not-understood`,
`epic-pull-request-not-opened`, `epic-spec-not-read`, `pull-request-not-read`,
`pull-request-not-understood` — each with 400 and the tool's own words in
`detail`.

```
curl -s -X POST http://127.0.0.1:8787/spec-reslicing -H 'x-gate-key: <key>'
```

---

## `GET /epic-groom`

Gate 2's own state for the checkout the held coordinating session sits in, derived from the
execution spec, the epic's milestone and its issues on GitHub — nothing stored. No parameters.
The cabin polls it to draw gate 2's panel.

**200 OK** — ten shapes, told apart by `status`.

No coordinating session is held, so there is nothing to groom:

```json
{"status":"none"}
```

A session is held, but the checkout carries no execution spec — the same absence `GET
/spec-freeze` answers with `no-spec`:

```json
{"status":"no-spec"}
```

The spec exists and is not frozen yet:

```json
{"status":"draft"}
```

The spec is frozen and what the default branch holds is not the text this checkout holds, and that
edit is **not committed**: the coordinating session changed the slicing and the correction has not
left the checkout yet. `POST /spec-reslicing` is what makes it travel:

```json
{"status":"resliced","key":"3f9c1a…"}
```

The spec is frozen, but what the default branch holds is **not the text this checkout holds** — the
pull request that carries it has to merge first. Publication is decided by content and never by
existence: `gh api repos/<owner>/<repo>/contents/<spec>` answers the file of the default branch with
its git blob `sha`, and this backend compares it against the blob sha of the local spec
(`sha1("blob " + byteLength + "\0" + text)`, git's own envelope). A path that exists on the default
branch carrying an older table therefore reads as unpublished, which is what keeps the groom from
creating issues from a table nobody approved:

```json
{"status":"awaiting-publication",
 "pullRequest":{"number":341,"url":"https://github.com/owner/name/pull/341"}}
```

`pullRequest` is the open pull request of the branch the checkout sits on, read with the same `gh pr
list` `POST /spec-freeze` uses, so the link survives a page reload long after the freeze's own answer
is gone. It is `null` when no open pull request can be found, and the page says a different thing for
that case — the spec is still unpublished and no open pull request was found for its branch, rather
than asking for a merge with nothing to merge. Either way it is a wait, never an error: the creation
may have failed after the commit and the push, or the pull request may have been closed unmerged. This
read and `groomable` are the only two that run `git rev-parse` and `gh pr list` — this one for the open
pull request it waits for, `groomable` for the merged re-slicing that may already have authorised it;
the other eight shapes ask neither.

The spec is frozen and published, but `gh issue list` could not be exhausted: `gh` exposes no
cursor, so this backend establishes exhaustion by climbing `--limit` (200, 400, 800, … up to a
ceiling) until an answer comes back shorter than what it asked for; if every limit up to that
ceiling comes back full, the milestone may hold more issues than this backend could read, and it
answers INCONCLUSIVE rather than a listing it cannot vouch for — the defect this state exists to
close is exactly a confident `authorised` read past a page it never saw. `reason` is the words a
person reads for why:

```json
{"status":"issues-uncertain",
 "milestone":"The loop enters through brainstorming",
 "reason":"gh issue list answered exactly as many issues as it was asked for at every limit up to the ceiling of 1600: the milestone \"The loop enters through brainstorming\" may hold more issues than this backend could read"}
```

The spec is frozen and published, and the milestone holds no issue yet. `plan` is `ct-groom
--dry-run`'s own product, kept as what a real run would create: the milestone and, per row of the
spec's slices table, the order, the title, the labels and the repository the real run would give its issue:

```json
{"status":"groomable",
 "milestone":"The loop enters through brainstorming",
 "plan":{"home":"mercadona/control-tower","issues":[
   {"order":1,"title":"The intermediate gate retires","labels":["type:backend","area:api","status:backlog"],"repo":"mercadona/control-tower"},
   {"order":2,"title":"The session channel","labels":["type:ui","area:sessions","status:backlog"],"repo":"mercadona/repo-pulse"}
 ]},
 "planFingerprint":"9c1a3f…",
 "key":"3f9c1a…"}
```

The milestone holds at least one issue, but the plan still promises an order none of them carries —
`ct-groom` created some of the epic's issues and then died, or is still running: `plan` is the same
`ct-groom --dry-run` product as `groomable`'s, and `issues` are the ones the milestone already
holds, identified by their `<!-- ct-order:N -->` marker rather than by title, so a renamed issue is
never read as missing:

```json
{"status":"partially-groomed",
 "milestone":"The loop enters through brainstorming",
 "plan":{"home":"mercadona/control-tower","issues":[
   {"order":1,"title":"The intermediate gate retires","labels":["type:backend","area:api","status:backlog"],"repo":"mercadona/control-tower"},
   {"order":2,"title":"The session channel","labels":["type:ui","area:sessions","status:backlog"],"repo":"mercadona/repo-pulse"}
 ]},
 "planFingerprint":"9c1a3f…",
 "issues":[
   {"number":348,"url":"https://github.com/owner/name/issues/348","title":"The intermediate gate retires","status":"backlog"}
 ],
 "key":"3f9c1a…"}
```

The milestone holds issues and at least one open one still stands at `status:backlog` — the groom
already ran, gate 2's promotion has not:

```json
{"status":"groomed",
 "milestone":"The loop enters through brainstorming",
 "issues":[
   {"number":348,"url":"https://github.com/owner/name/issues/348","title":"The intermediate gate retires","status":"backlog"},
   {"number":349,"url":"https://github.com/owner/name/issues/349","title":"The session channel","status":"backlog"}
 ],
 "key":"3f9c1a…"}
```

Every open issue of the milestone already left `status:backlog` — there is nothing left to
promote:

```json
{"status":"authorised",
 "milestone":"The loop enters through brainstorming",
 "issues":[
   {"number":348,"url":"https://github.com/owner/name/issues/348","title":"The intermediate gate retires","status":"ready"},
   {"number":349,"url":"https://github.com/owner/name/issues/349","title":"The session channel","status":"ready"}
 ]}
```

`key` is the same value `POST /epic-groom` and `POST /epic-promotion` demand in their
`x-gate-key` header, minted once when the backend starts
(`backend/src/infrastructure/gate-key.ts`) — the mechanism `GET /spec-freeze` documents above. It
is attached only to the `resliced`, `groomable`, `partially-groomed` and `groomed` bodies, and only
for the page's own request — `resliced` carries it because the button it offers presses
`POST /spec-reslicing`, which demands the same key; `no-spec`, `draft`, `awaiting-publication`,
`issues-uncertain` and `authorised` never carry it, whatever request asks — `authorised` has nothing left for a key to open, and
`issues-uncertain` offers nothing to press while its own listing cannot be trusted.

`plan.home` is the milestone's **home repository**, the one the coordinating session holds, and
each issue's `repo` is the repository that issue will be created in: the milestone's slices table
may send a row to another repository (`Repo` column), and one row never spans two. A row whose
`repo` equals `home` is the ordinary case.

`reslicing` travels on `groomable` alone, and it is what makes the groom run
without a further click: the **merged** pull request of the branch the checkout
sits on that **approves this spec at the revision the default branch now holds**
and that **merged into the default branch**
(`gh pr list --head <branch> --base <default> --state merged --json number,url,body,baseRefName`,
then the announcement in the body compared against the spec being read). Three
things have to agree, and each closes a door: a branch is reusable — 
`EpicBranch.publishing` keeps any branch other than the default one — so two
milestones can be published from one branch and the path is what tells their
approvals apart; the revision is what stops an approval of an older table from
authorising a later edit; and the base branch is what stops a merge that landed
somewhere else from counting. `null` means nothing approved this table, and then
the groom waits for the press it always waited for. It is asked only in that one
state: once the milestone holds an issue there is nothing left to authorise, so
`partially-groomed`, `groomed` and `authorised` never ask.

`planFingerprint` is a sha256 hex digest of the plan's own content — the milestone, the home
repository, then each issue's order, title, labels and repository, in the plan's own order
(`backend/src/domain/value-objects/groom-plan.ts`'s `canonicalText()`, hashed by
`backend/src/domain/policies/plan-fingerprint.ts`). It travels only on `groomable` and
`partially-groomed`, the two shapes that carry a `plan`; `POST /epic-groom` demands it back in its
`x-plan-fingerprint` header, so a groom the person never previewed is never the one that runs.

**Refusals**

The shared ones — 405 for a method other than `GET` or `POST`, 403 for a foreign `Origin` — and,
with a 400 and its own `{code, detail}`, every tool refusal this read can meet: deriving these
ten states can run `ct-groom --dry-run`, `git status --porcelain`, `gh api
repos/<repo>/contents/<spec>` and `gh issue list`, so their failures surface here too — the same `PlanCollapse` codes `POST /epic-groom`
documents below, except `epic-issue-not-promoted`, which only `POST /epic-promotion` can meet. A
`gh issue list` call that fails outright still meets `epic-issues-not-read` there, exactly as
before this backend paged; only a paging climb that never comes back short answers
`issues-uncertain` here — that one is a state of the read, not a refusal, because the request
answered fine and gate 2 still has something true to say about it.

```
curl -s http://127.0.0.1:8787/epic-groom
```

---

## `POST /epic-groom`

Gate 2's groom. Runs `ct-groom` for real over the spec and milestone `GET /epic-groom` already
read, and answers the issues the milestone holds afterwards. No request body — the whole checkout
is read from the held coordinating session, the same way `GET /epic-groom` does.

A `partially-groomed` read is not refused here: `ct-groom` is idempotent through the
`<!-- ct-order:N -->` marker it writes into every issue, so running it again over a milestone that
already holds some of the plan's issues creates only the ones still missing and touches none of the
existing ones. Finishing the groom is the way `POST /epic-promotion` sends a partially groomed
epic back to.

**Request headers**

| Header | Required | Shape |
|---|---|---|
| `x-gate-key` | yes | the exact value `GET /epic-groom` minted for the page |
| `x-plan-fingerprint` | yes | the exact `planFingerprint` the `groomable` or `partially-groomed` body carried for the plan on screen |

**200 OK**

```json
{"status":"groomed",
 "milestone":"The loop enters through brainstorming",
 "issues":[
   {"number":348,"url":"https://github.com/owner/name/issues/348","title":"The intermediate gate retires","status":"backlog"},
   {"number":349,"url":"https://github.com/owner/name/issues/349","title":"The session channel","status":"backlog"}
 ]}
```

**Refusals**

Checked before anything else, ahead even of whether a session is held:

| `code` | Status | Meaning |
|---|---|---|
| `gate-not-from-the-page` | 403 | `x-gate-key` is missing or does not match the key `GET /epic-groom` minted for the page |

Then, once the key holds:

| `code` | Status | Meaning |
|---|---|---|
| `no-coordinating-session` | 400 | no coordinating session is held: there is nothing to groom |
| `groom-in-progress` | 409 | a groom of this checkout is under way: wait for it to answer before pressing again |
| `no-epic-spec` | 400 | no execution spec exists in this checkout to groom |
| `spec-not-frozen` | 400 | the spec is not frozen: gate 1 first |
| `spec-resliced` | 400 | the slicing changed in the coordinating session: publish it and merge it before the groom runs |
| `spec-not-published` | 400 | the spec is frozen, but its committed copy is not yet readable on the default branch |
| `epic-issues-uncertain` | 400 | `gh issue list`'s paging could not be exhausted: `detail` is the same reason `GET /epic-groom`'s `issues-uncertain` body carries, and the plan comparison this press would otherwise run cannot be trusted either |
| `plan-changed` | 409 | the spec changed since this plan was shown: read the new plan before pressing again |

`groom-in-progress` is `POST /epic-groom`'s own guard against two tabs pressing gate 2 at once — the
same synchronous-reservation mechanism `freeze-in-progress` documents above
(`backend/src/infrastructure/work-in-flight.ts`), keyed by the checkout and released once the groom
answers. It is a distinct code on purpose: gate 1 and gate 2 guard two different presses, so a
client cannot confuse which one is still running. `GET /epic-groom` and `POST /epic-promotion` take
no reservation of their own — a promotion adds a label to an issue, which is idempotent, so pressing
it twice at once creates nothing to duplicate.

`plan-changed` is this route's own — no other endpoint meets it. It is answered after the read that
`GET /epic-groom` already performed is repeated and its state allows a groom to run at all, and
before `ct-groom` is ever invoked: the plan that read would now groom is fingerprinted again
(`backend/src/domain/policies/plan-fingerprint.ts`) and compared against `x-plan-fingerprint`. A
mismatch means the spec changed underneath the page between the preview and the press; a request
carrying no `x-plan-fingerprint` at all meets the same code, because the page always has one to send
at a pressable rung, so its absence means the request did not come from a preview.

None of these nine touches the milestone or an issue.

From running the groom itself, once the eight above did not apply — the `PlanCollapse` codes this
slice adds to the doctrine `POST /spec-freeze` documents above
(`backend/src/infrastructure/start-plan-route.ts`). The first six are reached alike by `GET
/epic-groom`, `POST /epic-groom` and `POST /epic-promotion`, because all three read the spec, the
published copy and the milestone's issues through the same ports; the last is met only where an
issue is actually edited:

| `code` | Meaning |
|---|---|
| `epic-not-groomed` | `ct-groom` exited with something other than `0` (no divergence) or `3` (unreconciled divergence); `detail` is that program's own stderr, untranslated |
| `groom-plan-not-understood` | `ct-groom --dry-run` printed something this backend cannot read as a plan |
| `published-spec-not-read` | `gh api repos/<repo>/contents/<spec>` failed for a reason other than "not found" |
| `published-spec-not-understood` | that call answered something naming no `sha` this backend can read, so publication could not be compared |
| `epic-issues-not-read` | `gh issue list` failed while reading the milestone's issues |
| `epic-issues-not-understood` | `gh` answered the milestone's issues without the shape this reads |
| `epic-issue-not-promoted` | `gh issue edit` failed while moving one issue from `status:backlog` to `status:ready` — met only by `POST /epic-promotion`, the only caller of that edit |

All seven answer 400 and carry the tool's own message in `detail`, the same convention every other
tool refusal in this file follows.

```
curl -s -X POST -H 'x-gate-key: 3f9c1a…' -H 'x-plan-fingerprint: 9c1a3f…' http://127.0.0.1:8787/epic-groom
```

---

## `POST /epic-promotion`

Gate 2's press. Adds `status:ready` to every open issue of the milestone standing at
`status:backlog`, removing `status:backlog` from it, and touches no other label, no other issue
and no other field. No request body — the whole checkout is read from the held coordinating
session, the same way `GET /epic-groom` does. Unlike `POST /epic-groom`, it takes no
`x-plan-fingerprint`: it authorises issues that already exist and does not depend on the plan.

**Request header**

| Header | Required | Shape |
|---|---|---|
| `x-gate-key` | yes | the exact value `GET /epic-groom` minted for the page |

**200 OK**

```json
{"status":"authorised",
 "milestone":"The loop enters through brainstorming",
 "issues":[
   {"number":348,"url":"https://github.com/owner/name/issues/348","title":"The intermediate gate retires","status":"ready"},
   {"number":349,"url":"https://github.com/owner/name/issues/349","title":"The session channel","status":"ready"}
 ],
 "promoted":[348,349]}
```

`promoted` names only the issues this press actually moved; it is `[]` when nothing was waiting.

**Refusals**

Checked before anything else, ahead even of whether a session is held:

| `code` | Status | Meaning |
|---|---|---|
| `gate-not-from-the-page` | 403 | `x-gate-key` is missing or does not match the key `GET /epic-groom` minted for the page |

Then, once the key holds:

| `code` | Status | Meaning |
|---|---|---|
| `no-coordinating-session` | 400 | no coordinating session is held: there is nothing to promote |
| `no-epic-issues` | 400 | the milestone holds no issue yet: the groom has to run first |
| `epic-partially-groomed` | 400 | the milestone holds some but not every planned issue: `detail` names how many of how many exist and that the groom has to be finished first — this route's own code, met by no other endpoint |
| `epic-issues-uncertain` | 400 | `gh issue list`'s paging could not be exhausted: `detail` is the same reason `GET /epic-groom`'s `issues-uncertain` body carries — authorising past a page this backend never saw is exactly the defect this code exists to refuse |

None of these five touches a label. From reading the milestone's issues and moving them, once
the five above did not apply, this meets the same `PlanCollapse` codes `POST /epic-groom`
documents above, and it is the only route that can meet `epic-issue-not-promoted`.

`epic-issues-uncertain` is deliberately the same spelling `POST /epic-groom` uses for the identical
situation — one shared code for one shared fact about the milestone's issues, not two routes
independently inventing their own; `backend/__tests__/infrastructure/refusal-codes.test.ts` declares
the sharing on purpose so a future rename of either has to touch both.

```
curl -s -X POST -H 'x-gate-key: 3f9c1a…' http://127.0.0.1:8787/epic-promotion
```

---

## Where the frontend consumes each one

| Endpoint | Client | Types |
|---|---|---|
| `POST /start-plan` | `frontend/src/app/start-plan/client.ts` | `StartPlan.types.ts` |
| `GET /plan-events` | `frontend/src/app/plan-events/client.ts` | `PlanEvents.types.ts` |
| `POST /implement-plan` | `frontend/src/app/implement-plan/client.ts` | `ImplementPlan.types.ts` |
| `GET /implement-progress` | `frontend/src/app/implement-progress/client.ts` | `ImplementProgress.types.ts` |
| `GET /implement-history` | `frontend/src/app/implement-history/client.ts` | `ImplementHistory.types.ts` |
| `GET /active-plans` | `frontend/src/app/active-plans/client.ts` | `ActivePlan.types.ts` |
| `GET /external-tools` | `frontend/src/app/external-tools/client.ts` | `ExternalTools.types.ts` |
| `GET /sessions` | `frontend/src/app/sessions/client.ts` | `Sessions.types.ts` |
| `GET /sessions/:id/stream` | `frontend/src/app/sessions/client.ts` | `Sessions.types.ts` |
| `POST /sessions/:id/input` | `frontend/src/app/sessions/client.ts` | `Sessions.types.ts` |
| `POST /coordinating-session` | `frontend/src/app/coordinating-session/client.ts` | `CoordinatingSession.types.ts` |
| `GET /coordinating-session` | `frontend/src/app/coordinating-session/client.ts` | `CoordinatingSession.types.ts` |
| `POST /groom-session` | `frontend/src/app/epic-groom/client.ts` | `EpicGroom.types.ts` |
| `POST /spec-reslicing` | `frontend/src/app/epic-groom/client.ts` | `EpicGroom.types.ts` |
| `GET /spec-freeze` | `frontend/src/app/spec-freeze/client.ts` | `SpecFreeze.types.ts` |
| `POST /spec-freeze` | `frontend/src/app/spec-freeze/client.ts` | `SpecFreeze.types.ts` |
| `GET /epic-groom` | `frontend/src/app/epic-groom/client.ts` | `EpicGroom.types.ts` |
| `POST /epic-groom` | `frontend/src/app/epic-groom/client.ts` | `EpicGroom.types.ts` |
| `POST /epic-promotion` | `frontend/src/app/epic-groom/client.ts` | `EpicGroom.types.ts` |

A client validates the wire shape before it reaches a component, and projects
snake_case to camelCase. Add a field to the validator, or the component never
sees it.

`GET /external-tools` is rendered by `ToolsStatus`
(`frontend/src/app/external-tools/components/tools-status/`) in the home page's
top bar, which asks it once when it mounts and again when a person presses its
retry button — never on a timer, for the two costs named above. Its path is in
`API_PATHS` (`frontend/vite.config.ts`), so the dev server proxies it instead of
answering the page's HTML.

The three session endpoints are all in `API_PATHS` under the single `/sessions`
entry, which the dev server matches as a prefix, so `/sessions`,
`/sessions/:id/stream` and `/sessions/:id/input` are all proxied instead of
answering the page's HTML.

`POST /session-hooks` has no row above because the page never calls it: Claude
Code calls it on its own, from inside the checkout `POST /coordinating-session`
started. It is still in `API_PATHS` (`frontend/vite.config.ts`), because the
hook runs from the same machine the dev server listens on.

`GET /spec-freeze` and `POST /spec-freeze` do have their rows above: the
cabin's `app/spec-freeze` reads the first every two seconds and presses the
second, and `SpecFreezePanel` is what renders both answers.

## Where the contract is decided

| Concern | File |
|---|---|
| One endpoint's request, refusals and answer | `backend/src/infrastructure/<endpoint>-route.ts` |
| Mounting, the origin filter, the body limit, the last net | `backend/src/infrastructure/api-server.ts`, `http.ts` |
| The `{code, detail}` doctrine | `backend/conventions/this-repository.md` |
| That two endpoints never share a `code` by accident | `backend/__tests__/infrastructure/refusal-codes.test.ts` |
| The step and phase vocabularies | `domain/value-objects/implementation-state.ts`, `infrastructure/active-plans-route.ts` |
