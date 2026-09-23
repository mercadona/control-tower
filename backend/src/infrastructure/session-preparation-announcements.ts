import { PreparationAnnouncements } from '../domain/ports/preparation-announcements.ts'
import type { PreparationTarget } from '../domain/ports/repository-preparations.ts'
import type { RepositoryPreparation } from '../domain/value-objects/repository-preparation.ts'

type PreparationSession = {
  gateCheckout(): ({ target: string | null, conversation: PreparationTarget }) | null
  announce(line: string): boolean
}

export class SessionPreparationAnnouncements extends PreparationAnnouncements {
  readonly sessions: () => PreparationSession
  readonly stderr: (line: string) => void
  readonly #announced = new Map<string, string>()
  readonly #findings = new Map<string, Map<string, RepositoryPreparation>>()

  constructor(ports: { sessions: () => PreparationSession, stderr: (line: string) => void }) {
    super()
    this.sessions = ports.sessions
    this.stderr = ports.stderr
  }

  override current(asked: PreparationTarget): readonly RepositoryPreparation[] {
    return [...(this.#findings.get(`${asked.repository.text}:${asked.root.text}`)?.values() ?? [])]
  }

  override async announce(asked: PreparationTarget & { preparation: RepositoryPreparation, path?: string }): Promise<void> {
    const owner = `${asked.repository.text}:${asked.root.text}`
    const reports = this.#findings.get(owner) ?? new Map<string, RepositoryPreparation>()
    this.#findings.set(owner, reports)
    const subject = asked.path ?? asked.root.text
    const topic = JSON.stringify([owner, subject])
    if (asked.preparation.permitsDispatch()) {
      reports.delete(subject)
      this.#announced.delete(topic)
      return
    }
    reports.set(subject, asked.preparation)
    const sessions = this.sessions()
    const held = sessions.gateCheckout()
    if (held === null || held.conversation.root.text !== asked.root.text
      || held.conversation.repository.text !== asked.repository.text) {
      this.stderr(`preparation diagnostic has no matching coordinating session: ${asked.preparation.summary}\n`)
      return
    }
    const key = `${held.target}:${asked.preparation.summary}`
    if (this.#announced.get(topic) === key) return
    const line = `Repository preparation prevents dispatch.\n${asked.preparation.summary}\n`
      + 'Explain these findings to the person. With their authorization, help prepare a separate fix pull request. '
      + 'Do not change the frozen scope or bypass the check. After the fix merges, ask the person to recheck in the page. '
      + 'A proposed correction or an open pull request is not evidence that preparation passed.'
    try {
      if (sessions.announce(line)) {
        this.#announced.set(topic, key)
        return
      }
    } catch (error) {
      this.stderr(`preparation diagnostic could not reach the coordinator: ${String(error)}\n`)
      return
    }
    this.stderr(`preparation diagnostic could not reach the coordinator: ${asked.preparation.summary}\n`)
  }
}
