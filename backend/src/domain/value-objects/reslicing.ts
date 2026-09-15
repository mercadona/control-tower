export class Reslicing {
  static readonly MARKER = 'ct-groom:reslicing'
  static readonly #ANNOUNCEMENT = /<!-- ct-groom:reslicing spec="([^"]+)" revision="([0-9a-f]{40})" -->/
  static readonly #REVISION = /^[0-9a-f]{40}$/
  static readonly #TITLE_SUFFIX = ' — re-slicing of the execution spec'

  readonly path: string
  readonly revision: string

  constructor({ path, revision }: { path: string, revision: string }) {
    if (path.length === 0 || !Reslicing.#REVISION.test(revision)) {
      throw new Error(
        `a re-slicing names the spec it corrects and the revision it approves, got ${JSON.stringify({ path, revision })}`
      )
    }
    this.path = path
    this.revision = revision
    Object.freeze(this)
  }

  static announcedIn(body: string): Reslicing | null {
    const announced = body.match(Reslicing.#ANNOUNCEMENT)

    return announced === null ? null : new Reslicing({ path: announced[1], revision: announced[2] })
  }

  approves(other: Reslicing): boolean {
    return this.path === other.path && this.revision === other.revision
  }

  titleOf(milestone: string): string {
    return `${milestone}${Reslicing.#TITLE_SUFFIX}`
  }

  bodyFor(milestone: string): string {
    return [
      this.#announcement(),
      '',
      `The slicing of ${milestone} changed in the coordinating session. The spec stays frozen: only its slices `
      + 'table moved, and neither its state line nor its freeze date was touched.',
      '',
      `- ${this.path}`,
      '',
      "Merging this pull request authorises the groom: Control Tower's gate 2 then creates the issues from the "
      + 'table this spec now carries, with no further click. The revision above is what it authorises, so this '
      + 'approval cannot be inherited by another spec or by a later edit of this one.',
    ].join('\n')
  }

  #announcement(): string {
    return `<!-- ${Reslicing.MARKER} spec="${this.path}" revision="${this.revision}" -->`
  }
}
