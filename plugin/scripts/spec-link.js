// Resolution of the link to the spec that /ct-groom writes into every issue
// (F10).
//
// The defect it closes: up to here, the line was
// "Spec: [docs/x-design.md#9](docs/x-design.md#9)" — a RELATIVE path with a
// NUMERIC anchor. Both halves are broken, and both were checked against
// GitHub before anything was touched:
//
//   1. The relative path. `gh api /markdown -X POST` with `mode: gfm` and
//      `context: owner/repo` returns the href AS IS:
//      `<a href="docs/x-design.md#9">`. In a file of the repo (a README) it
//      would resolve fine; on an issue's page
//      (github.com/owner/repo/issues/N) it resolves against THAT url and
//      gives a 404. An issue is precisely where this line lives.
//   2. The anchor. "#<section number>" does not exist: the real heading is
//      "## 9. Slices" and GitHub assigns it "9-slices" (see scripts/anchor.js,
//      where the full verification against the real renderer lives).
//
// This module produces an ABSOLUTE, verified URL, or none at all. Deliberate:
// an absolute URL pointing at something unpublished is the same defect with
// another face, so "a good link could not be built" is a first-class result
// (`reason`), never a half-made link.

// ---------------------------------------------------------------------------
// Which reference is emitted, and why that one.
//
// What is emitted is the DEFAULT BRANCH of the repo where the spec lives
// (`https://<host>/<owner>/<repo>/blob/<default-branch>/<path>#<anchor>`),
// not a sha and not the branch it is invoked from. Three reasons, in order of
// weight:
//
//   - Against a sha (permalink): the spec is a LIVING document and /ct-groom
//     treats it as such — F5's drift detection compares every issue against
//     TODAY's §9. A permalink would freeze the link on a §9 that may have
//     stopped being the one the tool compares against, so the human who opens
//     the issue and the machine that reconciles it would be looking at
//     different documents. The known price is paid: if the file MOVES, the
//     link dies — but that is now detected (see the note about the comparison
//     in scripts/reconcile.js).
//   - Against the current branch: the current branch is not a property of the
//     repository but of WHO is invoking. Two legitimate invocations from
//     different branches would produce two different lines for the same slice
//     and --reconcile would rewrite them over one another indefinitely — the
//     ping-pong that the "by the anchor only" comparison used to avoid at the
//     cost of detecting nothing else. The default branch is the same wherever
//     it is invoked from.
//   - And because a feature branch is deleted on merge: the issue's link
//     would die exactly when the epic ends.
// ---------------------------------------------------------------------------

// GITHUB_REMOTE_RES: the shapes in which `git remote get-url origin` can
// return the same repo. The four that git/gh produce in practice are covered
// (https, https with an embedded credential, scp-like ssh, ssh://) — the
// trailing `.git` is optional in all of them.
const GITHUB_REMOTE_RES = [
  /^https?:\/\/(?:[^@/]*@)?([^/]+)\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  /^ssh:\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
  /^(?:[^@]+@)?([^:/]+):([^/]+)\/(.+?)(?:\.git)?\/?$/,
]

// parseRemote: remote URL -> { host, owner, repo }, or null if it is not
// recognised. The host is NOT required to be github.com: a self-hosted GitHub
// Enterprise has the same blob URL shape, and hardcoding github.com would
// turn a perfectly buildable link into a degradation.
export function parseRemote(remoteUrl) {
  const url = (remoteUrl || '').trim()
  if (!url) return null
  for (const re of GITHUB_REMOTE_RES) {
    const m = re.exec(url)
    if (m && m[1] && m[2] && m[3]) return { host: m[1], owner: m[2], repo: m[3] }
  }
  return null
}

// encodePathSegment: `encodeURIComponent` does NOT escape `!'()*`, and the
// parenthesis is precisely the character that breaks the `[text](target)`
// syntax of a markdown link — a spec at "docs/plan (v2)/x.md" would produce a
// link truncated at the parenthesis. Verified against GitHub: with
// `%28`/`%29` the href comes out whole.
function encodePathSegment(seg) {
  return encodeURIComponent(seg).replace(/\(/g, '%28').replace(/\)/g, '%29')
}
function encodePath(path) {
  return path.split('/').map(encodePathSegment).join('/')
}

