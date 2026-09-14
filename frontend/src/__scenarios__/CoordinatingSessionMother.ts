const CONVERSATION = '2b1a6c2e-8f2a-4b8b-9a3e-6f2b1a6c2e8f'
const REPO = 'owner/name'
const ROOT = '/Users/pedro/code/name'
const SESSION = { id: 'session-1', name: 'brainstorming' }
const QUESTION = 'the button should read Arrancar brainstorming, right?'
const UNRESUMABLE_DETAIL = 'claude code no longer holds this conversation: the coordinating session was not resumed'
const ONE_REPOSITORY_ONLY_DETAIL = 'an epic governs one checkout: send repo and path instead of repo_list'

const none = () => ({ status: 200, body: '{"status":"none"}' })

const working = () => ({
  status: 200,
  body:
    `{"status":"live","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"},"attention":{"status":"working","question":null}}`,
})

const waiting = () => ({
  status: 200,
  body:
    `{"status":"live","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"},` +
    `"attention":{"status":"waiting","question":"${QUESTION}"}}`,
})

const unresumable = () => ({
  status: 200,
  body:
    `{"status":"unresumable","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"detail":"${UNRESUMABLE_DETAIL}"}`,
})

const opened = () => ({
  status: 202,
  body:
    `{"status":"brainstorming","conversation":"${CONVERSATION}","repo":"${REPO}","root":"${ROOT}",` +
    `"session":{"id":"${SESSION.id}","name":"${SESSION.name}"}}`,
})

const oneRepositoryOnly = () => ({
  status: 400,
  body: `{"code":"one-repository-only","detail":"${ONE_REPOSITORY_ONLY_DETAIL}"}`,
})

export const CoordinatingSessionMother = {
  CONVERSATION,
  REPO,
  ROOT,
  SESSION,
  QUESTION,
  UNRESUMABLE_DETAIL,
  ONE_REPOSITORY_ONLY_DETAIL,
  none,
  working,
  waiting,
  unresumable,
  opened,
  oneRepositoryOnly,
}
