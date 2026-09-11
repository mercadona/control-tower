import { InspectProjectParams } from '../application/queries/inspect-project.js'

export class ProjectStatusView {
  constructor({ inspectProject }) {
    this.inspectProject = inspectProject
  }

  async render(root, response) {
    const result = await this.inspectProject.execute(new InspectProjectParams({ root }))
    response.end(JSON.stringify({ status: result.report.status }))
  }
}
