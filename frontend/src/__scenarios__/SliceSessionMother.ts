import { ImplementProgressMother } from '__scenarios__/ImplementProgressMother'

const ISSUE = 7
const ROOT = '/Users/pedro/code/name'
const REPO = 'owner/name'

export const SliceSessionMother = {
  ISSUE,
  ROOT,
  REPO,
  progress: ImplementProgressMother.progress,
  inReview: ImplementProgressMother.inReview,
}
