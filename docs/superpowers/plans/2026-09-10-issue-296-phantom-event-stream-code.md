# #296 — the event stream declares its own error codes, and the guard stops remembering them by hand

> **This plan is written to be executed by task-scoped subagents that arrive with zero context
> and decide nothing.** Every task carries the current state of what it touches (copied
> verbatim), the contracts it honours and the exact commands that verify it; its bodies are
> yours to write, test-first. Names, signatures, constants and test names come from this
> document, which decided them. On ambiguity, the issue body and AGENTS.md win.

## 1. Context and goal

The issue reports that `refusal-codes.test.js:50` read `PlanEvents.DELIVERY_NOT_READ`, a property
that does not exist, so the guard's array was `['plan-progress-not-read', undefined]` and passed
only because one `undefined` never repeats itself. It asks for a decision: either the event-stream
vocabulary really has one code, or a delivery-read failure was meant to have its own.

**The repository already answers it.** `DELIVERY_NOT_READ = 'delivery-progress-not-read'` was added
by `33131e6` and **retired on purpose** by `37bddbb`, whose message names it: *"Retired with the
stream reader: ReadDeliveryProgress, the readDelivery collaborator, the delivery-progress-not-read
code, and the delivering flag on PlanWatch"*. `37bddbb` left the test entry dangling; `#287` then
deleted that entry while converting the file to `.ts`, which is the silent pick the issue warned
about. So the vocabulary has one code, there is no behavioural gap in the SSE stream, and
`backend/API.md` already documents `plan-progress-not-read` as its only `error` frame.

What is **not** fixed is the weakness the issue names underneath the phantom: the guard remembers the
stream's codes in a second file, and it cannot tell a code from an absent one. That is this slice.

### Desired end state

- `PlanEvents.declaredCodes(): readonly string[]` exists in
  `backend/src/infrastructure/plan-events-route.ts` and returns exactly the codes the stream can put
  in an `error` frame — today `['plan-progress-not-read']`.
- `backend/__tests__/infrastructure/plan-events-route.test.ts` pins that the declared list is exactly
  what a client sees on the wire, so a retired code cannot stay declared and an emitted one cannot go
  undeclared.
- `refusal-codes.test.ts` reads `PlanEvents.declaredCodes()` instead of its own `EventStreamCodes`
  class, which is deleted.
- The guard refuses an entry that is not a kebab-case code, so a hand-remembered entry that goes
  phantom falls with its own name instead of passing as a lone `undefined`.
- `delivery-progress-not-read` is not reintroduced anywhere.

### Out of scope

- The issue declares `(none)` under "Out of scope / Protected".
- Reintroducing `DELIVERY_NOT_READ`, `ReadDeliveryProgress`, the `readDelivery` collaborator or the
  `delivering` flag on `PlanWatch`: `37bddbb` retired them and this slice keeps them retired.
- `CodesRememberedByHandFromHttpAndApiServer` keeps remembering `'not-found'`,
  `'method-not-allowed'`, `'foreign-origin'`, `'unsupported-media-type'`, `'body-too-large'` and
  `'request-failed'` by hand. Deriving those from `http.ts` is a separate slice; this one only makes
  a phantom among them fail.
- `backend/API.md` and `backend/conventions/this-repository.md` are not edited: both already say what
  this slice concludes.
- No test command is declared in `AGENTS.md` (the baseline in `.agent/SLICE.md` is `no-verificado`
  for that reason). Declaring one is not this slice's work; §8 names the real commands instead.

## 2. Closed decisions (take as given)

| Decision | Value |
|---|---|
| The reading of the issue's two options | The event-stream vocabulary really has one code. `delivery-progress-not-read` was retired by `37bddbb` on purpose and stays retired |
| Where the vocabulary lives | In `plan-events-route.ts`, beside the `yield` that emits it — not in the test |
| The accessor's name and shape | `static declaredCodes(): readonly string[]`, imitating `PlanCollapse.declaredCodes()` |
| The private list's name | `static readonly #ERROR_CODES: readonly string[]` |
| `ERROR_EVENT` | Stays `'error'` and is **not** a code: it is the SSE event name and never enters `#ERROR_CODES` |
| The shape a code must have | `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` — the kebab-case wire format `backend/conventions/this-repository.md` already requires |
| What the guard does with a bad entry | Collects the offenders and asserts the list is empty, so the failure names the culprit |
| Task order | Task 1 first: Task 2 reshapes the assembly Task 1 has already repointed |