// buildBlobUrl: the URL of "view this file on this branch", with an anchor if
// there is one. The anchor is NOT encoded: a GitHub slug can only contain
// letters, digits, combining marks, `_` and `-` (see anchor.js#SLUG_DROP_RE),
// none of which breaks either the URL or the markdown link syntax.
export function buildBlobUrl({ host, owner, repo, ref, path, anchor }) {
  const base = `https://${host}/${encodePathSegment(owner)}/${encodePathSegment(repo)}/blob/${encodePath(ref)}/${encodePath(path)}`
  return anchor ? `${base}#${anchor}` : base
}

// ANCHOR_ID_PREFIX: GitHub emits the heading's id prefixed
// (`id="user-content-9-slices"`) and the href unprefixed (`href="#9-slices"`);
// its own JS translates one into the other. To CHECK that the anchor exists
// one has to look for the prefixed form, which is the one that appears in the
// HTML.
const ANCHOR_ID_PREFIX = 'user-content-'
export function renderedHtmlHasAnchor(html, anchor) {
  if (!anchor) return false
  return (html || '').includes(`id="${ANCHOR_ID_PREFIX}${anchor}"`)
}

// SPEC_REF_REASONS: the reasons why there may be no link. They are fixed
// strings because they END UP IN THE ISSUE BODY (see
// groom.js#renderSpecLink): if they changed from run to run, F5's drift
// detection would report a change that is not one. None of them contains
// "#<digits>" on purpose — a bare "#N" in the body gets autolinked by GitHub
// to issue N of the repo (verified: in josemerca/ct-loop-sandbox, a bare "#3"
// comes out as `<a href=".../issues/3">`, and it is only NOT autolinked if
// that issue does not exist — that is, it not autolinking today does not mean
// it will not do so tomorrow).
export const SPEC_REF_REASONS = {
  notInRepo: 'the spec is not inside a git repository',
  outsideRepo: 'the spec falls outside the tree of the git repository',
  noRemote: 'the repository of the spec has no "origin" remote',
  unparsableRemote: 'the "origin" remote of the spec repository is not a recognisable GitHub URL',
  noDefaultBranch: 'the default branch of the spec repository could not be resolved',
  notPublished: 'el spec no está publicado en la rama por defecto del repositorio',
}

