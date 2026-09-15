export type GroomPlanIssue = { order: number; title: string; labels: string[] }
export type EpicIssue = { number: number; url: string; title: string; status: string }
export type EpicGroomOutcome =
  | { kind: 'none' } | { kind: 'no-spec' } | { kind: 'draft' } | { kind: 'awaiting-publication' }
  | { kind: 'groomable'; milestone: string; plan: GroomPlanIssue[]; key: string | null }
  | { kind: 'partially-groomed'; milestone: string; plan: GroomPlanIssue[]; issues: EpicIssue[]; key: string | null }
  | { kind: 'groomed'; milestone: string; issues: EpicIssue[]; key: string | null }
  | { kind: 'authorised'; milestone: string; issues: EpicIssue[] }
  | { kind: 'refused'; code: string; error: string } | { kind: 'unavailable' }
export type EpicGroomAskOutcome =
  | { kind: 'acted'; status: 'groomed' | 'authorised'; milestone: string; issues: EpicIssue[]; promoted: number[] }
  | { kind: 'refused'; code: string; error: string } | { kind: 'backend-unreachable' }
