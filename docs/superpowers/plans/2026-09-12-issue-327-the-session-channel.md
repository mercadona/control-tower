# #327 — The session channel

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

The backend owns no process a person can talk to. `backend/src/infrastructure/api-server.ts`
mounts eight endpoints and every one of them reads or writes something outside this process —
GitHub through `gh`, a worktree through `git`, cmux through its own binary. The page
(`frontend/src/pages/home/Home.tsx`) mirrors that: a form, a progress stream over
`GET /plan-events/:issue` and a history panel, and nowhere to type.

This slice adds the channel the rest of the epic hangs off: the backend owns a live terminal,
lists the live ones, streams what they print while they print it, and delivers what the page
types into them. It is additive — no existing endpoint, body, code or answer changes.

### Desired end state

- `GET /sessions` answers `{"sessions":[{"id":"…","name":"…"}]}` with the sessions the backend
  owns right now, each named by the program it runs.
- `GET /sessions/:id/stream` is a Server-Sent Events stream: its first frame carries the
  session's scrollback and each later frame carries the bytes the process just printed.
- `POST /sessions/:id/input` with `{"text":"…"}` writes that text into the process.
- `ct-api.ts` opens one terminal session at start-up and owns it. Closing the page ends the
  stream and nothing else: the process, its scrollback and its row in `GET /sessions` survive,
  and a second subscription replays the scrollback.
- The page renders that session in a real terminal emulator, lists the live sessions and sends
  every keystroke to the backend.

### Out of scope

- 🚫 **the eight existing endpoints and their contracts** — `POST /start-plan`,
  `POST /implement-plan`, `POST /review-plan`, `GET /plan-events/:issue`, `GET /active-plans`,
  `GET /implement-progress/:issue`, `GET /implement-history/:issue` and `GET /external-tools`
  keep their paths, bodies, codes and answers untouched.
- Which command a session runs beyond the developer's login shell: the coordinating session —
  `claude` with its phase prompt, its governed checkout and its hooks — is slice #3.
- The second frame kind of the envelope (`event`, one stream-json event): its producer is the
  headless transport of slice #6, and nothing reads it today.
