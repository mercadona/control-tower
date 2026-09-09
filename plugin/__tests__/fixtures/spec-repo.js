// A temporary directory with the shape a spec has IN PRODUCTION (F10).
//
// Before F10, a test's spec was a loose file inside an mkdtemp: it made no
// difference, because the link to the spec was composed from `--section` and
// from the path exactly as it arrived in argv. Now the link is derived from the
// repository (path relative to the root + `origin` remote + default branch) and
// is VERIFIED against GitHub before being written, so a loose file exercises
// the degradation branch, not the normal one.
//
// This helper returns a directory that is a real git repo with a GitHub
// `origin` remote — the configuration /ct-groom runs in when it is used for
// what it was made for. Tests that want to exercise the degradations (spec
// outside a repo, no remote, unpublished) do so on purpose and separately, not
// as a side effect.
//
// The real `gh` never comes in: the stub in fixtures/fake-gh-bin answers both
// the `repo view --json defaultBranchRef` and the
// `api repos/o/r/contents/<path>` that checks the anchor exists.
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SPEC_REPO_REMOTE = 'https://github.com/o/r.git'
export const SPEC_REPO_SLUG = 'o/r'

// makeSpecDir: mkdtemp + `git init` + origin remote. The real `git` (there is
// no stub): it is cheap and it is exactly what ct-groom.mjs will interrogate.
export function makeSpecDir(prefix = 'ctg-') {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('remote', 'add', 'origin', SPEC_REPO_REMOTE)
  return dir
}

// specUrl: the URL ct-groom.mjs must produce for a spec named `file` with the
// anchor `anchor` inside a directory from makeSpecDir. It is computed here, in
// the fixture, so the tests do not repeat the template — but deliberately NOT
// built with the functions of scripts/spec-link.js: a test that composes the
// URL with the same code that produces it checks nothing.
export function specUrl(file, anchor = '9-slices') {
  const base = `https://github.com/o/r/blob/main/${file}`
  return anchor ? `${base}#${anchor}` : base
}
