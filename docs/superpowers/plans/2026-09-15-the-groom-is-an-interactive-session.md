# The groom is a conversation, and a re-slicing travels as a pull request

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the brief and `CLAUDE.md` win.

## 1. Context and goal

Gate 2 is a button that creates. `read-epic-groom.ts` answers `groomable` when the spec is
frozen, its copy is readable on the default branch and the milestone holds no issue yet;
`EpicGroomPanel.tsx` then draws the dry run and **Ejecutar el groom**, and
`POST /epic-groom` runs `ct-groom.mjs` for real. The person's only say is yes or no to a list
they cannot touch, and the §9 table — the one place where the slicing can actually change — is
not on that screen.

Three things are missing and one is a hole. Missing: a way to *talk* about the slicing, a way
for a change to the slicing to reach the default branch, and a way for the issues to be created
once that change is approved. The hole: `GhPublishedSpecs.holds()` asks GitHub for
`repos/<owner>/<repo>/contents/<path>` and answers **true if the path exists**, so after the
first freeze the file always exists and a local re-slicing that has not merged yet reads as
published — the issues would be created from a table nobody approved.

A phase of this loop is a prompt, not a mode: `PhasePrompt.brainstorming()` already builds one
and the backend writes it to a file `claude` is pointed at through `CT_PHASE_PROMPT`. The plugin
already ships the groom as a skill, `control-tower-loop:ct-groom`. So the groom phase is one
more static factory beside `brainstorming`, and no second machine.

### Desired end state

- `PhasePrompt.groom(...)` exists beside `brainstorming`, invokes
  `control-tower-loop:ct-groom`, carries the same role sentence and tells the session that the
  issues are not its to create and that a re-slicing is published for it.
- `POST /groom-session` opens that conversation in the checkout the backend holds, and gate 2's
  panel offers it while the state is `groomable`, beside the dry run and beside
  **Ejecutar el groom**, which is unchanged.
- Publication compares **content**: the git blob sha of the local spec against the `sha` the
  contents API reports for the default branch. A local edit that has not merged never reads as
  published.
- A frozen spec whose local copy is not published **and is not committed** is the new state
  `resliced`: gate 2 refuses the groom there and offers **Publicar el nuevo slicing**, which
  commits the spec on the milestone branch, pushes it and opens a pull request carrying the
  marker `<!-- ct-groom:reslicing -->`.
- When that pull request merges, the read at `groomable` carries it in `reslicing` and the page
  presses gate 2 by itself: no further click.
- A press whose answer never arrives confirms itself with a read instead of claiming a failure
  the page does not know about.

### Out of scope

- Renaming any `Epic*` identifier: `docs/glossary.md` declares them debt and the rename is a
  separate coordinated move.
- The polling of `useEpicGroom.ts`, the place where `read-epic-groom.ts` decides publication,
  and **Autorizar el trabajo**, which stays a person's click.
- Anything under `plugin/`: no bundle changes and `plugin/dist/` stays untouched.
- Storing a phase anywhere: every phase stays derived from evidence that survives a restart.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| D1 · The groom phase is a phase prompt | `PhasePrompt.groom(...)` beside `brainstorming`, invoking `control-tower-loop:ct-groom`, with the same role sentence and the rule that mirrors `FREEZE_IS_NOT_YOURS`: the session never creates the issues itself. Gate 2 creates them, on a person's click or on the merge of a re-slicing pull request |
| D2 · In `groomable`, gate 2 opens the conversation | The dry run stays on screen and **Ejecutar el groom** stays exactly as it is. What is new is the way in: a second button that calls `POST /groom-session` |
| D3 · A re-slicing travels as a pull request | The session edits the spec's §9 table and stops. The program cuts or reuses the milestone branch, commits, pushes and opens the pull request — the same two ports gate 1 uses (`EpicBranch`, `PullRequests`). The spec stays `CONGELADA`: the state line and the date do not change |
| D4 · When that pull request merges, the issues are created with no further click | The merge is the authorisation and the trigger is evidence: a **merged** pull request of the branch whose body carries `<!-- ct-groom:reslicing -->`. The page, which already reads gate 2 every ten seconds while it waits, presses gate 2 once when it sees it |
| D5 · Publication compares CONTENT, not existence | `PublishedSpecs.holds({ repository, spec })` compares the git blob sha of the local spec's text against the `sha` the contents API reports. A local edit that has not merged must not read as published |
| D6 · The page must not lie while the groom is working | A press that cannot be read back is not a failure: the client re-reads gate 2 and answers what the read says, and where it still cannot tell it says so — never «No se pudo contactar con el backend» over a groom that created four issues |

## 3. Reference patterns

