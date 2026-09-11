import { ReadRevisionParams } from '../application/queries/read-revision.js'

export class RevisionView {
  constructor({ readRevision }) {
    this.readRevision = readRevision
  }

  async render(root, response) {
    const result = await this.readRevision.execute(new ReadRevisionParams({ root }))
    response.end(JSON.stringify({ revision: result.revision.text }))
  }
}
