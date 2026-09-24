export class SlicingReviewContract {
  static readonly ISSUES_ARE_NOT_YOURS =
    'You never create the issues yourself: the milestone, the labels, the issues and the Project are written by '
    + "gate 2 of the cabin, on a person's click or on the merge of a re-slicing pull request. Walk the slices "
    + 'table with the person, answer what they ask about it and stop.'
  static readonly RESLICING_TRAVELS_AS_A_PULL_REQUEST =
    'When the slicing has to change, edit the table of §9 and stop there: leave the state line and the '
    + 'freeze date as they are, commit nothing and push nothing. Gate 2 publishes your edit as a pull request, '
    + 'and the issues are created when that pull request merges.'

  static review({ milestone, spec }: { milestone: string, spec: string }): string {
    return `Review the slicing of the milestone "${milestone}" with the person: its frozen execution spec is ${spec} and the slices are the table of its §9.`
  }
}