Files to imitate: `backend/src/application/actions/open-coordinating-session.ts`,
`backend/src/application/actions/freeze-spec.ts`,
`backend/src/infrastructure/coordinating-session-route.ts`,
`backend/src/infrastructure/spec-freeze-route.ts`,
`backend/src/infrastructure/gh-published-specs.ts`,
`backend/src/infrastructure/gh-pull-requests.ts`,
`backend/__tests__/application/open-coordinating-session.test.ts`,
`backend/__tests__/infrastructure/gh-published-specs.test.ts`,
`frontend/src/app/epic-groom/client.ts`,
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx`,
`frontend/src/app/spec-freeze/useSpecFreeze.ts`.

Rules to obey: `CLAUDE.md`, `AGENTS.md`, `backend/conventions/this-repository.md`,
`plugin/conventions/simplicity.md`, `plugin/conventions/architecture.md`,
`plugin/conventions/boundaries.md`, `plugin/conventions/domain.md`,
`plugin/conventions/style.md`, `plugin/conventions/testing.md`,
`plugin/conventions/decisions.md`, `plugin/conventions/defects.md`,
`docs/glossary.md`, `frontend/README.md`, `backend/API.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/domain/value-objects/phase-prompt.ts` | modify | `OpenGroomSession` | Contract |
| `backend/src/application/actions/open-groom-session.ts` | create | `GroomSessionRoute` | Contract |
| `backend/src/infrastructure/groom-session-route.ts` | create | `api-server.ts` | Contract |
| `backend/src/infrastructure/api-server.ts` | modify | `ct-api.ts` | Call site |
| `backend/src/infrastructure/ct-api.ts` | modify | the entrypoint | none (body by TDD) |
| `backend/src/domain/ports/published-specs.ts` | modify | `ReadEpicGroom` | Contract |
| `backend/src/infrastructure/gh-published-specs.ts` | modify | `ct-api.ts` | Contract |
| `backend/src/domain/exceptions.ts` | modify | `PlanCollapse` | Contract |
| `backend/src/application/queries/read-epic-groom.ts` | modify | `epic-groom-route.ts` | Current state |
| `backend/src/application/actions/groom-epic.ts` | modify | `epic-groom-route.ts` | Current state |
| `backend/src/infrastructure/epic-groom-route.ts` | modify | `api-server.ts` | Contract |
| `backend/src/domain/value-objects/reslicing.ts` | create | `PublishReslicing`, `GhPullRequests` | Contract |
| `backend/src/application/actions/publish-reslicing.ts` | create | `SpecReslicingRoute` | Contract |
| `backend/src/infrastructure/spec-reslicing-route.ts` | create | `api-server.ts` | Contract |
| `backend/src/domain/ports/pull-requests.ts` | modify | `ReadEpicGroom` | Contract |
| `backend/src/infrastructure/gh-pull-requests.ts` | modify | `ct-api.ts` | Contract |
| `frontend/src/app/epic-groom/EpicGroom.types.ts` | modify | the client and the panel | Contract |
| `frontend/src/app/epic-groom/client.ts` | modify | the panel | Contract |
| `frontend/src/app/epic-groom/useMergedReslicing.ts` | create | the panel | Contract |
| `frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` | modify | `Home` | none (body by TDD) |
| `frontend/src/__scenarios__/EpicGroomMother.ts` | modify | the frontend tests | none (body by TDD) |
| `backend/API.md` | modify | whoever reads the contract | Final text |
| `frontend/README.md` | modify | whoever reads the frontend | Final text |
| `backend/conventions/this-repository.md` | modify | every diff here | Final text |

## 5. Interfaces

Consumes: nothing new from outside. `EpicBranch.publishing / committed / commit / pushed / push`
and `PullRequests.openOfBranch / open` already exist and are what a re-slicing travels through;
`Conversations.mint / start`, `ConversationRecords.prepare` and `SessionHooks.install` already
exist and are what a phase prompt is started with.

Produces:
`PhasePrompt.groom({ spec, milestone, repository, root }) => PhasePrompt`;
`OpenGroomSession.execute(OpenGroomSessionParams) => Promise<GroomSessionOpened>`;
`PublishReslicing.execute(PublishReslicingParams) => Promise<ReslicingPublished>`;
`PublishedSpecs.holds({ repository, spec }) => Promise<boolean>`;
`PullRequests.mergedReslicingOf({ branch, repository }) => Promise<ReviewedPullRequest | null>`;
`Reslicing.MARKER`, `Reslicing.titleOf(milestone)`, `Reslicing.bodyFor({ milestone, path })`,
`Reslicing.isAnnouncedIn(body)`;
`EpicGroomState.RESLICED`;
`EpicGroomRead.reslicing`;
`GroomSessionRoute.PATH = '/groom-session'`, `SpecReslicingRoute.PATH = '/spec-reslicing'`.

## 6. Test strategy

Outside-in, as `plugin/conventions/testing.md` fixes it: the application layer first with every
port doubled, then the adapters cut right before `gh` and `git`, then each controller through a
real listening server. The domain gets no tests of its own — `PhasePrompt.groom` and `Reslicing`
are reached through the use cases that carry them.

Every adapter test names the real capture its declared shape comes from. Two were taken for this
slice, on 2026-09-15, against `mercadona/control-tower`:

- `gh api repos/mercadona/control-tower/contents/VERSION` →
  `{"name":"VERSION","path":"VERSION","sha":"6e8bf73aa550d4c57f6f35830f1bcdc7a4a62f38",…}`, and
  `printf '0.1.0\n' | git hash-object --stdin` prints that same sha, which is what makes the
  blob sha the honest comparison;
- `gh pr list --repo mercadona/control-tower --state merged --json number,url,body --limit 1` →
  a JSON array of `{"body":…,"number":361,"url":…}`.

No test launches a real process, so no file of this slice carries the `-real-process` suffix.
Backend suites run from `backend/`, frontend suites from `frontend/`.

## 7. Tasks

### Task 1 — The groom phase is a prompt, and one use case starts it

**Objective:** `PhasePrompt.groom(...)` exists and `OpenGroomSession` starts that conversation in
the held checkout, recording it and installing the hooks before it starts.

**Files:** `backend/src/domain/value-objects/phase-prompt.ts` (modify),
`backend/src/application/actions/open-groom-session.ts` (create),
`backend/__tests__/application/open-groom-session.test.ts` (create)

Current state (backend/src/domain/value-objects/phase-prompt.ts, lines 19-31):

```ts
  static brainstorming({ story, comment, repository, root }: {
    story: UserStory | null,
    comment: PlanComment | null,
    repository: RepositoryName,
    root: CheckoutRoot,
  }): PhasePrompt {
    return new PhasePrompt([
      `Invoke the skill ${PhasePrompt.BRAINSTORMING_SKILL}.`,
      `You are the coordinating session of the epic for ${repository.text}, in the checkout ${root.text}: you cut no worktree and you switch no branch.`,
      PhasePrompt.FREEZE_IS_NOT_YOURS,
      ...PhasePrompt.#idea({ story, comment }),
    ].join('\n'))
  }
