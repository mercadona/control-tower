import { ImplementationStep, STEP_LABELS } from 'app/implement-progress/ImplementProgress.types'
import { ElapsedTime } from 'app/milestone-progress/ElapsedTime'
import type { SliceAttention, SliceLine, SliceTask } from 'app/milestone-progress/MilestoneProgress.types'

type AttentionCopy = { title: string; findings: string | null; detail: string }

class SliceLineCopy {
  static readonly #PLANNING_STEP = 'planning'
  static readonly #PLANNING_LABEL = 'Preparando el plan'
  static readonly #TASK_DONE_LABEL = 'Hecha'
  static readonly #TASK_PENDING_LABEL = 'Pendiente'
  static readonly #TASK_STOPPED_LABEL = 'Detenida'
  static readonly #VETO_TITLE = 'El juez cerró este slice'
  static readonly #VETO_HINT = 'Habla con la sesión coordinadora para decidir qué hacer.'
  static readonly #UNCERTAIN_TITLE = 'No se puede confirmar el estado'
  static readonly #PARTIAL_TITLE = 'Implementación terminada; publicación sin confirmar'
  static readonly #UNREADABLE_TITLE = 'No se puede leer el trabajo de este slice'

  static #stepWithTime(line: SliceLine, now: number): string {
    const parts = [
      line.step === null ? null : SliceLineCopy.#stepLabel(line.step),
      line.stepStartedAt === null ? null : ElapsedTime.since(line.stepStartedAt, now),
    ].filter((part): part is string => part !== null)

    return parts.join(' · ')
  }

  static runningLabel(line: SliceLine, now: number): string {
    const parts = [
      line.step === null ? null : SliceLineCopy.#stepLabel(line.step),
      line.task === null ? null : `Tarea ${line.task}${line.totalTasks === null ? '' : ` de ${line.totalTasks}`}`,
      line.stepStartedAt === null ? null : ElapsedTime.since(line.stepStartedAt, now),
    ].filter((part): part is string => part !== null)

    return parts.join(' · ')
  }

  static taskTitle(task: SliceTask): string {
    return task.name === null ? `Tarea ${task.number}` : `Tarea ${task.number} · ${task.name}`
  }

  static taskStatusLabel(task: SliceTask, line: SliceLine, now: number): string {
    switch (task.status) {
      case 'done': return SliceLineCopy.#TASK_DONE_LABEL
      case 'pending': return SliceLineCopy.#TASK_PENDING_LABEL
      case 'stopped': return SliceLineCopy.#TASK_STOPPED_LABEL
      case 'running': return SliceLineCopy.#stepWithTime(line, now)
    }
  }

  static attention(attention: SliceAttention): AttentionCopy {
    switch (attention.kind) {
      case 'veto': return { title: SliceLineCopy.#VETO_TITLE, findings: attention.findings, detail: SliceLineCopy.#VETO_HINT }
      case 'uncertain': return { title: SliceLineCopy.#UNCERTAIN_TITLE, findings: null, detail: attention.detail }
      case 'partial': return { title: SliceLineCopy.#PARTIAL_TITLE, findings: null, detail: attention.detail }
      case 'unreadable': return { title: SliceLineCopy.#UNREADABLE_TITLE, findings: null, detail: attention.detail }
    }
  }

  static #stepLabel(step: string): string {
    if (step === SliceLineCopy.#PLANNING_STEP) return SliceLineCopy.#PLANNING_LABEL

    return SliceLineCopy.#isImplementationStep(step) ? STEP_LABELS[step] : step
  }

  static #isImplementationStep(step: string): step is ImplementationStep {
    return (Object.values(ImplementationStep) as string[]).includes(step)
  }
}

export { SliceLineCopy }
