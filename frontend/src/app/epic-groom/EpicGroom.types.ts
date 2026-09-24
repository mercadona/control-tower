import { OpenedCoordinatingSession } from 'app/coordinating-session/CoordinatingSession.types'

export type GroomPlanIssue = { order: number; title: string; labels: string[]; repo: string }
export type EpicPullRequest = { number: number; url: string }
export type EpicIssue = { number: number; url: string; title: string; status: string }
export type EpicGroomOutcome =
  | { kind: 'none' } | { kind: 'no-spec'; target: string | null } | { kind: 'draft'; target: string | null }
  | { kind: 'awaiting-publication'; target: string | null; pullRequest: EpicPullRequest | null }
  | { kind: 'resliced'; target: string | null; key: string | null }
  | { kind: 'issues-uncertain'; target: string | null; milestone: string; reason: string }
  | {
      kind: 'groomable'; target: string | null; milestone: string; plan: GroomPlanIssue[]; home: string;
      planFingerprint: string; reslicing: EpicPullRequest | null; key: string | null;
    }
  | {
      kind: 'partially-groomed'; target: string | null; milestone: string; plan: GroomPlanIssue[];
      planFingerprint: string; issues: EpicIssue[]; key: string | null;
    }
  | { kind: 'groomed'; target: string | null; milestone: string; issues: EpicIssue[]; key: string | null; preparation?: string }
  | { kind: 'authorised'; target: string | null; milestone: string; issues: EpicIssue[]; key?: string | null; preparation?: string }
  | { kind: 'refused'; code: string; error: string } | { kind: 'unavailable' }
export type ReslicingOutcome =
  | { kind: 'published'; pullRequest: EpicPullRequest }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unconfirmed' }
export type GroomSessionOutcome =
  | { kind: 'opened'; opened: OpenedCoordinatingSession }
  | { kind: 'typed' }
  | { kind: 'refused'; code: string; error: string }
  | { kind: 'unconfirmed' }
export type EpicGroomAskOutcome =
  | { kind: 'acted'; status: 'groomed' | 'authorised'; milestone: string; issues: EpicIssue[]; promoted: number[] }
  | { kind: 'refused'; code: string; error: string } | { kind: 'unconfirmed' }
