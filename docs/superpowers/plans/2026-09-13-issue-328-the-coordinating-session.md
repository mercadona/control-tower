# #328 — The coordinating session

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

The cabin already owns one live session. `PtyLiveSessions` (`backend/src/infrastructure/pty-live-sessions.ts`)
opens the user's login shell at start-up from `ct-api.ts`, keeps its scrollback and serves
`GET /sessions`, `GET /sessions/:id/stream` and `POST /sessions/:id/input`; `SessionsPanel`
renders it with `@xterm/xterm` in every stage of `Home`. What the backend cannot do yet is open
a **conversation**: the shell is the only program it knows how to spawn, nothing tells that
program what to work on, nothing reports whether it is working or waiting, and nothing survives
a restart.

The entrance is still the plan's. `StartPlanForm` collects a ticket, a free description, a
repository and its local path, and its one button calls `POST /start-plan`, which opens a GitHub
issue and cuts a worktree.

This slice makes the app host the epic's **coordinating session**: an interactive `claude`
running in the governed checkout itself, told what to do by a file whose path travels in its
environment, hydrated with the idea typed at the entrance, reporting `working` / `waiting` and
its live question through hooks, reachable from every phase of the page, and brought back by
`--resume` after a backend restart — or said out loud when it cannot be.

### Desired end state

- `POST /coordinating-session` confirms the checkout, resolves the idea (a Jira key or a GitHub
  issue url through the existing `UserStories` adapter, free text, or both), writes the phase
  prompt to a file, installs the hooks and spawns `claude` in the governed checkout — with no
  worktree cut and no branch created.
- The phase prompt never travels as text: `CT_PHASE_PROMPT` carries its **path** and the opening
  argument tells the session to read that file.
- `POST /session-hooks` receives Claude Code's `UserPromptSubmit`, `Notification` and `Stop`
  payloads and projects `working`, `waiting` and the live question; the question is dropped the
  moment the session works again.
- Installing the hooks purges the app's own stale entries from the checkout's
  `.claude/settings.local.json` for every event it is about to write, and leaves foreign hooks
  untouched.
- `GET /coordinating-session` answers `none`, `live` (with the attention and its question) or
  `unresumable`.
- At start-up the backend recalls the recorded conversation and resumes it; when Claude Code no
  longer holds that conversation it opens **nothing** and says `unresumable`.
- The cabin's entrance keeps its four fields and its one button, which now opens the
  brainstorming; the session panel and the coordinating session's state are on the page in every
  phase, never hidden and never disabled, and a reload replays the scrollback the backend kept.

### Out of scope

- 🚫 `plugin/skills/brainstorming/SKILL.md` and everything under `plugin/skills/brainstorming/`:
  the phase prompt invokes that skill and never rewrites it.
- `POST /start-plan` keeps its behaviour, its use case and its adapters exactly as they are
  (D-26). The one thing it does gain is four rows in `PlanCollapse`, for the four new
  failures: `plan-refusal.test.ts` requires every `PlanFailure` leaf to declare a refusal, so
  a leaf and its row cannot be added by different commits.
- The gates, the groom, the dispatcher and the headless calls: slices 4 to 8.
- `Home`'s review and implementation stages keep working through the restore path they already
  have; this slice does not delete them.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D-1 · The entrance is a conversation with a real terminal | the cabin hosts the brainstorming and spec session as an interactive `claude` in a PTY streamed to the page, not a structured chat and not a step left outside the app. |
| D-13 · No phase is stored | every phase is derived from evidence that survives a restart: the spec and its state line, the milestone and its issues, a `status:ready` label, a worktree, a record, a pull request, a closed issue. |
| D-18 · There is a coordinating session and it is the boss of all of them | the entrance conversation does not die at the freeze: it stays as the milestone's coordinator and the human's single interlocutor, the one that orders the start, carries the changes asked on a pull request and unblocks what is stuck, implementations included. What it never does is decide the order or the phase — that is the program's. It commands by invoking the backend's endpoints and the plugin's programs, while the backend owns the processes, makes the call of each step, keeps the record and measures. |
| D-21 · The coordinating session is always in the front, and it is recoverable | the cabin offers a place to talk to it in **every** phase, and most explicitly once the implementation is running: no phase of the page may hide it, replace it with a progress panel or disable its input. Talking to it must not disturb what is being implemented. Getting it back is a requirement rather than a convenience — two different losses with two different answers, a page reload replaying what was already said and a backend restart bringing the conversation back by resuming it. A conversation that cannot be resumed is said out loud; the cabin never opens a different one and presents it as the same. |
| D-25 · The context of every call is composed by the plugin and relayed verbatim, never paraphrased by the backend | the backend hands over **paths** and pastes none of that text into a prompt. If `ct-step next` asks for a dispatch the backend cannot assemble from what it prepared, the backend refuses instead of improvising a prompt. |
| D-26 · The idea enters as a Jira user story or as free text, through the form the cabin already has | the entrance keeps its shape: a ticket key such as `ABC-123`, a free description, or both, plus the repository and its local path, because an epic governs one checkout and the coordinating session has to start in it. Its one button opens the brainstorming. A user story does not replace the conversation: it **hydrates** it — the coordinating session starts already knowing the ticket's summary and description, read through the `UserStories` adapter that `/start-plan` already uses, and goes on to explore, decide and write the spec exactly as it would from a blank page; free text hydrates it the same way. What the session is told travels as the phase prompt of slice 3 — a file whose path is in the environment, never text pasted into an argument — which is D-25 applied to the entrance. The endpoint of the short path of a loose issue stays as it is; what changes is that the cabin's button now opens an epic. |
| D-10 · Everything new under `backend/` is TypeScript | and the plugin stays JavaScript, which is the repository's own rule for what the plugin ships. |
| D-11 · A yardstick is imported from the plugin, never reimplemented | the backend grows no second opinion about something the plugin already implements. |
| D-16 · cmux leaves the backend | no new module under `backend/src` names cmux, and no new test requires it to be installed or running. |
| D-22 · The gates are the human's and no session can trigger them | writing `Estado: CONGELADA`, promoting to `status:ready` and anything around the merge are triggered only from the front, by a person's click. There is no endpoint for them that a session can call. |
| The entrance button's literal — decided by the coordinating session, 2026-09-13 | `StartPlanForm`'s one button reads **`Arrancar brainstorming`**. It is Spanish product copy, like everything `frontend/src` renders; today it reads `Arrancar plan`. The implementer does not choose this wording. |

## 3. Reference patterns

Files to imitate: `backend/src/application/actions/start-plan.ts` (a use case that confirms the
checkout, resolves the story through `UserStories` and drives its ports in order),
`backend/src/infrastructure/start-plan-route.ts` (request parsing, `PlanRefusal`, `PlanCollapse`),
`backend/src/infrastructure/pty-live-sessions.ts` (the PTY adapter),
`backend/src/infrastructure/disk-implementation-start-registry.ts` (a record under the state root),
`backend/src/infrastructure/plan-agent-brief.ts` (**the shape of a composed errand, not its
language**: that module is Spanish debt, and `CLAUDE.md` puts every agent prompt in English and
grants no declared-debt exemption for language, so a prompt born in this slice is English),
`backend/src/infrastructure/plan-events-route.ts` (an in-memory registry beside its route),
`backend/__tests__/application/start-plan.test.ts` (use case with every port doubled),
`backend/__tests__/infrastructure/sessions-route.test.ts` (controller through a real server),
`frontend/src/app/sessions/useLiveSessions.ts`,
`frontend/src/app/sessions/components/sessions-panel/SessionsPanel.tsx`,
`frontend/src/__scenarios__/SessionsMother.ts`.

