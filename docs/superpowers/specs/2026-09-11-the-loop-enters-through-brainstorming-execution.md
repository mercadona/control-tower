# The loop enters through brainstorming — Execution spec

**Handoff origen:** `docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-design.md`
**Fecha de congelación:** 2026-09-11
**Estado:** CONGELADA
**Enmiendas:** 2026-09-11, sobre el feedback de un revisor («no debemos deducirlo solamente de
`claude -p`») — D-2 reformulada, porque describía al backend como si fuese una sesión de LLM; D-18
a D-21 añadidas, que es la topología de sesiones que la congelación dejó implícita; slice 3
renombrado a la sesión coordinadora y slice 7 nuevo para la conducción paso a paso, con lo que la
cadena pasa a ser el 8.

## Hipótesis del experimento

**The bet:** if the loop's entrance is a conversation inside the cabin and the
three human gates are acts of the program, one whole epic goes from an idea to a
merge without anybody typing a command in a terminal, and every attempt is
measured with its cost and its turns — which today nothing can measure.

**How we will know it failed:** the first epic driven end to end through the
cabin still needs a slash command typed by hand at any step; or its metrics rows
arrive without cost and turns; or the app has to store a phase of its own to
know where the epic is.

**Anti-scope — what this epic does NOT do:** an epic governs one repository, so
the `repo_list` mode of `/start-plan` does not enter this flow and stays where it
is for the short path of a loose issue. No change to the prescriptive planning
skill, the plan contract, the task brief or the run machine's report format. No
second orchestration graph, no phase enumeration, no transition table. No
mirroring of a terminal the backend did not launch. No automatic merge and no
write of any kind from the app onto a pull request. No decision log. And the go
protocol is not retired here: only its default dies, and A-3 carries the rest.

## Decisiones congeladas

- **D-1 · The entrance is a conversation with a real terminal** — the cabin
  hosts the brainstorming and spec session as an interactive `claude` in a PTY
  streamed to the page, not a structured chat and not a step left outside the
  app.
  *(Procedencia: hablada — «Terminal real en la cabina», y «mover el loop como primer paso al brainstorming».)*
- **D-2 · The backend automates the coordination between issues and controls the
  agents' sessions** — `/start-plan` does what `/ct-next` does, inside the
  backend, with `claude -p`. The backend is a **program**, not a session and not
  a model: it selects the next issue, checks its dependencies, prepares its
  execution and chains the work. The sessions do not disappear and neither do
  the agents that do the work inside a slice — the backend owns and drives them.
  *(Procedencia: hablada — «start-plan lo que hace es lo mismo que hace el ct-next pero en el backend con claude -p para poder subir las estadisticas de desarrollo (…) el backend es el que controla la sesión y pasa la información y actua como sesion orquestadora para la implementación». Enmendada el 2026-09-11: «sesión orquestadora» describía al backend como si fuese una sesión de LLM, y un revisor lo señaló — «la formulación precisa es: el backend automatiza la coordinación entre issues y controla las sesiones de los agentes. No que desaparezcan las sesiones ni necesariamente los agentes que coordinan tareas dentro de un slice».)*
- **D-3 · There is no human gate between the plan and its implementation** — the
  authorisation is GATE 2 and the earlier gates are respected.
  *(Procedencia: hablada — «continuar con el plan (que ya no necesitara gate humano) y ponerse a implementar, hay que respetar los gates previos».)*
- **D-4 · The slices run one after another and nobody is asked which is next** —
  the order was decided once in the slices table and the dispatcher derives the
  rest.
  *(Procedencia: hablada — «que se ipmlementen las US una detras de otra sin parar, es decir, el usuario no tiene que ir diciendo que issue toca ahora».)*
- **D-5 · One slice in flight and the relay at the pull request** — the `--cap`
  frees when the pull request opens while `area:` and `touches:` stay held until
  the merge, so a merge only holds back what depends on it.
  *(Procedencia: hablada — «Cap 1, relevo al abrir el PR».)*
- **D-6 · Gates 1 and 2 are acts of the app, with its own yardstick** — the
  freeze and the promotion are buttons the program answers for, never lines the
  conversation's agent writes.
  *(Procedencia: hablada — «La app, con validación propia».)*