- Resizing a terminal, and any endpoint that opens or kills a session.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 | **D-1 · The entrance is a conversation with a real terminal** — the cabin hosts the brainstorming and spec session as an interactive `claude` in a PTY streamed to the page, not a structured chat and not a step left outside the app. |
| D-2 | **D-2 · The backend automates the coordination between issues and controls the agents' sessions** — `/start-plan` does what `/ct-next` does, inside the backend, with `claude -p`. The backend is a **program**, not a session and not a model: it selects the next issue, checks its dependencies, prepares its execution and chains the work. The sessions do not disappear and neither do the agents that do the work inside a slice — the backend owns and drives them. |
| D-3 | **D-3 · There is no human gate between the plan and its implementation** — the authorisation is GATE 2 and the earlier gates are respected. |
| D-4 | **D-4 · The slices run one after another and nobody is asked which is next** — the order was decided once in the slices table and the dispatcher derives the rest. |
| D-5 | **D-5 · One slice in flight and the relay at the pull request** — the `--cap` frees when the pull request opens while `area:` and `touches:` stay held until the merge, so a merge only holds back what depends on it. |
| D-6 | **D-6 · Gates 1 and 2 are acts of the app, with its own yardstick** — the freeze and the promotion are buttons the program answers for, never lines the conversation's agent writes. |
| D-7 | **D-7 · GATE 3 is entirely human and stays on GitHub** — the merge is the only act with a permanent external effect and no program performs it: a person merges on GitHub, and all the app does is notice, by sweeping, so that it can dispatch whatever the merge unblocked. The app never writes to a pull request, there is no merge button anywhere in the cabin, and no automation may acquire one without reopening this decision. |
| D-8 | **D-8 · The plan review retires and the review is the pull request** — the slice's plan is written by its agent and judged by `ct-judge` against its issue; a person reads it in the diff. |
| D-9 | **D-9 · A slice has a tab that shows its session and takes a message** — with the implementation headless there is no screen to mirror, so the tab renders the calls' stream and writing is a message into the live conversation. |
| D-10 | **D-10 · Everything new under `backend/` is TypeScript** — and the plugin stays JavaScript, which is the repository's own rule for what the plugin ships. |
| D-11 | **D-11 · A yardstick is imported from the plugin, never reimplemented** — `analyzeSpecFreeze` and `analyzeSlicesTable` are the freeze's yardstick and `ct-groom.mjs` is the groom; the backend grows no second opinion about whether a spec is freezable. |
| D-12 | **D-12 · The conductor is not duplicated** — which step comes next is decided by the run machine behind `ct-step`; the backend owns the process and is not a second automaton. |
| D-13 | **D-13 · No phase is stored** — every phase is derived from evidence that survives a restart: the spec and its state line, the milestone and its issues, a `status:ready` label, a worktree, a record, a pull request, a closed issue. |
| D-14 | **D-14 · The `plan` gate stops being implied, and control-tower keeps the two gates it was born with** — `gatesForType` adds `plan` to every slice of every epic whatever its `Tipo`, which is the opposite of D-3. That default is removed. Only `visual` and `apply` survive as human gates. The protocol behind the go is **not** retired in this epic: it is documented as debt in A-3 and retired in later work, so that this one can be built without touching the distributed plugin beyond that single line. |
| D-15 | **D-15 · The plan is published as a comment on the issue, and nothing waits for an answer** — the comment exists for tracking, which is what the `plan` gate's text used to achieve as a side effect of stopping. The backend posts it after the plan step, because it owns the sequence and already drives `gh`; the agent does not stop and no go is minted, read or expected. |
| D-16 | **D-16 · cmux leaves the backend** — with the launch headless, recovery reads the records under the state root: the record is the plan in flight and the process being alive is not what makes it recoverable. No module under `backend/src` names cmux, and it stops being probed as an external tool. |
| D-17 | **D-17 · The record is written once and never mutated** — its absence is the whole of "not prepared", so there is no lock, no revision and no owner pid. |
| D-18 | **D-18 · There is a coordinating session and it is the boss of all of them** — the entrance conversation does not die at the freeze: it stays as the milestone's coordinator and the human's single interlocutor, the one that orders the start, carries the changes asked on a pull request and unblocks what is stuck, implementations included. What it never does is decide the order or the phase — that is the program's, exactly as in the plugin, where the coordinating session runs `/ct-next` and `ct-next.mjs` is what decides. It commands by invoking the backend's endpoints and the plugin's programs, while the backend owns the processes, makes the call of each step, keeps the record and measures. So there is a session above every other one, and still no model in the critical path of the automatic chain. |
| D-19 | **D-19 · One conversation per slice, and one call per step of the run machine** — the backend asks `ct-step next`, makes the `claude -p --resume` call of the step that is due, and runs the verb that consumes what the call produced. `run-machine.js` stays the only sequencer: no step order is written in the backend, and a verb out of turn is still the machine's exit 9 rather than a backend decision. Three consequences that are part of the decision: the judge becomes its own call, so it reports its own cost — the argv of `judge-dispatch.js` is the reference shape; the attempt row of `docs/superpowers/metrics/issue-<n>.jsonl` can carry cost and turns, which is what the bet promises and what a subagent cannot report (`ct-step.mjs:53`); and the agent is never again told to ask `ct-step`, so a task's call implements that task with TDD and dispatches no subagent of its own. This is phase 4 of issue #139 and it is a slice of its own. |
| D-20 | **D-20 · A change asked on a pull request travels through the coordinating session** — you tell the boss and the boss makes it happen: it asks the backend to resume that slice's conversation with the change. The sweep of the pull request's own comments stays as the second channel, for a reviewer who writes on GitHub instead of talking to the cabin. |
| D-21 | **D-21 · The coordinating session is always in the front, and it is recoverable** — the cabin offers a place to talk to it in **every** phase, and most explicitly once the implementation is running: no phase of the page may hide it, replace it with a progress panel or disable its input. It is the same property the original plugin has for free, where the coordinator's terminal never goes away while slices work. Talking to it must not disturb what is being implemented, which it cannot: the slices' conversations are other sessions and their calls are the backend's. And getting it back is a requirement rather than a convenience — two different losses with two different answers, a page reload replaying what was already said and a backend restart bringing the conversation back by resuming it. A conversation that cannot be resumed is said out loud; the cabin never opens a different one and presents it as the same. |
| D-24 | **D-24 · The coordinating session can talk to every session it did not launch** — the backend is what spawns and drives them, so the boss is given the other half: it knows which conversations are live and can deliver a message into any of them, and read what came back, asking the backend, which stays the owner of the processes. The plugin already works this way — a coordinator reaches a slice with `cmux send --workspace workspace:97` — and this is the same property without cmux. It is also the mechanism D-20 needs: the change you ask of the boss reaches that slice because the boss can address it by name. |
| D-25 | **D-25 · The context of every call is composed by the plugin and relayed verbatim, never paraphrased by the backend** — `ct-step next` is already the composer and the dispatch order at once: it writes the task's brief with `task-brief --with-plan-context` (the desired end state, the out of scope and the two yardstick sections, whose authority split the script documents), it appends the plugin's yardstick, the repository's yardstick and, on a third attempt, the advisor's advice inside the brief; it writes the review package with `review-package` on the task's **recorded base** rather than `HEAD~1`, so a multi-commit task stays whole; and it prints whom to dispatch, with which model and which tools and which files. The backend hands over **those paths** and pastes none of that text into a prompt, which is the property `task-brief` exists for — "so the task text never has to be pasted through the controller's context". The role material per step is what `role-bytes.js` declares, the tools and models and package sections are what `step-contracts.js` declares, and the judge travels with the plugin's own definition the way judge-bench composes it (`--agents <json> --agent <name>`), so no judge prompt is ever written in the backend. The answer's schema is imposed by the binary with `--json-schema`, which only exists in `--print` mode and which `step-contracts.js:14-16` records as lost when the conductor stopped being headless: D-19 gets it back, so the verdict, the report, the advice and the e2e stop being asked for in prose. If `ct-step next` asks for a dispatch the backend cannot assemble from what it prepared, the backend refuses instead of improvising a prompt. |
| D-23 | **D-23 · After the freeze the app publishes the spec, and the groom waits for its merge** — pressing gate 1 commits the state line and then does what a person would do next: push the epic's branch and open its pull request with the design and the spec in it. The groom stays refused until the spec's committed copy is readable on the **default** branch, and what achieves that is the human merging that pull request — not a fourth gate, but D-7 again: the app never merges. The reason the branch is not enough is written in `spec-link.js`: the issue's link resolves against the default branch on purpose, because a feature branch is deleted on merge and the link would rot. Grooming earlier gives every issue a text reference instead of a link, and fixing it afterwards needs `--reconcile`, which the plugin marks experimental. |
| D-22 | **D-22 · The gates are the human's and no session can trigger them** — the coordinating session commands the backend, but not here: writing `Estado: CONGELADA`, promoting to `status:ready` and anything around the merge are triggered only from the front, by a person's click. There is no endpoint for them that a session can call, and an attempt is refused with an explicit code rather than obeyed. Everything else does travel through the boss: starting work already authorised, asking for changes, unblocking what is stuck. This is the repository's own doctrine — the go the agent cannot write — applied to the coordinator now that it has hands. |
| P-1 | The port `LiveSessions` is **synchronous**. It does no input/output: the backend already owns the processes in this process's memory, so `all`, `find`, `watch` and `write` return without a promise, and the stream route can write its headers between finding the session and receiving its first byte. |
| P-2 | A stream frame carries **bytes and nothing else** — `data: {"bytes":"…"}`. No `kind` field is declared until slice #6 brings the producer of the second kind: today nothing would read it, and `conventions/simplicity.md` puts the burden of proof on what is added. |
| P-3 | **The page never opens or kills a session.** `ct-api.ts` opens the one terminal session at start-up and owns it; the cabin subscribes. There is no `POST /sessions`, no delete, and no command travelling from the browser. |
| P-4 | The terminal is a real PTY through **`node-pty`, pinned to `1.0.0`**, which builds from source and leaves its `spawn-helper` executable. `1.1.0` ships a prebuilt `spawn-helper` with mode `644` on darwin and `posix_spawnp` then fails at run time. |
| P-5 | The page renders the stream with **`@xterm/xterm` (`^6.0.0`)**. Its tests double it with `vi.mock('@xterm/xterm', …)`: jsdom cannot measure a terminal, and what the test owes is that the bytes reached it. |
| P-6 | The session the backend opens is **`$SHELL -il`** with `TERM=xterm-256color`, 80 columns, 24 rows, in the backend's own working directory. `$SHELL` unset falls back to `/bin/sh`. The name of a session is the basename of that program. |
| P-7 | The scrollback is **262144 characters**, oldest dropped first. It is what a second subscriber receives as its first frame, and the only reason the backend keeps anything a session printed. |
| P-8 | Product copy on the page is **Spanish**; identifiers, test names, log lines and every other string are **English**, as `AGENTS.md` rules. |
| P-9 | An unknown or dead session id is refused with the code **`session-not-live`**, shared on purpose between the stream's and the input's vocabularies and declared as such in `refusal-codes.test.ts`. |

## 3. Reference patterns

Files to imitate:

- `backend/src/infrastructure/plan-events-route.ts` — a Server-Sent Events route with its
  request model, its closed vocabulary of outcomes, its refusal projection and its
  disconnection watcher.
- `backend/src/infrastructure/external-tools-route.ts` — a `GET` route over a single query.
- `backend/src/infrastructure/review-plan-route.ts` — a `POST` route that parses a JSON body,
  refuses unknown fields and projects every outcome to a `Refusal`.
- `backend/src/application/queries/survey-external-tools.ts` — a query, its result object and
  the port it hands its work to.
- `backend/src/domain/ports/tool-sessions.ts` — a port whose methods refuse until an adapter
  implements them.
- `backend/src/domain/value-objects/tool-session.ts` — an immutable value object that validates
  in its constructor and freezes itself.
- `backend/src/infrastructure/probed-tool-sessions.ts` — an adapter that extends its port and
  takes every collaborator by name through the constructor.
