import { afterEach, describe, expect, it } from 'vitest'
import { ApiServer } from '../../src/infrastructure/api-server.js'
import { InspectProject } from '../../src/application/queries/inspect-project.ts'
import { ProjectSetup } from '../../src/domain/ports/project-setup.ts'
import { ProjectReadiness } from '../../src/domain/value-objects/project-readiness.ts'
import { ReadinessFinding } from '../../src/domain/value-objects/readiness-finding.ts'
import type { PlanTarget } from '../../src/domain/value-objects/plan-target.ts'

class InspectedSetup extends ProjectSetup {
  calls = 0

  async inspect(target: PlanTarget): Promise<ProjectReadiness> {
    this.calls += 1
    return new ProjectReadiness({
      repository: target.repository.text, root: target.root.text, baseRevision: 'a'.repeat(40),
      observedAt: '2026-09-10T00:00:00.000Z',
      findings: [new ReadinessFinding({ id: 'test-workers', status: 'changes-required', evidence: ['pytest -n auto'], action: 'limit-workers' })],
    })
  }
}

class InspectionApi {
  static readonly running: ApiServer[] = []

  static async request({ body = { repo: 'owner/project', path: '/repo' }, method = 'POST', origin }: {
    body?: unknown, method?: string, origin?: string,
  } = {}) {
    const setup = new InspectedSetup()
    const server = new ApiServer({
      port: 0, startPlan: null, implementPlan: null, askPlanChanges: null, implementProgress: null,
      reviews: null, pullRequestReviews: null, planEvents: null, sessions: null, activePlans: null,
      externalTools: null, implementationStarts: null, recovery: null, stderr: () => {},
      frontendRoot: '/ct-no-frontend', inspectProject: new InspectProject({ setup }),
    })
    const port = await server.start()
    InspectionApi.running.push(server)
    const response = await fetch(`http://127.0.0.1:${port}/project-readiness`, {
      method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    })
    return { response, setup }
  }

  static async stop(): Promise<void> {
    await Promise.all(InspectionApi.running.splice(0).map((server) => server.stop()))
  }
}

afterEach(() => InspectionApi.stop())

describe('ProjectReadinessRoute', () => {
  it('returns_the_inspection_and_its_scope_without_starting_a_plan', async () => {
    const { response, setup } = await InspectionApi.request()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      repo: 'owner/project', path: '/repo', base_revision: 'a'.repeat(40), observed_at: '2026-09-10T00:00:00.000Z',
      status: 'changes-required',
      findings: [{ id: 'test-workers', status: 'changes-required', evidence: ['pytest -n auto'], action: 'limit-workers' }],
    })
    expect(setup.calls).toBe(1)
  })

  it.each([null, [], { repo: 'bad', path: '/repo' }, { repo: 'owner/project', path: 'relative' }, { repo: 'owner/project', path: '/repo', execute: true }].map((body) => [body]))(
    'rejects_a_malformed_request_before_inspection: %j', async (body) => {
      const { response, setup } = await InspectionApi.request({ body })
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ code: 'malformed-project-target' })
      expect(setup.calls).toBe(0)
    },
  )

  it('rejects_a_foreign_origin_without_inspecting_local_files', async () => {
    const { response, setup } = await InspectionApi.request({ origin: 'https://other.example' })
    expect(response.status).toBe(403)
    expect(setup.calls).toBe(0)
  })

  it('declares_the_supported_method', async () => {
    const { response, setup } = await InspectionApi.request({ method: 'GET' })
    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('POST')
    expect(setup.calls).toBe(0)
  })
})