Rules to obey: `CLAUDE.md` (English everywhere except what a person reads in the product, which
is Spanish), `AGENTS.md`, `backend/conventions/this-repository.md` (the layout, the exception
families, how this API answers, `{code, detail}` in kebab-case, where the suite runs),
`frontend/README.md` (the frontend yardstick and the design system mirrors),
`.agent/conventions-ack.md`. Skills named by the epic context: `backend-engineering:backend-best-practices`,
`frontend-engineering:frontend-best-practices`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/session-program.ts` | create | `PtyLiveSessions`, `ClaudeConversations` | Contract (T1) |
| `backend/src/infrastructure/pty-live-sessions.ts` | modify | `ct-api.ts`, `ClaudeConversations` | Current state (T1) |
| `backend/src/infrastructure/ct-api.ts` | modify | the entrypoint | Call site (T1, T7, T9) |
| `backend/src/domain/value-objects/conversation-id.ts` | create | the ports | Contract (T2) |
| `backend/src/domain/value-objects/coordinating-conversation.ts` | create | the ports | Contract (T2) |
| `backend/src/domain/value-objects/session-attention.ts` | create | the registry | Contract (T2) |
| `backend/src/domain/value-objects/phase-prompt.ts` | create | `ConversationRecords` | Contract (T2) |
| `backend/src/domain/ports/conversations.ts` | create | the use cases | Contract (T2) |
| `backend/src/domain/ports/session-hooks.ts` | create | the use cases | Contract (T2) |
| `backend/src/domain/ports/conversation-records.ts` | create | the use cases | Contract (T2) |
| `backend/src/domain/exceptions.ts` | modify | the adapters | Contract (T2) |
| `backend/src/application/actions/open-coordinating-session.ts` | create | the route | Contract (T3) |
| `backend/src/infrastructure/claude-conversations.ts` | create | `ct-api.ts` | Contract (T4) |
| `backend/src/infrastructure/local-settings-session-hooks.ts` | create | `ct-api.ts` | Contract (T5) |
| `backend/src/infrastructure/disk-conversation-records.ts` | create | `ct-api.ts` | Contract (T6) |
| `backend/src/infrastructure/coordinating-sessions.ts` | create | the routes | Contract (T7) |
| `backend/src/infrastructure/coordinating-session-route.ts` | create | `api-server.ts` | Contract (T7, T9) |
| `backend/src/infrastructure/api-server.ts` | modify | `ct-api.ts` | Call site (T7, T8, T9) |
| `backend/src/infrastructure/session-hooks-route.ts` | create | `api-server.ts` | Contract (T8) |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | the suite | none (body by TDD) |
| `backend/src/application/actions/recover-coordinating-session.ts` | create | `ct-api.ts` | Contract (T9) |
| `frontend/src/app/coordinating-session/CoordinatingSession.types.ts` | create | the client and the hook | Contract (T10) |
| `frontend/src/app/coordinating-session/client.ts` | create | the hook and the form | Contract (T10) |
| `frontend/src/app/coordinating-session/useCoordinatingSession.ts` | create | the status component | Contract (T10) |
| `frontend/src/app/coordinating-session/components/coordinating-session-status/*` | create | `Home` | none (body by TDD) |
| `frontend/src/__scenarios__/CoordinatingSessionMother.ts` | create | the frontend suites | none (body by TDD) |
| `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx` | modify | `Home` | Current state (T11) |
| `frontend/src/pages/home/Home.tsx` | modify | the page | Call site (T12) |
| `frontend/src/pages/home/__tests__/helpers.tsx` | modify | the Home suites | none (body by TDD) — T12 |
| `frontend/vite.config.ts` | modify | the dev server | listed by T10 |
| `backend/API.md` | modify | whoever codes against the API | Final text (T13) |
| `frontend/README.md` | modify | the frontend | Final text (T13) |
| `backend/conventions/this-repository.md` | modify | every diff here | Final text (T13) |

## 5. Interfaces

Consumes: `#2` delivered the session channel this slice hangs the conversation on —
`LiveSessions.all()`, `LiveSessions.find(id)`, `LiveSessions.watch({session, onBytes, onEnded})`
and `LiveSessions.write({session, text})` (`backend/src/domain/ports/live-sessions.ts`), the
`LiveSession {id, name}` value object, the three endpoints `GET /sessions`,
`GET /sessions/:id/stream` and `POST /sessions/:id/input`, and on the page
`SessionsClient.list/watch/type`, `useLiveSessions()` and `SessionsPanel`.

Produces, for slices 4 to 8:
`CoordinatingSessions.held(): HeldCoordinatingSession | null` — the live conversation, its
session and its attention, or the one that could not be resumed.
`OpenCoordinatingSession.execute(OpenCoordinatingSessionParams): Promise<CoordinatingSessionOpened>`.
`RecoverCoordinatingSession.execute(): Promise<CoordinatingSessionRecovered>`.
`Conversations.mint() / isResumable(conversation) / start({conversation, promptPath}) / resume(conversation)`.
`SessionHooks.install(root: CheckoutRoot): Promise<void>`.
`ConversationRecords.prepare({conversation, prompt}): Promise<string>` and `recall(): Promise<CoordinatingConversation | null>`.
`SessionProgram {name, file, argv, cwd, env}` and `PtyLiveSessions.open(program): LiveSession`.

## 6. Test strategy

Outside-in, with `plugin/conventions/testing.md` as the yardstick: the two use cases are black
boxes with every port doubled (Task 3, Task 9); the adapters are cut right before the external
system — `node-pty`, the filesystem, Claude Code's transcript store — and assert the literal
argv, the literal environment and the literal JSON written (Tasks 4, 5, 6); the controllers are
exercised through a real listening server and a real client, asserting status and literal body
(Tasks 7, 8, 9), with the use case doubled by construction and every refusal test also asserting
that the use case was never asked. The domain gets no tests of its own: `PhasePrompt`,
`SessionAttention`, `ConversationId` and `CoordinatingConversation` are reached through the use
cases that carry them. No new test spawns a real process, so none carries the `-real-process`
suffix, and none needs cmux. On the page the hook and the client are tested with `fetch` stubbed
and fake timers, the components with Testing Library, and `Home` end to end over stubbed
endpoints. Commands: `npm --prefix backend run typecheck`, `npm --prefix backend test`,
`npm --prefix frontend test`.

## 7. Tasks

### Task 1 — A live session carries the program it runs

**Objective:** `PtyLiveSessions.open` spawns whatever program it is handed instead of always the
login shell, so a conversation can be opened beside it.

**Files:** `backend/src/domain/value-objects/session-program.ts` (create),
`backend/src/infrastructure/pty-live-sessions.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/infrastructure/pty-live-sessions.test.ts` (modify),
`backend/__tests__/infrastructure/pty-live-sessions-real-process.test.ts` (modify),
`backend/__tests__/infrastructure/session-channel-real-process.test.ts` (modify)

Current state (backend/src/infrastructure/pty-live-sessions.ts, lines 54-64):

```ts
  open(): LiveSession {
    const file = this.shell ?? PtyLiveSessions.FALLBACK_SHELL
    const program = PtyLiveSessions.#basenameOf(file)
    const session = new LiveSession({ id: this.newId(), name: program })
    const terminal = this.spawn(file, [PtyLiveSessions.LOGIN_INTERACTIVE], {
      name: PtyLiveSessions.TERM,
      cols: PtyLiveSessions.COLUMNS,
      rows: PtyLiveSessions.ROWS,
      cwd: this.cwd,
      env: PtyLiveSessions.#environmentOf(this.env),
    })
```

Contract (backend/src/domain/value-objects/session-program.ts):

```ts
export class SessionProgram {
  readonly name: string
  readonly file: string
  readonly argv: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  constructor({ name, file, argv, cwd, env }: {
    name: unknown, file: unknown, argv: readonly string[], cwd: unknown,
    env: Readonly<Record<string, string>>,
  })
}
```

`PtyLiveSessions.open(program: SessionProgram): LiveSession` spawns `program.file` with
`program.argv`, `cwd: program.cwd` and `PtyLiveSessions` forcing `TERM` over `program.env`; the
session is named `program.name`. `loginShell(shell: string | undefined, cwd: string, env)` is a
new static that builds the shell's own `SessionProgram` with `FALLBACK_SHELL`, `LOGIN_INTERACTIVE`
and the basename as its name; `ct-api.ts` calls `liveSessions.open(PtyLiveSessions.loginShell(...))`.
The `shell`, `cwd` and `env` constructor fields disappear with their only reader.

**TDD:** `it('spawns the program it is given, with its own argv and working directory')` — the
spawn double records `file`, `argv` and `cwd` and the assertion is on the literal three, with a
program that is not a shell. Then `it('forces its own TERM over the program environment')`.

**Tests:** added to `backend/__tests__/infrastructure/pty-live-sessions.test.ts`:
`spawns the program it is given, with its own argv and working directory`,
`forces its own TERM over the program environment`,
`names the login shell by its basename`. Existing tests keep their names, rebuilt around
`loginShell`.

**Verification:** the suite of the adapter is green and the graph typechecks.

```bash
npm --prefix backend run typecheck   # expected: exit 0 — no caller of open() was left without its program
npm --prefix backend test -- __tests__/infrastructure/pty-live-sessions.test.ts   # expected: exit 0
test "$(grep -c 'loginShell' backend/src/infrastructure/ct-api.ts)" -eq 1   # expected: exit 0 — the entrypoint builds the shell's program
```

### Task 2 — The conversation's values, its ports and its failures

**Objective:** the vocabulary the rest of the slice is written against exists — the conversation,
the phase prompt, the attention, the three ports, and each failure with the refusal it owes.

**Files:** `backend/src/domain/value-objects/conversation-id.ts` (create),
`backend/src/domain/value-objects/coordinating-conversation.ts` (create),
`backend/src/domain/value-objects/session-attention.ts` (create),
`backend/src/domain/value-objects/phase-prompt.ts` (create),
`backend/src/domain/ports/conversations.ts` (create),
`backend/src/domain/ports/session-hooks.ts` (create),
`backend/src/domain/ports/conversation-records.ts` (create),
`backend/src/domain/exceptions.ts` (modify),
`backend/src/infrastructure/start-plan-route.ts` (modify),
`backend/__tests__/infrastructure/plan-refusal.test.ts` (modify)

Contract (backend/src/domain/ports/conversations.ts):

```ts
export class Conversations {
  mint(): ConversationId
  isResumable(c: CoordinatingConversation): boolean
  start(o: { conversation: CoordinatingConversation, promptPath: string }): LiveSession
  resume(c: CoordinatingConversation): LiveSession
}
```

Contract (backend/src/domain/value-objects/session-attention.ts):

```ts
export const AttentionStatus = Object.freeze({ WORKING: 'working', WAITING: 'waiting' } as const)
export class SessionAttention {
  readonly status: string
  readonly question: string | null
  static working(): SessionAttention
  static waiting(question: string | null): SessionAttention
}
```

`working()` always carries `question === null`: an answered question stops being a question.
`SessionHooks.install(root: CheckoutRoot): Promise<void>`.
`ConversationRecords.prepare({conversation, prompt: PhasePrompt}): Promise<string>` answers the
prompt file's absolute path; `recall(): Promise<CoordinatingConversation | null>`.
`ConversationId` guards the `randomUUID` shape and carries `.text`;
`CoordinatingConversation {id, repository: RepositoryName, root: CheckoutRoot}`;
`PhasePrompt.brainstorming({story, comment, repository, root})` with `.text`.
`exceptions.ts` gains `ConversationFailure` (`ConversationNotStarted`, `ConversationNotRecorded`)
and `SessionHooksFailure` (`SessionHooksNotWritten`, `SessionHooksNotUnderstood`). In the same
commit `PlanCollapse` gains one row per leaf — `conversation-not-started`,
`conversation-not-recorded`, `session-hooks-not-written`, `session-hooks-not-understood` — and
nothing else of that module moves: a leaf without its row is what the guard below forbids. That
guard's `FAMILIES` list registers the two new roots, the way every family before them was added.

**TDD:** the red is already written and belongs to this repo —
`every_way_the_plan_can_collapse_has_a_refusal_declared_so_adding_one_cannot_reach_the_client_as_a_crash`
turns red the moment the four leaves exist; the `PlanCollapse` rows turn it green. No new test:
the domain gets none of its own.

**Tests:** none added or removed — that guard is what drives this task.

**Verification:** the graph is sound, each family carries its two leaves, and the suite is green.

```bash
npm --prefix backend run typecheck   # expected: exit 0
test "$(grep -c 'extends ConversationFailure' backend/src/domain/exceptions.ts)" -eq 2   # expected: exit 0 — its two causes
test "$(grep -c 'extends SessionHooksFailure' backend/src/domain/exceptions.ts)" -eq 2   # expected: exit 0
npm --prefix backend test   # expected: exit 0
```

### Task 3 — Opening the coordinating session, with every port doubled

**Objective:** the use case confirms the governed checkout, hydrates the phase prompt with the
idea typed at the entrance, installs the hooks and starts the conversation — cutting no worktree
and no branch.

**Files:** `backend/src/application/actions/open-coordinating-session.ts` (create),
`backend/src/domain/value-objects/phase-prompt.ts` (modify),
`backend/__tests__/application/open-coordinating-session.test.ts` (create)

Contract (backend/src/application/actions/open-coordinating-session.ts):

```ts
export class OpenCoordinatingSessionParams {
  readonly story: UserStoryKey | UserStoryUrl | null
  readonly comment: PlanComment | null
  readonly repository: RepositoryName
  readonly root: CheckoutRoot
}
export class CoordinatingSessionOpened {
  readonly conversation: CoordinatingConversation
  readonly session: LiveSession
}
export class OpenCoordinatingSession {
  constructor({ userStories, workspace, conversations, sessionHooks, records }: {
    userStories: UserStories, workspace: Workspace, conversations: Conversations,
    sessionHooks: SessionHooks, records: ConversationRecords,
  })
  async execute(params: OpenCoordinatingSessionParams): Promise<CoordinatingSessionOpened>
}
```

Order inside `execute`: confirm the checkout with `workspace.confirm`, read the story with
`userStories.detail` only when one was given, mint the conversation, compose the prompt, write it
with `records.prepare`, install the hooks, start the conversation with the path `prepare`
answered. `workspace.prepare` is never called: the coordinating session lives in the governed
checkout itself. `PhasePrompt.brainstorming` was written in Task 2 and this task closes one hole
in it: `#idea` appends `story.description` unconditionally, so a ticket with none ends the
sentence with a dangling separator — `UserStory.hasDescription()` is this repository's own
answer, and `gh-plan-issues.ts` already asks it.

**TDD:** `it('starts the conversation in the confirmed checkout and prepares no worktree')` — the
workspace double answers a canonical root from `confirm`, and the assertion is that
`conversations.start` received a conversation whose `root` is that canonical root and that
`workspace.prepare` was never asked. Then
`it('hydrates the phase prompt with the story summary and description and with the free text')`,
asserting on the literal text `records.prepare` received.

**Tests:** added to `backend/__tests__/application/open-coordinating-session.test.ts`:
`starts the conversation in the confirmed checkout and prepares no worktree`,
`hydrates the phase prompt with the story summary and description and with the free text`,
`hydrates the phase prompt from free text alone without asking the user stories adapter`,
`installs the hooks before the conversation starts`,
`starts the conversation with the path the records answered`,
`records the conversation before answering`,
`leaves the description out of the phase prompt when the ticket has none`.

**Verification:** the use case is green with every port doubled.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/application/open-coordinating-session.test.ts   # expected: exit 0
test -z "$(grep -l 'cmux' backend/src/application/actions/open-coordinating-session.ts)"   # expected: exit 0 — D-16
```

### Task 4 — `ClaudeConversations`: the CLI, its argv and its environment

**Objective:** the adapter spawns `claude` through the login shell in the governed checkout, with
the prompt's path in the environment and the conversation's id imposed, and answers whether a
recorded conversation can still be resumed.

**Files:** `backend/src/infrastructure/claude-conversations.ts` (create),
`backend/__tests__/infrastructure/claude-conversations.test.ts` (create)

Contract (backend/src/infrastructure/claude-conversations.ts):

```ts
export class ClaudeConversations extends Conversations {
  static readonly BIN = 'claude'
  static readonly NAME = 'brainstorming'
  static readonly PROMPT_VARIABLE = 'CT_PHASE_PROMPT'
  static readonly HOOKS_URL_VARIABLE = 'CT_SESSION_HOOKS_URL'
  static readonly PERMISSION_MODE = 'acceptEdits'
  static readonly OPENING = 'Read the file at "$CT_PHASE_PROMPT" and do exactly what it says.'
  constructor({ liveSessions, shell, env, claudeDirectory, listNames, readText, newId, hooksUrl }: {
    liveSessions: PtyLiveSessions, shell: string | undefined, env: NodeJS.ProcessEnv,
    claudeDirectory: string, listNames: (path: string) => string[],
    readText: (path: string) => string, newId: () => string, hooksUrl: () => string,
  })
}
```

The command handed to the shell as `['-il', '-c', command]`:
`exec claude --session-id <id> --permission-mode acceptEdits "<OPENING>"` to start, and
`exec claude --resume <id> --permission-mode acceptEdits` to resume. The shell is what expands
`$CT_PHASE_PROMPT`, which is why the path travels in the environment and never in the argv.
The environment adds `CT_PHASE_PROMPT` — on `start` only — and `CT_SESSION_HOOKS_URL` to the
inherited one; `cwd` is `conversation.root.text`. `isResumable` asks the plugin's
`ClaudeCodeTranscript` (`plugin/scripts/claude-code-usage.js`) for `conversation.id.text` under
`claudeDirectory` with `cwd: conversation.root.text`, and answers whether it read anything. A
spawn that throws becomes `ConversationNotStarted`.

**TDD:** `it('imposes the minted conversation id and leaves the prompt path in the environment')`
— the `PtyLiveSessions` double records the `SessionProgram` and the assertion is on the literal
`argv` and on `env.CT_PHASE_PROMPT`, proving the path is in neither the command nor the argument.
Then `it('answers that a conversation Claude Code no longer holds cannot be resumed')`.

**Tests:** added to `backend/__tests__/infrastructure/claude-conversations.test.ts`:
`imposes the minted conversation id and leaves the prompt path in the environment`,
`resumes a recorded conversation instead of opening a new one`,
`runs in the governed checkout`,
`answers that a conversation Claude Code no longer holds cannot be resumed`,
`answers that a recorded transcript can be resumed`,
`raises conversation-not-started when the terminal cannot be spawned`.

**Verification:** the adapter is green and the prompt never reaches the argv.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/claude-conversations.test.ts   # expected: exit 0
test "$(grep -c 'CT_PHASE_PROMPT' backend/src/infrastructure/claude-conversations.ts)" -eq 3   # expected: exit 0 — the constant, the opening and the environment entry
```

### Task 5 — The hooks in the checkout's local settings, purged before they are written

**Objective:** installing the hooks removes the app's own stale entries for every event it is
about to write and leaves every foreign hook exactly where it was.

**Files:** `backend/src/infrastructure/local-settings-session-hooks.ts` (create),
`backend/__tests__/infrastructure/local-settings-session-hooks.test.ts` (create)

Contract (backend/src/infrastructure/local-settings-session-hooks.ts):

```ts
export class LocalSettingsSessionHooks extends SessionHooks {
  static readonly SETTINGS: readonly string[] = ['.claude', 'settings.local.json']
  static readonly EVENTS: readonly string[] = ['UserPromptSubmit', 'Notification', 'Stop']
  static readonly MARKER = 'CT_SESSION_HOOKS_URL'
  static readonly TIMEOUT_SECONDS = 5
  static readonly COMMAND =
    'if [ -n "$CT_SESSION_HOOKS_URL" ]; then curl -sS -m 2 -o /dev/null -X POST' +
    " -H 'Content-Type: application/json' --data-binary @- \"$CT_SESSION_HOOKS_URL\" || true; fi"
  constructor({ read, write }: {
    read: (path: string) => Promise<string | null>,
    write: (path: string, text: string) => Promise<void>,
  })
}
```

Each event gets one group `{hooks: [{type: 'command', command: COMMAND, timeout: TIMEOUT_SECONDS}]}`.
An entry is the app's own when its `command` contains `MARKER`; those are dropped from the three
events before ours are appended, a group left with no hooks is dropped, and an event left with no
groups loses its key. The guard on `$CT_SESSION_HOOKS_URL` is what makes these hooks inert in a
session the backend did not spawn, which is every session a person starts in that checkout.
A missing file is an empty object; a file that is not JSON raises `SessionHooksNotUnderstood`
rather than being overwritten; a write that fails raises `SessionHooksNotWritten`.

**TDD:** `it('purges its own stale hooks for every event before writing the new ones')` — the
arrange writes a settings file holding one of ours pointing at a dead port under `Stop` plus a
foreign `Stop` hook, and the assertion is that the written JSON has exactly one of ours under
`Stop` and still holds the foreign one.

**Tests:** added to `backend/__tests__/infrastructure/local-settings-session-hooks.test.ts`:
`purges its own stale hooks for every event before writing the new ones`,
`leaves hooks that are not ours exactly where they were`,
`writes one command per reported event`,
`treats a missing settings file as an empty one`,
`raises session-hooks-not-understood instead of overwriting a settings file it cannot parse`,
`raises session-hooks-not-written when the file cannot be written`.

**Verification:** the adapter is green and the three events are the ones written.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/local-settings-session-hooks.test.ts   # expected: exit 0
test "$(grep -c 'SessionStart' backend/src/infrastructure/local-settings-session-hooks.ts)" -eq 0   # expected: exit 0 — hydration is the prompt file, not a hook
```

### Task 6 — The conversation's paperwork under the state root

**Objective:** the phase prompt and the record of the conversation are written where a restart
can find them, and the record is read back as a `CoordinatingConversation`.

**Files:** `backend/src/infrastructure/disk-conversation-records.ts` (create),
`backend/__tests__/infrastructure/disk-conversation-records.test.ts` (create)

Contract (backend/src/infrastructure/disk-conversation-records.ts):

```ts
export class DiskConversationRecords extends ConversationRecords {
  static readonly DIRECTORY = 'coordinating-session'
  static readonly RECORD = 'conversation.json'
  static readonly PROMPT = 'phase-prompt.md'
  constructor({ read, write, root }: {
    read: (path: string) => Promise<string | null>,
    write: (path: string, text: string) => Promise<void>,
    root: string,
  })
}
```

`prepare` writes the prompt to `<root>/coordinating-session/<conversation id>/phase-prompt.md`
and the record to `<root>/coordinating-session/conversation.json` as
`{"conversation": "<id>", "repo": "owner/name", "root": "/abs/path"}`, and answers the prompt's
absolute path. `recall` answers `null` when the record is absent, a `CoordinatingConversation`
when it reads, and raises `ConversationNotRecorded` when the file is there and cannot be read as
that shape — a malformed record never becomes "no conversation", because the cabin would then
open a different one in silence. A write that fails raises `ConversationNotRecorded` too.

**TDD:** `it('answers the path of the prompt it wrote for that conversation')` — the write double
records path and text, and the assertion is on the literal path returned and on the text written
at it. Then
`it('raises conversation-not-recorded instead of reading a malformed record as no conversation')`.

**Tests:** added to `backend/__tests__/infrastructure/disk-conversation-records.test.ts`:
`answers the path of the prompt it wrote for that conversation`,
`writes the record beside it with the conversation, the repository and the root`,
`recalls the recorded conversation`,
`answers no conversation when nothing was ever recorded`,
`raises conversation-not-recorded instead of reading a malformed record as no conversation`,
`raises conversation-not-recorded when the prompt cannot be written`.

**Verification:** the adapter is green.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/disk-conversation-records.test.ts   # expected: exit 0
```

### Task 7 — `POST /coordinating-session` opens the brainstorming

**Objective:** the entrance endpoint parses the body the form sends, refuses a repository list,
opens the conversation and holds it, and the entrypoint wires every adapter.

**Files:** `backend/src/infrastructure/coordinating-sessions.ts` (create),
`backend/src/infrastructure/coordinating-session-route.ts` (create),
`backend/src/infrastructure/api-server.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/infrastructure/coordinating-session-route.test.ts` (create),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

Contract (backend/src/infrastructure/coordinating-sessions.ts):

```ts
export class HeldCoordinatingSession {
  readonly state: string
  readonly conversation: CoordinatingConversation
  readonly session: LiveSession | null
  readonly attention: SessionAttention | null
}
export class CoordinatingSessions {
  constructor({ stderr }: { stderr: (line: string) => void })
  remember(held: HeldCoordinatingSession): void
  held(): HeldCoordinatingSession | null
  attend({ conversation, attention }: { conversation: string, attention: SessionAttention }): boolean
}
```

Contract (backend/src/infrastructure/coordinating-session-route.ts):

```ts
export const CoordinatingSessionOutcome = Object.freeze({
  ACCEPTED: 'accepted', ONE_REPOSITORY_ONLY: 'one-repository-only',
} as const)
export class CoordinatingSessionRoute {
  static readonly PATH = '/coordinating-session'
  static readonly METHODS = 'GET, POST'
  static opening(open: OpenCoordinatingSession, held: CoordinatingSessions): RequestHandler
}
```

`PlanRequest.from` parses the body — it already decides what a well-formed entrance is, so `id`,
`user_comment`, `repo` and `path` keep their codes through `PlanRefusal` — and a request whose
`listed` is true is refused `one-repository-only`. A `PlanFailure` collapses through the
`PlanCollapse` rows Task 2 already declared. Success answers 202 with `status` `brainstorming`, the
conversation, the repo, the root and the session, and holds it `live` and working. `attend`
answers `false` for an id that is not the held conversation's and writes
`coordinating session <id> <status>` to stderr on every transition. `refusal-codes.test.ts` adds
`CoordinatingSessionOutcome`; `CoordinatingSessionState` is the frozen pair
`{LIVE: 'live', UNRESUMABLE: 'unresumable'}` beside `HeldCoordinatingSession`.

**TDD:** `it('answers 202 with the conversation and the session it opened')` — a real listening
server, the use case doubled, the assertion on the literal body. Then
`it('refuses a repository list because an epic governs one checkout')`, asserting too that the
use case was never asked.

**Tests:** added to `coordinating-session-route.test.ts`:
`answers 202 with the conversation and the session it opened`,
`holds the opened session as live and working`,
`refuses a repository list because an epic governs one checkout`,
`refuses a body with nothing to plan without asking the use case`,
`collapses a conversation that could not be started into conversation-not-started`,
`answers 405 to a method that is neither GET nor POST`.

**Verification:** the route is green and no two endpoints share a code.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/coordinating-session-route.test.ts __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0
```

### Task 8 — `POST /session-hooks` projects working, waiting and the live question

**Objective:** the three hooks reach the backend and move the held session's attention, and a
question stops being a question the moment the session works again.

**Files:** `backend/src/infrastructure/session-hooks-route.ts` (create),
`backend/src/infrastructure/api-server.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/infrastructure/session-hooks-route.test.ts` (create),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

Contract (backend/src/infrastructure/session-hooks-route.ts):

```ts
export const SessionHookOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  HOOK_NOT_UNDERSTOOD: 'hook-not-understood',
  CONVERSATION_NOT_LIVE: 'conversation-not-live',
} as const)
export class SessionHooksRoute {
  static readonly PATH = '/session-hooks'
  static readonly METHOD = 'POST'
  static readonly SESSION_FIELD = 'session_id'
  static readonly EVENT_FIELD = 'hook_event_name'
  static readonly MESSAGE_FIELD = 'message'
  static handledBy(held: CoordinatingSessions): RequestHandler
}
```

The payload is Claude Code's, so this is the one endpoint that does **not** refuse an unknown
field: it reads the three it knows and ignores the rest, which is what a door owes a shape
another program decides. The projection over the closed vocabulary of events:
`UserPromptSubmit` → `SessionAttention.working()`, `Notification` →
`SessionAttention.waiting(message)`, `Stop` → `SessionAttention.waiting(null)`. An event outside
it, or a body without `session_id`, is `hook-not-understood`; an id that is not the held
conversation's is `conversation-not-live`. Success answers 202
`{"status":"reported","attention":"waiting"}`.

**TDD:** `it('moves the held session from working to waiting with the question it was asked')` —
a real server, the registry real, the assertion on what `held()` answers afterwards: status
`waiting` and the literal question. Then `it('drops the question when the session works again')`,
which is the same registry receiving a `UserPromptSubmit` after a `Notification`.

**Tests:** added to `backend/__tests__/infrastructure/session-hooks-route.test.ts`:
`moves the held session from working to waiting with the question it was asked`,
`drops the question when the session works again`,
`reads Stop as waiting with no question`,
`ignores the fields of the payload it does not know`,
`refuses an event it does not know with hook-not-understood`,
`refuses an id that is not the held conversation with conversation-not-live`.

**Verification:** the route is green and the codes stay unique.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/session-hooks-route.test.ts __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0
```

### Task 9 — `GET /coordinating-session`, and the restart that resumes or says it cannot

**Objective:** the backend recalls the recorded conversation at start-up, resumes it when Claude
Code still holds it, opens nothing when it does not, and the page can read which of the three it
is.

**Files:** `backend/src/application/actions/recover-coordinating-session.ts` (create),
`backend/src/infrastructure/coordinating-session-route.ts` (modify),
`backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/application/recover-coordinating-session.test.ts` (create),
`backend/__tests__/infrastructure/coordinating-session-route.test.ts` (modify)

Contract (backend/src/application/actions/recover-coordinating-session.ts):

```ts
export const RecoveredConversation = Object.freeze({
  NONE: 'none', LIVE: 'live', UNRESUMABLE: 'unresumable',
} as const)
export class CoordinatingSessionRecovered {
  readonly outcome: string
  readonly conversation: CoordinatingConversation | null
  readonly session: LiveSession | null
}
export class RecoverCoordinatingSession {
  constructor({ conversations, sessionHooks, records }: {
    conversations: Conversations, sessionHooks: SessionHooks, records: ConversationRecords,
  })
  async execute(): Promise<CoordinatingSessionRecovered>
}
```

`CoordinatingSessionRoute.reading(held: CoordinatingSessions): RequestHandler` answers 200 with
`{"status":"none"}`, or
`{"status":"live","conversation":…,"repo":…,"root":…,"session":{"id","name"},"attention":{"status","question"}}`,
or `{"status":"unresumable","conversation":…,"repo":…,"root":…,"detail":…}`. `ct-api.ts` runs the
recovery after `server.start()` — the hooks url needs the listening port — and puts its outcome
into `CoordinatingSessions`, writing one stderr line either way.

**TDD:** `it('opens nothing when Claude Code no longer holds the recorded conversation')` — the
conversations double answers `false` to `isResumable`, and the assertion is that the outcome is
`unresumable` **and** that neither `resume` nor `start` was asked. Then
`it('resumes the recorded conversation instead of opening a new one')`.

**Tests:** added to `backend/__tests__/application/recover-coordinating-session.test.ts`:
`answers none when nothing was ever recorded`,
`resumes the recorded conversation instead of opening a new one`,
`installs the hooks before resuming`,
`opens nothing when Claude Code no longer holds the recorded conversation`.
Added to `backend/__tests__/infrastructure/coordinating-session-route.test.ts`:
`answers none while no conversation has been opened`,
`answers the live conversation with its attention and its question`,
`answers unresumable for a conversation Claude Code no longer holds`.

**Verification:** both suites are green and the recovery is wired at start-up.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/application/recover-coordinating-session.test.ts __tests__/infrastructure/coordinating-session-route.test.ts   # expected: exit 0
test "$(grep -c 'RecoverCoordinatingSession' backend/src/infrastructure/ct-api.ts)" -eq 2   # expected: exit 0 — imported and run at start-up
```

### Task 10 — The cabin reads the coordinating session

**Objective:** the page polls `GET /coordinating-session` and renders the status, the live
question and the unresumable notice beside the terminal.

**Files:** `frontend/src/app/coordinating-session/CoordinatingSession.types.ts` (create),
`frontend/src/app/coordinating-session/client.ts` (create),
`frontend/src/app/coordinating-session/client.test.ts` (create),
`frontend/src/app/coordinating-session/useCoordinatingSession.ts` (create),
`frontend/src/app/coordinating-session/useCoordinatingSession.test.ts` (create),
`frontend/src/app/coordinating-session/components/coordinating-session-status/CoordinatingSessionStatus.tsx` (create),
`frontend/src/app/coordinating-session/components/coordinating-session-status/CoordinatingSessionStatus.test.tsx` (create),
`frontend/src/app/coordinating-session/components/coordinating-session-status/index.ts` (create),
`frontend/src/__scenarios__/CoordinatingSessionMother.ts` (create),
`frontend/vite.config.ts` (modify)

Contract (frontend/src/app/coordinating-session/CoordinatingSession.types.ts):

```ts
export type Attention = { status: 'working' | 'waiting'; question: string | null }
export type LiveSessionRef = { id: string; name: string }
export type CoordinatingSessionOutcome =
  | { kind: 'none' }
  | { kind: 'live'; conversation: string; repo: string; root: string
      session: LiveSessionRef; attention: Attention }
  | { kind: 'unresumable'; conversation: string; detail: string }
  | { kind: 'unavailable' }
export type OpenedCoordinatingSession = { conversation: string; session: LiveSessionRef }
export type OpenOutcome =
  | { kind: 'opened'; opened: OpenedCoordinatingSession }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'backend-unreachable' }
```

`CoordinatingSessionClient.read(): Promise<CoordinatingSessionOutcome>` and
`.open(submission: StartPlanSubmission): Promise<OpenOutcome>`, the second posting the body
`StartPlanClient.start` posts. `useCoordinatingSession()` reads on mount and every 2000 ms, and
stops on unmount. Product copy, in Spanish: `Trabajando`, `Esperando`, `Te está preguntando`, and
the banner `No se ha podido recuperar la conversación coordinadora` with
`Claude Code ya no guarda esta conversación. No se ha abierto otra en su lugar.` — the backend's
English `detail` is diagnostic and never renders. No stylesheet of its own.
`frontend/vite.config.ts` adds `'/coordinating-session'` and `'/session-hooks'` to `API_PATHS`.

**TDD:** `it('shows the live question while the session is waiting')` — the client stubbed with a
`waiting` answer, asserting the question's text on screen. Test names are English here; only what
renders is Spanish.

**Tests:** in `useCoordinatingSession.test.ts`: `reads the state on mount`,
`reads again every two seconds`, `stops reading on unmount`. In `client.test.ts`:
`reads the coordinating session state`, `sends the idea when it opens the brainstorming`,
`returns the backend's refusal with its code`. In `CoordinatingSessionStatus.test.tsx`:
`shows that the session is working`, `shows the live question while the session is waiting`,
`warns that the conversation could not be recovered`.

**Verification:** the three suites are green and the dev proxy knows the path.

```bash
npm --prefix frontend test -- src/app/coordinating-session   # expected: exit 0
test "$(grep -c 'coordinating-session' frontend/vite.config.ts)" -eq 1   # expected: exit 0
```

### Task 11 — The entrance's one button opens the brainstorming

**Objective:** the form the cabin already had keeps its fields and its validation, and its single
button opens the brainstorming instead of starting a plan.

**Files:** `frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx` (modify),
`frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.test.tsx` (modify)

Current state (frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx, lines 168-172):

```tsx
      <div className="start-plan-form__actions">
        <Button type="submit" disabled={!canStart} aria-describedby={!canStart ? 'start-plan-help' : undefined}>
          {isSending ? <><Loading aria-label="Enviando la solicitud" /> Enviando solicitud</> : 'Arrancar plan'}
        </Button>
      </div>
```

The button reads `Arrancar brainstorming` — the literal §2 closed — and the sending label becomes
`Abriendo el brainstorming`. The submit calls `CoordinatingSessionClient.open(submission)` with
the very same `StartPlanSubmission` it builds today; `onStarted` becomes
`onOpened(opened, request)` and `onBackendUnreachable` becomes `onUnreachable(request)`. The
locked summary, the field validation, the refusal banner and the `start-plan-help` text are
untouched, and so is `frontend/src/app/start-plan/client.ts`, whose endpoint D-26 keeps.

**TDD:** `it('opens the brainstorming with the ticket and the comment')` — the client stubbed,
the assertion on the literal submission it received, `{id, userComment, repo, path}`. Then
`it('opens nothing while the repository or the path is missing')`.

**Tests:** `StartPlanForm.test.tsx` keeps its field, validation and locked-summary tests and
replaces the ones naming the plan with
`opens the brainstorming with the ticket and the comment`,
`opens the brainstorming with free text alone`,
`opens nothing while the repository or the path is missing`,
`shows the backend refusal without losing what was typed`,
`warns when the backend does not answer`.

**Verification:** the form's suite is green and the plan endpoint is no longer called from it.

```bash
npm --prefix frontend test -- src/app/start-plan   # expected: exit 0
test "$(grep -c 'StartPlanClient' frontend/src/app/start-plan/components/start-plan-form/StartPlanForm.tsx)" -eq 0   # expected: exit 0
```

### Task 12 — `Home` follows the entrance and keeps the session in every phase

**Objective:** the page wires the new form and the coordinating session's state, keeps the
terminal on screen and writable in every phase, and reaches the later stages through the restore
path it already has.

**Files:** `frontend/src/pages/home/Home.tsx` (modify),
`frontend/src/pages/home/__tests__/helpers.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.startPlan.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.sessions.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.implementPlan.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.implementProgress.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.implementHistory.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.planEvents.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.baseline.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.layout.test.tsx` (modify),
`frontend/src/pages/home/__tests__/Home.navigation.test.tsx` (modify)

Call site (frontend/src/pages/home/Home.tsx):

```tsx
          <section className="home__sessions" aria-label="Sesiones en marcha">
            <SessionsPanel />
            <CoordinatingSessionStatus />
          </section>
```

`planStarted`, `planStartUncertain` and the `uncertain-start` reconciliation branch leave with the
plan the form no longer starts. The `home__sessions` section stays outside every `currentStage`
branch, which is D-21. `helpers.tsx` renames `startPlan` to `openBrainstorming` against the new
label and `/coordinating-session`, and grows `openRestored(plan)`, which seeds
`WorkflowSnapshotStorage` and `/active-plans` so a suite opens `Home` already in the review or
implementation stage — the shape `Home.restoreWorkflow.test.tsx` already uses, and how every suite
that used to press the button now reaches a later stage. `Home.startPlan.test.tsx` keeps its path
on purpose: a rename would delete a file the scope control expects to still be there, and its
`describe` is what says it is about the brainstorming now.

**TDD:** `it('keeps the coordinating session reachable while a slice is implemented')` — `Home`
opened restored in the implementation stage, asserting the terminal's region is on screen **and**
that its input is not disabled.

**Tests:** added to `Home.sessions.test.tsx`:
`keeps the coordinating session reachable while a slice is implemented`,
`replays what was already said when the page reloads`,
`shows the coordinating session's live question`. `Home.startPlan.test.tsx` points at
`/coordinating-session`; its `uncertain-start` tests go with the branch they measured.

**Verification:** the whole frontend suite is green.

```bash
npm --prefix frontend test   # expected: exit 0
test "$(grep -c 'home__sessions' frontend/src/pages/home/Home.tsx)" -eq 1   # expected: exit 0 — one section, outside every stage branch
```

### Task 13 — The argv assertion pins its constants, and the record's two causes are told apart

**Objective:** two findings this slice's own judges raised are closed: the argv assertion stops
being built from the constants it measures, and an unreadable record stops being reported as a
failed write.

**Files:** `backend/__tests__/infrastructure/claude-conversations.test.ts` (modify),
`backend/src/domain/exceptions.ts` (modify),
`backend/src/infrastructure/disk-conversation-records.ts` (modify),
`backend/__tests__/infrastructure/disk-conversation-records.test.ts` (modify),
`backend/src/infrastructure/start-plan-route.ts` (modify)

Current state (backend/src/infrastructure/disk-conversation-records.ts, lines 82-87):

```ts
    try {
      return DiskConversationRecords.#conversationFrom(text)
    } catch (cause) {
      throw new ConversationNotRecorded(`the record at ${path} cannot be read as a conversation: ${String(cause)}`)
    }
  }
```

Contract (backend/src/domain/exceptions.ts):

```ts
export class ConversationNotUnderstood extends ConversationFailure {}
```

`recall()` raises `ConversationNotUnderstood` for a record that is there and cannot be read as a
conversation; `ConversationNotRecorded` stays for the write that failed, which is what the family
rule asks — the command failed, and the command answered something we cannot read. `PlanCollapse`
gains its row as `conversation-not-understood`, because `plan-refusal.test.ts` demands a refusal
for every leaf. In `claude-conversations.test.ts` the expected argv is spelled out literally
instead of interpolating `ClaudeConversations.PERMISSION_MODE` and `ClaudeConversations.OPENING`,
so that mutating either constant turns the test red — `OPENING` is the sentence that makes the
shell expand `$CT_PHASE_PROMPT`, which is this slice's second acceptance criterion and today no
test watches it.

**TDD:** `it('raises conversation-not-understood when the record cannot be read as a conversation')`
— the read double answers text that is not a conversation, and the assertion is on the type
raised, distinct from the write failure's. Then the argv assertion is rewritten to the literal
string and proven by mutating `OPENING` by hand and watching it fall.

**Tests:** added to `disk-conversation-records.test.ts`:
`raises conversation-not-understood when the record cannot be read as a conversation`.
Removed on purpose, replaced by it:
`raises conversation-not-recorded instead of reading a malformed record as no conversation`.
No test is added in `claude-conversations.test.ts`: its existing
`imposes the minted conversation id and leaves the prompt path in the environment` keeps its name
and gains the assertion it was missing.

**Verification:** the three suites are green and the assertion no longer names the constants it
measures.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test -- __tests__/infrastructure/claude-conversations.test.ts __tests__/infrastructure/disk-conversation-records.test.ts __tests__/infrastructure/plan-refusal.test.ts   # expected: exit 0
test "$(grep -c 'ClaudeConversations.OPENING' backend/__tests__/infrastructure/claude-conversations.test.ts)" -eq 0   # expected: exit 0 — the argv is spelled, not composed
```

### Task 14 — The three endpoints, the page and the vocabulary, written down

**Objective:** `API.md` documents the three new endpoints with the shapes a running server
answers, and the repository's vocabulary gains the terms this slice introduced.

**Files:** `backend/API.md` (modify), `frontend/README.md` (modify),
`backend/conventions/this-repository.md` (modify)

Final text (backend/API.md):

```md
| Endpoints | 13 (`POST` 5, `GET` 8) |
```

`API.md` gains three sections after `POST /sessions/:id/input`:
`POST /coordinating-session` (the body `{id?, user_comment?, repo, path}`, the 202 answer and its
own code `one-repository-only` beside the codes `POST /start-plan` already documents),
`GET /coordinating-session` (the three shapes `none`, `live`, `unresumable`) and
`POST /session-hooks` (Claude Code's own payload, the one endpoint that ignores unknown fields
instead of refusing them, and the codes `hook-not-understood` and `conversation-not-live`), each
with the `curl` line that reproduces it; the exception to rule 5 is named where rule 5 is stated.
`frontend/README.md` gains a paragraph on `app/coordinating-session`: what it polls, the
two-second cadence, and that the terminal is on the page in every phase and never disabled.
`backend/conventions/this-repository.md` adds to its ubiquitous language table **Coordinating
session**, **Phase prompt**, **Conversation** and **Session attention**.

**TDD:** No TDD — documentation, and every claim in it is verified against the repository by the
commands below.

**Tests:** N/A — no behaviour changes; the suites of Tasks 1 to 13 cover what is described.

**Verification:** every documented path is routed and the vocabulary is where it belongs.

```bash
test "$(grep -c '^## `POST /coordinating-session`' backend/API.md)" -eq 1   # expected: exit 0
test "$(grep -c '^## `GET /coordinating-session`' backend/API.md)" -eq 1   # expected: exit 0
test "$(grep -c '^## `POST /session-hooks`' backend/API.md)" -eq 1   # expected: exit 0
test "$(grep -c 'Coordinating session' backend/conventions/this-repository.md)" -eq 1   # expected: exit 0
test "$(grep -c 'app/coordinating-session' frontend/README.md)" -eq 1   # expected: exit 0
```

## 8. Global verification

Every suite green, the graph sound, and the three endpoints mounted on the server. Then, with
human eyes: `make run-frontend`, open `http://127.0.0.1:8787`, fill the entrance with a ticket
key and a description, press **Arrancar brainstorming**, and watch the terminal below the form
show `claude` starting in the governed checkout; the status reads **Trabajando** while it works
and flips to **Esperando** with its question under **Te está preguntando** when the brainstorming
asks something. Reload the page: the scrollback comes back. Stop the backend and start it again:
the same conversation is resumed and the terminal fills; delete its transcript under
`~/.claude/projects/` first instead, and the cabin says it could not be recovered and opens
nothing.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npm --prefix backend test   # expected: exit 0
npm --prefix frontend test   # expected: exit 0
test "$(grep -c 'CoordinatingSessionRoute.PATH' backend/src/infrastructure/api-server.ts)" -eq 3   # expected: exit 0 — get, post and the method refusal
test "$(grep -c 'SessionHooksRoute.PATH' backend/src/infrastructure/api-server.ts)" -eq 2   # expected: exit 0 — post and the method refusal
test -z "$(grep -l 'cmux' backend/src/infrastructure/claude-conversations.ts)"   # expected: exit 0 — D-16
```

## 9. Assumptions

1. **The phase prompt is read by the session, not injected by a hook.** The acceptance criterion
   fixes the file and the environment variable, not who reads them. `claude` is spawned through
   the login shell so the shell expands `$CT_PHASE_PROMPT` into a one-sentence opening argument
   that tells the session to read that file. Nothing of the prompt's text ever reaches an
   argument, which is what D-25 asks and what the amendment's `MAX_ARG_STRLEN` argument forbids,
   and the opening argument starts the conversation, which a hook's context injection does not.
   Provenance: own call, from D-25 and the issue's second criterion.
2. **Three hooks, not four.** The criterion asks the hooks to report working, waiting and the
   live question: `UserPromptSubmit`, `Notification` and `Stop` report all three. `SessionStart`
   is not written, because with assumption 1 it would have no reader. Provenance: own call, from
   the issue's fourth criterion and `plugin/conventions/simplicity.md`.
3. **The hooks are guarded by `$CT_SESSION_HOOKS_URL`.** They live in the checkout's
   `.claude/settings.local.json` and therefore run in every session a person starts there; the
   guard makes them inert in any session the backend did not spawn. Provenance: own call.
4. **`.claude/settings.local.json` is not repository content.** The epic's design says the app
   writes exactly one thing into the governed repository's tree, the freeze; local settings are
   untracked machine state, which is where the POC puts the same hooks. Provenance: epic context
   plus the design's own description of the POC.
5. **`--permission-mode acceptEdits`, and no `--model`.** The brainstorming writes a spec
   document, so it needs to edit without a prompt per file; the model stays whatever the user's
   `claude` defaults to, because no decision of this epic names one for the entrance.
   Provenance: own call.
6. **One coordinating session at a time.** One record under the state root, replaced when a new
   entrance opens one: an epic governs one checkout, and D-17's write-once record is the dispatch
   record of slice 6, not this one. Provenance: own call, from D-26.
7. **The body of `POST /coordinating-session` is parsed by `PlanRequest`.** The entrance keeps
   the shape the form already sends, so the decision about what a well-formed entrance is stays
   in one place; only `one-repository-only` is new. Provenance: `plugin/conventions/decisions.md`.
8. **`Home`'s review and implementation stages are not removed.** The form no longer starts a
   plan, so `Home` no longer creates a workflow from it; the stages keep their restore path
   through `GET /active-plans`, which is already implemented and tested, and slices 4 to 8
   replace them. What goes is only what loses its last caller: `planStarted`,
   `planStartUncertain` and the `uncertain-start` branch. Provenance: own call, from D-26 and the
   issue's out-of-scope section.
9. **The attention is read by polling, not by a stream.** One endpoint answers the three states
   the page needs, including the one where there is no session to stream, and the page reads it
   every two seconds — the cadence the backend already uses between reads. A second frame kind on
   the session stream would need a mechanism for a state that is not bytes. Provenance: own call.
10. **The observability signal is the endpoint plus the log line.** `GET /coordinating-session`
    carries `attention.status`, bounded to `working` and `waiting`, and its question; every
    transition also writes `coordinating session <id> <status>` to the backend's stderr, the way
    `PtyLiveSessions` already announces a session opening. Provenance: the issue's observability
    section.
11. **The baseline was measured, not inherited.** `.agent/SLICE.md` says `no-verificado` because
    this worktree had no `node_modules`; after `npm ci` in `backend/` and `frontend/` the tree is
    green — typecheck exit 0, 1453 backend tests, 946 frontend tests. Provenance: own call.
12. **The phase prompt is written in English**, in the task that creates it. `CLAUDE.md` puts
    agent prompts in English and refuses the declared-debt exemption for language, so the Spanish
    of `plan-agent-brief.ts` is debt rather than the pattern to copy — which is why §3 names that
    file for its shape and says so. Provenance: `CLAUDE.md`, via a judge veto of Task 2.
13. **`ConversationFailure` names two causes that are both "the command failed".** The repository
    asks each family to name the command failing and the command answering something unreadable.
    `ConversationNotStarted` and `ConversationNotRecorded` are two failures to act across two
    collaborators, and Task 6 adds no `*NotUnderstood`: a malformed record raises
    `ConversationNotRecorded` too. Recorded rather than fixed, because the alternative splits one
    family in two for a cause no caller tells apart. Provenance: own call, after a judge raised it.
14. **Test names are English, in every package.** `CLAUDE.md` puts `describe`/`it`/`test` names
    in the English bucket with no product-copy exemption, and `frontend/__tests__/yardstick.test.ts`
    enforces it with a denylist of Spanish words. An earlier draft of this plan named the frontend
    tests in Spanish, confusing "what renders is Spanish" with "the test that watches it is". Only
    what renders is. Provenance: `CLAUDE.md`, via a control that refused Task 10.
15. **A fourteenth task closes two findings this run raised.** The argv assertion built from its
    own constants (Task 4, judge `low`) and the two failure causes collapsed into one exception
    (Task 6, declared by its implementer and recorded as decision 13) are repaired in Task 13,
    before the documentation task, so `API.md` is written against the final set of codes. What
    that task deliberately does NOT touch, and what therefore remains open: `ct-api.ts` still
    awaits the start-up recovery unguarded, so an unreadable record kills the backend instead of
    being reported — the judge's `low` on Task 9. Renaming the exception does not change that.
    Provenance: the coordinating session, asked for these two and no more.
16. **Fourteen tasks.** The slice was cut with a human in the room and carries eight acceptance
    criteria across three packages; splitting the slice is not in this session's hands, so the
    work is split into commits instead. Every `**Files:**` line spells each path in full, because
    `splitFiles` (`plugin/scripts/plan-tasks.js`) reads every backticked token in that paragraph
    as a path: an abbreviated list would hand the scope control bare basenames. Provenance: the
    prescriptive planning skill and that parser.