- `backend/src/infrastructure/tool-runner.ts` — the module that owns a child process.
- `backend/__tests__/infrastructure/tool-runner-real-process.test.ts` — a test that spawns for
  real, with the suffix that says so.
- `frontend/src/app/plan-events/client.ts` — an `EventSource` client with a listener object.
- `frontend/src/app/external-tools/useExternalTools.ts` — a hook over a client.
- `frontend/src/app/implement-progress/components/implement-progress/ImplementProgress.tsx` —
  a component with its `.css` and its `index.ts` beside it.

Rules to obey:

- `AGENTS.md` — English everywhere except what a person reads on the page, which is Spanish;
  and no repository control is routed around.
- `CLAUDE.md` — the same text, carried twice on purpose.
- `backend/conventions/this-repository.md` — no declared debt here, TypeScript with erasable
  syntax only, relative imports naming the real extension, `{code, detail}` refusals in
  kebab-case with 400 for anything the application judged, the layout under `src/`, one
  controller per endpoint, and where the suite runs.
- `backend/API.md` — the rules every endpoint of this API already answers by.
- `frontend/README.md` — no semicolons, named exports, absolute imports from `src/`, one
  component per file, BEM, the design system's mirrors under `src/system-ui/`, Spanish labels,
  and the yardstick `frontend/__tests__/yardstick.test.ts` measures on every file.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/live-session.ts` | create | the port, the query, both routes, the page | Contract (T1) |
| `backend/src/domain/ports/live-sessions.ts` | create | `ListLiveSessions`, `WatchLiveSession`, `TypeIntoSession`, both request models | Contract (T1) |
| `backend/src/application/queries/list-live-sessions.ts` | create | `SessionsRoute` | Contract (T1) |
| `backend/src/infrastructure/sessions-route.ts` | create | `api-server.ts` | Contract (T1) |
| `backend/src/infrastructure/api-server.ts` | modify | `ct-api.ts` | Current state + Call site (T1, T4, T5) |
| `backend/__tests__/infrastructure/sessions-route.test.ts` | create | the suite | none (body by TDD) (T1) |
| `backend/__tests__/application/list-live-sessions.test.ts` | create | the suite | none (body by TDD) (T1) |
| `backend/src/infrastructure/pty-live-sessions.ts` | create | `ct-api.ts` | Contract (T2) |
| `backend/__tests__/infrastructure/pty-live-sessions.test.ts` | create | the suite | none (body by TDD) (T2) |
| `backend/src/infrastructure/ct-api.ts` | modify | `make run-backend` | Call site (T3, T10) |
| `backend/package.json` | modify | the install | prose (config) (T3) |
| `backend/package-lock.json` | modify | the install | prose (config) (T3) |
| `backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts` | create | the suite | none (body by TDD) (T3) |
| `backend/src/application/queries/watch-live-session.ts` | create | `SessionStreamRoute` | Contract (T4) |
| `backend/src/infrastructure/session-stream-route.ts` | create | `api-server.ts` | Contract (T4) |
| `backend/__tests__/infrastructure/session-stream-route.test.ts` | create | the suite | none (body by TDD) (T4) |
| `backend/__tests__/application/watch-live-session.test.ts` | create | the suite | none (body by TDD) (T4) |
| `backend/src/application/actions/type-into-session.ts` | create | `SessionInputRoute` | Contract (T5) |
| `backend/src/infrastructure/session-input-route.ts` | create | `api-server.ts` | Contract (T5) |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | the codes guard | Current state (T5) |
| `backend/__tests__/infrastructure/session-input-route.test.ts` | create | the suite | none (body by TDD) (T5) |
| `backend/__tests__/application/type-into-session.test.ts` | create | the suite | none (body by TDD) (T5) |
| `backend/__tests__/infrastructure/session-channel-real-process.test.ts` | create | `ct-step global` | none (body by TDD) (T10) |
| `docs/superpowers/plans/2026-09-12-issue-327-the-session-channel.md` | modify | the pull request | prose (T10) |
| `frontend/src/app/sessions/Sessions.types.ts` | create | the client, the hook, both components | Contract (T6) |
| `frontend/src/app/sessions/client.ts` | create | `useLiveSessions`, `SessionTerminal` | Contract (T6) |
| `frontend/src/app/sessions/useLiveSessions.ts` | create | `SessionsPanel` | Contract (T6) |
| `frontend/src/__scenarios__/SessionsMother.ts` | create | the page's suites | none (body by TDD) (T6) |
| `frontend/vite.config.ts` | modify | the dev server | Current state (T6) |
| `frontend/src/app/sessions/client.test.ts` | create | the suite | none (body by TDD) (T6) |
| `frontend/src/app/sessions/useLiveSessions.test.ts` | create | the suite | none (body by TDD) (T6) |
| `frontend/src/app/sessions/components/session-terminal/SessionTerminal.tsx` | create | `SessionsPanel` | Contract (T7) |
| `frontend/src/app/sessions/components/session-terminal/SessionTerminal.css` | create | the component | none (body by TDD) (T7) |
| `frontend/src/app/sessions/components/session-terminal/index.ts` | create | `SessionsPanel` | none (body by TDD) (T7) |
| `frontend/package.json` | modify | the install | prose (config) (T7) |
| `frontend/package-lock.json` | modify | the install | prose (config) (T7) |
| `frontend/src/app/sessions/components/session-terminal/SessionTerminal.test.tsx` | create | the suite | none (body by TDD) (T7) |
| `frontend/src/app/sessions/components/sessions-panel/SessionsPanel.tsx` | create | `Home` | Contract (T8) |
| `frontend/src/app/sessions/components/sessions-panel/SessionsPanel.css` | create | the component | none (body by TDD) (T8) |
| `frontend/src/app/sessions/components/sessions-panel/index.ts` | create | `Home` | none (body by TDD) (T8) |
| `frontend/src/pages/home/Home.tsx` | modify | the page | Current state + Call site (T8) |
| `frontend/src/pages/home/Home.css` | modify | the page | none (body by TDD) (T8) |
| `frontend/src/app/sessions/components/sessions-panel/SessionsPanel.test.tsx` | create | the suite | none (body by TDD) (T8) |
| `frontend/src/pages/home/__tests__/Home.sessions.test.tsx` | create | the suite | none (body by TDD) (T8) |
| `frontend/src/app/sessions/components/session-terminal/SessionTerminal.test.tsx` | modify | the suite | none (body by TDD) (T8) |
| `backend/API.md` | modify | whoever codes against this API | Final text (T9) |
| `backend/conventions/this-repository.md` | modify | every agent working here | Final text (T9) |
| `frontend/README.md` | modify | whoever works on the page | prose (T9) |

## 5. Interfaces

Consumes: N/A — the issue declares no "## Dependencias" section and its row in the slices table
carries `Dep: –`. Nothing merged before this slice conditions it.

Produces:

- `LiveSession` — an immutable value object with `readonly id: string` and
  `readonly name: string`, built from `{ id, name }` and refusing either one blank.
- `LiveSessionStream` — `{ readonly printed: string, readonly stop: () => void }`, what
  subscribing answers.
- `LiveSessions` — the port: `all(): LiveSession[]`, `find(id: string): LiveSession | null`,
  `watch({ session, onBytes }: { session: LiveSession, onBytes: (bytes: string) => void }): LiveSessionStream`,
  `write({ session, text }: { session: LiveSession, text: string }): void`.
- `PtyLiveSessions` — the adapter, plus its own verb `open(): LiveSession`, which slice #3 calls
  again with the command of the coordinating session.
- `GET /sessions`, `GET /sessions/:id/stream`, `POST /sessions/:id/input` — the wire contract
  slices #3 and #8 render.
- `SessionsClient.list(): Promise<SessionsOutcome>`,
  `SessionsClient.watch(id: string, listener: SessionStreamListener): SessionStreamSubscription`,
  `SessionsClient.type(id: string, text: string): Promise<void>` — the page's half.

## 6. Test strategy

Outside-in with the port doubled, which is the epic's rule and this backend's. Every route test
builds an `ApiServer` over a stub `LiveSessions` and asserts on the wire: the body of
`GET /sessions`, the frames of the stream, the text the stub was written, the refusal's `code`.
The adapter's own test doubles the spawner — a fake terminal object with `onData`, `onExit`,
`write` and `kill` — so the scrollback, the fan-out and the removal of an exited session are
driven red without a process. One test spawns for real,
`pty-live-sessions-real-process.test.ts`, and it is the only one that does: it proves a real
`node-pty` prints, receives what is written to it and outlives the end of a subscription, and it
kills its child in `afterEach`, including on a failed assertion. No new test asks for cmux.

On the page, the client is tested against a stubbed `fetch` and a fake `EventSource` — the one
`frontend/src/pages/home/__tests__/FakeEventSource.ts` already provides — and the components
against a doubled `@xterm/xterm`, asserting that the bytes the stream delivered reached the
terminal and that a keystroke reached the client.

Commands, the three the epic's context declares: `npm --prefix backend run typecheck`,
`npm --prefix backend test`, `npm --prefix frontend test`.

## 7. Tasks

### Task 1 — The live sessions the backend lists

**Objective:** `GET /sessions` answers the sessions the backend owns, each one named.

**Files:** `backend/src/domain/value-objects/live-session.ts` (create),
`backend/src/domain/ports/live-sessions.ts` (create),
`backend/src/application/queries/list-live-sessions.ts` (create),
`backend/src/infrastructure/sessions-route.ts` (create),
`backend/src/infrastructure/api-server.ts` (modify),
`backend/__tests__/infrastructure/sessions-route.test.ts` (create),
`backend/__tests__/application/list-live-sessions.test.ts` (create)

Contract (backend/src/domain/value-objects/live-session.ts):

```ts
export class LiveSession {
  readonly id: string
  readonly name: string
  constructor({ id, name }: { id: unknown, name: unknown })
}
```

Contract (backend/src/domain/ports/live-sessions.ts):

```ts
export type LiveSessionStream = { readonly printed: string, readonly stop: () => void }