## 3. Reference patterns

This repository declares no per-agent conventions file; its yardstick is the documents below.

Files to imitate: `backend/src/infrastructure/start-plan-route.ts` for the `declaredCodes()` idiom,
`backend/__tests__/infrastructure/plan-events-route.test.ts` for the `EventsDouble` mother and its
named scenarios, `backend/__tests__/infrastructure/refusal-codes.test.ts` for the one-class-per-fact
shape of that guard.

Rules to obey: `backend/conventions/this-repository.md` (the backend is TypeScript and erasable-only;
`npm run typecheck` runs before the suite; the fast subset runs from `backend/`; the wire format of a
`code` is kebab-case; a controller is `<endpoint>-route.ts`), `AGENTS.md` and `CLAUDE.md` (everything
here is English; a repository control is not an obstacle to route around),
`plugin/conventions/testing.md` (the test name is the sentence; mothers with named scenarios; the
assertion is on the observable effect; an assertion is not finished until it has been seen to fail for
the reason its name gives), `plugin/conventions/style.md` (no prose in the code; no free function at
module level), `plugin/conventions/simplicity.md`.

## 4. Inventory

| File | Action | Consumed by | Block in §7 |
|---|---|---|---|
| `backend/src/infrastructure/plan-events-route.ts` | modify | the SSE route and both guards | Current state + Contract (Task 1) |
| `backend/__tests__/infrastructure/plan-events-route.test.ts` | modify | the suite | none (body by TDD) |
| `backend/__tests__/infrastructure/refusal-codes.test.ts` | modify | the suite | Current state + Contract (Tasks 1 and 2) |
| `plugin/conventions/` | read only | the judge | ct's yardstick, at the path the kickoff gives |

## 5. Interfaces

Consumes: N/A — the issue declares no "Dependencias" section and this slice consumes no new
interface.

Produces: `PlanEvents.declaredCodes(): readonly string[]` — the codes the plan event stream can put
in an `error` frame, for any guard that has to enumerate what the API emits.

## 6. Test strategy

Both tasks are test-first and both run from the repository root with
`npx vitest run --root backend <file>`; `npm run typecheck --prefix backend` runs before the suite,
because Node strips types and never checks them.

Task 1 pins the new accessor **at the boundary the stream already has**: the error frame on the wire.
The assertion compares `PlanEvents.declaredCodes()` against the code parsed out of the frames the
existing `EventsDouble.unable` mother produces, so the two directions of the drift the issue is about
— a declared code nothing emits, an emitted code nothing declares — each turn it red.

Task 2 pins the shape of every entry the guard collects. Its boundary is the kebab-case regex: a
single-segment code such as `'not-found'` passes, and the empty string — the shape a phantom
`Object.freeze([Something.MISSING])` entry collapses to once `?? ''` is applied — fails.

No new controller, application or adapter test: this slice adds no endpoint and no port.

## 7. Tasks

### Task 1 — the stream declares the error codes it can emit, and the guard reads them

**Objective:** `PlanEvents` owns the list of codes its `error` frames carry, and
`refusal-codes.test.ts` stops keeping a second copy of it.

**Files:** `backend/src/infrastructure/plan-events-route.ts` (modify),
`backend/__tests__/infrastructure/plan-events-route.test.ts` (modify),
`backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

Current state (backend/src/infrastructure/plan-events-route.ts, lines 138-139):

```ts
  static readonly ERROR_EVENT = 'error'
  static readonly PROGRESS_NOT_READ = 'plan-progress-not-read'
