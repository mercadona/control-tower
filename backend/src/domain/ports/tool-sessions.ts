import type { ToolSession } from '../value-objects/tool-session.ts'

export class ToolSessions {
  async all(): Promise<ToolSession[]> {
    throw new Error(`${this.constructor.name} must implement all()`)
  }
}