export class LiveSessions {
  all(): LiveSession[]
  find(id: string): LiveSession | null
  watch({ session, onBytes }: { session: LiveSession, onBytes: (bytes: string) => void }): LiveSessionStream
  write({ session, text }: { session: LiveSession, text: string }): void
}
```

Contract (backend/src/application/queries/list-live-sessions.ts):

```ts
export class ListLiveSessionsResult {
  readonly sessions: readonly LiveSession[]
}
export class ListLiveSessions {
  constructor({ liveSessions }: { liveSessions: LiveSessions })
  execute(): ListLiveSessionsResult
}
```

Contract (backend/src/infrastructure/sessions-route.ts):

```ts
export class SessionsRoute {
  static readonly PATH = '/sessions'
  static readonly METHOD = 'GET'
  static handledBy(listLiveSessions: ListLiveSessions): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

Current state (backend/src/infrastructure/api-server.ts):

```ts
    app.all(ExternalToolsRoute.PATH, ExternalToolsRoute.refuseOtherMethods)
```

The port's methods refuse with `${this.constructor.name} must implement …`, as
`tool-sessions.ts` does; `LiveSession` freezes itself. `ApiServer` gains a `listLiveSessions`
collaborator and mounts `SessionsRoute`'s `app.get` + `app.all` pair, in the shape of the cited
lines, just before `app.use(Failures.nothingMatched)`. The answer is `200`
`{"sessions":[{"id":"…","name":"…"}]}`, in the port's order.

**TDD:** red first with
`it('the live sessions the backend owns are listed with their names')` — a port holding two
sessions answers both, in its own order, each as `{id, name}` and nothing else.

**Tests:** added — in `sessions-route.test.ts`:
`it('the live sessions the backend owns are listed with their names')`,
`it('no live session is an empty list and not a refusal')`,
`it('a method other than GET is refused naming GET as the allowed one')`;
in `list-live-sessions.test.ts`: `it('the query answers what the port holds')`,
`it('a live session refuses a blank id')`, `it('a live session refuses a blank name')`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the new modules type-check
npm --prefix backend test -- __tests__/infrastructure/sessions-route.test.ts   # expected: exit 0 — the route suite exists and is green
npm --prefix backend test -- __tests__/application/list-live-sessions.test.ts   # expected: exit 0 — the query suite exists and is green
npm --prefix backend test   # expected: exit 0 — no existing endpoint broke
```

### Task 2 — The terminal the backend owns

**Objective:** an adapter owns terminals, keeps each one's scrollback and fans its bytes out to
whoever is watching.

**Files:** `backend/src/infrastructure/pty-live-sessions.ts` (create),
`backend/__tests__/infrastructure/pty-live-sessions.test.ts` (create)

Contract (backend/src/infrastructure/pty-live-sessions.ts):

```ts
export type Terminal = {
  onData(listener: (bytes: string) => void): void,
  onExit(listener: () => void): void,
  write(text: string): void,
}
export type TerminalSpawn = (file: string, argv: string[], options: {
  name: string, cols: number, rows: number, cwd: string, env: Record<string, string>,
}) => Terminal
export class PtyLiveSessions extends LiveSessions {
  static readonly TERM = 'xterm-256color'
  static readonly COLUMNS = 80
  static readonly ROWS = 24
  static readonly LOGIN_INTERACTIVE = '-il'
  static readonly FALLBACK_SHELL = '/bin/sh'
  static readonly SCROLLBACK_CHARACTERS = 262144
  constructor({ spawn, shell, cwd, env, newId, stderr }: {
    spawn: TerminalSpawn, shell: string | undefined, cwd: string, env: NodeJS.ProcessEnv,
    newId: () => string, stderr: (line: string) => void })
  open(): LiveSession
}
```

`open()` spawns `<shell> -il` with `cols`, `rows` and `name` from the constants above, mints the
id with `newId`, names the session after the basename of the shell and remembers it. Every chunk
`onData` brings is appended to that session's scrollback — trimmed from the front to the last
`SCROLLBACK_CHARACTERS` — and handed to every live watcher. `watch` answers the scrollback as
`printed` plus a `stop` that removes only that watcher. `onExit` forgets the session, so `find`
and `all` stop naming it. The environment is `env` with its undefined entries dropped and `TERM`
forced to `PtyLiveSessions.TERM`. One `stderr` line on open and one on exit, each naming the id
and the program, so whoever runs `make run-backend` can tell a live cabin terminal from a dead
one.

**TDD:** red first with
`it('a watcher receives what the terminal printed before it arrived')` — a doubled spawn emits
two chunks, then a watcher arrives and its `printed` is both chunks joined, in order.

**Tests:** added — in `pty-live-sessions.test.ts`:
`it('opening names the session after the program it runs')`,
`it('a watcher receives what the terminal printed before it arrived')`,
`it('two watchers of one session both receive the next bytes')`,
`it('a stopped watcher receives nothing more and the session stays live')`,
`it('the scrollback keeps the last 262144 characters and drops the oldest')` — one case at
exactly the limit, which drops nothing, and one at the limit plus one character, which drops
exactly the first;
`it('a session whose terminal exited is neither found nor listed')`,
`it('what is written reaches the terminal')`,
`it('the shell is the login interactive one, and /bin/sh when SHELL is unset')`,
`it('the environment carries TERM and no undefined entry')`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/pty-live-sessions.test.ts   # expected: exit 0 — the doubled-spawn suite is green
npm --prefix backend test   # expected: exit 0
```

### Task 3 — The real terminal, opened at start-up

**Objective:** `make run-backend` opens a real PTY the cabin can list, and it outlives every
watcher.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify), `backend/package.json` (modify),
`backend/package-lock.json` (modify),
`backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts` (create),
`backend/__tests__/infrastructure/ct-api-real-process.test.ts` (modify)

