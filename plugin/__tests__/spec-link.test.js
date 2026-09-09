import { describe, it, expect } from 'vitest'
import { parseRemote, buildBlobUrl, renderedHtmlHasAnchor, resolveSpecRef, SPEC_REF_REASONS } from '../scripts/spec-link.js'
import { renderSpecLink } from '../scripts/groom.js'

// F10 — the layer that decides WHICH link is written into the issue, and when
// NONE is written. `run` is injected, so every branch (including the
// degradation ones, which in real life depend on whether the spec has been
// pushed or not) is tested without a network and without a repo.

describe('parseRemote — the shapes in which git can return the same repo', () => {
  const CASES = [
    ['https://github.com/o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['https://github.com/o/r', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['https://github.com/o/r/', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['https://token@github.com/o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['git@github.com:o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['git@github.com:o/r', { host: 'github.com', owner: 'o', repo: 'r' }],
    ['ssh://git@github.com/o/r.git', { host: 'github.com', owner: 'o', repo: 'r' }],
    // GitHub Enterprise: the same blob URL shape. Hardcoding github.com would
    // turn a perfectly buildable link into a degradation.
    ['git@ghe.empresa.com:equipo/proyecto.git', { host: 'ghe.empresa.com', owner: 'equipo', repo: 'proyecto' }],
  ]
  for (const [url, expected] of CASES) {
    it(`${url} → ${expected.owner}/${expected.repo} on ${expected.host}`, () => {
      expect(parseRemote(url)).toEqual(expected)
    })
  }
  it('a remote that is not a recognisable URL → null (nothing is guessed)', () => {
    expect(parseRemote('')).toBeNull()
    expect(parseRemote(null)).toBeNull()
    expect(parseRemote('/ruta/local/sin/host')).toBeNull()
  })
})

describe('buildBlobUrl — the URL, and what gets encoded', () => {
  it('the normal shape', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'docs/spec.md', anchor: '9-slices' }))
      .toBe('https://github.com/o/r/blob/main/docs/spec.md#9-slices')
  })
  it('with no anchor, a bare "#" is not emitted (a dangling "#" leads nowhere)', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'spec.md', anchor: null }))
      .toBe('https://github.com/o/r/blob/main/spec.md')
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'spec.md', anchor: '' }))
      .toBe('https://github.com/o/r/blob/main/spec.md')
  })
  // The parenthesis is THE character that breaks the `[text](target)` syntax
  // of a markdown link, and encodeURIComponent does not escape it by itself.
  // Verified against GitHub: with %28/%29 the href comes out whole.
  it('spaces and parentheses in the path are encoded (otherwise the markdown link is cut off there)', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'main', path: 'docs/plan (v2)/spec.md', anchor: 'a' }))
      .toBe('https://github.com/o/r/blob/main/docs/plan%20%28v2%29/spec.md#a')
  })
  it('the slash of the path and of the branch is NOT encoded (they are separators, not content)', () => {
    expect(buildBlobUrl({ host: 'github.com', owner: 'o', repo: 'r', ref: 'release/1.0', path: 'a/b/c.md', anchor: null }))
      .toBe('https://github.com/o/r/blob/release/1.0/a/b/c.md')
  })
})

