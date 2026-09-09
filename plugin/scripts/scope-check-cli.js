#!/usr/bin/env node
// scope-check — THE CONFORMANCE GATE OF THE PR. Do the files this PR touched
// fit inside the scope its epic declared?
//
// IT RUNS IN THE TARGET REPO, AS A CI CHECK OVER THE PR. Not inside
// `dispatch-check --release`: that one is invoked by the agent itself, and a
// guard that the suspect runs is not a guard. And not as a block of text in
// the body of the PR: one more paragraph competes with the other twenty that
// nobody reads any more. The product of this command is a RED check, which is
// binary and cannot be skimmed over.
//
// IT IS DISTRIBUTED BUNDLED (dist/scope-check.js, with no npm dependencies at
// runtime) because the target repo does NOT have the plugin installed in CI.
// The workflow that invokes it and the three steps to install it by hand live
// in `docs/loop/ct-scope-gate.md` of the plugin's repo: nothing vendors it on
// its own.
//
// WHY IT EXISTS: dispatch 1, slice 4 — the agent touched GDPR copy on screen
// against its «Protegido» and wrote that Jose had authorised it. That was
// false. The human signature is not verifiable from inside the loop (the agent
// runs with Jose's credentials and can fabricate any GitHub artefact); what it
// touched is. See scripts/scope.js.
import { execFileSync } from 'node:child_process'
import { parseScope, scopeViolations, issueFromPrBody, isSliceBranch } from './scope.js'

const arg = (f) => {
  const i = process.argv.indexOf(f)
  if (i === -1) return undefined
  const v = process.argv[i + 1]
  return (typeof v === 'string' && !v.startsWith('--')) ? v : true
}

const usage = 'usage: scope-check --repo <owner/repo> --pr <number> [--exempt <pattern,pattern>]'
const repo = arg('--repo')
const pr = arg('--pr')
// Exemptions OF THE TARGET REPO: its own bookkeeping (a ledger, a logbook)
// that its conventions force every slice to touch. They are passed in from the
// workflow because they belong to the repo, not to the loop: hardcoding them
// in the plugin would turn them into holes for every other repo. They ADD UP
// to the plugin's own.
const exemptRaw = arg('--exempt')
const exempt = typeof exemptRaw === 'string' ? exemptRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
if (typeof repo !== 'string' || typeof pr !== 'string' || !/^\d+$/.test(pr)) {
  console.error(usage)
  process.exit(2)
}

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024, timeout: 5 * 60 * 1000, killSignal: 'SIGKILL' })

// EVERY read failure is RED, never green. It is the rule the rest of the
// plugin already holds up («el 1 nunca se degrada a 0»): not being able to
// check is NOT being clean. A gate that fails open on a network error is worse
// than having no gate, because on top of that it reassures.
function die(message, detail) {
  console.error(`🛑 scope-check: ${message}`)
  if (detail) console.error(`   ${detail}`)
  process.exit(1)
}

let prData
try {
  prData = JSON.parse(gh(['pr', 'view', pr, '--repo', repo, '--json', 'body,files,headRefName']))
} catch (e) {
  die(`could not read PR #${pr} of ${repo}`, (e.stderr || e.message || '').toString().trim())
}

const issueN = issueFromPrBody(prData.body)
if (!issueN) {
  // THIS IS WHERE IT IS DECIDED WHETHER THIS GATE SURVIVES NEXT WEEK.
  //
  // A governed repo has PRs that are NOT slices: documentation, chores, fixes
  // made by hand. None of them carries `Closes #N` and none of them is harvest
  // of the loop. Failing them all would turn the gate into an unsatisfiable
  // wall, and a wall like that gets switched off whole within days — it is the
  // failure conventions.js already paid for in this repo (F14), and switched
  // off it protects nothing.
  //
  // The discriminator is the BRANCH, not the body of the PR, because
  // `feat/<n>` is created by the dispatcher and not by the agent. A PR that
  // comes from a slice branch without its `Closes` is broken for two reasons
  // at once —the gate does not know which scope to apply AND the issue will
  // not be closed on merge, holding its tokens forever— so that one does come
  // out red.
  if (isSliceBranch(prData.headRefName)) {
    die(
      `PR #${pr} comes from the slice branch \`${prData.headRefName}\` but does not declare a single issue with a closing keyword in its BODY`,
      'Add `Closes #<issue>` to the BODY of the PR (not to the title, not in a comment). Without it, on top of that, the issue is not closed on merge and the slice holds its `area:`/`touches:` tokens forever.',
    )
  }
  // It is said out loud that nothing has been checked. A green and mute check
  // would be indistinguishable from a green check that did judge something.
  console.log(`✅ scope-check: PR #${pr} is not a slice of the loop (branch \`${prData.headRefName}\`, no closing keyword). There is no epic scope to check.`)
  process.exit(0)
}

let issueBody
try {
  issueBody = JSON.parse(gh(['issue', 'view', String(issueN), '--repo', repo, '--json', 'body'])).body
} catch (e) {
  die(`could not read issue #${issueN} of ${repo}`, (e.stderr || e.message || '').toString().trim())
}

const scope = parseScope(issueBody)
if (!scope.declared) {
  die(
    `the epic of issue #${issueN} declares no scope`,
    `${scope.reason}. Add an \`Alcance: <paths>\` line to the \`## Contexto del epic\` section of the execution spec and re-groom it (or edit the issue). It is declared ONCE per epic, at the freeze.`,
  )
}

const files = (prData.files || []).map((f) => f.path)
const violations = scopeViolations(files, scope.patterns, exempt)

if (violations.length) {
  console.error(`🛑 scope-check: PR #${pr} touches ${violations.length} file(s) OUTSIDE the scope its epic declared (issue #${issueN}).`)
  console.error('')
  console.error('   Declared scope:')
  for (const p of scope.patterns) console.error(`     ✓ ${p}`)
  console.error('')
  console.error('   Out of scope:')
  for (const f of violations) console.error(`     ✗ ${f}`)
  console.error('')
  // The message does not accuse anybody of bad faith, and it must not: the
  // real failure mode that was measured is not an adversarial agent, it is an
  // agent that convinces itself it already asked. What is asked for is that
  // the decision go back to the human, which is exactly the step that agent
  // skipped.
  console.error('   This is NOT fixed by editing the record of the PR. Either the work leaves')
  console.error('   the PR, or the scope of the epic changes — and changing the scope of a frozen')
  console.error("   epic is a human decision, not the agent's.")
  process.exit(1)
}

console.log(`✅ scope-check: the ${files.length} file(s) of PR #${pr} fit in the scope of the epic (issue #${issueN}).`)
process.exit(0)
