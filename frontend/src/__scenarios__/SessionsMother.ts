import { CoordinatingSessionMother } from '__scenarios__/CoordinatingSessionMother'

const bodyOf = (body: unknown) => ({ status: 200, body: JSON.stringify(body) })

const oneSession = () => bodyOf({ sessions: [{ id: 'a1', name: 'zsh' }] })

const twoSessions = () => bodyOf({ sessions: [{ id: 'a1', name: 'zsh' }, { id: 'b2', name: 'bash' }] })

const withCoordinatingSession = () => bodyOf({ sessions: [{ id: 'a1', name: 'zsh' }, CoordinatingSessionMother.SESSION] })

const noSessions = () => bodyOf({ sessions: [] })

const malformedRow = () => bodyOf({ sessions: [{ id: 'a1' }] })

export const SessionsMother = {
  oneSession,
  twoSessions,
  withCoordinatingSession,
  noSessions,
  malformedRow,
}
