import {
  CHECK_LABELS, NEXT_ACTIONS, STATUS_LABELS, InspectionUnavailable, ProjectReadinessOutcome, ProjectReadinessReport, ReadinessFinding, ReadinessStatus,
} from './ProjectReadiness.types'

export class ProjectReadinessClient {
  static #record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static #status(value: unknown): value is ReadinessStatus {
    return typeof value === 'string' && Object.hasOwn(STATUS_LABELS, value)
  }

  static #finding(value: unknown): value is ConstructorParameters<typeof ReadinessFinding>[0] {
    return ProjectReadinessClient.#record(value) && Object.keys(value).length === 4
      && typeof value.id === 'string' && Object.hasOwn(CHECK_LABELS, value.id)
      && ProjectReadinessClient.#status(value.status)
      && Array.isArray(value.evidence) && value.evidence.every((item) => typeof item === 'string')
      && (value.action === null || (typeof value.action === 'string' && Object.hasOwn(NEXT_ACTIONS, value.action)))
      && (value.status === 'ready' || value.action !== null)
  }

  static #report(value: unknown): ProjectReadinessReport | null {
    if (!ProjectReadinessClient.#record(value) || Object.keys(value).length !== 6
      || typeof value.repo !== 'string' || typeof value.path !== 'string' || !value.path.startsWith('/')
      || !(value.base_revision === null || (typeof value.base_revision === 'string' && /^[a-f0-9]{40,64}$/.test(value.base_revision)))
      || typeof value.observed_at !== 'string' || !Number.isFinite(Date.parse(value.observed_at))
      || !ProjectReadinessClient.#status(value.status) || !Array.isArray(value.findings)
      || value.findings.length === 0 || !value.findings.every(ProjectReadinessClient.#finding)) return null
    if (new Set(value.findings.map((finding) => finding.id)).size !== value.findings.length) return null
    return new ProjectReadinessReport({
      repository: value.repo, path: value.path, baseRevision: value.base_revision,
      observedAt: value.observed_at, status: value.status,
      findings: value.findings.map((finding) => new ReadinessFinding(finding)),
    })
  }

  static async inspect(repo: string, path: string, signal: AbortSignal): Promise<ProjectReadinessOutcome> {
    try {
      const response = await fetch('/project-readiness', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, path }), signal,
      })
      const body: unknown = response.ok ? await response.json() : null
      const report = ProjectReadinessClient.#report(body)
      if (report === null || report.repository !== repo) return new InspectionUnavailable()
      return report
    } catch {
      return new InspectionUnavailable()
    }
  }
}
