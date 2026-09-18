const ISSUE = 7
const ROOT = '/Users/pedro/code/name'
const REPO = 'owner/name'
const AGENT = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const TEXT = 'Cambia el nombre del export'
const NOT_DELIVERED_DETAIL = `conversation "${AGENT}" has not been delivered`

const progress = () => ({
  status: 200,
  body: '{"step":"judge","task":3,"total_tasks":7,"name":"el lector del plan","attempt":2,"discards":0}',
})

const delivered = () => ({ status: 202, body: '{"status":"delivered"}' })

const refused = () => ({
  status: 400,
  body: `{"code":"slice-message-not-delivered","detail":${JSON.stringify(NOT_DELIVERED_DETAIL)}}`,
})

export const SliceSessionMother = {
  ISSUE,
  ROOT,
  REPO,
  AGENT,
  TEXT,
  NOT_DELIVERED_DETAIL,
  progress,
  delivered,
  refused,
}