- **D-7 · GATE 3 is entirely human and stays on GitHub** — the merge is the only
  act with a permanent external effect and no program performs it: a person
  merges on GitHub, and all the app does is notice, by sweeping, so that it can
  dispatch whatever the merge unblocked. The app never writes to a pull request,
  there is no merge button anywhere in the cabin, and no automation may acquire
  one without reopening this decision.
  *(Procedencia: hablada — «Mergeas en GitHub, la app lo nota», y «el merge si es humano (…) el merge tiene que ser totalmente humano».)*
- **D-8 · The plan review retires and the review is the pull request** — the
  slice's plan is written by its agent and judged by `ct-judge` against its
  issue; a person reads it in the diff.
  *(Procedencia: hablada — «Desaparece: la revisión es la PR».)*
- **D-9 · A slice has a tab that shows its session and takes a message** — with
  the implementation headless there is no screen to mirror, so the tab renders
  the calls' stream and writing is a message into the live conversation.
  *(Procedencia: hablada — «Pestaña por slice, con escritura»; su forma es deducida de D-2.)*
- **D-10 · Everything new under `backend/` is TypeScript** — and the plugin stays
  JavaScript, which is the repository's own rule for what the plugin ships.
  *(Procedencia: hablada — «lo estamos haciendo todo con typescript, eso no debe de cambiar».)*
- **D-11 · A yardstick is imported from the plugin, never reimplemented** —
  `analyzeSpecFreeze` and `analyzeSlicesTable` are the freeze's yardstick and
  `ct-groom.mjs` is the groom; the backend grows no second opinion about whether
  a spec is freezable.
  *(Procedencia: deducida de D-6 y de la dirección de dependencia del repo, que `start-plan.ts:5` ya usa para importar `plugin/scripts/baseline.js`.)*
- **D-12 · The conductor is not duplicated** — which step comes next is decided
  by the run machine behind `ct-step`; the backend owns the process and is not a
  second automaton.
  *(Procedencia: deducida de D-2 y de la doctrina de una sola máquina de estados.)*
- **D-13 · No phase is stored** — every phase is derived from evidence that
  survives a restart: the spec and its state line, the milestone and its issues,
  a `status:ready` label, a worktree, a record, a pull request, a closed issue.
  *(Procedencia: deducida de D-12.)*
- **D-14 · The `plan` gate stops being implied, and control-tower keeps the two
  gates it was born with** — `gatesForType` adds `plan` to every slice of every
  epic whatever its `Tipo`, which is the opposite of D-3. That default is
  removed. Only `visual` and `apply` survive as human gates. The protocol behind
  the go is **not** retired in this epic: it is documented as debt in A-3 and
  retired in later work, so that this one can be built without touching the
  distributed plugin beyond that single line.
  *(Procedencia: hablada — «ese gate no debio de haber nacido nunca», «solo se quiere los 2 gates con los que nacio control-tower», y «quiero la 3 para poder seguir haciendolo todo (…) Documenta esta decisión para no perderla y poder retirarlo en unas tareas posteriores».)*
- **D-15 · The plan is published as a comment on the issue, and nothing waits
  for an answer** — the comment exists for tracking, which is what the `plan`
  gate's text used to achieve as a side effect of stopping. The backend posts it
  after the plan step, because it owns the sequence and already drives `gh`; the
  agent does not stop and no go is minted, read or expected.
  *(Procedencia: hablada — «el plan se hara cuándo se implemente y se pone como comentario en la issue para tenerlo trackeado de manera sencilla, pero ya no es necesario un OK humano, ya que la implementación es automatica».)*
- **D-16 · cmux leaves the backend** — with the launch headless, recovery reads
  the records under the state root: the record is the plan in flight and the
  process being alive is not what makes it recoverable. No module under
  `backend/src` names cmux, and it stops being probed as an external tool.
  *(Procedencia: deducida de D-2.)*
- **D-17 · The record is written once and never mutated** — its absence is the
  whole of "not prepared", so there is no lock, no revision and no owner pid.
  *(Procedencia: deducida de D-13.)*
