# The focused view follows the story through implementation — design

**Story:** mercadona/control-tower#585
**Sources:** the design interview and the six boards "Implementación · …" of
https://claude.ai/artifact/Jy7zBnpjrxmpczxfsq3QAc (I1 list, I2 expanded, I3
attention, I4 session panel, I5 session ended, I6 completed); the facts,
inventories and traps of #582, #583 and #584.

The design was decided before this brainstorming. This document records it as
the execution spec's origin; it does not reopen it.

## What the person sees

While a coordinating session is held (live, ended or unresumable), the page is
the focused view through its four steps — Brainstorming, Congelación del spec,
Groom y autorización, Implementación. Implementation runs from the first slice
started to the last pull request merged, with step 4 in progress. With no
session held, the page is only the start form.

With a milestone in flight the page shows that milestone and nothing else:
slices of other stories do not appear, and no other story is started until it
ends.

**Header (I1).** Title "Implementación", the story key and repository, and two
actions: "Hablar con la sesión" and "Cancelar la sesión".

**Centre (I1).** A section "Issues del milestone" with "X de N entregadas" and
one line per issue of the milestone, pending, running and delivered alike:

- status mark, issue number, title;
- for a running issue, "<step> · Tarea X de Y · mm:ss", the time since the
  current step started, ticking;
- "Entregada" and "Pull request #N" linked, for a delivered one;
- "Pendiente" for one not started;
- an expand control on running issues.

**Expanded line (I2).** The tasks of the slice, each with its status (Hecha,
the running step with its time, Pendiente), plus "Cierre del slice"; what the
judge found when it stopped a task; and a live box: "El agente está trabajando
· mm:ss en este paso", "Última herramienta: <tool · target>", "Último mensaje:
«…»". The page never looks frozen between tasks.

**Needs the person (I3).** The line is marked, says what happened and carries
the one action that fits it:

- judge veto: "El juez cerró este slice", "Lo que encontró el juez: …", "Habla
  con la sesión coordinadora para decidir qué hacer.", button "Hablar con la
  sesión";
- uncertain state: "No se puede confirmar el estado", the backend's diagnostic,
  and the single recovery button the backend offers ("Recuperar trabajo");
- partial delivery, with its own wording and action from the existing copy.

The notice "El repositorio ya estaba en rojo antes de empezar. Un slice puede
fallar por algo que no ha tocado." appears above the list only when the
baseline of some slice was red.

**Session panel (I4).** "Hablar con la sesión" opens the coordinating session's
terminal in a panel over the list.

**Session ended (I5).** A session that ended by itself shows, in every step, "La
sesión coordinadora se ha cerrado" and "Reabrir la sesión". In step 4 the notice
adds "Los slices siguen en marcha. Reábrela para volver a hablar con ellos;
conserva lo que ya se habló."; in steps 1 to 3 it adds "Reábrela para seguir;
conserva lo que ya se habló." This notice is the only change to steps 1 to 3.
Reopening resumes the same conversation by its identifier; only when
that is impossible does it open a new one with the prompt of the current step.

**Completed (I6).** With every issue delivered: title "Milestone completado",
"Las N issues están entregadas y mergeadas", "<story> está terminado." and one
action, "Cerrar la sesión y volver al inicio".

**Cancel.** "Cancelar la sesión" stays as it is today. After it the page is the
start form and running slices are not shown; that gap belongs to another story.

## Architecture

### Backend: one read and one action

`GET /milestone-progress` reads the milestone of the held coordinating session
(the same source `/epic-groom` uses: root, repository, story) and answers one
line per issue.

- Query `ReadMilestoneProgress` (application) returns the value object
  `MilestoneProgress`, a list of `SliceLine`.
- `SliceLine` carries: state (`pending`, `running`, `needs-person`,
  `delivered`); step, task X of Y and when the current step started; the live
  activity of the current agent call (last tool, last text); the pull request
  when there is one; attention (judge veto with its findings, uncertain with its
  recovery action, partial delivery); baseline red yes or no; and the tasks with
  their status and the judge's finding when it stopped one.
- It composes existing ports — epic specs, epic issues (extended with the
  closed state and the delivered pull request), the work inventory with harvest
  receipts, run-file progress, implement history — and two new ones: the
  activity of the current implementation call and the slice's baseline.
- The current call is picked from `history(conversation)` by `startedAt` among
  the calls with purpose `implementation`, because the step role is not stored
  and `implementationFor` throws when there is more than one. Its
  `stream.ndjson` is read the way `StreamPlanningActivities` reads planning's.
- The baseline is read from the `baseline:` field of the slice's state file in
  its worktree.
- The agent of a running slice is resolved inside the backend; the page does
  not need `/active-plans` to ask.

`POST /coordinating-session/reopen` (action `ReopenCoordinatingSession`)
resumes the same conversation with `ClaudeConversations.resume` when its
transcript exists (`isResumable`), and otherwise opens a new conversation with
the prompt of the step the story is in — a new implementation prompt for step
4. The backend deduces that step itself: spec not frozen is brainstorming,
frozen but not authorized is groom, gate 2 authorized is implementation. After an explicit close nothing is held and nothing reopens; that case is
out of scope.

Domain knows neither GitHub nor the disk; every source is injected.

### Frontend: the focused view owns the page

`Home` renders the focused view whenever a session is held, and the start form
otherwise. Step 4 reads `/milestone-progress` by polling, the way the focused
view already reads its gates, and keeps the last read through an outage with
the single "Sin conexión con el backend" notice. The recovery button calls the
existing `recover()`/`cleanup()` with `{repo, issue, agent}` from the line. The
session panel mounts `SessionTerminal` directly, as `CentredSession` does.

The classic implementation view is deleted rather than reshaped, with
everything only it used — the inventory in #583.

### Cleanup

Once the page reads `/milestone-progress`, the backend routes and fields left
without a caller go, with their tests and docs — the inventory in #584.

## Slicing

Three slices in order, one per issue: the backend read and reopen (#582), the
focused implementation view with the classic view removed (#583), and the
backend cleanup (#584). The groom creates new issues for them; #582, #583 and
#584 are then closed as superseded, pointing to the new ones.

## Testing

- Backend: the query and the action with test doubles that answer by what they
  are asked; the endpoint answers pending, running, vetoed, uncertain and
  delivered issues; reopen resumes by identifier and falls back to a new
  conversation.
- Frontend: one page test per board state (I1–I6), plus "no session held →
  start form only".
- Cleanup: a final sweep finds no code, type, field, fixture or doc whose only
  reader was removed.