```

Contract (backend/src/domain/value-objects/phase-prompt.ts):

```ts
static readonly GROOM_SKILL = 'control-tower-loop:ct-groom'
static readonly ISSUES_ARE_NOT_YOURS: string
static readonly RESLICING_TRAVELS_AS_A_PULL_REQUEST: string
static groom({ spec, milestone, repository, root }: {
  spec: EpicSpec, milestone: string, repository: RepositoryName, root: CheckoutRoot,
}): PhasePrompt
static #roleOf({ repository, root }: { repository: RepositoryName, root: CheckoutRoot }): string
```

The role sentence moves into `#roleOf` byte for byte and both factories use it. `groom` joins,
in this order: `Invoke the skill ${GROOM_SKILL}.`, the role sentence, `ISSUES_ARE_NOT_YOURS`,
`RESLICING_TRAVELS_AS_A_PULL_REQUEST`, and
`` `The milestone is "${milestone}" and its frozen execution spec is ${spec.path}.` ``.
`ISSUES_ARE_NOT_YOURS` says the session never creates the issues itself, that gate 2 writes the
milestone, the labels, the issues and the Project on a person's click or on the merge of a
re-slicing pull request, and that its job is to walk the §9 table with the person and stop.
`RESLICING_TRAVELS_AS_A_PULL_REQUEST` says that a change to the slicing is an edit of the §9
table and nothing else — state line and date untouched, nothing committed, nothing pushed —
and that gate 2 publishes it as a pull request whose merge creates the issues.

Contract (backend/src/application/actions/open-groom-session.ts):

```ts
export class OpenGroomSessionParams {
  readonly repository: RepositoryName
  readonly root: CheckoutRoot
}
export const GroomSessionOpening = Object.freeze({ OPENED: 'opened', NO_SPEC: 'no-spec' } as const)
export class GroomSessionOpened {
  readonly outcome: GroomSessionOpeningValue
  readonly conversation: CoordinatingConversation | null
  readonly session: LiveSession | null
  static opened(conversation: CoordinatingConversation, session: LiveSession): GroomSessionOpened
  static noSpec(): GroomSessionOpened
}
export class OpenGroomSession {
  constructor({ specs, conversations, sessionHooks, records }: {
    specs: EpicSpecs, conversations: Conversations,
    sessionHooks: SessionHooks, records: ConversationRecords,
  })
  execute(params: OpenGroomSessionParams): Promise<GroomSessionOpened>
}
```

The milestone is `spec.title()!`, the way `read-epic-groom.ts:118` already takes it: the only
adapter of `EpicSpecs` refuses a spec with no title, so the assertion states that invariant.
No `Workspace.confirm`: the root arrives already confirmed from the conversation the backend
holds.

**TDD:** red first —
`it('the groom conversation is told to invoke the groom skill, that the issues are not its to create and that a re-slicing is published for it')`,
asserting `records.prepared[0].prompt.text` equals the five lines above joined by `\n`, with the
role sentence identical to the one `brainstorming` writes. Then
`it('a checkout with no execution spec opens no conversation at all')` —
`outcome` is `no-spec`, and `conversations.started`, `records.prepared` and
`sessionHooks.installed` are all empty.

**Tests:** added, in `backend/__tests__/application/open-groom-session.test.ts`:
`the groom conversation is told to invoke the groom skill, that the issues are not its to create and that a re-slicing is published for it`,
`a checkout with no execution spec opens no conversation at all`,
`the hooks are installed and the conversation recorded before the session starts`,
`the session starts on the path the records answered, in the checkout it was asked about`.
Removed: none.

**Verification:** the typecheck is clean, the new suite is green and the four tests are the ones
named above.

```bash
npm --prefix backend run typecheck                                                        # expected: exit 0 — the graph is sound
npx --prefix backend vitest run --root backend __tests__/application/open-groom-session.test.ts   # expected: exit 0 — the new suite is green
test "$(grep -c "^  it('" backend/__tests__/application/open-groom-session.test.ts)" -eq 4       # expected: exit 0 — four tests, no more
npm --prefix backend test                                                                 # expected: exit 0 — nothing else broke
```

### Task 2 — `POST /groom-session` opens it, and only from the page

**Objective:** gate 2 has a door that opens the groom conversation, refused without the gate key,
without a held checkout, while another conversation is live and when there is no spec.

**Files:** `backend/src/infrastructure/groom-session-route.ts` (create),
`backend/src/infrastructure/api-server.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/infrastructure/groom-session-route.test.ts` (create),
`backend/API.md` (modify)

Contract (backend/src/infrastructure/groom-session-route.ts):

```ts
export const GroomSessionOutcome = Object.freeze({
  ACCEPTED: 'accepted',
  NOT_FROM_THE_PAGE: 'gate-not-from-the-page',
  NO_COORDINATING_SESSION: 'no-coordinating-session',
  NO_EPIC_SPEC: 'no-epic-spec',
  ALREADY_LIVE: 'coordinating-session-already-live',
  OPENING: 'coordinating-session-opening',
} as const)
export class GroomSessionRoute {
  static readonly PATH = '/groom-session'
  static readonly METHODS = 'POST'
  static readonly STATUS = 'grooming'
  static opening(held: CoordinatingSessions, open: OpenGroomSession, key: GateKey): RequestHandler
  static refuseOtherMethods(request: Request, response: Response): void
}
```

The handler, in this order: no gate key → 403 `gate-not-from-the-page`; `held.held() === null` →
400 `no-coordinating-session`; `held.reserve()` not `RESERVED` → 409 `coordinating-session-already-live`
or `coordinating-session-opening`, projected with `Projection` the way
`coordinating-session-route.ts` projects them; `open.execute` throwing `PlanFailure` →
`held.release()` and `PlanCollapse.of(cause)`; `no-spec` → `held.release()` and 400
`no-epic-spec`; otherwise `held.remember(new HeldCoordinatingSession({ state: LIVE, … , attention: SessionAttention.working() }))`
and 202 `{ status: 'grooming', conversation, repo, root, session: { id, name } }`.

Call site (backend/src/infrastructure/api-server.ts):

```ts
app.post(GroomSessionRoute.PATH, Browsers.turnAwayForeign,
  GroomSessionRoute.opening(this.coordinatingSessions!, this.openGroomSession!, this.gateKey!))
app.all(GroomSessionRoute.PATH, GroomSessionRoute.refuseOtherMethods)
```

`ApiCollaborators` gains `openGroomSession?: OpenGroomSession | null`, `ct-api.ts` builds it with
`specs: epicSpecs` and the same `claudeConversations`, `sessionHooks` and `conversationRecords`
`openCoordinatingSession` already gets. This door takes no JSON body, so it mounts without
`JsonBody.demandDeclared`.

