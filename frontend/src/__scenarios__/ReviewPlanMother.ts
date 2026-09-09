const ISSUE = 7
const REPO = 'owner/name'
const CHANGES = 'parte la tarea 2 en dos'
const REQUEST_BODY = '{"issue":7,"repo":"owner/name","changes":"parte la tarea 2 en dos"}'

const changesAsked = () => ({
  status: 202,
  body: '{"status":"changes-asked","issue":7}',
})

const malformedChanges = () => ({
  status: 400,
  body: '{"code":"malformed-changes","detail":"changes must say what to change"}',
})

const noLiveSession = () => ({
  status: 409,
  body: '{"code":"no-live-planning-session","detail":"no matching live planning session exists, so nobody would read the changes"}',
})

const notAsked = () => ({
  status: 400,
  body: '{"code":"plan-changes-not-asked","detail":"gh issue comment failed: gh: not found"}',
})

export const ReviewPlanMother = {
  ISSUE,
  REPO,
  CHANGES,
  REQUEST_BODY,
  changesAsked,
  malformedChanges,
  noLiveSession,
  notAsked,
}