describe('renderedHtmlHasAnchor — the PREFIXED form is looked for, which is the one GitHub emits', () => {
  // GitHub emits `id="user-content-9-slices"` and `href="#9-slices"`; its own
  // JS translates one into the other. Looking for the unprefixed form in the
  // HTML would not find the id.
  const HTML = '<a id="user-content-9-slices" class="anchor" href="#9-slices"></a>'
  it('finds the anchor that is present', () => {
    expect(renderedHtmlHasAnchor(HTML, '9-slices')).toBe(true)
  })
  it('does not find one that is not there', () => {
    expect(renderedHtmlHasAnchor(HTML, '9-slices-revisado')).toBe(false)
  })
  it('an anchor that is a PREFIX of another does not count as present (the comparison is of the whole id)', () => {
    expect(renderedHtmlHasAnchor(HTML, '9-slice')).toBe(false)
  })
  it('with no anchor → false (never "anything goes")', () => {
    expect(renderedHtmlHasAnchor(HTML, '')).toBe(false)
    expect(renderedHtmlHasAnchor(HTML, null)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// resolveSpecRef: the whole sequence, and every point at which it gives up.
// ---------------------------------------------------------------------------

const HEADING = { text: '9. Slices', anchor: '9-slices' }
const OK_HTML = '<a id="user-content-9-slices" class="anchor" href="#9-slices"></a>'

// fakeRun: answers the four commands of the sequence. `failures` names which
// one the attempt gives up at (the same point at which it would really give
// up: spec outside a repo, no remote, gh down, spec not pushed).
function fakeRun({ failures = {}, remote = 'https://github.com/o/r.git', branch = 'main', html = OK_HTML, log = [] } = {}) {
  return (cmd, args) => {
    log.push([cmd, ...args].join(' '))
    if (cmd === 'git' && args.includes('--show-toplevel')) {
      if (failures.toplevel) throw new Error('not a git repository')
      return '/repo'
    }
    if (cmd === 'git' && args.includes('get-url')) {
      if (failures.remote) throw new Error('No such remote')
      return remote
    }
    if (cmd === 'gh' && args[0] === 'repo') {
      if (failures.branch) throw new Error('gh: not found')
      return branch
    }
    if (cmd === 'gh' && args[0] === 'api') {
      if (failures.contents) throw new Error('gh: Not Found (HTTP 404)')
      return html
    }
    throw new Error(`comando inesperado: ${cmd} ${args.join(' ')}`)
  }
}

const relativize = (root, file) => file.startsWith(`${root}/`) ? file.slice(root.length + 1) : '../fuera.md'

function resolve(opts = {}) {
  const { failures, remote, branch, html, heading = HEADING, specFile = '/repo/docs/spec.md', log } = opts
  return resolveSpecRef({
    specFile,
    displayPath: 'docs/spec.md',
    heading,
    run: fakeRun({ failures, remote, branch, html, log }),
    relativize,
  })
}

describe('resolveSpecRef — the normal path', () => {
  it('spec in a repo with a GitHub remote, published on the default branch, with the anchor present → absolute URL with anchor, no warnings', () => {
    const { ref, warnings } = resolve()
    expect(ref).toEqual({
      path: 'docs/spec.md',
      heading: '9. Slices',
      url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices',
      reason: null,
    })
    expect(warnings).toEqual([])
  })

  // The link is to the DEFAULT BRANCH, not to a sha: the spec is a living
  // document and F5's drift detection compares every issue against TODAY's §9
  // — a permalink would freeze the link on a §9 that may have stopped being
  // the one the tool compares against.
  it('the branch is the one the repo declares, not "main" blindly', () => {
    const { ref } = resolve({ branch: 'develop' })
    expect(ref.url).toBe('https://github.com/o/r/blob/develop/docs/spec.md#9-slices')
  })

  it('the command sequence is the expected one: two from git (local) and two from gh (reads), in that order', () => {
    const log = []
    resolve({ log })
    expect(log).toEqual([
      'git -C /repo/docs rev-parse --show-toplevel',
      'git -C /repo remote get-url origin',
      'gh repo view o/r --json defaultBranchRef -q .defaultBranchRef.name',
      'gh api repos/o/r/contents/docs/spec.md?ref=main -H Accept: application/vnd.github.html',
    ])
  })
})

describe('resolveSpecRef — when a good link canNOT be built, it is said: a broken one is never emitted', () => {
  const GIVE_UP_CASES = [
    ['the spec is not in a git repo', { failures: { toplevel: true } }, SPEC_REF_REASONS.notInRepo],
    ['the repo has no origin remote', { failures: { remote: true } }, SPEC_REF_REASONS.noRemote],
    ['the remote is not a recognisable GitHub URL', { remote: '/ruta/local' }, SPEC_REF_REASONS.unparsableRemote],
    ['the default branch cannot be resolved', { failures: { branch: true } }, SPEC_REF_REASONS.noDefaultBranch],
    ['the default branch comes back empty', { branch: '' }, SPEC_REF_REASONS.noDefaultBranch],
  ]
  for (const [caseName, opts, reason] of GIVE_UP_CASES) {
    it(`${caseName} → no url, with a reason and with a warning`, () => {
      const { ref, warnings } = resolve(opts)
      expect(ref.url).toBeNull()
      expect(ref.reason).toBe(reason)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(reason)
    })
  }

  // The commonest case in real life, by a distance: the spec written and not
  // yet pushed. It was exactly the one that produced a broken link without
  // saying anything.
  it('the spec is not published on the default branch → no url, and the reason names repo and branch', () => {
    const { ref, warnings } = resolve({ failures: { contents: true } })
    expect(ref.url).toBeNull()
    expect(ref.reason).toBe(`${SPEC_REF_REASONS.notPublished} (o/r, branch main)`)
    expect(warnings[0]).toMatch(/not published/i)
  })

  it('the spec falls outside the repo tree → no url', () => {
    const { ref } = resolve({ specFile: '/otro/sitio/spec.md' })
    expect(ref.url).toBeNull()
    expect(ref.reason).toBe(SPEC_REF_REASONS.outsideRepo)
  })

  // Hard rule: if there is no url, there is a warning. The link falling over
  // in silence IS the original defect.
  it('NO degradation is silent', () => {
    for (const [, opts] of [...GIVE_UP_CASES, ['not published', { failures: { contents: true } }], ['outside', { specFile: '/otro/spec.md' }]]) {
      const { ref, warnings } = resolve(opts)
      if (ref.url === null) expect(warnings.length).toBeGreaterThan(0)
    }
  })

  // When the warning's reason ends up in the issue body, it also has to say
  // that /ct-groom will NOT fix it on its own on the next run (F5 is
  // idempotent by existence): the moment to fix it is BEFORE.
  it('the warning says a later run does not fix it without --reconcile', () => {
    const { warnings } = resolve({ failures: { toplevel: true } })
    expect(warnings[0]).toMatch(/--reconcile/)
    expect(warnings[0]).toMatch(/BEFORE the real run/)
  })
})

describe('resolveSpecRef — when there is a link but no anchor: the file is linked and why is said', () => {
  it('the local anchor is not in the PUBLISHED copy (spec edited and not pushed) → url to the file, with no fragment, with a warning', () => {
    const { ref, warnings } = resolve({ html: '<a id="user-content-otra-cosa" class="anchor"></a>' })
    expect(ref.url).toBe('https://github.com/o/r/blob/main/docs/spec.md')
    expect(ref.reason).toBeNull()
    expect(warnings[0]).toContain('9-slices')
    expect(warnings[0]).toMatch(/push the current version of the spec/)
  })
  it('the §9 table does not live under any heading → url to the file, with a warning that says how to fix it', () => {
    const { ref, warnings } = resolve({ heading: null })
    expect(ref.url).toBe('https://github.com/o/r/blob/main/docs/spec.md')
    expect(ref.heading).toBeNull()
    expect(warnings[0]).toMatch(/does not live under any heading/)
  })
  it('the heading produces no usable anchor ("## ...") → url to the file, with a warning', () => {
    const { ref, warnings } = resolve({ heading: { text: '...', anchor: '' } })
    expect(ref.url).toBe('https://github.com/o/r/blob/main/docs/spec.md')
    expect(warnings[0]).toMatch(/produces no anchor/)
  })
})

// ---------------------------------------------------------------------------
// How each case is written into the body. What is checked here is that the
// degraded reference is HONEST (not a half-made link) and that it does not
// reintroduce through the back door the other defect F6 fixed: a bare "#N" in
// the body gets autolinked by GitHub to issue N of the repo (verified in the
// sandbox: a bare "#3" comes out as <a href=".../issues/3">, and inside a code
// span or a link's text, it does not).
// ---------------------------------------------------------------------------

describe('renderSpecLink — how each case is written', () => {
  const SLICE = { n: 3 }
  it('with url: a markdown link with the path and the section as its text', () => {
    const line = renderSpecLink(SLICE, { path: 'docs/spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/docs/spec.md#9-slices', reason: null })
    expect(line).toBe('> Slice `#3` of the epic. Spec: [docs/spec.md § 9. Slices](https://github.com/o/r/blob/main/docs/spec.md#9-slices)')
  })
  it('with no heading: only the path', () => {
    const line = renderSpecLink(SLICE, { path: 'spec.md', heading: null, url: 'https://github.com/o/r/blob/main/spec.md', reason: null })
    expect(line).toBe('> Slice `#3` of the epic. Spec: [spec.md](https://github.com/o/r/blob/main/spec.md)')
  })
  it('with no url: a text reference with the reason, and NO markdown link', () => {
    const line = renderSpecLink(SLICE, { path: 'docs/spec.md', heading: '9. Slices', url: null, reason: 'the spec is not inside a git repository' })
    expect(line).toBe('> Slice `#3` of the epic. Spec: `docs/spec.md` § `9. Slices` — sin enlace: the spec is not inside a git repository')
    expect(line).not.toMatch(/\]\(/)
  })
  // A heading can cite an issue ("## 9. Slices (ver #3)"). Inside a link's
  // text that does NOT get autolinked (verified); in plain text it DOES. The
  // degraded form, which is plain text, has to protect it.
  it('a "#N" from the heading never ends up as plain text in the degraded form', () => {
    const line = renderSpecLink(SLICE, { path: 'spec.md', heading: '9. Slices (ver #12)', url: null, reason: 'motivo' })
    expect(line).toContain('`9. Slices (ver #12)`')
    // With the code spans removed there can be NO loose "#<digits>" reference
    // left — neither the heading's nor the slice's own order.
    expect(line.replace(/(`+)[\s\S]*?\1/g, '')).not.toMatch(/#\d/)
  })
  it('square brackets in the link text are escaped (otherwise they would cut the link dead)', () => {
    const line = renderSpecLink(SLICE, { path: 'docs/[wip]/spec.md', heading: '9. Slices', url: 'https://github.com/o/r/blob/main/x', reason: null })
    expect(line).toContain('docs/\\[wip\\]/spec.md')
  })
  it('a backtick in the path does not break the inline code of the degraded form', () => {
    const line = renderSpecLink(SLICE, { path: 'do`c.md', heading: null, url: null, reason: 'motivo' })
    expect(line).toContain('``do`c.md``')
  })
})