**TDD:** red first —
`it('a press carrying the gate key opens the groom conversation and answers the session it started')`,
through a real listening server: 202, body `status` `grooming` and the session's id and name, and
the double received the held conversation's repository and root. Then
`it('a press without the gate key is refused and the use case is never asked')` — 403,
`gate-not-from-the-page`, and the double recorded no call.

**Tests:** added, in `backend/__tests__/infrastructure/groom-session-route.test.ts`:
`a press carrying the gate key opens the groom conversation and answers the session it started`,
`a press without the gate key is refused and the use case is never asked`,
`a press with no coordinating session held is refused before the use case is asked`,
`a press while a coordinating conversation is live is refused as already live`,
`a checkout with no execution spec is refused as no-epic-spec and the opening reservation is released`,
`a get on the groom session door answers 405 naming the method it takes`.
Removed: none.

**Verification:** the new suite is green, `api-server`'s own suite still is, and `API.md` carries
the new endpoint.

```bash
npm --prefix backend run typecheck                                                          # expected: exit 0
npx --prefix backend vitest run --root backend __tests__/infrastructure/groom-session-route.test.ts   # expected: exit 0
test "$(grep -c 'POST /groom-session' backend/API.md)" -ge 1                                # expected: exit 0 — the contract is documented
npm --prefix backend test                                                                   # expected: exit 0
```

### Task 3 — The page's way into the conversation

**Objective:** while the state is `groomable`, gate 2's panel offers a second button that opens
the groom conversation, beside the dry run and beside **Ejecutar el groom**, which is untouched.

**Files:** `frontend/src/app/epic-groom/EpicGroom.types.ts` (modify),
`frontend/src/app/epic-groom/client.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` (modify),
`frontend/src/app/epic-groom/client.test.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx` (modify),
`frontend/src/__scenarios__/EpicGroomMother.ts` (modify),
`frontend/README.md` (modify)

Contract (frontend/src/app/epic-groom/EpicGroom.types.ts):

```ts
export type GroomSessionOutcome =
  | { kind: 'opened' }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unconfirmed' }
```

Contract (frontend/src/app/epic-groom/client.ts):

```ts
const SESSION_PATH = '/groom-session'
const OPENED_STATUS = 202
const openSession = (key: string): Promise<GroomSessionOutcome>
```

The panel's Spanish copy: the button is `Revisar el slicing con la sesión`, `Abriendo la sesión`
while the press is in flight, and once opened the panel reads
`Sesión del groom abierta: habla con ella en el panel de sesiones.` A refusal shows in the same
`Banner type="error" role="alert"` the other presses use.

**TDD:** red first —
`it('the way into the conversation carries the gate key and says where the session can be talked to')`
in `EpicGroomPanel.test.tsx`: after clicking `Revisar el slicing con la sesión`, the second fetch
is `'/groom-session'` with `{ method: 'POST', headers: { 'x-gate-key': EpicGroomMother.KEY } }`
and the sentence above is on screen. It has to fail before the button exists and after the header
is dropped.

**Tests:** added:
`the way into the conversation carries the gate key and says where the session can be talked to`,
`a refused opening is shown with the words the program printed and leaves the dry run on screen`
(`EpicGroomPanel.test.tsx`);
`an accepted opening answers opened, and a refusal answers the code and the detail` (`client.test.ts`).
`EpicGroomMother` gains `groomSessionOpened()` and `groomSessionNotFromThePage()`.
Removed: none.

**Verification:** the frontend builds the way CI builds it and its suite is green.

```bash
npm --prefix frontend run build      # expected: exit 0 — tsc --noEmit and vite build, what CI runs
npm --prefix frontend test           # expected: exit 0
```

### Task 4 — Publication compares content, not existence

**Objective:** a frozen spec whose local text differs from what the default branch holds stops
reading as published, so no groom can run from a table nobody approved.

**Files:** `backend/src/domain/ports/published-specs.ts` (modify),
`backend/src/infrastructure/gh-published-specs.ts` (modify),
`backend/src/domain/exceptions.ts` (modify),
`backend/src/infrastructure/start-plan-route.ts` (modify),
`backend/src/application/queries/read-epic-groom.ts` (modify),
`backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/infrastructure/gh-published-specs.test.ts` (modify),
`backend/__tests__/application/read-epic-groom.test.ts` (modify), `backend/API.md` (modify)

Current state (backend/src/infrastructure/gh-published-specs.ts, lines 20-28):

```ts
  async holds({ repository, path }: { repository: RepositoryName, path: string }): Promise<boolean> {
    const outcome = await this.gh.run(GhPublishedSpecs.argvFor({ repository, path }), { safeToRepeat: true })
    if (!outcome.failed) return true
    if (Gh.isNotFound(outcome.stderr)) return false

    throw new PublishedSpecNotRead(
      `${Gh.BIN} api repos/${repository.text}/contents/${path} failed: ${outcome.stderr.trim()}`
    )
  }
```

Contract (backend/src/infrastructure/gh-published-specs.ts):

```ts
static readonly BLOB = 'blob'
constructor({ gh, digest }: { gh: Gh, digest: (text: string) => string })
static blobTextOf(text: string): string
async holds({ repository, spec }: { repository: RepositoryName, spec: EpicSpec }): Promise<boolean>
```

`blobTextOf` is `` `blob ${Buffer.byteLength(text, 'utf8')}\0${text}` `` — git's own blob
envelope, so `digest` over it is the very sha the contents API reports. `digest` arrives from
`ct-api.ts` as `(text) => createHash('sha1').update(text, 'utf8').digest('hex')`; the adapter
picks no algorithm. `holds` projects only the `sha` key of the answer and raises the new
`PublishedSpecNotUnderstood extends SpecFreezeFailure` when it is absent or not a string,
quoting what `gh` printed. `PlanCollapse` declares it as `published-spec-not-understood`.

**TDD:** red first —
`it('a spec whose local text is not the text the default branch holds is not published')`: the
double answers the captured `contents` payload with the sha of another text and the answer is
`false`, while the same payload with `printf`'s own blob sha answers `true`. Then
`it('an answer with no readable sha is told apart from a gh that failed')` — the first raises
`PublishedSpecNotUnderstood`, the second `PublishedSpecNotRead`.

