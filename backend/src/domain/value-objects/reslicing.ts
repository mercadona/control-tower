export class Reslicing {
  static readonly MARKER = '<!-- ct-groom:reslicing -->'
  static readonly #TITLE_SUFFIX = ' — re-slicing of the execution spec'

  static titleOf(milestone: string): string {
    return `${milestone}${Reslicing.#TITLE_SUFFIX}`
  }

  static bodyFor({ milestone, path }: { milestone: string, path: string }): string {
    return [
      Reslicing.MARKER,
      '',
      `The slicing of ${milestone} changed in the coordinating session. The spec stays frozen: only its slices `
      + 'table moved, and neither its state line nor its freeze date was touched.',
      '',
      `- ${path}`,
      '',
      "Merging this pull request authorises the groom: Control Tower's gate 2 then creates the issues from the "
      + 'table this spec now carries, with no further click.',
    ].join('\n')
  }

  static isAnnouncedIn(body: string): boolean {
    return body.includes(Reslicing.MARKER)
  }
}