Call site (backend/src/infrastructure/ct-api.ts):

```ts
const liveSessions = new PtyLiveSessions({
  spawn, shell: environment.SHELL, cwd: process.cwd(), env: environment,
  newId: randomUUID, stderr: (line) => process.stderr.write(line),
})
liveSessions.open()
```

Configuration: `backend/package.json` adds `"node-pty": "1.0.0"` to `dependencies` — the exact
version, no caret, for the reason in P-4 — and the lockfile is regenerated with
`npm --prefix backend install`. `ct-api.ts` imports `spawn` from `node-pty`, builds
`liveSessions` as above before the `ApiServer` is constructed, opens the session, and passes
`listLiveSessions: new ListLiveSessions({ liveSessions })` to `ApiServer`.

**TDD:** red first with
`it('a real terminal prints into the scrollback and answers what is written to it')` — the real
`node-pty` is injected as the spawn, `echo` is written into it and the scrollback ends up
carrying what it echoed.

**Tests:** added — in `pty-live-sessions-real-process.test.ts`:
`it('a real terminal prints into the scrollback and answers what is written to it')`,
`it('the real process stays alive after every watcher has stopped')` — the suite keeps every pty
it spawned and kills each one in `afterEach`, so a failed assertion leaks nothing.

**Verification:**

```bash
npm --prefix backend test -- __tests__/infrastructure/pty-live-sessions-real-process.test.ts   # expected: exit 0 — a real pty prints and answers
test -x backend/node_modules/node-pty/build/Release/spawn-helper   # expected: exit 0 — node-pty built from source, so its helper is executable
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test   # expected: exit 0
```

### Task 4 — The stream that reaches the page while the process runs

**Objective:** `GET /sessions/:id/stream` opens with what the session already printed and then
carries every byte it prints; closing it kills nothing.

**Files:** `backend/src/application/queries/watch-live-session.ts` (create),
`backend/src/infrastructure/session-stream-route.ts` (create),
`backend/src/infrastructure/api-server.ts` (modify),
`backend/__tests__/infrastructure/session-stream-route.test.ts` (create),
`backend/__tests__/application/watch-live-session.test.ts` (create)

Contract (backend/src/application/queries/watch-live-session.ts):

```ts
export class WatchLiveSessionParams {
  readonly session: LiveSession
  readonly onBytes: (bytes: string) => void
}
export class WatchLiveSessionResult {
  readonly printed: string
  readonly stop: () => void
}
export class WatchLiveSession {
  constructor({ liveSessions }: { liveSessions: LiveSessions })
  execute(params: WatchLiveSessionParams): WatchLiveSessionResult
}
```

Contract (backend/src/infrastructure/session-stream-route.ts):

```ts
export const SessionStreamOutcome = Object.freeze({ NOT_LIVE: 'session-not-live' } as const)

export class SessionStreamRoute {
  static readonly PATH = '/sessions/:id/stream'
  static readonly METHOD = 'GET'
  static readonly ID_PARAMETER = 'id'
  static frameFor(bytes: string): string
  static notLive(): Refusal
  static handledBy(liveSessions: LiveSessions, watchLiveSession: WatchLiveSession): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

A frame is `data: ${JSON.stringify({ bytes })}\n\n`, under the three headers
`PlanEventsRoute` already sends. The handler asks `liveSessions.find` for the `:id`; `null` is
`Answer.refuseAs(response, SessionStreamRoute.notLive())`, a 400 saying no live session answers
to that id. Otherwise: the headers, **then** the subscription through `WatchLiveSession` with an
`onBytes` that writes a frame, **then** one frame with the `printed` it answered — subscribing
before printing is what makes a gap impossible, and `printed` was captured at subscription, so
nothing repeats. `request.on('close', …)` calls `stop()` and ends the response, and nothing
else: the port is never told to kill anything, which is the whole of "closing the page does not
kill the session". `ApiServer` gains a `watchLiveSession` collaborator and mounts its pair
beside Task 1's.

**TDD:** red first with
`it('the stream opens with what the session already printed')` — a session whose `printed` is
`hola` answers a first frame `data: {"bytes":"hola"}`.

**Tests:** added — in `session-stream-route.test.ts`:
`it('the stream opens with what the session already printed')`,
`it('bytes printed while the stream is open reach it as they are printed')`,
`it('closing the stream stops only that watch and leaves the session live')`,
`it('an unknown id is refused with session-not-live')`,
`it('a method other than GET is refused naming GET as allowed')`;
in `watch-live-session.test.ts`:
`it('watching hands the port the session and answers what it printed')`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/session-stream-route.test.ts   # expected: exit 0 — the stream suite is green
npm --prefix backend test -- __tests__/application/watch-live-session.test.ts   # expected: exit 0 — the query suite is green
npm --prefix backend test   # expected: exit 0
```

### Task 5 — The input the page types

**Objective:** `POST /sessions/:id/input` writes what the page typed into the session.

**Files:** `backend/src/application/actions/type-into-session.ts` (create),
`backend/src/infrastructure/session-input-route.ts` (create),
`backend/src/infrastructure/api-server.ts` (modify),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify),
`backend/__tests__/infrastructure/session-input-route.test.ts` (create),
`backend/__tests__/application/type-into-session.test.ts` (create)

Contract (backend/src/application/actions/type-into-session.ts):

```ts
export class TypeIntoSessionParams {
  readonly session: LiveSession
  readonly text: string
}
export class TypeIntoSession {
  constructor({ liveSessions }: { liveSessions: LiveSessions })
  execute(params: TypeIntoSessionParams): void
}
```