- **D-18 · There is a coordinating session and it is the boss of all of them** —
  the entrance conversation does not die at the freeze: it stays as the
  milestone's coordinator and the human's single interlocutor, the one that
  orders the start, carries the changes asked on a pull request and unblocks
  what is stuck, implementations included. What it never does is decide the
  order or the phase — that is the program's, exactly as in the plugin, where
  the coordinating session runs `/ct-next` and `ct-next.mjs` is what decides.
  It commands by invoking the backend's endpoints and the plugin's programs,
  while the backend owns the processes, makes the call of each step, keeps the
  record and measures. So there is a session above every other one, and still no
  model in the critical path of the automatic chain.
  *(Procedencia: hablada — «tiene q haber una sesión q sea la jefa de todas, incluyendo las implementaciones, como en el plugin» y «El backend las hace; la jefa manda a través de él». Que su identidad sea la sesión de entrada que persiste es deducido de D-1.)*
- **D-19 · One conversation per slice, and one call per step of the run
  machine** — the backend asks `ct-step next`, makes the `claude -p --resume`
  call of the step that is due, and runs the verb that consumes what the call
  produced. `run-machine.js` stays the only sequencer: no step order is written
  in the backend, and a verb out of turn is still the machine's exit 9 rather
  than a backend decision. Three consequences that are part of the decision: the
  judge becomes its own call, so it reports its own cost — the argv of
  `judge-dispatch.js` is the reference shape; the attempt row of
  `docs/superpowers/metrics/issue-<n>.jsonl` can carry cost and turns, which is
  what the bet promises and what a subagent cannot report (`ct-step.mjs:53`); and
  the agent is never again told to ask `ct-step`, so a task's call implements
  that task with TDD and dispatches no subagent of its own. This is phase 4 of
  issue #139 and it is a slice of its own.
  *(Procedencia: hablada — «Una conversación por slice, una llamada por paso», sobre la pregunta que el revisor dejó abierta: «cómo se distribuyen las conversaciones entre slices y tareas».)*
- **D-20 · A change asked on a pull request travels through the coordinating
  session** — you tell the boss and the boss makes it happen: it asks the backend
  to resume that slice's conversation with the change. The sweep of the pull
  request's own comments stays as the second channel, for a reviewer who writes
  on GitHub instead of talking to the cabin.
  *(Procedencia: hablada — «Para decir cambios en la pr se quiere hacer desde una sesión coordinadora».)*
- **D-21 · The coordinating session is always in the front, and it is
  recoverable** — the cabin offers a place to talk to it in **every** phase, and
  most explicitly once the implementation is running: no phase of the page may
  hide it, replace it with a progress panel or disable its input. It is the same
  property the original plugin has for free, where the coordinator's terminal
  never goes away while slices work. Talking to it must not disturb what is
  being implemented, which it cannot: the slices' conversations are other
  sessions and their calls are the backend's. And getting it back is a
  requirement rather than a convenience — two different losses with two
  different answers, a page reload replaying what was already said and a backend
  restart bringing the conversation back by resuming it. A conversation that
  cannot be resumed is said out loud; the cabin never opens a different one and
  presents it as the same.
  *(Procedencia: hablada — «La sesión coordinadora siempre tiene q estar en el front para poder hablar con ella, y se tiene q poder recuperar» y «aunque hagamos el gate de implementar, en el front siempre tengo que poder hablar con la sesión orquestadora, de la misma manera que en el plugin original». Que sean dos mecanismos distintos es deducido: el PTY muere con su padre y el descriptor del maestro no se recupera, mientras que la conversación sí, porque el CLI la resume desde su propio almacén.)*

## Enfoque técnico

The build order subtracts before it adds. The plan review goes first, because it
is the only piece the rest would have had to keep coherent for nothing. Then the
channel and the entrance, which are additive and touch no existing endpoint: at
that point the cabin can hold a conversation but governs nothing. Then the two
gates over artefacts that already exist — the spec's freeze and the groom's
promotion — which is where the app starts writing into the governed repository,
one line and one label. Then the transport swap, which is the riskiest slice and
the only one that removes a launcher while replacing it: it is also where the
money and the turns start being recorded. The chain closes last, because a relay
with nothing to relay is untestable.

Every row of the table below waives the `plan` gate explicitly (`!plan`), which
is noisy on purpose. The reason is an ordering one: slice 1 is what removes that
default, and when this spec is groomed slice 1 has not landed, so without the
waiver this epic's own issues would be born demanding a go that D-3 says does not
exist. The waiver stops being necessary for the epics that come after it.

