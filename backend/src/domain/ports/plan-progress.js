export class PlanProgress {
  async of({ located, issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement of({ located, issue, repository }), asked for ${issue?.number} at ${located?.path} in ${repository}`
    )
  }

  async committedAt({ located }) {
    throw new Error(
      `${this.constructor.name} must implement committedAt({ located }), asked for ${located?.path}`
    )
  }
}
