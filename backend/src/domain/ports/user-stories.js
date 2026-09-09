export class UserStories {
  async detail(reference) {
    throw new Error(`${this.constructor.name} must implement detail(reference), asked for ${reference}`)
  }
}
