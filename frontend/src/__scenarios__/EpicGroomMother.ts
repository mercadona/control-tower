const MILESTONE = 'The loop enters through brainstorming'
const KEY = '7b1e9d3c5a2f8046b3d1e9c7a5f3082b6d4e2c0a8f6b4d2e0c8a6f4b2d0e8c6a'
const GATE_ISSUE = { order: 1, title: 'The intermediate gate retires', labels: ['type:backend', 'area:api', 'status:backlog'] }
const CHANNEL_ISSUE = { order: 2, title: 'The session channel', labels: ['type:ui', 'area:sessions', 'status:backlog'] }
const BACKLOG_GATE = { number: 348, url: 'https://github.com/owner/name/issues/348', title: 'The intermediate gate retires', status: 'backlog' }
const BACKLOG_CHANNEL = { number: 349, url: 'https://github.com/owner/name/issues/349', title: 'The session channel', status: 'backlog' }
const READY_GATE = { ...BACKLOG_GATE, status: 'ready' }
const READY_CHANNEL = { ...BACKLOG_CHANNEL, status: 'ready' }
const PROMOTED = [348, 349]
const NOT_FROM_THE_PAGE_DETAIL = 'gate 2 answers only a request carrying the key the page was given'

const PLAN_JSON = `[${JSON.stringify(GATE_ISSUE)},${JSON.stringify(CHANNEL_ISSUE)}]`
const BACKLOG_ISSUES_JSON = `[${JSON.stringify(BACKLOG_GATE)},${JSON.stringify(BACKLOG_CHANNEL)}]`
const READY_ISSUES_JSON = `[${JSON.stringify(READY_GATE)},${JSON.stringify(READY_CHANNEL)}]`

const none = () => ({ status: 200, body: '{"status":"none"}' })

const noSpec = () => ({ status: 200, body: '{"status":"no-spec"}' })

const draft = () => ({ status: 200, body: '{"status":"draft"}' })

const awaitingPublication = () => ({ status: 200, body: '{"status":"awaiting-publication"}' })

const groomable = () => ({
  status: 200,
  body: `{"status":"groomable","milestone":"${MILESTONE}","plan":{"issues":${PLAN_JSON}},"key":"${KEY}"}`,
})

const groomableWithoutKey = () => ({
  status: 200,
  body: `{"status":"groomable","milestone":"${MILESTONE}","plan":{"issues":${PLAN_JSON}}}`,
})

const partiallyGroomed = () => ({
  status: 200,
  body: `{"status":"partially-groomed","milestone":"${MILESTONE}","plan":{"issues":${PLAN_JSON}},` +
    `"issues":${JSON.stringify([BACKLOG_GATE])},"key":"${KEY}"}`,
})

const groomed = () => ({
  status: 200,
  body: `{"status":"groomed","milestone":"${MILESTONE}","issues":${BACKLOG_ISSUES_JSON},"key":"${KEY}"}`,
})

const groomedByThePress = () => ({
  status: 200,
  body: `{"status":"groomed","milestone":"${MILESTONE}","issues":${BACKLOG_ISSUES_JSON}}`,
})

const authorised = () => ({
  status: 200,
  body: `{"status":"authorised","milestone":"${MILESTONE}","issues":${READY_ISSUES_JSON}}`,
})

const promoted = () => ({
  status: 200,
  body: `{"status":"authorised","milestone":"${MILESTONE}","issues":${READY_ISSUES_JSON},"promoted":${JSON.stringify(PROMOTED)}}`,
})

const unrecognisedStatus = () => ({ status: 200, body: '{"status":"something-nobody-declared"}' })

const notFromThePage = () => ({
  status: 403,
  body: `{"code":"gate-not-from-the-page","detail":${JSON.stringify(NOT_FROM_THE_PAGE_DETAIL)}}`,
})

export const EpicGroomMother = {
  MILESTONE,
  KEY,
  GATE_ISSUE,
  CHANNEL_ISSUE,
  BACKLOG_GATE,
  BACKLOG_CHANNEL,
  READY_GATE,
  READY_CHANNEL,
  PROMOTED,
  NOT_FROM_THE_PAGE_DETAIL,
  none,
  noSpec,
  draft,
  awaitingPublication,
  groomable,
  groomableWithoutKey,
  partiallyGroomed,
  groomed,
  groomedByThePress,
  authorised,
  promoted,
  unrecognisedStatus,
  notFromThePage,
}
