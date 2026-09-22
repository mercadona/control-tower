const ISSUE = 7
const REPO = 'owner/name'
const NOT_WATCHED_DETAIL = 'no plan was started for that issue'
const MALFORMED_REPO_DETAIL = 'repo must be a repository such as owner/name'

const running = () => ({
  status: 200,
  body: '{"state":"running","running_ms":372000,"tool_calls":41,' +
    '"last_tool":{"name":"Read","argument":"plugin/conventions/testing.md"},' +
    '"last_text":"Ahora escribo el plan"}',
})

const runningBeforeTheFirstToolCall = () => ({
  status: 200,
  body: '{"state":"running","running_ms":1500,"tool_calls":0,"last_tool":null,"last_text":null}',
})

const finished = () => ({
  status: 200,
  body: '{"state":"finished","running_ms":614000,"tool_calls":57,' +
    '"last_tool":{"name":"Write","argument":"docs/plan-500.md"},' +
    '"last_text":"El plan queda escrito."}',
})

const notWatched = () => ({
  status: 400,
  body: `{"code":"not-watched","detail":"${NOT_WATCHED_DETAIL}"}`,
})

const malformedRepo = () => ({
  status: 400,
  body: `{"code":"malformed-repo","detail":"${MALFORMED_REPO_DETAIL}"}`,
})

export const PlanningProgressMother = {
  ISSUE,
  REPO,
  NOT_WATCHED_DETAIL,
  MALFORMED_REPO_DETAIL,
  running,
  runningBeforeTheFirstToolCall,
  finished,
  notWatched,
  malformedRepo,
}
