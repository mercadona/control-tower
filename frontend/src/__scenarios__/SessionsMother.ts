const bodyOf = (body: unknown) => ({ status: 200, body: JSON.stringify(body) })

const oneSession = () => bodyOf({ sessions: [{ id: 'a1', name: 'zsh' }] })

const noSessions = () => bodyOf({ sessions: [] })

const malformedRow = () => bodyOf({ sessions: [{ id: 'a1' }] })

export const SessionsMother = {
  oneSession,
  noSessions,
  malformedRow,
}
