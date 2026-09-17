# Coordinating sessions use Claude auto mode

## Approval and scope

The user approved this design on 2026-09-17 for
https://github.com/mercadona/control-tower/issues/386. Work starts from main
at `a1e9ee0`, in `.worktrees/386`, branch `feat/386`.

The user selected `--permission-mode auto`, explicitly disabled the
`flag-discipline` default for this project, and approved the design below.
The requested delivery sequence is Astra planning, Sol implementation, and a
fresh Astra review, coordinated without Orca.

## Decisions

1. Start and resume interactive coordinating conversations with Claude's
   native `auto` permission mode. This covers brainstorming and groom.
   Source: the user selected option 1 and approved the design.
2. Separate interactive permission configuration from headless permission
   configuration. `ClaudePlanCalls` currently imports
   `ClaudeConversations.PERMISSION_MODE`, so changing that shared value alone
   would also change headless calls. Keep headless calls at `acceptEdits`.
   Source: the user approved this scope distinction.
3. Apply the change directly, without a feature flag. Source: the user's
   explicit project-wide opt-out, recorded in AGENTS.md and CLAUDE.md.
4. Preserve Claude's classifier decisions, explicit permission rules, hooks,
   and repository controls. Respect the CLI's behavior if auto mode is
   unavailable; do not add a bypass fallback. Source: the approved design.
5. Validate literal opening and resuming command payloads, preserve headless
   payload coverage, and obtain evidence from a real Claude session executing
   Bash and a normal brainstorming flow without a waiting-for-permission
   timeline event. Source: issue acceptance and the approved design.
6. Record the selected route and its permission semantics in the issue.
   Source: issue requirements and the approved design.

## Observed behavior and compatibility

The installed Claude Code is 2.1.274 and its help lists `auto` as a supported
permission-mode argument. Argument support alone does not establish that auto
mode is active for a particular account, provider, or model.

The official permission-mode documentation says auto mode uses a classifier
to approve routine actions and block others. Explicit ask rules can still
prompt. When auto mode is unavailable, Claude can start in Manual mode.
Acceptance therefore measures the actual runtime, not only the argument.

Reference: https://code.claude.com/docs/en/permission-modes

## Verification expectations

- Assert `auto` literally at the interactive start and resume boundary.
- Assert `acceptEdits` literally at the headless boundary.
- Keep the real-shell argument test meaningful; its fake Claude binary is
  not evidence of real Claude permission behavior.
- Run backend typechecking and the applicable suite from `backend/`.
- Capture real Claude acceptance evidence with bounded execution and reliable
  cleanup. Report account, provider, policy, or environment blockers honestly.
- A genuine permission event remains observable through the existing hooks
  and timeline; passing acceptance must not rely on filtering those events.

## Delivery artifacts

This approved design is the planning handoff for the existing issue. The
governed-repository execution-spec template is not seeded at
`docs/superpowers/specs/_TEMPLATE-execution-spec.md` in this checkout; its
distributable source exists under `plugin/templates/`. Do not invent a
milestone freeze or groom flow for this standalone issue.

Keep code, tests, agent briefs, and documentation in English. Commits, pushes,
and pull requests require an explicit user request. The user has now explicitly
requested a draft pull request for this implementation.

## Verification status

- Backend typechecking passed, and the full backend suite passed all 2,221
  tests.
- A real coordinating session retained native auto mode and produced eight
  successful Bash results, including `git status --short`.
- The ordinary multiple-choice brainstorming clarification coincided with the
  generic `Claude needs your permission` notification and a real
  `waiting-for-permission` timeline event. The evidence does not establish a
  tool-authorization prompt, and the event must not be hidden or reclassified
  without a separate decision.
- No clarification answer, completed turn, or same-UUID resume is proven, so
  live acceptance remains incomplete and the pull request remains draft.