// resolveSpecRef: from "the path I was handed in argv" to "the reference that
// can be written into an issue". `run(cmd, args)` returns stdout and throws if
// the command fails — injected so that ALL the degradation branches can be
// tested without a network and without a repo (see
// __tests__/spec-link.test.js).
//
// `heading` is { text, anchor } (scripts/anchor.js, through slices.js's
// report) or null if the §9 table does not live under any heading.
//
// Returns { ref, warnings }:
//   - ref: what gets rendered into the body. A non-null `url` means "verified
//     to exist": the file has really been asked of GitHub on that branch, and
//     if there is an anchor it has been checked that the rendered HTML carries
//     its id. Without that check, "absolute" would only change the SHAPE of
//     the broken link.
//   - warnings: lines for stderr. NEVER empty when `url` is null — the link
//     falling over in silence is the original defect.
// `specFile` arrives ALREADY absolute and with its symbolic links resolved
// (ct-groom.mjs does that): `git -C <dir>` needs a real directory, and the
// path relative to the repo root can only be computed between two paths of the
// same kind. `displayPath` is the path EXACTLY AS it was written in argv, and
// it is what gets shown in the body when even the repo cannot be worked out —
// in that case an absolute path on the invoker's machine says nothing to
// whoever reads the issue.
export function resolveSpecRef({ specFile, displayPath, heading, run, relativize }) {
  const warnings = []
  const headingText = heading && heading.text ? heading.text : null
  const anchor = heading && heading.anchor ? heading.anchor : null
  const degraded = (reason, path = (displayPath || specFile)) => ({
    ref: { path, heading: headingText, url: null, reason },
    warnings: [
      `warning: the spec link of every issue is left WITHOUT a link — ${reason}. The issues will be born with a text reference (path + section) instead of a clickable link, and /ct-groom does NOT fix it on later runs without --reconcile (marked EXPERIMENTAL): if you want the link, fix this and run again BEFORE the real run.`,
    ],
  })

  let root
  try {
    root = run('git', ['-C', dirOf(specFile), 'rev-parse', '--show-toplevel'])
  } catch {
    return degraded(SPEC_REF_REASONS.notInRepo)
  }
  const relPath = relativize(root, specFile)
  if (!relPath || relPath.startsWith('..')) return degraded(SPEC_REF_REASONS.outsideRepo)

  let remoteUrl
  try {
    remoteUrl = run('git', ['-C', root, 'remote', 'get-url', 'origin'])
  } catch {
    return degraded(SPEC_REF_REASONS.noRemote, relPath)
  }
  const remote = parseRemote(remoteUrl)
  if (!remote) return degraded(SPEC_REF_REASONS.unparsableRemote, relPath)
  const slug = `${remote.owner}/${remote.repo}`

  let branch
  try {
    branch = run('gh', ['repo', 'view', slug, '--json', 'defaultBranchRef', '-q', '.defaultBranchRef.name'])
  } catch {
    return degraded(SPEC_REF_REASONS.noDefaultBranch, relPath)
  }
  if (!branch) return degraded(SPEC_REF_REASONS.noDefaultBranch, relPath)

  // The check that turns "absolute" into "usable": the RENDERED file, on that
  // branch, is asked of GitHub itself. A 404 here is the commonest case of all
  // in real life — the spec just written and not yet pushed — and it is
  // exactly the one that produced a broken link without saying anything.
  let html
  try {
    html = run('gh', ['api', `repos/${slug}/contents/${encodePath(relPath)}?ref=${encodeURIComponent(branch)}`,
      '-H', 'Accept: application/vnd.github.html'])
  } catch {
    return degraded(`${SPEC_REF_REASONS.notPublished} (${slug}, rama ${branch})`, relPath)
  }

  const url = buildBlobUrl({ ...remote, ref: branch, path: relPath, anchor })
  if (!anchor) {
    warnings.push(headingText === null
      ? `warning: the §9 table does not live under any heading of the spec — the link of every issue points at the whole file, not at the section; put the table under a heading ("## 9. Slices") so the link lands where it should.`
      : `warning: the heading "${headingText}" produces no anchor on GitHub (it comes out empty once the punctuation is stripped) — the link of every issue points at the whole file, not at the section.`)
    return { ref: { path: relPath, heading: headingText, url, reason: null }, warnings }
  }
  if (!renderedHtmlHasAnchor(html, anchor)) {
    // The anchor is computed over the LOCAL file; the link points at the
    // PUBLISHED copy. If they do not match, it is because the published one is
    // another (spec edited and not pushed, typically) — linking to the anchor
    // anyway would be inventing.
    warnings.push(`warning: the anchor "${anchor}" (from the heading "${headingText}") does not exist in the copy of ${relPath} published at ${slug}@${branch} — the link of every issue points at the whole file, not at the section; push the current version of the spec and run again.`)
    return { ref: { path: relPath, heading: headingText, url: buildBlobUrl({ ...remote, ref: branch, path: relPath, anchor: null }), reason: null }, warnings }
  }
  return { ref: { path: relPath, heading: headingText, url, reason: null }, warnings }
}

// dirOf: `dirname` without importing node:path — this module stays pure and
// dependency-free so that it can be tested without touching disk. A path with
// no slash at all lives in the current directory.
function dirOf(p) {
  const i = (p || '').lastIndexOf('/')
  return i === -1 ? '.' : (i === 0 ? '/' : p.slice(0, i))
}
