import { RepositoryName } from 'app/start-plan/RepositoryName'

const KEY_SHAPE = /^[A-Z][A-Z0-9_]*-\d+$/
const URL_SHAPE = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)$/
const EXAMPLE = 'ABC-123'
const URL_EXAMPLE = 'https://github.com/owner/name/issues/123'

const isUrlWellFormed = (text: string): boolean => {
  const found = text.match(URL_SHAPE)

  return found !== null && RepositoryName.isWellFormed(found[1])
}

const isWellFormed = (text: string): boolean => KEY_SHAPE.test(text) || isUrlWellFormed(text)

export const TicketKey = {
  EXAMPLE,
  URL_EXAMPLE,
  isWellFormed,
}