**Tests:** added, in `gh-published-specs.test.ts`:
`a spec whose local text is not the text the default branch holds is not published`,
`a spec whose blob sha is the one the default branch reports is published`,
`an answer with no readable sha is told apart from a gh that failed`.
Changed: the two existing tests that call `holds({ repository, path })` now pass a real
`EpicSpec`; `read-epic-groom.test.ts`'s `PublishedSpecsDouble` records `{ repository, spec }` and
its assertions name the spec. Removed: none.

**Verification:** the blob sha of `0.1.0\n` computed by the production code equals what
`git hash-object` prints, and both suites are green.

```bash
npm --prefix backend run typecheck   # expected: exit 0
npx --prefix backend vitest run --root backend __tests__/infrastructure/gh-published-specs.test.ts   # expected: exit 0
npx --prefix backend vitest run --root backend __tests__/infrastructure/plan-refusal.test.ts         # expected: exit 0 — the new failure is declared
npm --prefix backend test            # expected: exit 0
```

### Task 5 — A frozen spec edited locally is `resliced`, and the groom refuses there

**Objective:** the read tells apart a re-slicing waiting to travel from a pull request waiting to
merge, and gate 2 refuses the groom while the local spec disagrees with the default branch.

**Files:** `backend/src/application/queries/read-epic-groom.ts` (modify),
`backend/src/application/actions/groom-epic.ts` (modify),
`backend/src/infrastructure/epic-groom-route.ts` (modify),
`backend/__tests__/application/read-epic-groom.test.ts` (modify),
`backend/__tests__/application/groom-epic.test.ts` (modify),
`backend/__tests__/infrastructure/epic-groom-route.test.ts` (modify), `backend/API.md` (modify)

Current state (backend/src/application/queries/read-epic-groom.ts, lines 113-119):

```ts
    const isPublished = await this.published.holds({ repository: params.repository, path: spec.path })
    if (!isPublished) {
      return new EpicGroomRead({
        state: EpicGroomState.AWAITING_PUBLICATION, spec, milestone: null, plan: null, planFingerprint: null,
        issues: [], pullRequest: await this.#awaitedPullRequest(params),
      })
    }
```

Contract (backend/src/application/queries/read-epic-groom.ts):

```ts
export const EpicGroomState = Object.freeze({ /* … */ RESLICED: 'resliced', /* … */ } as const)
```

Inside `!isPublished`, before the pull request is asked for: when
`await this.branch.committed({ root: params.root, paths: [spec.path] })` is `false` the state is
`RESLICED`, with `milestone`, `plan`, `planFingerprint` and `pullRequest` all null and `issues`
empty, and neither `git`'s branch nor `gh` is asked anything else. `GroomEpic.REFUSED` gains
`EpicGroomState.RESLICED`. `epic-groom-route.ts` gains `EpicGroomOutcome.SPEC_RESLICED = 'spec-resliced'`
with the detail
`the slicing changed in the coordinating session: publish it and merge it before the groom runs`,
its row in `EpicGroomRefusal.#BY_STATE`, and a `#answerRead` case answering 200
`{ status: 'resliced', …(minted === null ? {} : { key: minted }) }`.

**TDD:** red first —
`it('a frozen spec the session edited and nobody committed is resliced, and the pull request is never asked for')`:
`published` answers `false`, `branch.committed` answers `false`, the state is `resliced` and
`flow.pullRequests.asked` is empty. Then
`it('pressing the groom over a resliced spec is refused with the reason and nothing is groomed')`
in `groom-epic.test.ts`: the state comes back `resliced`, staleness `fresh`, and
`flow.groom.ran` is empty.

**Tests:** added:
`a frozen spec the session edited and nobody committed is resliced, and the pull request is never asked for`,
`a frozen spec whose edit is already committed still waits for its pull request to merge`
(`read-epic-groom.test.ts`);
`pressing the groom over a resliced spec is refused with the reason and nothing is groomed`
(`groom-epic.test.ts`);
`a resliced spec answers the state and the gate key and no plan`,
`a press over a resliced spec answers spec-resliced` (`epic-groom-route.test.ts`).
Removed: none.

**Verification:** the three suites are green and `API.md` declares the state and the code.

```bash
npm --prefix backend run typecheck                                            # expected: exit 0
test "$(grep -c 'spec-resliced' backend/API.md)" -ge 1                        # expected: exit 0 — the refusal is documented
npm --prefix backend test                                                     # expected: exit 0
```

### Task 6 — The re-slicing travels as a pull request

**Objective:** `POST /spec-reslicing` commits the corrected spec on the milestone branch, pushes
it and opens the pull request whose merge will authorise the groom.

**Files:** `backend/src/domain/value-objects/reslicing.ts` (create),
`backend/src/application/actions/publish-reslicing.ts` (create),
`backend/src/infrastructure/spec-reslicing-route.ts` (create),
`backend/src/infrastructure/api-server.ts` (modify), `backend/src/infrastructure/ct-api.ts` (modify),
`backend/__tests__/application/publish-reslicing.test.ts` (create),
`backend/__tests__/infrastructure/spec-reslicing-route.test.ts` (create), `backend/API.md` (modify)

Contract (backend/src/domain/value-objects/reslicing.ts):

```ts
export class Reslicing {
  static readonly MARKER = '<!-- ct-groom:reslicing -->'
  static titleOf(milestone: string): string
  static bodyFor({ milestone, path }: { milestone: string, path: string }): string
  static isAnnouncedIn(body: string): boolean
}
```

`titleOf` is `` `${milestone} — re-slicing of the execution spec` ``. `bodyFor` opens with
`MARKER` on its own line and then says, in English, that the slicing of this milestone changed in
the coordinating session, that the spec stays frozen, and that merging authorises gate 2 to
create the issues from the table the spec now carries, naming `path`.

Contract (backend/src/application/actions/publish-reslicing.ts):