Contract (backend/src/infrastructure/session-input-route.ts):

```ts
export const SessionInputOutcome = Object.freeze({
  ACCEPTED: 'accepted', BODY_NOT_A_JSON_OBJECT: 'body-not-a-json-object',
  UNKNOWN_FIELD: 'unknown-field', MALFORMED_TEXT: 'malformed-text',
  NOT_LIVE: 'session-not-live',
} as const)

export class SessionInputRoute {
  static readonly PATH = '/sessions/:id/input'
  static readonly METHOD = 'POST'
  static readonly TEXT_FIELD = 'text'
  static handledBy(liveSessions: LiveSessions, typeIntoSession: TypeIntoSession): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

`SessionInputRequest` parses the body and `SessionInputRefusal` projects each outcome, in the
shape `review-plan-route.ts` uses. The one known field is `text`: a non-empty string, no control
character forbidden — an arrow key and a `Ctrl-C` are what a terminal is typed. The `:id` goes
through `liveSessions.find`; `null` refuses `session-not-live`. The answer
is `202` `{"status":"typed","id":"…"}`. `ApiServer` mounts it with `JsonBody.demandDeclared` and
`JsonBody.reader()`, as the other `POST`s. In `refusal-codes.test.ts`,
`RequestVocabularies.codes()` gains both new vocabularies and
`SharedOnPurposeAcrossRequestVocabularies.CODES` gains
`SessionInputOutcome.BODY_NOT_A_JSON_OBJECT`, `.UNKNOWN_FIELD` and `.NOT_LIVE`.

**TDD:** red first with `it('the text typed on the page reaches the session')` — a body of
`{"text":"ls\r"}` writes exactly `ls\r` into that session.

**Tests:** added — in `session-input-route.test.ts`:
`it('the text typed on the page reaches the session')`,
`it('a lone carriage return is text and reaches the session')` and
`it('an empty text is refused with malformed-text')` — the boundary's two sides;
`it('an unknown id is refused as session-not-live')`,
`it('an unknown field is refused naming it')`,
`it('a method other than POST is refused naming POST as allowed')`;
in `type-into-session.test.ts`: `it('the action hands the port the session and the text')`.

**Verification:**

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/session-input-route.test.ts   # expected: exit 0 — the input suite is green
npm --prefix backend test -- __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0 — no code shared by accident
npm --prefix backend test   # expected: exit 0
```

### Task 6 — The page's half of the channel

**Objective:** the page lists the live sessions, subscribes to one and sends text into it.

**Files:** `frontend/src/app/sessions/Sessions.types.ts` (create),
`frontend/src/app/sessions/client.ts` (create),
`frontend/src/app/sessions/useLiveSessions.ts` (create),
`frontend/src/__scenarios__/SessionsMother.ts` (create), `frontend/vite.config.ts` (modify),
`frontend/src/app/sessions/client.test.ts` (create),
`frontend/src/app/sessions/useLiveSessions.test.ts` (create)

Contract (frontend/src/app/sessions/Sessions.types.ts):

```ts
export type LiveSession = { id: string; name: string }

export type SessionsOutcome =
  | { kind: 'loaded'; sessions: LiveSession[] }
  | { kind: 'unavailable' }

export type SessionFailure = { code: string; detail: string }

export type SessionStreamListener = {
  onBytes: (bytes: string) => void
  onFailure: (failure: SessionFailure) => void
  onUnreachable: () => void
}

export type SessionStreamSubscription = { close: () => void }
```

Contract (frontend/src/app/sessions/client.ts):

```ts
export const SessionsClient: {
  list(): Promise<SessionsOutcome>
  watch(id: string, listener: SessionStreamListener): SessionStreamSubscription
  type(id: string, text: string): Promise<void>
}
```

Contract (frontend/src/app/sessions/useLiveSessions.ts):

```ts
export type LiveSessionsState =
  | { status: 'loading' }
  | { status: 'loaded'; sessions: LiveSession[] }
  | { status: 'unavailable' }
export const useLiveSessions: () => LiveSessionsState
```

Current state (frontend/vite.config.ts):

```ts
const BACKEND = 'http://127.0.0.1:8787'
```

`API_PATHS` gains `'/sessions'` — one entry: vite proxies by prefix and the stream and the input
hang off it. `list()` is `fetch('/sessions')` and validates the wire shape before a component
sees it, as `external-tools/client.ts` does: anything but an array of `{id, name}` strings is
unavailable. `watch()` opens
`new EventSource(\`/sessions/${encodeURIComponent(id)}/stream\`)`, reads `bytes` out of each
`data`, and tells failure from a dead connection the way `plan-events/client.ts` does. `type()`
posts `{"text": text}` as json. `SessionsMother` answers three bodies: one session, none, a malformed row.

**TDD:** red first with `it('the live sessions the backend lists reach the page')` — a body of
`{"sessions":[{"id":"a1","name":"zsh"}]}` answers `{ kind: 'loaded' }` with that row.

**Tests:** added — in `client.test.ts`:
`it('the live sessions the backend lists reach the page')`,
`it('a malformed session row makes the whole answer unavailable')`,
`it('an unreachable backend is unavailable and never throws')`,
`it('the bytes of a frame reach the listener')`,
`it('typing posts the text as json to that session input')`;
in `useLiveSessions.test.ts`:
`it('the hook starts loading and ends with what the backend listed')`,
`it('an unreachable backend leaves it unavailable')`.

**Verification:**

```bash
npm --prefix frontend test -- src/app/sessions/client.test.ts   # expected: exit 0 — the client suite is green
npm --prefix frontend test -- src/app/sessions/useLiveSessions.test.ts   # expected: exit 0 — the hook suite is green
npm --prefix frontend test   # expected: exit 0 — the yardstick and every other suite pass
npm --prefix frontend run build   # expected: exit 0 — the page type-checks and builds
```

### Task 7 — The live terminal on the page

**Objective:** one session renders as a real terminal that shows what it prints, takes what is
typed, and names what went wrong.

**Files:** `frontend/src/app/sessions/components/session-terminal/SessionTerminal.tsx` (create),
`frontend/src/app/sessions/components/session-terminal/SessionTerminal.css` (create),
`frontend/src/app/sessions/components/session-terminal/index.ts` (create),
`frontend/src/app/sessions/components/session-terminal/SessionTerminal.test.tsx` (create),
`frontend/package.json` (modify), `frontend/package-lock.json` (modify),
`frontend/src/app/sessions/Sessions.types.ts` (modify),
`frontend/src/app/sessions/client.ts` (modify),
`frontend/src/app/sessions/client.test.ts` (modify)

Contract (frontend/src/app/sessions/components/session-terminal/SessionTerminal.tsx):

```tsx
export type SessionTerminalProps = { session: LiveSession }
export const SessionTerminal: ({ session }: SessionTerminalProps) => ReactElement
```

