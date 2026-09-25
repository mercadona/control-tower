import { EpicGroomMother } from '__scenarios__/EpicGroomMother'

const bodyOf = (body: unknown) => ({ status: 200, body: JSON.stringify(body) })

const oneSession = () => bodyOf({ sessions: [{ id: 'a1', name: 'zsh' }] })

const withGroomSession = () => bodyOf({ sessions: [{ id: 'a1', name: 'zsh' }, EpicGroomMother.GROOM_SESSION] })

const noSessions = () => bodyOf({ sessions: [] })

export const SessionsMother = {
  oneSession,
  withGroomSession,
  noSessions,
}
