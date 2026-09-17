import { CoordinatingSessionRead } from 'app/coordinating-session/useCoordinatingSession'

const CONVERSATION = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
const REPO = 'owner/name'
const ROOT = '/Users/pedro/code/name'
const SESSION = { id: 'session-1', name: 'brainstorming' }
const QUESTION = 'the button should read Arrancar brainstorming, right?'
const UNRESUMABLE_DETAIL = 'claude code no longer holds this conversation: the coordinating session was not resumed'
const ENDED_DETAIL = 'the terminal of this coordinating session exited and no other one was opened'
const ALREADY_LIVE_DETAIL = 'a coordinating conversation is already live: it has to end before another one opens'

const OPENED_AT = '2026-09-15T09:00:00.000Z'
const WORKING_AT = '2026-09-15T09:05:00.000Z'
const WAITING_AT = '2026-09-15T09:10:00.000Z'
const SECOND_WAITING_AT = '2026-09-15T09:12:00.000Z'
const THIRD_WAITING_AT = '2026-09-15T09:14:00.000Z'
const SECOND_QUESTION = 'should I run the migration on staging first?'
const THIRD_QUESTION = 'can I delete the stale branch?'

const OPENED_EVENT = { id: 'event-1', kind: 'opened' as const, at: OPENED_AT, detail: null }
const WORKING_TIMELINE = [OPENED_EVENT, { id: 'event-2', kind: 'working' as const, at: WORKING_AT, detail: null }]
const WAITING_TIMELINE = [
  ...WORKING_TIMELINE,
  { id: 'event-3', kind: 'waiting-for-permission' as const, at: WAITING_AT, detail: QUESTION },
]
const REPEATED_WAITING_TIMELINE = [
  ...WORKING_TIMELINE,
  { id: 'event-3', kind: 'waiting-for-permission' as const, at: WAITING_AT, detail: QUESTION },
  { id: 'event-4', kind: 'waiting-for-permission' as const, at: SECOND_WAITING_AT, detail: SECOND_QUESTION },
  { id: 'event-5', kind: 'waiting-for-permission' as const, at: THIRD_WAITING_AT, detail: THIRD_QUESTION },
]

const none = () => ({ status: 200, body: '{"status":"none","operation":"idle"}' })

const nothingRead = (): CoordinatingSessionRead => ({ phase: 'read', kind: 'none', operation: 'idle' })

const workingRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'live',
  operation: 'idle',
  target: TARGET,
  conversation: CONVERSATION,
  repo: REPO,
  root: ROOT,
  session: SESSION,
  attention: { status: 'working', question: null },
  timeline: WORKING_TIMELINE,
  closureError: null,
})

const waitingRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'live',
  operation: 'idle',
  target: TARGET,
  conversation: CONVERSATION,
  repo: REPO,
  root: ROOT,
  session: SESSION,
  attention: { status: 'waiting', question: QUESTION },
  timeline: WAITING_TIMELINE,
  closureError: null,
})

const repeatedWaitingRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'live',
  operation: 'idle',
  target: TARGET,
  conversation: CONVERSATION,
  repo: REPO,
  root: ROOT,
  session: SESSION,
  attention: { status: 'waiting', question: THIRD_QUESTION },
  timeline: REPEATED_WAITING_TIMELINE,
  closureError: null,
})

const unresumableRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'unresumable',
  operation: 'idle',
  target: TARGET,
  conversation: CONVERSATION,
  repo: REPO,
  root: ROOT,
  detail: UNRESUMABLE_DETAIL,
  timeline: WORKING_TIMELINE,
  closureError: null,
})

const working = () => ({
  status: 200,
  body:
    `{"status":"live","operation":"idle","target":"${TARGET}","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"},"attention":{"status":"working","question":null},` +
    `"timeline":${JSON.stringify(WORKING_TIMELINE)}}`,
})

const waiting = () => ({
  status: 200,
  body:
    `{"status":"live","operation":"idle","target":"${TARGET}","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"},` +
    `"attention":{"status":"waiting","question":"${QUESTION}"},` +
    `"timeline":${JSON.stringify(WAITING_TIMELINE)}}`,
})

const unresumable = () => ({
  status: 200,
  body:
    `{"status":"unresumable","operation":"idle","target":"${TARGET}","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"detail":"${UNRESUMABLE_DETAIL}","timeline":${JSON.stringify(WORKING_TIMELINE)}}`,
})

const ended = () => ({
  status: 200,
  body:
    `{"status":"ended","operation":"idle","target":"${TARGET}","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"detail":"${ENDED_DETAIL}","timeline":${JSON.stringify(WORKING_TIMELINE)}}`,
})

const closeFailed = (answer: ReturnType<typeof working> | ReturnType<typeof ended>) => ({
  ...answer,
  body: JSON.stringify({
    ...JSON.parse(answer.body),
    operation: 'close-failed',
    closureError: {
      code: 'session-termination-permission-denied',
      detail: 'permission denied for the saved process group',
    },
  }),
})

const liveCloseFailed = () => closeFailed(working())

const endedCloseFailed = () => closeFailed(ended())

const endedRead = (): CoordinatingSessionRead => ({
  phase: 'read',
  kind: 'ended',
  operation: 'idle',
  target: TARGET,
  conversation: CONVERSATION,
  repo: REPO,
  root: ROOT,
  detail: ENDED_DETAIL,
  timeline: WORKING_TIMELINE,
  closureError: null,
})

const opened = () => ({
  status: 202,
  body:
    `{"status":"brainstorming","target":"${TARGET}","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
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
  TARGET,
  REPO,
  ROOT,
  SESSION,
  QUESTION,
  UNRESUMABLE_DETAIL,
  ENDED_DETAIL,
  ALREADY_LIVE_DETAIL,
  WORKING_TIMELINE,
  WAITING_TIMELINE,
  REPEATED_WAITING_TIMELINE,
  none,
  nothingRead,
  workingRead,
  waitingRead,
  repeatedWaitingRead,
  unresumableRead,
  endedRead,
  working,
  waiting,
  unresumable,
  ended,
  liveCloseFailed,
  endedCloseFailed,
  opened,
  alreadyLive,
}