```

Current state (backend/__tests__/infrastructure/refusal-codes.test.ts, lines 49-51):

```ts
class EventStreamCodes {
  static readonly VALUES: readonly string[] = Object.freeze([PlanEvents.PROGRESS_NOT_READ])
}
```

Contract (backend/src/infrastructure/plan-events-route.ts):

```ts
export class PlanEvents {
  static readonly ERROR_EVENT = 'error'
  static readonly PROGRESS_NOT_READ = 'plan-progress-not-read'
  static readonly #ERROR_CODES: readonly string[] = Object.freeze([PlanEvents.PROGRESS_NOT_READ])

  static declaredCodes(): readonly string[]
}
```

`EventStreamCodes` is deleted and the spread in the distinctness test becomes
`...PlanEvents.declaredCodes(),`. `ERROR_EVENT` is the SSE event name, not a code: it stays out of
`#ERROR_CODES`.

**TDD:** red first in `plan-events-route.test.ts`:
`it('the_error_codes_the_stream_declares_are_exactly_the_ones_a_client_can_see_on_the_wire')`. Build
the failure with the existing `EventsDouble.unable('git status refused')` mother, collect the frames,
parse the `code` out of each `event: error` frame, and assert
`expect(PlanEvents.declaredCodes()).toEqual(seen)`. That equality is the boundary in both directions:
a code left declared after being retired makes `declaredCodes()` longer than `seen`, and a code
emitted without being declared makes it shorter. Then the minimal green: `#ERROR_CODES` and the
accessor.

**Tests:** added: `the_error_codes_the_stream_declares_are_exactly_the_ones_a_client_can_see_on_the_wire`
in `plan-events-route.test.ts`. Removed on purpose: none — the two `it`s of `refusal-codes.test.ts`
keep their names and only change where the event-stream codes come from.

**Verification:** the graph compiles with the accessor in it, both touched suites pass, the second
copy of the vocabulary is gone from the guard, and the retired code is nowhere in the backend.

```bash
npm run typecheck --prefix backend   # expected: exit 0 — declaredCodes() type-checks
npx vitest run --root backend __tests__/infrastructure/plan-events-route.test.ts   # expected: exit 0
npx vitest run --root backend __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0
test -z "$(grep -l 'EventStreamCodes' backend/__tests__/infrastructure/refusal-codes.test.ts)"   # expected: exit 0 — the empty list is the claim
test "$(grep -c 'static declaredCodes' backend/src/infrastructure/plan-events-route.ts)" -eq 1   # expected: exit 0 — the accessor is declared once
test -z "$(grep -rl 'delivery-progress-not-read' backend/src backend/__tests__)"   # expected: exit 0 — the retired code stays retired
```

### Task 2 — a phantom entry falls with its own name instead of passing as a lone undefined

**Objective:** every code the guard collects has to be a kebab-case string, so an entry that no
longer exists fails the guard instead of surviving as one `undefined` that never repeats itself.

**Files:** `backend/__tests__/infrastructure/refusal-codes.test.ts` (modify)

Current state (backend/__tests__/infrastructure/refusal-codes.test.ts, lines 42-47):

```ts
class CodesRememberedByHandFromHttpAndApiServer {
  static readonly VALUES: readonly string[] = Object.freeze([
    'not-found', 'method-not-allowed', 'foreign-origin', 'unsupported-media-type', 'body-too-large', 'request-failed',
    ActivePlansOutcome.RECOVERY_INCONCLUSIVE,
  ])
}
```

One class is added to this test file, named `EveryCodeTheApiEmits`, and it carries three members.
`static readonly KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/` — the regex is the non-derivable part,
copy it exactly. `static values(): string[]` is the assembly the distinctness `it` builds inline
today, moved into this class unchanged and read by both `it`s. `static shapeless(): string[]`
returns the entries of `values()` that `KEBAB_CASE` refuses, applying `?? ''` so an absent entry is
measured rather than crashing the match. Nothing else in the file changes: the two existing `it`s
keep their names and their assertions.

**TDD:** red first:
`it('a_code_the_guard_remembers_by_hand_that_no_longer_exists_falls_here_instead_of_passing_as_a_lone_undefined')`,
asserting `expect(EveryCodeTheApiEmits.shapeless()).toEqual([])`. Drive it red by appending a
deliberate phantom — a frozen entry reading a property no route declares — to the assembly, see the
offender named in the diff of the assertion, and remove it before the green. The boundary is the
regex: `'not-found'`, one segment, has to pass, and the empty string an absent entry collapses to has
to fail.

