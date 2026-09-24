const SPEC = 'docs/superpowers/specs/STAFF-128-execution.md'
const TARGET = '6d13bc52-740f-49f8-b128-15e597674f3a'
const KEY = '3f9c1a2b6d4e8f0c1a9b7d3e5f2c4a6b8d0e2f4a6c8b0d2e4f6a8c0b2d4e6f80'
const ON = '2026-09-14'
const PULL_REQUEST = { number: 341, url: 'https://github.com/owner/name/pull/341' }
const MARKER_FINDING = { code: 'clarification-marker', line: 42, detail: '[NEEDS CLARIFICATION: which button?]' }
const HYPOTHESIS_FINDING = { code: 'hypothesis-absent', line: null, detail: null }
const SCOPE_FINDING = { code: 'scope-absent', line: null, detail: null }
const PROVENANCE_FINDING = {
  code: 'decision-without-provenance',
  line: 13,
  detail: '- **D-1 · la puerta** — un solo clic congela el spec.',
}
const NOT_FREEZABLE_DETAIL = 'the spec is not freezable: 2 finding(s) remain, the first on line 42'
const NOT_FROM_THE_PAGE_DETAIL = 'gate 1 answers only a request carrying the key the page was given'

const FINDINGS_JSON =
  `[{"code":"${MARKER_FINDING.code}","line":${MARKER_FINDING.line},"detail":${JSON.stringify(MARKER_FINDING.detail)}},` +
  `{"code":"${HYPOTHESIS_FINDING.code}","line":null,"detail":null}]`

const none = () => ({ status: 200, body: '{"status":"none"}' })

const noSpec = () => ({ status: 200, body: `{"status":"no-spec","target":"${TARGET}"}` })

const draftWithMarker = () => ({
  status: 200,
  body: `{"status":"draft","target":"${TARGET}","spec":"${SPEC}","findings":${FINDINGS_JSON},"key":"${KEY}"}`,
})

const draftWithoutScope = () => ({
  status: 200,
  body: `{"status":"draft","target":"${TARGET}","spec":"${SPEC}","findings":[{"code":"${SCOPE_FINDING.code}","line":null,"detail":null}],"key":"${KEY}"}`,
})

const draftWithoutKey = () => ({
  status: 200,
  body: `{"status":"draft","target":"${TARGET}","spec":"${SPEC}","findings":${FINDINGS_JSON}}`,
})

const draftReady = () => ({
  status: 200,
  body: `{"status":"draft","target":"${TARGET}","spec":"${SPEC}","findings":[],"key":"${KEY}"}`,
})

const draftWithSourcelessDecision = () => ({
  status: 200,
  body:
    `{"status":"draft","target":"${TARGET}","spec":"${SPEC}","findings":[` +
    `{"code":"${PROVENANCE_FINDING.code}","line":${PROVENANCE_FINDING.line},"detail":${JSON.stringify(PROVENANCE_FINDING.detail)}}` +
    `],"key":"${KEY}"}`,
})

const frozen = () => ({
  status: 200,
  body: `{"status":"frozen","target":"${TARGET}","spec":"${SPEC}","on":"${ON}","pullRequest":{"number":${PULL_REQUEST.number},"url":"${PULL_REQUEST.url}"}}`,
})

const frozenWithoutSession = () => ({
  status: 200,
  body: `{"status":"frozen","target":null,"spec":"${SPEC}","on":"${ON}","pullRequest":{"number":${PULL_REQUEST.number},"url":"${PULL_REQUEST.url}"}}`,
})

const draftReadyWithoutSession = () => ({
  status: 200,
  body: `{"status":"draft","target":null,"spec":"${SPEC}","findings":[],"key":"${KEY}"}`,
})

const notFreezable = () => ({
  status: 400,
  body: `{"code":"spec-not-freezable","detail":${JSON.stringify(NOT_FREEZABLE_DETAIL)}}`,
})

const notFromThePage = () => ({
  status: 403,
  body: `{"code":"gate-not-from-the-page","detail":${JSON.stringify(NOT_FROM_THE_PAGE_DETAIL)}}`,
})

const REFUSED_DETAIL = 'the spec carries no title'

const refusedRead = () => ({
  status: 400,
  body: `{"code":"epic-spec-not-understood","detail":"${REFUSED_DETAIL}"}`,
})

const frozenUndated = () => ({
  status: 200,
  body: `{"status":"frozen","target":"${TARGET}","spec":"${SPEC}","on":null,"pullRequest":null}`,
})

export const SpecFreezeMother = {
  frozenUndated,
  REFUSED_DETAIL,
  refusedRead,
  SPEC,
  TARGET,
  KEY,
  ON,
  PULL_REQUEST,
  MARKER_FINDING,
  HYPOTHESIS_FINDING,
  SCOPE_FINDING,
  PROVENANCE_FINDING,
  NOT_FREEZABLE_DETAIL,
  NOT_FROM_THE_PAGE_DETAIL,
  none,
  noSpec,
  draftWithMarker,
  draftWithoutScope,
  draftWithSourcelessDecision,
  draftReady,
  draftWithoutKey,
  frozen,
  frozenWithoutSession,
  draftReadyWithoutSession,
  notFreezable,
  notFromThePage,
}
