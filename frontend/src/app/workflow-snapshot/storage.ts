import { StartedPlan, StartPlanRequest } from 'app/start-plan/StartPlan.types'
import { isPlanForRequest, isRecord, isRequest } from 'app/workflow-snapshot/validation'

type WorkflowSnapshot = {
  phase: 'planning' | 'implementing'
  request: StartPlanRequest
  plan: StartedPlan
}

type RestorableWorkflow = Omit<WorkflowSnapshot, 'phase'> & { phase: WorkflowSnapshot['phase'] | 'ready' }

type StoredWorkflowSnapshot = {
  version: 1 | 2
  workflow: WorkflowSnapshot
}

const KEY = 'control-tower.workflow'
const VERSION = 2

const isWorkflow = (value: unknown): value is RestorableWorkflow =>
  isRecord(value) &&
  (value.phase === 'planning' || value.phase === 'ready' || value.phase === 'implementing') &&
  isRequest(value.request) &&
  isPlanForRequest(value.plan, value.request)

const load = (): WorkflowSnapshot | null => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (!isRecord(value) || (value.version !== 1 && value.version !== VERSION) || !isWorkflow(value.workflow)) return null

    return { ...value.workflow, phase: value.workflow.phase === 'ready' ? 'planning' : value.workflow.phase }
  } catch {
    return null
  }
}

const save = (workflow: WorkflowSnapshot) => {
  try {
    const stored: StoredWorkflowSnapshot = { version: VERSION, workflow }
    localStorage.setItem(KEY, JSON.stringify(stored))
  } catch {
  }
}

const remove = () => {
  try {
    localStorage.removeItem(KEY)
  } catch {
  }
}

export const WorkflowSnapshotStorage = { load, save, remove }
export const WORKFLOW_SNAPSHOT_KEY = KEY
export type { WorkflowSnapshot }
