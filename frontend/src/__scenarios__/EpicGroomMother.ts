const MILESTONE = 'The loop enters through brainstorming'
const TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
const KEY = '7b1e9d3c5a2f8046b3d1e9c7a5f3082b6d4e2c0a8f6b4d2e0c8a6f4b2d0e8c6a'
const PLAN_FINGERPRINT = '4c9e2a1d7f5b3068a2c4e6f81d3b5a7c9e0f2d4b6a8c1e3f5d7b9a0c2e4f6b81'
const CHANGED_PLAN_FINGERPRINT = '81b6f4e2c0a8f6b4d2e0c8a6f4b2d0e8c6a4b2d0e8c6a4b2d0e8c6a4b2d0e8c6'
const HOME = 'mercadona/control-tower'
const OTHER_REPO = 'mercadona/repo-pulse'
const GATE_ISSUE = { order: 1, title: 'The intermediate gate retires', labels: ['type:backend', 'area:api', 'status:backlog'], repo: HOME }
const CHANNEL_ISSUE = { order: 2, title: 'The session channel', labels: ['type:ui', 'area:sessions', 'status:backlog'], repo: HOME }
const ELSEWHERE_ISSUE = { order: 3, title: 'The pulse of the other repository', labels: ['type:backend', 'status:backlog'], repo: OTHER_REPO }
const BACKLOG_GATE = { number: 348, url: 'https://github.com/owner/name/issues/348', title: 'The intermediate gate retires', status: 'backlog' }
const BACKLOG_CHANNEL = { number: 349, url: 'https://github.com/owner/name/issues/349', title: 'The session channel', status: 'backlog' }
const READY_GATE = { ...BACKLOG_GATE, status: 'ready' }
const READY_CHANNEL = { ...BACKLOG_CHANNEL, status: 'ready' }
const PROMOTED = [348, 349]
const PULL_REQUEST = { number: 341, url: 'https://github.com/owner/name/pull/341' }
const GROOM_CONVERSATION = '9c3f1b7e-4d2a-4c8b-9a3e-6f2b1a6c2e8f'
const GROOM_TARGET = '69d8d78f-1f6f-47db-98c5-3a13b1710691'
const GROOM_SESSION = { id: 'session-9', name: 'brainstorming' }
const RESLICING_PULL_REQUEST = { number: 363, url: 'https://github.com/owner/name/pull/363' }
const NOT_FROM_THE_PAGE_DETAIL = 'gate 2 answers only a request carrying the key the page was given'
const PLAN_CHANGED_DETAIL = 'the spec changed since this plan was shown: read the new plan before pressing again'
const ISSUES_UNCERTAIN_REASON = 'gh issue list answered exactly as many issues as it was asked for at every ' +
  'limit up to the ceiling of 1600: the milestone may hold more issues than this backend could read'

const PLAN_JSON = `[${JSON.stringify(GATE_ISSUE)},${JSON.stringify(CHANNEL_ISSUE)}]`
const SPREAD_PLAN_JSON = `[${JSON.stringify(GATE_ISSUE)},${JSON.stringify(ELSEWHERE_ISSUE)}]`
const BACKLOG_ISSUES_JSON = `[${JSON.stringify(BACKLOG_GATE)},${JSON.stringify(BACKLOG_CHANNEL)}]`
const READY_ISSUES_JSON = `[${JSON.stringify(READY_GATE)},${JSON.stringify(READY_CHANNEL)}]`

const none = () => ({ status: 200, body: '{"status":"none"}' })

const noSpec = () => ({ status: 200, body: `{"status":"no-spec","target":"${TARGET}"}` })

const draft = () => ({ status: 200, body: `{"status":"draft","target":"${TARGET}"}` })

const awaitingPublication = () => ({
  status: 200,
  body: `{"status":"awaiting-publication","target":"${TARGET}","pullRequest":${JSON.stringify(PULL_REQUEST)}}`,
})

const awaitingPublicationWithNoPullRequest = () => ({
  status: 200,
  body: `{"status":"awaiting-publication","target":"${TARGET}","pullRequest":null}`,
})

const issuesUncertain = () => ({
  status: 200,
  body: `{"status":"issues-uncertain","target":"${TARGET}","milestone":"${MILESTONE}","reason":${JSON.stringify(ISSUES_UNCERTAIN_REASON)}}`,
})

const groomable = () => ({
  status: 200,
  body: `{"status":"groomable","target":"${TARGET}","milestone":"${MILESTONE}","plan":{"home":"${HOME}","issues":${PLAN_JSON}},` +
    `"planFingerprint":"${PLAN_FINGERPRINT}","reslicing":null,"key":"${KEY}"}`,
})

