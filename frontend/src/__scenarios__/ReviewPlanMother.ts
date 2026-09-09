import { ImplementPlanMother } from '__scenarios__/ImplementPlanMother'

const ISSUE = ImplementPlanMother.ISSUE
const REPO = ImplementPlanMother.REPO
const CHANGES = 'parte la tarea 2 en dos'
const REQUEST_BODY = `{"issue":${ISSUE},"repo":"${REPO}","changes":"${CHANGES}"}`
const CONFLICT = 409
const BAD_REQUEST = 400

type Answer = {
  status: number
  body: string
}

const changesAsked = (): Answer => ({
  status: 202,
  body: `{"status":"changes-asked","issue":${ISSUE}}`,
})

const noLiveSession = (): Answer => ({
  status: CONFLICT,
  body: '{"code":"no-live-planning-session","detail":"no matching live planning session exists, so nobody would read the changes"}',
})

const alreadyImplementing = (): Answer => ({
  status: CONFLICT,
  body: '{"code":"plan-already-being-implemented","detail":"the plan is already being implemented, so its review watch is gone"}',
})

const phaseUncertain = (): Answer => ({
  status: CONFLICT,
  body: '{"code":"implementation-phase-uncertain","detail":"implementation may have started; inspect the plan before retrying"}',
})

const notAsked = (): Answer => ({
  status: BAD_REQUEST,
  body: '{"code":"plan-changes-not-asked","detail":"gh issue comment failed: gh: not found"}',
})

const asABadRequest = (answer: Answer): Answer => ({ status: BAD_REQUEST, body: answer.body })

const asAConflict = (answer: Answer): Answer => ({ status: CONFLICT, body: answer.body })

export const ReviewPlanMother = {
  ISSUE,
  REPO,
  CHANGES,
  REQUEST_BODY,
  changesAsked,
  noLiveSession,
  alreadyImplementing,
  phaseUncertain,
  notAsked,
  asABadRequest,
  asAConflict,
}
