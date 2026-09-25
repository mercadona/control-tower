const ISSUE = 7
const REPO = 'owner/name'
const NOT_WATCHED_DETAIL = 'no plan was started for that issue'
const NOT_READ_DETAIL = 'the conversation has no single recorded planning call'

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

const notRead = () => ({
  status: 400,
  body: `{"code":"planning-progress-not-read","detail":"${NOT_READ_DETAIL}"}`,
})

export const PlanningProgressMother = {
  ISSUE,
  REPO,
  NOT_WATCHED_DETAIL,
  NOT_READ_DETAIL,
  running,
  runningBeforeTheFirstToolCall,
  finished,
  notWatched,
  notRead,
}
