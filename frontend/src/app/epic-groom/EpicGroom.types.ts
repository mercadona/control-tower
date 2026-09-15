export type GroomPlanIssue = { order: number; title: string; labels: string[]; repo: string }
export type EpicPullRequest = { number: number; url: string }
export type EpicIssue = { number: number; url: string; title: string; status: string }
export type EpicGroomOutcome =
  | { kind: 'none' } | { kind: 'no-spec' } | { kind: 'draft' }
  | { kind: 'awaiting-publication'; pullRequest: EpicPullRequest | null }
  | { kind: 'resliced'; key: string | null }
  | { kind: 'issues-uncertain'; milestone: string; reason: string }
  | {
      kind: 'groomable'; milestone: string; plan: GroomPlanIssue[]; home: string;
      planFingerprint: string; key: string | null;
    }
  | {
      kind: 'partially-groomed'; milestone: string; plan: GroomPlanIssue[];
      planFingerprint: string; issues: EpicIssue[]; key: string | null;
    }
  | { kind: 'groomed'; milestone: string; issues: EpicIssue[]; key: string | null }
  | { kind: 'authorised'; milestone: string; issues: EpicIssue[] }
  | { kind: 'refused'; code: string; error: string } | { kind: 'unavailable' }
export type ReslicingOutcome =
  | { kind: 'published'; pullRequest: EpicPullRequest }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unconfirmed' }
export type GroomSessionOutcome =
  | { kind: 'opened' }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unconfirmed' }
export type EpicGroomAskOutcome =
  | { kind: 'acted'; status: 'groomed' | 'authorised'; milestone: string; issues: EpicIssue[]; promoted: number[] }
  | { kind: 'refused'; code: string; error: string } | { kind: 'backend-unreachable' }
