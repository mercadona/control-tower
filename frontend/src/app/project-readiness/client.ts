import {
  CHECK_LABELS, NEXT_ACTIONS, ProjectReadinessOutcome, ProjectReadinessReport, ReadinessFinding, ReadinessStatus,
} from './ProjectReadiness.types'

export class ProjectReadinessClient {
  static record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  static status(value: unknown): value is ReadinessStatus {
    return value === 'ready' || value === 'changes-required' || value === 'unverified'
  }

  static finding(value: unknown): value is ReadinessFinding {
    return ProjectReadinessClient.record(value) && Object.keys(value).length === 4
      && typeof value.id === 'string' && Object.hasOwn(CHECK_LABELS, value.id)
      && ProjectReadinessClient.status(value.status)
      && Array.isArray(value.evidence) && value.evidence.every((item) => typeof item === 'string')
      && (value.action === null || (typeof value.action === 'string' && Object.hasOwn(NEXT_ACTIONS, value.action)))
      && (value.status === 'ready' || value.action !== null)
  }

  static report(value: unknown): value is ProjectReadinessReport {
    if (!ProjectReadinessClient.record(value) || Object.keys(value).length !== 6
      || typeof value.repo !== 'string' || typeof value.path !== 'string' || !value.path.startsWith('/')
      || !(value.base_revision === null || (typeof value.base_revision === 'string' && /^[a-f0-9]{40,64}$/.test(value.base_revision)))
      || typeof value.observed_at !== 'string' || !Number.isFinite(Date.parse(value.observed_at))
      || !ProjectReadinessClient.status(value.status) || !Array.isArray(value.findings)
      || value.findings.length === 0 || !value.findings.every(ProjectReadinessClient.finding)) return false
    if (new Set(value.findings.map((finding) => finding.id)).size !== value.findings.length) return false
    const status = value.findings.some((finding) => finding.status === 'changes-required') ? 'changes-required'
      : value.findings.some((finding) => finding.status === 'unverified') ? 'unverified' : 'ready'
    return value.status === status
  }

  static async inspect(repo: string, path: string, signal: AbortSignal): Promise<ProjectReadinessOutcome> {
    try {
      const response = await fetch('/project-readiness', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repo, path }), signal,
      })
      const body: unknown = response.ok ? await response.json() : null
      if (!ProjectReadinessClient.report(body) || body.repo !== repo) return { kind: 'unavailable' }
      return { kind: 'inspected', report: body }
    } catch {
      return { kind: 'unavailable' }
    }
  }
}
