// Pure logic for choosing the current iteration of a Sprint field (Project v2)
// among the iterations returned by the graphql introspection
// (`ProjectV2IterationField.configuration.iterations`, each one with
// `startDate` "YYYY-MM-DD" and `duration` in days). Extracted from ct-groom.mjs
// so that it can be tested without a network: computing "today falls inside
// [startDate, startDate+duration)" is pure arithmetic, it does not need `gh`.
//
// Days-since-epoch in UTC are used (not `Date#setDate`, nor comparing Date
// objects that carry a time) so as not to depend on the process's time zone:
// a "YYYY-MM-DD" date with no time is interpreted as midnight UTC, and
// mutating that date with setDate() operates in local time, which can shift
// the calendar day in negative time zones.

const MS_PER_DAY = 86400000

function daysSinceEpochUTC(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / MS_PER_DAY
}

// iterations: [{ id, title, startDate, duration }], todayIso: "YYYY-MM-DD" (or
// any ISO string, it is trimmed to the first 10 characters).
// Returns the current iteration, or null if none of them covers today.
export function pickCurrentIteration(iterations, todayIso) {
  const todayDay = daysSinceEpochUTC(todayIso.slice(0, 10))
  return (iterations || []).find((it) => {
    const start = daysSinceEpochUTC(it.startDate)
    return todayDay >= start && todayDay < start + it.duration
  }) || null
}

// Closes the idempotency gap between "issue created" and "issue added to the
// Project v2": they are two decoupled network calls (unlike the labels, which
// travel in the same `gh issue create` call and cannot be left half done). If
// the process is interrupted between the two, a re-run finds the issue by its
// `ct-order` marker and, without this check, would `continue` without trying
// the `item-add` again — the issue would stay out of the project forever, and
// in silence.
//
// items: the raw shape of `gh project item-list --format json` (`.items`),
// each one with `content.repository` ("owner/repo") and `content.number`.
export function hasProjectItem(items, repo, issueNumber) {
  return (items || []).some((it) => it?.content?.repository === repo && it?.content?.number === issueNumber)
}
