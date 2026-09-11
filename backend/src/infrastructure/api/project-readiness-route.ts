import type { Request, Response } from 'express'
import { Answer, JsonBody } from '../http.ts'
import { InspectProjectParams } from '../../application/queries/inspect-project.ts'
import type { InspectProject } from '../../application/queries/inspect-project.ts'
import type { ProjectReadiness } from '../../domain/value-objects/project-readiness.ts'
import { PlanTarget } from '../../domain/value-objects/plan-target.ts'
import { CheckoutRoot } from '../../domain/value-objects/checkout-root.ts'
import { RepositoryName } from '../../domain/value-objects/repository-name.ts'

export type ProjectInspector = Pick<InspectProject, 'execute'>

class ProjectTargetRequest {
  static from(text: string): PlanTarget | null {
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return null }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    if (Object.keys(parsed).length !== 2 || !('repo' in parsed) || !('path' in parsed)) return null
    if (!RepositoryName.isWellFormed(parsed.repo) || !CheckoutRoot.isWellFormed(parsed.path) || /[\0\r\n]/.test(parsed.path)) return null
    return new PlanTarget({ repository: new RepositoryName(parsed.repo), root: new CheckoutRoot(parsed.path) })
  }
}

class ReadinessResponse {
  static from(report: ProjectReadiness) {
    return {
      repo: report.repository, path: report.root, base_revision: report.baseRevision,
      observed_at: new Date(report.observedAt).toISOString(), status: report.status,
      findings: report.findings.map((finding) => ({
        id: finding.id, status: finding.status, evidence: finding.evidence, action: finding.action,
      })),
    }
  }
}

export class ProjectReadinessRoute {
  static readonly PATH = '/project-readiness'
  static readonly METHOD = 'POST'

  static handledBy(inspectProject: ProjectInspector) {
    return async (request: Request, response: Response): Promise<void> => {
      const target = ProjectTargetRequest.from(JsonBody.textOf(request))
      if (target === null) {
        Answer.refuse(response, 400, 'malformed-project-target', 'body must contain only a valid repo and absolute path')
        return
      }
      const result = await inspectProject.execute(new InspectProjectParams({ target }))
      Answer.send(response, 200, ReadinessResponse.from(result.report))
    }
  }

  static refuseOtherMethods(_request: Request, response: Response): void {
    response.setHeader('Allow', ProjectReadinessRoute.METHOD)
    Answer.refuse(response, 405, 'method-not-allowed', 'method not allowed')
  }
}
