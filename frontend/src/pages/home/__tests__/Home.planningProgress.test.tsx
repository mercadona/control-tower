import { screen, waitFor } from '@testing-library/react'
import { PlanEventsMother } from '__scenarios__/PlanEventsMother'
import { StartPlanMother } from '__scenarios__/StartPlanMother'
import { WorkflowSnapshot, WorkflowSnapshotStorage } from 'app/workflow-snapshot/storage'
import { FakeEventSource } from './FakeEventSource'
import {
  backendPending,
  openHome,
  openRestored,
  streamFrame,
} from './helpers'

const PANEL_LABEL = 'Progreso de la planificación'

describe('Home · planning progress panel', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('mounts the panel while the plan is being written', async () => {
    openRestored({ phase: 'planning' })
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))

    expect(screen.getByLabelText(PANEL_LABEL)).toBeInTheDocument()
  })

  it('unmounts the panel once the plan is ready, because there is nothing left to watch it plan', async () => {
    openRestored({ phase: 'planning' })
    await waitFor(() => expect(FakeEventSource.opened).toHaveLength(1))
    expect(screen.getByLabelText(PANEL_LABEL)).toBeInTheDocument()

    await streamFrame(PlanEventsMother.ready())

    expect(screen.queryByLabelText(PANEL_LABEL)).toBeNull()
  })

  it('does not mount the panel for an unconfirmed restored snapshot, before recovery has resolved it', async () => {
    const workflow: WorkflowSnapshot = {
      phase: 'planning',
      request: { id: StartPlanMother.TICKET, repo: StartPlanMother.REPO, path: StartPlanMother.PATH },
      plan: {
        id: StartPlanMother.TICKET,
        repo: StartPlanMother.REPO,
        issue: StartPlanMother.ISSUE,
        agent: StartPlanMother.AGENT,
        branch: StartPlanMother.BRANCH,
        worktree: StartPlanMother.WORKTREE,
      },
    }
    WorkflowSnapshotStorage.save(workflow)
    backendPending()

    openHome()

    await screen.findByText('Comprobando que el plan sigue activo')
    expect(screen.queryByLabelText(PANEL_LABEL)).toBeNull()
  })
})