On the topology the amendment adds, the approach is this. The coordinating
session is one PTY the backend owns and keeps, and the cabin subscribes to it
rather than creating it, so the page is a window and not the owner. A reload is
answered from a scrollback the backend keeps per session; a restart is answered
by relaunching the CLI on the recorded conversation id, which is a different
mechanism because the PTY's master descriptor does not outlive its owner while
the conversation does. Driving the run machine step by step is slice 7 and it
sits between the dispatcher and the chain on purpose: it needs a conversation
to resume, and the chain needs steps that finish.

The heart is the session port with two adapters. Everything else is a reader of
evidence: the gates read artefacts and write the two mutations they are gates
for, and the dispatcher reads the table, the labels and the tokens. Slices 2
and 3 serialize on the session channel; 4 and 5 on the gates; 6 and 7 on the
dispatch. Nothing serializes across those three areas except through `Dep`.

## Contexto del epic

- Stack: `backend/` is TypeScript on Node 24 with Express 5 — every module, test
  and helper under it is `.ts`, which `backend/__tests__/typescript-only.test.ts`
  keeps live. `frontend/` is React 19 with Vite in TypeScript. `plugin/` stays
  JavaScript (`.js` / `.mjs`).
- Direction of dependency: `backend/` may import `plugin/scripts/*.js`; nothing
  under `plugin/` ever learns that the backend exists.
- A yardstick that the plugin already implements is imported, never
  reimplemented in the backend.
- No phase is stored anywhere. Every phase is derived from evidence that
  survives a restart, the way `ActivePlanRecovery` already derives its three.
- The repository is written in English — prose, identifiers, test names, commit
  messages, branches, issues and pull requests. The parsed Spanish headings of
  the execution spec and the loop's own vocabulary (`verde`, `status:`, `gate:`)
  are contract data and stay as they are.
- Refusals answer `{code, detail}` with a kebab-case `code`, and no two
  endpoints share a `code` by accident — `refusal-codes.test.ts` is the guard.
- Tests are outside-in with the ports doubled. A test that spawns a real process
  carries the `-real-process` suffix and kills its children in `afterEach`,
  including on a failed assertion.
- No new test may require cmux to be installed or running.
- Verification of every slice: `npm --prefix backend run typecheck`,
  `npm --prefix backend test`, `npm --prefix frontend test`.