const groomableAfterReslicing = () => ({
  status: 200,
  body: `{"status":"groomable","target":"${TARGET}","milestone":"${MILESTONE}","plan":{"home":"${HOME}","issues":${PLAN_JSON}},` +
    `"planFingerprint":"${PLAN_FINGERPRINT}","reslicing":${JSON.stringify(RESLICING_PULL_REQUEST)},` +
    `"key":"${KEY}"}`,
})

const groomableAcrossRepositories = () => ({
  status: 200,
  body: `{"status":"groomable","target":"${TARGET}","milestone":"${MILESTONE}","plan":{"home":"${HOME}","issues":${SPREAD_PLAN_JSON}},` +
    `"planFingerprint":"${PLAN_FINGERPRINT}","key":"${KEY}"}`,
})

const groomableWithoutKey = () => ({
  status: 200,
  body: `{"status":"groomable","target":"${TARGET}","milestone":"${MILESTONE}","plan":{"home":"${HOME}","issues":${PLAN_JSON}},` +
    `"planFingerprint":"${PLAN_FINGERPRINT}"}`,
})

const partiallyGroomed = () => ({
  status: 200,
  body: `{"status":"partially-groomed","target":"${TARGET}","milestone":"${MILESTONE}","plan":{"home":"${HOME}","issues":${PLAN_JSON}},` +
    `"planFingerprint":"${PLAN_FINGERPRINT}","issues":${JSON.stringify([BACKLOG_GATE])},"key":"${KEY}"}`,
})

const groomed = () => ({
  status: 200,
  body: `{"status":"groomed","target":"${TARGET}","milestone":"${MILESTONE}","issues":${BACKLOG_ISSUES_JSON},"key":"${KEY}"}`,
})

const groomedByThePress = () => ({
  status: 200,
  body: `{"status":"groomed","milestone":"${MILESTONE}","issues":${BACKLOG_ISSUES_JSON}}`,
})

const authorised = () => ({
  status: 200,
  body: `{"status":"authorised","target":"${TARGET}","milestone":"${MILESTONE}","issues":${READY_ISSUES_JSON}}`,
})

const promoted = () => ({
  status: 200,
  body: `{"status":"authorised","milestone":"${MILESTONE}","issues":${READY_ISSUES_JSON},"promoted":${JSON.stringify(PROMOTED)}}`,
})

const resliced = () => ({ status: 200, body: `{"status":"resliced","target":"${TARGET}","key":"${KEY}"}` })

const reslicedWithoutKey = () => ({ status: 200, body: `{"status":"resliced","target":"${TARGET}"}` })

const reslicingPublished = () => ({
  status: 200,
  body: `{"status":"published","pullRequest":${JSON.stringify(RESLICING_PULL_REQUEST)}}`,
})

const groomSessionOpened = () => ({
  status: 202,
  body: `{"status":"grooming","target":"${GROOM_TARGET}","conversation":"${GROOM_CONVERSATION}","repo":"owner/name","root":"/repo",` +
    `"session":{"id":"${GROOM_SESSION.id}","name":"${GROOM_SESSION.name}"}}`,
})

const unrecognisedStatus = () => ({ status: 200, body: '{"status":"something-nobody-declared"}' })

const notFromThePage = () => ({
  status: 403,
  body: `{"code":"gate-not-from-the-page","detail":${JSON.stringify(NOT_FROM_THE_PAGE_DETAIL)}}`,
})

const planChanged = () => ({
  status: 409,
  body: `{"code":"plan-changed","detail":${JSON.stringify(PLAN_CHANGED_DETAIL)}}`,
})

export const EpicGroomMother = {
  TARGET,
  MILESTONE,
  KEY,
  PLAN_FINGERPRINT,
  CHANGED_PLAN_FINGERPRINT,
  GATE_ISSUE,
  CHANNEL_ISSUE,
  ELSEWHERE_ISSUE,
  HOME,
  OTHER_REPO,
  BACKLOG_GATE,
  BACKLOG_CHANNEL,
  READY_GATE,
  READY_CHANNEL,
  PROMOTED,
  PULL_REQUEST,
  GROOM_CONVERSATION,
  GROOM_TARGET,
  GROOM_SESSION,
  RESLICING_PULL_REQUEST,
  NOT_FROM_THE_PAGE_DETAIL,
  PLAN_CHANGED_DETAIL,
  ISSUES_UNCERTAIN_REASON,
  none,
  noSpec,
  draft,
  awaitingPublication,
  awaitingPublicationWithNoPullRequest,
  issuesUncertain,
  groomable,
  groomableAcrossRepositories,
  groomableWithoutKey,
  partiallyGroomed,
  groomed,
  groomedByThePress,
  authorised,
  promoted,
  groomableAfterReslicing,
  resliced,
  reslicedWithoutKey,
  reslicingPublished,
  groomSessionOpened,
  unrecognisedStatus,
  notFromThePage,
  planChanged,
}
