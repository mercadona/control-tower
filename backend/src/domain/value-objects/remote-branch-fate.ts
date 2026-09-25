export const RemoteBranchFate = Object.freeze({
  REMOVED: 'removed',
  ABSENT: 'absent',
  KEPT: 'kept',
} as const)

export type RemoteBranchFateValue = (typeof RemoteBranchFate)[keyof typeof RemoteBranchFate]
