export class ProjectReadinessMother {
  static report() {
    return {
      repo: 'owner/project', path: '/repo', base_revision: 'a'.repeat(40),
      observed_at: '2026-09-10T00:00:00.000Z', status: 'changes-required',
      findings: [
        { id: 'test-workers', status: 'changes-required', evidence: ['pytest -n auto'], action: 'limit-workers' },
        { id: 'execution', status: 'unverified', evidence: [], action: 'verify-execution' },
      ],
    }
  }

  static response(): Response { return new Response(JSON.stringify(ProjectReadinessMother.report())) }
}