## Tabla de slices

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate | Señal |
|---|-------|------|---------|-----|--------|-----------|------|------|------|-------|
| 1 | The intermediate gate retires | backend | The flow loses its intermediate human gate: the review endpoint and its wiring are gone, the `plan` gate stops being implied by every slice, and the pull request's fix loop is untouched | – | `POST /review-plan` is no longer routed, the plan events vocabulary is `writing` and `ready` only, no slice is born with the plan gate unless its own row asks for it, the pull request fixes still reach the agent through the surviving watch, `API.md` no longer documents the retired endpoint | `ReadFixesAsked` and `RequestFixes` and the second `ReviewWatch` wiring; the go protocol's own modules stay as they are | api | plugin | !plan | a groom of any spec creates no `gate:plan` label and the plan stream emits only writing and ready |
| 2 | The session channel | ui | The page opens a live terminal fed by a backend session, with its stream, its input and the list of the live ones | – | the live sessions are listed by the backend, output reaches the page while the process runs, typed input reaches the process, closing the page does not kill the session | the eight existing endpoints and their contracts | sessions | frontend | !plan | the session list names the live session and its stream carries bytes while the process runs |
| 3 | The coordinating session | backend | The conversation that brainstorms and writes the spec runs inside the app on the governed checkout and stays there as the milestone's boss — always reachable and recoverable | #2 | the session starts in the governed checkout with no worktree and no branch of its own, the phase prompt travels in an environment variable, the hooks report working and waiting and the live question, a hook left by a previous run is purged before the session starts, the page offers a place to talk to it in every phase and none hides or disables it while a slice is being implemented, a reload replays what was already said, a backend restart brings the conversation back by resuming it and says so when it cannot instead of opening a different one in silence | the brainstorming skill's own text | sessions | hooks | !plan | the session status moves from working to waiting and the live question is readable in the cabin |
| 4 | Gate 1 — the freeze | ui | The freeze becomes an act of the program: the yardstick's failures on screen and a button that writes the state and the date and commits them | #3 | the button refuses while a clarification marker or an empty hypothesis remains, each failure is shown as the imported module reports it, pressing it writes `Estado: CONGELADA` with the date and commits, the conversation's agent never writes that line | `plugin/scripts/groom.js` and `plugin/scripts/slices.js` — imported and not modified | gates | frontend | !plan | the spec commit carries `Estado: CONGELADA` with its date and a refusal names the offending line |
| 5 | The groom and gate 2 | ui | The groom runs from the cabin: the dry run's plan on screen before anything mutates, then the real groom, then the promotion that authorises work | #4 | the dry run's product is shown as what will be created, the real groom is refused while the spec is not frozen, the promotion adds `status:ready` to the epic's issues and nothing else, a groom failure is shown in the program's own words | `plugin/scripts/ct-groom.mjs` | gates | github | !plan | the dry run product matches the issues the real groom creates and each one ends at `status:ready` |
| 6 | The headless dispatcher | backend | `/start-plan` selects the next ready issue by the table's order and its merged dependencies and its free tokens and claims it and isolates it and sows it and launches `claude -p` with its record | #5 | no module under `backend/src` names cmux, `POST /implement-plan` is no longer routed and no go is minted, the plan is published as a comment on the issue after the plan step and nothing waits for an answer, the record is written before the launch and its absence is the whole of not prepared, every call records its cost and turns and duration, a restart recovers the plans in flight from the records alone | `ct-next.mjs` and `ct-step.mjs` and the run machine | dispatch | sessions | apply, !plan | every call record holds its cost and turns and duration and the attempt row carries them |
| 7 | The backend drives the run machine | backend | The backend asks `ct-step next` and makes one `claude -p --resume` call for the step that is due and runs the verb that consumes what the call produced | #6 | no step order lives in the backend and the run machine is the only sequencer, a verb out of turn is still the machine's own exit 9, the judge is its own call and reports its own cost, the attempt row carries the cost and the turns of its call, no errand ever tells an agent to ask `ct-step` | `run-machine.js` and the contract of the verbs and the task brief | dispatch | plugin | !plan | every attempt row carries the cost and turns of its own call and the judge row carries its own |
| 8 | The chain that does not stop | backend | The relay when the pull request opens, the merge noticed by sweeping, the next slice dispatched, and the slice's own tab showing its stream and taking a message | #7 | the next admissible slice is dispatched when a pull request opens, a merge dispatches whatever it unblocked, nobody is ever asked which slice is next, the slice's tab renders the stream and a message reaches the live conversation, a change asked from the coordinating session reaches that slice's own conversation | `dispatch-check.mjs` | dispatch | frontend | visual, !plan | the next dispatch is recorded within one sweep of the pull request opening with no human input between |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|
| A-1 | – | Whether the app keeps a decision log of the human gates, with the minutes spent at each one | The POC's `.companion/decisiones.jsonl`, append-only, one line per gate with `minutos_humanos`; or nothing, and human time stays unmeasured | Parked — it is a product contract of its own and no slice needs it |
| A-2 | – | What happens to the `repo_list` mode of `/start-plan` once the epic path no longer uses it | Keep it for the short path of a loose issue; or retire it and lose multi-repository starts | Parked — out of this epic's scope by its anti-scope |
| A-3 | 1 | The retirement of the whole go protocol, whose default this epic removes. Measured on `e04e484`: `gates.js`, `kickoff.js`, `ct-go.mjs`, `ct-watch-go.mjs`, `ct-watch-merge.mjs`, `go-channel.js`, `go-registry.js`, `go-response.js`, `dispatch-check.mjs`'s exit-9 ladder, `ct-next.mjs`, `run-metrics.js`, `step-contracts.js`, `watch-common.js`, `cmux.js` and four backend modules — 17 production files and 28 test files, around 168 assertions naming the nonce, the go or the label. Its own pending decision: what happens to the live issues of governed repositories that already carry the `gate:plan` label, and to a spec row that already writes `Gate: plan` | Retire it all in this epic; or remove only the default now and the protocol in later work | Parked — decision taken: only the default dies here, deliberately, so this epic does not touch the distributed plugin beyond one line. Retire the rest in later work |

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
