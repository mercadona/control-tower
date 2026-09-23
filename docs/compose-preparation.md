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

This first implementation supports the Catalog/Playground Makefile layout:
`DOCKER_COMPOSE_FILE` names a single base Compose file at the root or under `docker/`, relative to `ROOT_FOLDER`,
and `DOCKER_COMPOSE_OVERRIDE_FILE` names the sibling `docker-compose.local.yml`,
appended to `DOCKER_COMMAND` when it exists. A forced `-p` or `--project-name`
refuses preparation. Unresolved wrappers, multiple base files and Compose includes
are reported as not checked, not approved by a guessed interpretation.

Named external resources and fixed container names require a repository change.
A normal default Compose `name:` does not: the local override replaces it.
Repositories with no discovered Compose configuration are not applicable to this
check; that is not a certification of every other environment they may use.

## Per-worktree configuration

The project name is derived from the absolute worktree path. The local override
resets each service's published ports, allowing parallel tests over Compose's
internal network. It must already be ignored by Git, and creation uses an
exclusive write. Existing files are never overwritten by the preparer.

Compose's effective configuration must name the reserved project, have no
published ports, fixed container names, host networking or shared named volumes
and networks. An application bind mount at `/app` must point to this worktree.
This measures configuration, not the live mount table. No container is started
and local credential files are neither copied nor filled in by this feature.

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
