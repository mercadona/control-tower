import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'

const CONVERSATION = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const REPO = 'owner/name'
const ROOT = '/Users/pedro/code/name'
const SESSION = { id: 'session-1', name: 'brainstorming' }
const QUESTION = 'the button should read Arrancar brainstorming, right?'
const UNRESUMABLE_DETAIL = 'claude code no longer holds this conversation: the coordinating session was not resumed'
const ENDED_DETAIL = 'the terminal of this coordinating session exited and no other one was opened'
const ALREADY_LIVE_DETAIL = 'a coordinating conversation is already live: it has to end before another one opens'

const none = () => ({ status: 200, body: '{"status":"none"}' })

const nothingRead = (): CoordinatingSessionRead => ({ phase: 'read', kind: 'none' })

const workingRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'live',
  conversation: CONVERSATION,
  repo: REPO,
  root: ROOT,
  session: SESSION,
  attention: { status: 'working', question: null },
})

const waitingRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'live',
  conversation: CONVERSATION,
  repo: REPO,
  root: ROOT,
  session: SESSION,
  attention: { status: 'waiting', question: QUESTION },
})

const unresumableRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'unresumable',
  conversation: CONVERSATION,
  detail: UNRESUMABLE_DETAIL,
})

const working = () => ({
  status: 200,
  body:
    `{"status":"live","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"},"attention":{"status":"working","question":null}}`,
})

const waiting = () => ({
  status: 200,
  body:
    `{"status":"live","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"},` +
    `"attention":{"status":"waiting","question":"${QUESTION}"}}`,
})

const unresumable = () => ({
  status: 200,
  body:
    `{"status":"unresumable","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"detail":"${UNRESUMABLE_DETAIL}"}`,
})

const ended = () => ({
  status: 200,
  body:
    `{"status":"ended","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"detail":"${ENDED_DETAIL}"}`,
})

const endedRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'ended',
  conversation: CONVERSATION,
  detail: ENDED_DETAIL,
})

const opened = () => ({
  status: 202,
  body:
    `{"status":"brainstorming","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"}}`,
})

const alreadyLive = () => ({
  status: 409,
  body:
    `{"code":"coordinating-session-already-live","detail":"${ALREADY_LIVE_DETAIL}",` +
    `"conversation":"${CONVERSATION}","session":{"id":"${SESSION.id}","name":"${SESSION.name}"}}`,
})

export const CoordinatingSessionMother = {
  CONVERSATION,
  REPO,
  ROOT,
  SESSION,
  QUESTION,
  UNRESUMABLE_DETAIL,
  ENDED_DETAIL,
  ALREADY_LIVE_DETAIL,
  none,
  nothingRead,
  workingRead,
  waitingRead,
  unresumableRead,
  endedRead,
  working,
  waiting,
  unresumable,
  ended,
  opened,
  alreadyLive,
}