```ts
export class PublishReslicingParams { readonly root: CheckoutRoot; readonly repository: RepositoryName }
export const ReslicingOutcome = Object.freeze({
  PUBLISHED: 'published', NO_SPEC: 'no-spec', NOT_FROZEN: 'not-frozen',
} as const)
export class ReslicingPublished {
  readonly outcome: ReslicingOutcomeValue
  readonly pullRequest: { readonly number: number, readonly url: string } | null
}
export class PublishReslicing {
  constructor({ specs, branch, pullRequests }: { specs: EpicSpecs, branch: EpicBranch, pullRequests: PullRequests })
  execute(params: PublishReslicingParams): Promise<ReslicingPublished>
}
```

The sequence, which is gate 1's own machinery through the same two ports: read the spec; refuse
`no-spec` and `not-frozen`; `branch.publishing({ root, milestone: spec.milestoneBranch() })`;
`specs.reread(...) ?? found`, so what the branch holds is what gets published; commit
`[spec.path]` as `` `Re-slice the execution spec of ${milestone}` `` unless
`branch.committed` already says there is nothing to commit; push unless `branch.pushed`; answer
the standing `pullRequests.openOfBranch` if there is one, else
`pullRequests.open({ repository, branch, title: Reslicing.titleOf(milestone), body: Reslicing.bodyFor(...) })`.
Nothing writes into the spec: the state line and the date are never touched.

`SpecReslicingRoute` mirrors `SpecFreezeRoute.freezing`: `PATH = '/spec-reslicing'`,
`METHODS = 'POST'`, the gate key, the held session, a `WorkInFlight` reservation keyed by the
checkout root, `PlanCollapse` for a `PlanFailure`, refusals `no-epic-spec`, `spec-not-frozen` and
`reslicing-in-progress`, and 200 `{ status: 'published', pullRequest }`. `ApiCollaborators` gains
`publishReslicing` and `reslicingsInFlight`.

**TDD:** red first —
`it('the correction is committed on the milestone branch, pushed, and announced in a pull request carrying the re-slicing marker')`:
`branch.committed` false, `branch.pushed` false, and the assertion is on the literal commit
message, the pushed branch, and that `pullRequests.open` received a body containing
`Reslicing.MARKER`. Then
`it('a correction already committed and already travelling answers the pull request that is open instead of opening a second one')`.

**Tests:** added, in `publish-reslicing.test.ts`:
`the correction is committed on the milestone branch, pushed, and announced in a pull request carrying the re-slicing marker`,
`a correction already committed and already travelling answers the pull request that is open instead of opening a second one`,
`what the branch it switched to holds is what gets published, never the copy the press started from`,
`a spec that is not frozen is refused and nothing is committed, pushed or opened`;
in `spec-reslicing-route.test.ts`:
`a press carrying the gate key answers the pull request the correction travels in`,
`a press without the gate key is refused and the use case is never asked`,
`a second press while one is in flight is refused as reslicing-in-progress`,
`a get on the re-slicing door answers 405 naming the method it takes`.
Removed: none.

**Verification:** both new suites are green and the marker lives in exactly one place.

```bash
npm --prefix backend run typecheck                                                   # expected: exit 0
test "$(grep -rl 'ct-groom:reslicing' backend/src | wc -l | tr -d ' ')" -eq 1        # expected: exit 0 — one writer of the marker
npm --prefix backend test                                                            # expected: exit 0
```

### Task 7 — The page publishes the new slicing

**Objective:** at `resliced` the panel says what happened and offers **Publicar el nuevo slicing**,
which opens the pull request and links it.

**Files:** `frontend/src/app/epic-groom/EpicGroom.types.ts` (modify),
`frontend/src/app/epic-groom/client.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` (modify),
`frontend/src/app/epic-groom/client.test.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx` (modify),
`frontend/src/__scenarios__/EpicGroomMother.ts` (modify), `frontend/README.md` (modify)

Contract (frontend/src/app/epic-groom/EpicGroom.types.ts):

```ts
export type EpicGroomOutcome = /* … */ | { kind: 'resliced'; key: string | null } /* … */
export type ReslicingOutcome =
  | { kind: 'published'; pullRequest: EpicPullRequest }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unconfirmed' }
```

Contract (frontend/src/app/epic-groom/client.ts):

```ts
const RESLICING_PATH = '/spec-reslicing'
const publishReslicing = (key: string): Promise<ReslicingOutcome>
```

The Spanish copy: `La sesión ha cambiado el slicing del spec. Publícalo en un pull request: al
mergearlo se crearán las issues.`, the button `Publicar el nuevo slicing`, `Publicando el nuevo
slicing` while it is in flight, and once published the same `Pull request #N` link the wait
already draws. `resliced` is not a resting kind, so the existing ten-second read moves the panel
on by itself.

**TDD:** red first —
`it('a resliced spec says the session changed the slicing and offers to publish it')`, asserting
the sentence, the button, and that no `Ejecutar el groom` button is on screen. Then
`it('publishing the new slicing carries the gate key and links the pull request it opened')`.

**Tests:** added:
`a resliced spec says the session changed the slicing and offers to publish it`,
`publishing the new slicing carries the gate key and links the pull request it opened`,
`a refused publication is shown with the words the program printed` (`EpicGroomPanel.test.tsx`);
`a resliced read is recognised with its gate key`,
`a published re-slicing answers the pull request, and a refusal answers the code and the detail`
(`client.test.ts`). `EpicGroomMother` gains `resliced()`, `reslicedWithoutKey()` and
`reslicingPublished()`.
Removed: none.

**Verification:** the frontend builds and its suite is green.

```bash
npm --prefix frontend run build      # expected: exit 0
npm --prefix frontend test           # expected: exit 0
```

### Task 8 — A merged re-slicing is the authorisation

**Objective:** the read at `groomable` carries the merged pull request that published a
re-slicing of this branch, so the page can create the issues without another click.

**Files:** `backend/src/domain/ports/pull-requests.ts` (modify),
`backend/src/infrastructure/gh-pull-requests.ts` (modify),
`backend/src/application/queries/read-epic-groom.ts` (modify),
`backend/src/infrastructure/epic-groom-route.ts` (modify),
`backend/__tests__/infrastructure/gh-pull-requests.test.ts` (modify),
`backend/__tests__/application/read-epic-groom.test.ts` (modify),
`backend/__tests__/infrastructure/epic-groom-route.test.ts` (modify), `backend/API.md` (modify)

