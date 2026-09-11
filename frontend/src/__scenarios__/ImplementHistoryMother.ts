const ISSUE = 7
const ROOT = '/Users/pedro/code/name'
const REPO = 'owner/name'
const NOT_READ_DETAIL = 'the worktree /Users/pedro/code/name/.worktrees/7 is not there, so its history cannot be read'
const MALFORMED_REPO_DETAIL = 'repo must be a repository such as owner/name'

const TASK_ONE_NAME = 'the lookup looks where it says it looks'
const TASK_TWO_NAME = 'a lookup that could not run is unmeasured, not "not found"'
const TASK_ONE_SUMMARY =
  "Renamed inIndex's local from ambito to scope so the pathspec's ...scope no longer throws a ReferenceError " +
  'swallowed by the catch, which was making every git grep --cached lookup silently answer false; added the two ' +
  'tests from the brief (14 total, all green) and confirmed both were red against the previous code for the ' +
  'stated reasons before the fix.'
const TASK_TWO_SUMMARY =
  'inIndex() now tells a real git grep failure apart from a real miss: e.status === 1 stays "not found", any ' +
  'other exit (or the null a killed 60s timeout leaves) throws NameLookupDidNotRun with the name, exit status ' +
  "and git's own stderr (stdio switched to ['ignore','ignore','pipe'] to capture it). controls wraps " +
  'declaredTests/declaredBlocks in one try and, on that error, logs "# names that could not be looked up" plus ' +
  'the message and sets result = OUTCOMES.INDETERMINATE (exit 5); the command-loop guard moved from ' +
  '`result === OUTCOMES.FAILED ? [] : t.commands` to `result === OUTCOMES.DONE ? t.commands : []` so an ' +
  'unmeasured lookup no longer spends the task\'s commands. New test provokes this with a `git` shim first on ' +
  'PATH that exits 128 on `grep` and delegates everything else to the real binary; verified RED by stashing ' +
  'only the production file and confirming the test failed for the right reason (old code silently read the ' +
  'broken lookup as "not found", giving exit 0 instead of 5), then restored the fix. Whole suite: 148 files, ' +
  '4029 tests, exit 0.'

const ISSUE_298_STEPS = [
  { step: 'implement', task: 1, task_name: TASK_ONE_NAME, tasks_total: 2, attempt: 1, outcome: 'done', written_at: '2026-09-10T14:55:59.885Z', duration_ms: null, summary: TASK_ONE_SUMMARY, ruling: null, findings_total: null, tool_total_tokens: 9718233 },
  { step: 'controls', task: 1, task_name: TASK_ONE_NAME, tasks_total: 2, attempt: 1, outcome: 'failed', written_at: '2026-09-10T14:56:12.569Z', duration_ms: 138, summary: null, ruling: null, findings_total: null, tool_total_tokens: 395160 },
  { step: 'implement', task: 1, task_name: TASK_ONE_NAME, tasks_total: 2, attempt: 2, outcome: 'done', written_at: '2026-09-10T15:03:27.804Z', duration_ms: null, summary: TASK_ONE_SUMMARY, ruling: null, findings_total: null, tool_total_tokens: 804298 },
  { step: 'controls', task: 1, task_name: TASK_ONE_NAME, tasks_total: 2, attempt: 2, outcome: 'done', written_at: '2026-09-10T15:03:46.526Z', duration_ms: 12226, summary: null, ruling: null, findings_total: null, tool_total_tokens: 203423 },
  { step: 'judge', task: 1, task_name: TASK_ONE_NAME, tasks_total: 2, attempt: 2, outcome: 'done', written_at: '2026-09-10T15:05:41.987Z', duration_ms: null, summary: null, ruling: 'PASS', findings_total: 0, tool_total_tokens: 821607 },
  { step: 'implement', task: 2, task_name: TASK_TWO_NAME, tasks_total: 2, attempt: 1, outcome: 'done', written_at: '2026-09-10T15:14:12.924Z', duration_ms: null, summary: TASK_TWO_SUMMARY, ruling: null, findings_total: null, tool_total_tokens: 1892550 },
  { step: 'controls', task: 2, task_name: TASK_TWO_NAME, tasks_total: 2, attempt: 1, outcome: 'done', written_at: '2026-09-10T15:14:33.439Z', duration_ms: 14202, summary: null, ruling: null, findings_total: null, tool_total_tokens: 217621 },
  { step: 'judge', task: 2, task_name: TASK_TWO_NAME, tasks_total: 2, attempt: 1, outcome: 'done', written_at: '2026-09-10T15:16:49.248Z', duration_ms: null, summary: null, ruling: 'PASS', findings_total: 0, tool_total_tokens: 1321277 },
  { step: 'reconcile', task: null, task_name: null, tasks_total: 2, attempt: 1, outcome: 'up-to-date', written_at: '2026-09-10T15:17:04.489Z', duration_ms: 2055, summary: null, ruling: null, findings_total: null, tool_total_tokens: 445748 },
  { step: 'global', task: null, task_name: null, tasks_total: 2, attempt: 1, outcome: 'done', written_at: '2026-09-10T15:20:01.126Z', duration_ms: 164081, summary: null, ruling: null, findings_total: null, tool_total_tokens: 447274 },
  { step: 'slice-judge', task: null, task_name: null, tasks_total: 2, attempt: 1, outcome: 'done', written_at: '2026-09-10T15:20:58.197Z', duration_ms: null, summary: null, ruling: 'PASS', findings_total: 0, tool_total_tokens: 1359562 },
]

const empty = () => ({ status: 200, body: '{"steps":[]}' })

const oneTask = () => ({ status: 200, body: JSON.stringify({ steps: [ISSUE_298_STEPS[0]] }) })

const oneInProgressTask = () => ({ status: 200, body: JSON.stringify({ steps: ISSUE_298_STEPS.slice(0, 6) }) })

const fullRun = () => ({ status: 200, body: JSON.stringify({ steps: ISSUE_298_STEPS }) })

const refusedNotRead = () => ({
  status: 400,
  body: `{"code":"implementation-history-not-read","detail":"${NOT_READ_DETAIL}"}`,
})

const refusedMalformedRepo = () => ({
  status: 400,
  body: `{"code":"malformed-history-repo","detail":"${MALFORMED_REPO_DETAIL}"}`,
})

export const ImplementHistoryMother = {
  ISSUE,
  ROOT,
  REPO,
  NOT_READ_DETAIL,
  MALFORMED_REPO_DETAIL,
  empty,
  oneTask,
  oneInProgressTask,
  fullRun,
  refusedNotRead,
  refusedMalformedRepo,
}