One `useEffect`, keyed on `session.id`: it builds a `Terminal` from `@xterm/xterm` at 80 columns
and 24 rows — the size the backend opened the pty at — opens it on a ref'd `<div className="session-terminal__screen">`, subscribes
with `SessionsClient.watch` writing every `bytes` into it, and wires
`terminal.onData((text) => void SessionsClient.type(session.id, text))`. Cleanup closes the
subscription and disposes the terminal, nothing else.
**`SessionStreamListener` gains `onRefused`**, which Task 6 lacked: a 400 before the SSE headers
leaves the `EventSource` `CLOSED` for good while an unreachable backend leaves it `CONNECTING`,
and `plan-events/client.ts` already tells them apart by `readyState === CLOSED`. Without it the
page cannot say "this session is gone" apart from "the backend will come back". Each of the
three renders a `Banner`, in Spanish: `Esta sesión ya no existe` for the refusal and
`No se puede leer esta sesión` for the rest. The `aria-label` is `Terminal de la sesión`. The `.css` is BEM under `.session-terminal`, its colours read from
`semantic-color.css` (`--background-inverse`, `--foreground-inverse`, `--border-subtle`): no
literal colour, no brand token edited.

Configuration: `"@xterm/xterm": "^6.0.0"` joins `frontend/package.json`'s `dependencies`
(lockfile via `npm --prefix frontend install`), and the component imports its `css/xterm.css`.

**TDD:** red first with `it('the bytes the stream delivers are written to the terminal')` — with
`@xterm/xterm` doubled, a frame of `hola` leaves `hola` in the fake terminal.

**Tests:** added — in `SessionTerminal.test.tsx`:
`it('the bytes the stream delivers are written to the terminal')`,
`it('what the person types is sent to that session')`,
`it('unmounting closes the subscription and disposes the terminal')`,
`it('an unreachable stream says so instead of staying mute')`,
`it('a session the backend no longer holds is said to be gone')`;
in `client.test.ts`: `it('a connection the browser closed for good is a refusal')`.

**Verification:**

```bash
npm --prefix frontend test -- src/app/sessions/components/session-terminal/SessionTerminal.test.tsx   # expected: exit 0 — the terminal suite is green
npm --prefix frontend test -- src/app/sessions/client.test.ts   # expected: exit 0 — the refusal branch is pinned
npm --prefix frontend test   # expected: exit 0 — the yardstick and every other suite pass
npm --prefix frontend run build   # expected: exit 0 — the page type-checks and builds
```

### Task 8 — The list and the terminal on the page

**Objective:** the page lists the live sessions and shows the chosen one, in every stage.

**Files:** `frontend/src/app/sessions/components/sessions-panel/SessionsPanel.tsx` (create),
`frontend/src/app/sessions/components/sessions-panel/SessionsPanel.css` (create),
`frontend/src/app/sessions/components/sessions-panel/index.ts` (create),
`frontend/src/pages/home/Home.tsx` (modify), `frontend/src/pages/home/Home.css` (modify),
`frontend/src/app/sessions/components/sessions-panel/SessionsPanel.test.tsx` (create),
`frontend/src/pages/home/__tests__/Home.sessions.test.tsx` (create),
`frontend/src/app/sessions/components/session-terminal/SessionTerminal.test.tsx` (modify),
`frontend/src/pages/home/__tests__/helpers.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.implementHistory.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.implementProgress.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.layout.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.navigation.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.restoreWorkflow.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.startPlan.test.tsx` (modify)

Call site (frontend/src/pages/home/Home.tsx):

```tsx
          <section className="home__sessions" aria-label="Sesiones en marcha">
            <SessionsPanel />
          </section>
```

`export const SessionsPanel: () => ReactElement` reads `useLiveSessions`: `Loading`, a `Banner`,
a Spanish line when none is live, or the names as `Button`s beside the chosen session's
`SessionTerminal` — the first until a name is clicked, and which one is chosen said in the
accessibility tree, not only in a `Button` variant. It sits in `main`, in **every** stage, gated
by nothing about the workflow: the place D-21 asks the cabin to keep. `.home__sessions` moves no
declaration `Home.shell.test.ts` pins.

Unconditional means **every** `Home` test fetches `/sessions`: hence the seven files under
`__tests__/`. Each gains a `/sessions` route and no assertion weakens; one the second
live region made ambiguous is scoped to its container. `SessionsMother.oneSession()` and `.noSessions()`
replace every hand-built copy of those two bodies; the two-session one stays inline, the mother
not being this task's to change. Task 7 left `terminal.open(screen)` unwatched — delete it and
that suite stays green — so the double records what it opened on and a test pins that.

**TDD:** red first with `it('the live sessions are listed by their names')` — two sessions
render both names and the first one's terminal.

**Tests:** added — in `SessionsPanel.test.tsx`:
`it('the live sessions are listed by their names')`,
`it('the first session is the one shown')`,
`it('choosing another session shows that one')`,
`it('no live session is said out loud instead of an empty box')`,
`it('an unreachable backend is said out loud')`,
`it('the chosen session is named as chosen for a screen reader')`;
in `SessionTerminal.test.tsx`: `it('the terminal is opened on the screen it renders')`;
in `Home.sessions.test.tsx`: `it('the sessions panel is on the page before a plan is requested')`
and `it('the sessions panel is still on the page while an implementation runs')`.

**Verification:**

```bash
npm --prefix frontend test   # exit 0: both new suites, the reopened open call, the shell, the seven Home suites
npm --prefix frontend run build   # exit 0: the page type-checks and builds
```

### Task 9 — The channel, documented where this API is documented

**Objective:** the three endpoints are in the contract the frontend codes against, and the
repository's vocabulary names what a live session is.

**Files:** `backend/API.md` (modify), `backend/conventions/this-repository.md` (modify),
`frontend/README.md` (modify)

Current state (backend/API.md, line 17):

```md
| Endpoints | 7 (`POST` 3, `GET` 4) |
```

Final text (backend/API.md):

```md
| Endpoints | 11 (`POST` 4, `GET` 7) |
```

Final text (backend/conventions/this-repository.md):

```md
| **Live session** | A process the backend owns and keeps: the cabin lists it, reads what it prints and writes into it, and closing the page ends the subscription and nothing else |
```

The count was already one short — eight endpoints were routed while the table said seven — and
the three this slice adds make eleven; the plan writes the true number rather than eight plus
three. `API.md` gains one section per endpoint, in the order `api-server.ts` mounts them, each
with its path, its answer and its refusals, and **each shape read from a running server** as
that document's own opening line demands. Its "Where the frontend consumes each one" table gains
three rows, all naming `frontend/src/app/sessions/client.ts` and `Sessions.types.ts`, and the
note that `'/sessions'` is in `API_PATHS` so the dev server proxies the three. The row above goes
into the ubiquitous language table of `this-repository.md`, in alphabetical place. `README.md`
gains a paragraph on the sessions module: which endpoints it consumes, that `@xterm/xterm`
renders the stream, and that the backend owns the session so the page is a window and not its
owner.

**TDD:** No TDD — this task is documentation; its claims are measured by the predicates below
and by the suites the earlier tasks left green.

**Tests:** N/A — no behaviour changes; `backend/__tests__/conventions-no-restatement.test.ts`
already guards the document this task edits and is run below.

**Verification:**