Contract (backend/src/domain/ports/pull-requests.ts):

```ts
async mergedReslicingOf({ branch, repository }: {
  branch: string, repository: RepositoryName,
}): Promise<ReviewedPullRequest | null>
```

Contract (backend/src/infrastructure/gh-pull-requests.ts):

```ts
static readonly MERGED_READ = '10'
static mergedArgvFor({ branch, repository }: { branch: string, repository: RepositoryName }): string[]
```

The argv is
`['pr', 'list', '--repo', repository.text, '--head', branch, '--state', 'merged', '--json', 'number,url,body', '--limit', GhPullRequests.MERGED_READ]`,
and the adapter answers the first listed pull request whose `body` satisfies
`Reslicing.isAnnouncedIn`, `null` when none does. A listing whose entry carries no readable
`number`, `url` or `body` raises `PullRequestNotUnderstood`, told apart from the
`PullRequestNotRead` of a `gh` that failed. `EpicGroomRead` gains `reslicing`, filled only in the
`GROOMABLE` answer from `branch.current(params.root)` — the same branch
`#awaitedPullRequest` already asks about — and the route's `groomable` answer carries
`reslicing: outcome.reslicing`.

**TDD:** red first —
`it('a merged pull request whose body carries the re-slicing marker is the one the read answers')`
in `gh-pull-requests.test.ts`, over the captured `pr list --state merged` array: one merged pull
request without the marker answers `null` and one with it answers its number and url, with the
literal argv asserted. Then
`it('a groomable milestone whose re-slicing already merged carries that pull request')` in
`read-epic-groom.test.ts`.

**Tests:** added:
`a merged pull request whose body carries the re-slicing marker is the one the read answers`,
`a merged pull request without the marker is not a re-slicing and answers nothing`,
`a merged listing whose entry has no body is told apart from a gh that failed`
(`gh-pull-requests.test.ts`);
`a groomable milestone whose re-slicing already merged carries that pull request`,
`a groomable milestone nobody re-sliced carries no pull request` (`read-epic-groom.test.ts`);
`a groomable answer carries the merged re-slicing that authorised it` (`epic-groom-route.test.ts`).
Removed: none.

**Verification:** the three suites are green and `API.md` declares the field.

```bash
npm --prefix backend run typecheck                                   # expected: exit 0
test "$(grep -c 'reslicing' backend/API.md)" -ge 1                   # expected: exit 0 — the field is documented
npm --prefix backend test                                            # expected: exit 0
```

### Task 9 — The issues are created when the pull request merges

**Objective:** a `groomable` read carrying a merged re-slicing makes the page press gate 2 once,
by itself, and say why.

**Files:** `frontend/src/app/epic-groom/EpicGroom.types.ts` (modify),
`frontend/src/app/epic-groom/client.ts` (modify),
`frontend/src/app/epic-groom/useMergedReslicing.ts` (create),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx` (modify),
`frontend/src/__scenarios__/EpicGroomMother.ts` (modify), `frontend/README.md` (modify)

Contract (frontend/src/app/epic-groom/useMergedReslicing.ts):

```ts
const useMergedReslicing = ({ read, press }: {
  read: EpicGroomRead,
  press: (planFingerprint: string) => Promise<void>,
}): void
```

It presses exactly once per mount, guarded by a `useRef`, and only when `read.phase === 'read'`,
`read.kind === 'groomable'`, `read.reslicing !== null` and `read.key !== null`. `groomable` gains
`reslicing: EpicPullRequest | null` in the types and in the client's projection. The panel's
Spanish line, above the buttons:
`El nuevo slicing se aprobó al mergear su pull request: las issues se crean sin pulsar nada.`,
beside the same `Pull request #N` link. `partially-groomed` never auto-presses: a half-created
milestone is a person's business.

**TDD:** red first —
`it('a groomable milestone whose re-slicing already merged creates the issues without anybody pressing')`:
the read answers `groomable` with `reslicing`, no click happens, and the second fetch is
`'/epic-groom'` with the gate key and the plan fingerprint, with the created issues then on
screen. It has to fail while `reslicing` is null.

**Tests:** added:
`a groomable milestone whose re-slicing already merged creates the issues without anybody pressing`,
`a groomable milestone nobody re-sliced waits for the person to press`,
`the automatic press happens once, however many times the read is answered`.
`EpicGroomMother` gains `groomableAfterReslicing()`.
Removed: none.

**Verification:** the frontend builds and its suite is green.

```bash
npm --prefix frontend run build      # expected: exit 0
npm --prefix frontend test           # expected: exit 0
```

### Task 10 — The page never claims a failure it does not know about

**Objective:** a press whose answer cannot be read confirms itself with a read of gate 2, and
where it still cannot tell it says so instead of reporting a failure.

**Files:** `frontend/src/app/epic-groom/EpicGroom.types.ts` (modify),
`frontend/src/app/epic-groom/client.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.tsx` (modify),
`frontend/src/app/epic-groom/client.test.ts` (modify),
`frontend/src/app/epic-groom/components/epic-groom-panel/EpicGroomPanel.test.tsx` (modify),
`frontend/README.md` (modify)

Current state (frontend/src/app/epic-groom/client.ts, lines 114-122):

```ts
const press = async (path: string, headers: Record<string, string>): Promise<EpicGroomAskOutcome> => {
  let response: Response
  let body: unknown
  try {
    response = await fetch(path, { method: 'POST', headers })
    body = await response.json()
  } catch {
    return { kind: 'backend-unreachable' }
  }
```

Contract (frontend/src/app/epic-groom/EpicGroom.types.ts):

```ts
export type EpicGroomAskOutcome =
  | { kind: 'acted'; status: 'groomed' | 'authorised'; milestone: string; issues: EpicIssue[]; promoted: number[] }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unconfirmed' }
```

