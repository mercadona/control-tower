# Compose preparation before dispatch

The STAFF-127 rehearsal selected independent code slices but used one Compose
project for their tests. Recreating the shared application container changed the
checkout its siblings saw. A missing test file was an environment collision, not
a code defect for the implementer to fix.

## Ownership and flow

Control Tower owns the check and the local preparation. Governed repositories
need no Control Tower script or capability manifest.

`CheckRepositoryPreparation` is injected into milestone authorization, dispatch
and workspace preparation. The `WorktreeEnvironments` port isolates the execution-environment step from Git
workspace creation, with `ComposeWorktreeEnvironments` as its Compose adapter.
Authorization checks before promoting issues; dispatch checks before claiming any candidate. The adapter fetches the remote
default HEAD by commit and reads its files with Git, without switching branches
or replacing local source files. A corrected revision is read on the next check.

The initial result says whether the versioned configuration supports isolation,
not whether containers are running. The worktree is checked again on its own
commit before its baseline or agent starts.

## Supported configuration

This check addresses the Playground incident: a Makefile forcing the same Compose
project and `/app` pointing at a sibling checkout. The remote check reports a
`-p` or `--project-name` override, which would outrank the local project name.
It does not require particular Makefile lines, assignment spacing or variable
definitions.

In the worktree, GNU Make resolves the existing `DOCKER_COMMAND` through `make
-qp`. Exit 1 is the normal question-mode answer for an out-of-date target, not a
failed lookup. The checker parses that expanded command into arguments and asks
Compose for its configuration. It does not execute a shell recipe or start a
service. Only the direct `docker compose` prefix with file/project-name options
used by these repositories is supported; unresolved commands are not checked.

Docker Compose parses its own configuration. There is no separate YAML parser or
audit of external resources, custom container names or networking policies.
Repositories with no discovered Compose configuration are not applicable to this
check; that is not a certification of every other environment they may use.

## Per-worktree configuration

The project name is derived from the absolute worktree path. The local override
resets the ports that the base configuration publishes: Playground's Centrifugo
port would otherwise collide as soon as a second environment starts. The file
must already be ignored by Git, and creation uses an exclusive write. Existing
files are never overwritten by the preparer.

The configuration read through Make's Compose command must select that project
name and mount this worktree at `/app`. If the command ignores the override or
still points at a sibling checkout, the agent does not start. This measures the
configuration, not the live mount table. Local credential files are neither copied
nor filled in by this feature.

## A refusal and the way back

The page shows the repository, revision, path, cause and proposed correction.
The coordinating session receives the same diagnostic plus the instruction to
ask for human authorization before helping prepare a separate fix pull request.
An unchanged diagnostic is not repeatedly injected into the same session.

Before authorization, the button becomes **Volver a comprobar y autorizar**.
After authorization, preparation findings remain visible through the existing
groom polling and **Volver a comprobar** performs a fresh remote check without
changing the spec. Local findings remain until that worktree's configuration
passes. The next dispatch still checks afresh; a cached display is never permission
to launch. Latest findings are held in memory, not a new persisted run state.

The fix travels through the repository's usual review and merge process. Neither
an agent saying it is fixed nor an open pull request clears the check. Repository
configuration remains the team's decision; Control Tower does not rewrite a
Makefile or broaden a frozen scope on its own.