```bash
test "$(grep -c '^## `GET /sessions`$' backend/API.md)" -eq 1   # expected: exit 0 — the list endpoint has its own section
test "$(grep -c '^## `GET /sessions/:id/stream`$' backend/API.md)" -eq 1   # expected: exit 0 — the stream endpoint has its own section
test "$(grep -c '^## `POST /sessions/:id/input`$' backend/API.md)" -eq 1   # expected: exit 0 — the input endpoint has its own section
test "$(grep -c 'Endpoints | 11 ' backend/API.md)" -eq 1   # expected: exit 0 — the count is the true one
test "$(grep -c 'Live session' backend/conventions/this-repository.md)" -eq 1   # expected: exit 0 — the term is defined once
npm --prefix backend test -- __tests__/conventions-no-restatement.test.ts   # expected: exit 0 — the convention document still restates nothing
```

### Task 10 — The channel, wired, end to end over one real process

**Objective:** the running backend reaches all three endpoints, and one test drives the four
acceptance criteria through the real routes over a real PTY.

**Files:** `backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/infrastructure/session-channel-real-process.test.ts` (create),
`docs/superpowers/plans/2026-09-12-issue-327-the-session-channel.md` (modify)

Call site (backend/src/infrastructure/ct-api.ts):

```ts
      liveSessions,
      watchLiveSession: new WatchLiveSession({ liveSessions }),
      typeIntoSession: new TypeIntoSession({ liveSessions }),
```

Those three join `listLiveSessions` in the `ApiServer` call `ct-api.ts` already makes. Tasks 4
and 5 mount their routes on `ApiServer` but nothing hands them their collaborators, so until
this task the running backend answers `GET /sessions` and nothing else of the channel — which is
also why the `visual` gate cannot be met before it.

The test builds an `ApiServer` on port `0` over a `PtyLiveSessions` whose spawn is the real
`node-pty`, opens one session, and then, against the listening server: asks `GET /sessions` and
finds that session by id and name; opens `GET /sessions/:id/stream`; posts `{"text":"echo ct\r"}`
to `GET`'s sibling `POST /sessions/:id/input`; reads frames until `ct` has come back through the
stream; aborts the request that was reading the stream; and asks `GET /sessions` again, which
still names the session. Every pty it spawned is killed in `afterEach`, on a failed assertion
too, and the server is stopped there as well.

**TDD:** No TDD — an end-to-end is written after the behaviours it binds, and it is still red
before this slice starts, because `GET /sessions` does not exist on `main`.

**Tests:** added — in `session-channel-real-process.test.ts`:
`it('the live session is listed, its stream carries what it prints and what is typed reaches it')`,
`it('closing the stream leaves the session listed and its process alive')`.

**Verification:**

```bash
npm --prefix backend test -- __tests__/infrastructure/session-channel-real-process.test.ts   # expected: exit 0 — the four criteria hold over one real process
npm --prefix backend test   # expected: exit 0 — the whole backend suite, real processes included
```

## 8. Global verification

The three suites the epic's context declares, the page's build, and the committed end-to-end of
Task 10, which is the slice's four acceptance criteria over one real PTY. On this branch's base
the backend suite was 60 files and 1487 tests in about 26 s, the page 47 files and 917 tests in
about 9 s, and `typecheck` exit 0; this slice adds to both.

Then the `visual` gate, which no command closes and this agent cannot give as met: with
`make run-frontend`, open `http://127.0.0.1:8787`, and the page shows the session the backend
opened, named, with its prompt in the terminal. Type `ls` and press enter: the listing appears.
Reload the page: the scrollback comes back and the prompt is the same one, because the process
never died. The before is the same page on `main`, which has no terminal at all. A person
reviewing the pull request closes the gate.

```bash
npm --prefix backend run typecheck   # expected: exit 0 — the whole backend graph type-checks
npm --prefix backend test   # expected: exit 0 — the backend suite, real processes included
npm --prefix frontend test   # expected: exit 0 — the page's suite and its yardstick
npm --prefix frontend run build   # expected: exit 0 — the page type-checks and builds
npm --prefix backend test -- __tests__/infrastructure/session-channel-real-process.test.ts   # expected: exit 0 — the four acceptance criteria over one real process
```

## 9. Assumptions

1. **The session the backend opens runs the developer's login shell.** The criteria need a live
   process to list, stream and type into, and which command the coordinating session runs is
   slice #3's business. `$SHELL -il` is the shape the epic's design records from the POC's
   `PtyManager`, and it is what makes the session inherit the real `PATH`. *(Own call, anchored
   in D-1 and in the epic context.)*
2. **The page never opens a session.** The epic's approach says the cabin "subscribes to it
   rather than creating it, so the page is a window and not the owner", so `ct-api.ts` opens it
   at start-up and there is no endpoint that creates or kills one. *(Own call, from the epic
   context.)*
3. **A stream frame carries `bytes` and no `kind`.** The envelope's second kind has no producer
   until the headless transport of slice #6, and `conventions/simplicity.md` puts the burden of
   proof on what is added. *(Own call.)*
4. **`node-pty` is pinned to `1.0.0`, not `^1.1.0`.** Measured on this machine on 2026-09-12: a
   fresh `npm install node-pty@1.1.0` leaves `prebuilds/darwin-arm64/spawn-helper` at mode `644`
   and `pty.fork` then dies with `Error: posix_spawnp failed.`; `1.0.0` ships no darwin prebuild,
   builds from source in about 11 s and leaves `build/Release/spawn-helper` executable, on this
   machine and on the `ubuntu-latest` runner alike. *(Own call, measured.)*
5. **`@xterm/xterm` is doubled in the page's tests.** jsdom cannot measure a terminal, and what
   those tests owe is that the bytes reached it and that a keystroke left it. *(Own call.)*
6. **The baseline is `no-verificado`** because `AGENTS.md` declares no `test: <command>` line in
   a "## Build, test & lint" section for the plugin to read — not because anything is red. The
   commands this plan uses are the three the issue's "Contexto del epic" declares, and on this
   branch's base they are green. *(`.agent/SLICE.md` + epic context.)*
7. **`API.md`'s endpoint count was already one short** — it says seven while `api-server.ts`
   routes eight — so Task 9 writes eleven, the true number once this slice lands, rather than
   seven plus three. The eight protected endpoints keep their own sections untouched. *(Own
   call, read from `api-server.ts`.)*
8. **A session whose process exits stops being listed, and a stream already open on it stays
   open carrying nothing more.** No criterion asks for an end-of-stream frame, and the reader
   who will need one is the coordinating session's recovery, which is slice #3. *(Own call.)*
9. **The scrollback is bounded at 262144 characters.** A session lives as long as the backend,
   so an unbounded buffer is a leak; no criterion names a size. *(Own call.)*
10. **Nothing kills a session.** It ends when its shell exits or when the backend does; an
    endpoint that killed one is outside this slice. *(Own call, from "Out of scope".)*
11. **`GET /sessions` is neither paginated nor filtered.** It has one caller, the page, and the
    backend owns a handful of sessions at most. *(Own call.)*
12. **Nothing is inherited.** The issue's "## Contexto heredado" carries only the empty template
    line, and its row in the slices table has `Dep: –`. *(Issue.)*
