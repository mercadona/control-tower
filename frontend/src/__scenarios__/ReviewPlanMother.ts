import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'

const ISSUE = ImplementPlanMother.ISSUE
const REPO = ImplementPlanMother.REPO
const CHANGES = 'parte la tarea 2 en dos'
const REQUEST_BODY = `{"issue":${ISSUE},"repo":"${REPO}","changes":"${CHANGES}"}`

const changesAsked = () => ({
  status: 202,
  body: `{"status":"changes-asked","issue":${ISSUE}}`,
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
  noLiveSession,
  notAsked,
}