**Tests:** added:
`a_code_the_guard_remembers_by_hand_that_no_longer_exists_falls_here_instead_of_passing_as_a_lone_undefined`.
Removed on purpose: none.

**Verification:** the guard's own module carries three `it`s, the new one among them, the file
type-checks and passes, and the fast subset is still green.

```bash
npm run typecheck --prefix backend   # expected: exit 0
npx vitest run --root backend __tests__/infrastructure/refusal-codes.test.ts   # expected: exit 0
test "$(grep -c "  it('" backend/__tests__/infrastructure/refusal-codes.test.ts)" -eq 3   # expected: exit 0 — this module's own tests, not the suite's total
test "$(grep -c 'KEBAB_CASE' backend/__tests__/infrastructure/refusal-codes.test.ts)" -eq 2   # expected: exit 0 — declared once, applied once
npx vitest run --root backend --exclude '**/*-real-process.test.ts'   # expected: exit 0
```

## 8. Global verification

Run from the repository root, with `backend/node_modules` installed
(`npm ci --prefix backend`). The first two are the commands
`backend/conventions/this-repository.md` names: typecheck before the suite, and the fast subset that
excludes the real-process tests. The last three are the slice's own claims — the retired code is
absent, the second copy of the vocabulary is gone, and the guard now reads the stream's declaration.
Measured on `cbf78c6` before any task ran, the fast subset was green (53 files) and the typecheck
exited 0.

```bash
npm run typecheck --prefix backend   # expected: exit 0
npx vitest run --root backend --exclude '**/*-real-process.test.ts'   # expected: exit 0
test -z "$(grep -rl 'delivery-progress-not-read' backend/src backend/__tests__)"   # expected: exit 0
test -z "$(grep -l 'EventStreamCodes' backend/__tests__/infrastructure/refusal-codes.test.ts)"   # expected: exit 0
test "$(grep -c 'PlanEvents.declaredCodes()' backend/__tests__/infrastructure/refusal-codes.test.ts)" -eq 1   # expected: exit 0
```

## 9. Assumptions

1. **The issue declares no acceptance criteria** — its "Acceptance criteria (EARS, 1:1 con tests)"
   section reads `(fill in from the spec)` and there is no "Comentario de quien pide el plan"
   section. The criteria in §1's "Desired end state" are therefore proposed by this plan, from the
   issue's description and its "The decision to take" section. Provenance: own call.
2. **The issue's premise that `DELIVERY_NOT_READ` "never has been" is wrong**, and the plan resolves
   the decision against the repository's own history rather than by guessing: `33131e6` added the
   code and `37bddbb` retired it by name. Provenance: git history of the two files.
3. **The phantom entry is already gone** from `refusal-codes.test.ts`, deleted by `#287` during the
   TypeScript conversion. This slice therefore does not remove it; it removes the reason the drift
   was invisible. Provenance: `git log -S`, working tree.
4. **No behavioural change to the SSE stream.** The issue's second reading — a delivery-read failure
   deserving its own code — is refused, because `37bddbb` retired the reader that would raise it and
   `backend/API.md` already documents one `error` code. Provenance: `37bddbb`'s message,
   `backend/API.md` lines 228-244.
5. **The vocabulary lives in the production file, not the test.** The issue does not say where; the
   `declaredCodes()` idiom of `PlanCollapse`, `ImplementCollapse` and `ProgressCollapse` does.
   Provenance: repo convention.
6. **The kebab-case regex is not a new rule.** `backend/conventions/this-repository.md` already
   states the wire format of a `code`; Task 2 only makes the guard measure it. Provenance: repo
   convention.
7. **`backend/API.md` is left alone.** It already lists `plan-progress-not-read` as the stream's only
   `error` code, so there is nothing to correct and a note about a retired code is history, not
   contract. Provenance: own call.
8. **`AGENTS.md` gains no `test:` line**, although its absence is what left the slice's baseline
   `no-verificado`. Declaring the repository's test command is a change to a repository control and
   belongs to whoever owns that document. Provenance: own call, reported rather than taken.
