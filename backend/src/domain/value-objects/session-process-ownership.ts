export type SessionProcessIdentity = {
  readonly pid: number,
  readonly identity: string,
}

export class SessionProcessOwnership {
  readonly rootIdentity: string
  readonly members: readonly SessionProcessIdentity[]

  constructor({ rootIdentity, members }: {
    rootIdentity: unknown,
    members: unknown,
  }) {
    if (typeof rootIdentity !== 'string' || rootIdentity.length === 0) {
      throw new Error(`session process ownership root identity must be non-empty, got ${JSON.stringify(rootIdentity)}`)
    }
    if (!Array.isArray(members) || members.length === 0) {
      throw new Error('session process ownership members must be a non-empty array')
    }
    const checked = members.map((member) => SessionProcessOwnership.#memberFrom(member))
    const seen = new Set<number>()
    for (const member of checked) {
      if (seen.has(member.pid)) throw new Error(`session process ownership has duplicate pid ${member.pid}`)
      seen.add(member.pid)
    }
    const rootPid = SessionProcessOwnership.pidOf(rootIdentity)
    if (!checked.some((member) => member.pid === rootPid && member.identity === rootIdentity)) {
      throw new Error(`session process ownership must contain root identity ${rootIdentity}`)
    }
    this.rootIdentity = rootIdentity
    this.members = Object.freeze(checked.sort((left, right) => left.pid - right.pid))
    Object.freeze(this)
  }

  static pidOf(identity: string): number {
    const matched = identity.match(/^(\d+):(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12]\d|3[01]) ([01]\d|2[0-3]):[0-5]\d:[0-5]\d (\d{4})$/)
    if (matched === null) throw new Error(`session process identity is not canonical: ${JSON.stringify(identity)}`)
    const pid = Number(matched[1])
    if (!Number.isSafeInteger(pid) || pid <= 0 || matched[1] !== String(pid)) {
      throw new Error(`session process identity pid must be a positive safe integer, got ${JSON.stringify(identity)}`)
    }
    return pid
  }

  static #memberFrom(raw: unknown): SessionProcessIdentity {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`session process ownership member must be an object, got ${JSON.stringify(raw)}`)
    }
    const keys = Object.keys(raw).sort()
    if (JSON.stringify(keys) !== JSON.stringify(['identity', 'pid'])) {
      throw new Error(`session process ownership member must contain exactly identity and pid, got ${JSON.stringify(keys)}`)
    }
    const member = raw as { pid?: unknown, identity?: unknown }
    if (typeof member.pid !== 'number' || !Number.isSafeInteger(member.pid) || member.pid <= 0) {
      throw new Error(`session process ownership member pid must be a positive safe integer, got ${JSON.stringify(member.pid)}`)
    }
    if (typeof member.identity !== 'string' || SessionProcessOwnership.pidOf(member.identity) !== member.pid) {
      throw new Error(`session process ownership member identity must match pid ${member.pid}`)
    }
    return Object.freeze({ pid: member.pid, identity: member.identity })
  }
}
