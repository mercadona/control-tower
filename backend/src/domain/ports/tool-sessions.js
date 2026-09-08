export class ToolSessions {
  async all() {
    throw new Error(`${this.constructor.name} must implement all()`)
  }
}
