# Frontend usability — implementation plan

## Scope and decisions

1. Model recovery as a mutation lock. A fresh `/active-plans` failure says the
   backend is unavailable; an indeterminate/lost `POST /start-plan` says an
   existing workflow may exist. Both disable new starts until an explicit,
   state-appropriate recovery or discard action, preventing duplicate starts.
2. While `POST /start-plan` is pending, disable the form and show the
   indeterminate logistics `Loading` mirror with the API-backed explanation
   that baseline checks can take minutes. Do not render a percentage.
3. Replace `Comentario` with `TextArea`, labelled `Qué quieres planificar`.
   Ticket and description remain independently optional but jointly required;
   repository and path are visibly required and validate after interaction.
   Persist the normalized description in the workflow request and summary as an
   optional extension. Recovery accepts backend requests and v1 snapshots that
   predate it, while newly saved snapshots use v2.
4. Add a visible, keyboard-accessible `/external-tools` status region in the
   focused screen. It has a non-tooltip label, a real details trigger, per-tool
   state/fix and retry action. Reuse only the feature files from `6871f5b` as
   reference; do not merge its branch.
5. Render the numbered Solicitud, Revisar plan and Implementación flow from
   the first paint. The current stage owns the full workspace; completed stages
   retain compact expandable facts without changing that current stage.
6. Separate implementation stage, task context, diagnostics and PR link in
   `ImplementProgress`; only show fields actually supplied by the API.
7. Keep `WorkflowStep` because it is a workflow stage control: unlike upstream
   `CollapsableCard` it makes the whole header the accessible stage affordance
   and exposes status. Align its responsive treatment to the DS `768/1024/
   1280/1920` scale (use `768`, never local `480/600` breakpoints).
8. Mirror upstream `TextArea` and `Loading` as local components, matching
   current local conventions and vendored tokens. Upstream current source uses
   `--foreground-tertiary` and `--border-disabled`; vendored `0.42.1` lacks
   them, so the compatible adaptation uses `--foreground-secondary` and
   `--border-secondary`. Theme files remain untouched.
9. Add RTL/Vitest coverage for input error states, pending start, recovery
   lock, health details/retry, persistent plan facts and progress hierarchy;
   run `npm test` and `npm run build`. Visual QA is only reported if a safe
   local render is available without a real backend mutation.

## Implemented work and validation

- Tool health lives in the TopBar actions slot. Its details open in an anchored
  panel with logistics surface, border, radius and elevation tokens; Escape,
  outside clicks and leaving the control dismiss it.
- Implemented the recovery lock in `Home`: it remains closed through a retry
  request, clears to `not-required` only after a fresh empty survey, and
  retains the existing interaction token race protection.
- Added an automatic, cleaned-up external-tool survey plus `/external-tools`
  Vite proxy routing. Client, hook, and component tests cover ready, attention,
  unavailable, retries, all listed tools, and a late response after unmount.
- Added touched-on-blur validation and FormField error states for ticket,
  repository, and path; tests cover partial typing and cleared required fields.
- Kept Plan mounted while implementation runs but disabled observation, so the
  user can expand its summary/details and copy facts without reopening SSE.
  Implementation progress renders stage, task count/name, attempt/diagnostics,
  and PR independently for partial backend payloads.
- Replaced self-targeting container behavior in the locked request summary with
  an intrinsic `auto-fit/minmax` grid. `WorkflowStep` retains a container query
  only for descendant layout, preserving reusable box adaptation.
- Verified every newly introduced semantic token against the vendored theme.
  Typography uses the vendored `lg-body-medium` and `lg-caption1-regular`
  utilities, not unavailable typography variables. The form sets
  `--form-control-width: 100%` so TextArea and Input align.
- Incorporated browser-review feedback: the focused desktop screen uses the
  DS `--layout-container-md` (1024px) rather than the 640px small container.
  Its existing `<768px` mobile padding and reusable component box adaptation
  remain unchanged, while full-width form controls use the added space
  consistently.

The upstream implementation references reviewed were
[TextArea](https://github.com/mercadona/mo.staff-design/blob/master/packages/logistics-ui/src/components/TextArea/TextArea.tsx),
[Loading](https://github.com/mercadona/mo.staff-design/blob/master/packages/logistics-ui/src/components/Loading/Loading.tsx),
[CollapsableCard](https://github.com/mercadona/mo.staff-design/blob/master/packages/logistics-ui/src/components/CollapsableCard/CollapsableCard.tsx),
and the [logistics-ui README](https://github.com/mercadona/mo.staff-design/blob/master/packages/logistics-ui/README.md).
The local vendoring provenance remains `VENDORED.md` commit
`466bfd3aa5a6ca2e97dda468c15dc02e8584bef6`; no generated theme source was edited. Focused RTL/Vitest
coverage passed before the final full suite and build run.

## Flow clarity iteration

The page now has a persistent, numbered three-step flow: Solicitud, Revisar
plan, and Implementación. The derived current stage follows workflow state,
not the completed summary the user may be inspecting. The active stage is the
only full workspace; completed Solicitud and Revisar plan stages remain compact
expandable summaries so their facts stay available without changing the active
work.

`ready` deliberately remains in Revisar plan. That workspace offers the known
GitHub issue link and the existing `POST /implement-plan` action; it never
claims to have fetched a plan document and moves to Implementación only after a
successful response. Planning and unconfirmed recovery use neutral tracking
copy. Implementation uses the backend progress component for specific stage
claims, including delivered and review states.

Tool health remains in `TopBar.actions`, including its floating detail-panel
dismissal behavior. During restored recovery, plan facts can stay mounted but
their EventSource observation is limited to confirmed planning workflows;
stale, unavailable, inconclusive, and uncertain workflows open no stream.

The upstream [Navigation.tsx](https://github.com/mercadona/mo.staff-design/blob/master/packages/logistics-ui/src/components/Navigation/Navigation.tsx)
source was reviewed after the initial catalog lookup. It is an app-shell
navigation component that composes navbar, top bar, tab bar, and scrollable
content; it is not a workflow-step indicator. The page therefore makes no claim
of direct component conformance. Its persistent indicator is page-level semantic
ordered navigation using vendored tokens, while existing `WorkflowStep` remains
the local workflow-specific completed-summary control.

When several active plans are recovered, their continuation choices remain
visible beside a fresh request form. Starting to type uses the existing
interaction handler to clear those choices, so a new request never requires
selecting or starting another recovered workflow first.

This final desktop-flow pass adds regression coverage for unconfirmed restored
ready workflows, confirmed ready review, keyboard dismissal and focus return
for tool details, and keyboard access to completed summaries while another
stage remains current. It does not add mobile-specific work. The focused run
passed 49 tests in 4 files; the final frontend run passed 585 tests in 27 files;
and `npm run build` passed. No browser visual QA was run in this pass, and no
real plan or backend mutation was started.