Every `backend-unreachable` becomes `unconfirmed`, and it is answered only after one `read()`:
a read that comes back `groomed` or `authorised` answers `acted` with its milestone and issues
and `promoted: []`, because the work the press asked for is on the record. The panel renders
`unconfirmed` as `Banner type="warning" role="alert"` titled
`No se ha podido confirmar el groom`, described
`Puede seguir en marcha: no lo vuelvas a pulsar. La página lo dirá en cuanto lo sepa.` —
never an error, because the page does not know one happened.

**TDD:** red first —
`it('a press whose answer never arrives is confirmed by reading, and the issues it created reach the screen')`:
the press rejects, the following read answers `groomed`, and the created issues are on screen
with no banner at all. Then
`it('a press the page cannot confirm says so as a warning instead of reporting a failure')` —
press and read both unreadable, the alert carries `No se ha podido confirmar el groom` and the
words `No se pudo contactar con el backend` are nowhere on screen.

**Tests:** added:
`a press whose answer never arrives is confirmed by reading, and the issues it created reach the screen`,
`a press the page cannot confirm says so as a warning instead of reporting a failure` (both files).
Changed: `a press whose answer body is not JSON re-enables the button and says the backend could
not be reached` becomes
`a press whose answer body is not JSON is confirmed by reading and re-enables the button`.
Removed: none.

**Verification:** the frontend builds, its suite is green, and the sentence the backend's own log
contradicted is gone from the tree.

```bash
npm --prefix frontend run build                                                                        # expected: exit 0
test -z "$(grep -rl 'No se pudo contactar con el backend' frontend/src/app/epic-groom)"                # expected: exit 0 — the lie is gone from gate 2
npm --prefix frontend test                                                                             # expected: exit 0
```

### Task 11 — The vocabulary and the two documents say what the loop now does

**Objective:** `backend/conventions/this-repository.md` and the two contract documents describe
gate 2 as it is now, so the next diff reads the same yardstick.

**Files:** `backend/conventions/this-repository.md` (modify), `backend/API.md` (modify),
`frontend/README.md` (modify)

Final text (backend/conventions/this-repository.md):

```md
| **Groom conversation** | The groom as a phase of the coordinating session: `PhasePrompt.groom` points an interactive `claude` at the plugin's own `ct-groom` skill so a person can walk the spec's slices table with it. It creates nothing — the issues are gate 2's, and a change to the slicing is an edit of the table that gate 2 publishes |
| **Re-slicing** | A correction of the frozen spec's slices table: the spec stays `CONGELADA`, the change travels on the milestone branch in a pull request whose body carries `<!-- ct-groom:reslicing -->`, and that merge is what authorises the groom with no further click |
```

`Gate 2`'s own row gains, after "Only the page this backend serves can press either", the
sentence that the groom also runs unpressed when a merged re-slicing of the branch authorised it.
`API.md` carries `POST /groom-session`, `POST /spec-reslicing`, the `resliced` state, the
`reslicing` field of `groomable` and the two new codes. `frontend/README.md` says gate 2 now
answers nine states, what `resliced` renders, which two buttons it adds, and that a `groomable`
read carrying `reslicing` presses the groom by itself.

**TDD:** No TDD — documentation only; `__tests__/conventions-no-restatement.test.ts` and
`__tests__/agent-instructions-mirror.test.ts` are the controls that read these files.

**Tests:** N/A — no behaviour changes.

**Verification:** the repository's own document controls pass and nothing in the tree still
describes the seven-state gate 2.

```bash
npx --prefix backend vitest run --root backend __tests__/conventions-no-restatement.test.ts   # expected: exit 0
npx --prefix backend vitest run --root backend __tests__/agent-instructions-mirror.test.ts    # expected: exit 0
test "$(grep -c 'seven states' frontend/README.md)" -eq 0                                     # expected: exit 0 — the stale count is gone
npm --prefix backend test                                                                     # expected: exit 0
```

## 8. Global verification

Everything the brief names, in the order CI runs it. `plugin/` is untouched, so no bundle is
rebuilt and `plugin/dist/` has to come out of the run unchanged.

```bash
npm --prefix backend run typecheck                          # expected: exit 0
npm --prefix backend test                                   # expected: exit 0 — the whole suite, real processes included
npm --prefix frontend run build                             # expected: exit 0 — tsc --noEmit && vite build, what CI runs
npm --prefix frontend test                                  # expected: exit 0
test -z "$(git status --porcelain -- plugin/dist)"           # expected: exit 0 — no bundle moved
```

## 9. Assumptions

1. **The groom conversation replaces the held one instead of running beside it.** The epic's
   frozen decision is one coordinating session, so `POST /groom-session` reserves through the
   very `CoordinatingSessions.reserve()` gate 0 uses and refuses while another conversation is
   live. Provenance: `backend/conventions/this-repository.md`'s *Coordinating session* row and
   `coordinating-sessions.ts`; own call on the refusal rather than a silent replacement.
2. **The publication of the correction is a person's click, its creation of the issues is not.**
   D3 does not say who presses publish and D4 says only that the merge needs no further click, so
   the panel at `resliced` offers the button and the merge does the rest. Provenance: the brief's
   D3 and D4; own call.
3. **The page owns D4's trigger.** Nothing else in this program watches GitHub, and the read the
   page already runs every ten seconds while `resliced` and `awaiting-publication` is where the
   merge is noticed. While nobody has the page open nothing happens, and the issues appear when
   the person next opens it. Provenance: the brief names this consequence and asks for it to be
   chosen out loud; own call.
4. **The marker, not the title, is what says a merged pull request published a re-slicing.** A
   title is product prose that can be edited on GitHub; `<!-- ct-groom:reslicing -->` is contract
   data, the shape `ct-init` already uses for its own markers. Provenance: `CLAUDE.md`'s block
   markers section; own call.
5. **`branch.current(root)` is the branch a re-slicing is looked for on**, the same branch
   `#awaitedPullRequest` already asks about, because `EpicBranch.publishing` leaves the checkout
   on the branch it published from. Provenance: `read-epic-groom.ts` and `git-epic-branch.ts`.
6. **The session's program keeps the name `brainstorming`** in the sessions panel. Renaming it
   per phase would mean a phase travelling with the conversation, and the epic's frozen decision
   forbids storing one. Provenance: the brief's "do not store a phase anywhere"; own call,
   declared as a known cosmetic limit.
