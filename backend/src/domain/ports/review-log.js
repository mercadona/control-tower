export class ReviewLog {
  noted({ issue, repository, at }) {
    throw new Error(
      `${this.constructor.name} must implement noted({ issue, repository, at }), told about ${issue} in ${repository} at ${at}`
    )
  }

  lastAskedAt({ issue, repository }) {
    throw new Error(
      `${this.constructor.name} must implement lastAskedAt({ issue, repository }), asked for ${issue} in ${repository}`
    )
  }
}
