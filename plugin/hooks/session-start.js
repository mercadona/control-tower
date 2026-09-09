#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { composeHydration } from '../scripts/state.js'
import { resolveStatePath } from '../scripts/state-paths.js'

let input
try { input = JSON.parse(readFileSync(0, 'utf8')) } catch { process.exit(0) }
const cwd = input.cwd || process.cwd()
// F22: in a slice's worktree there are TWO state files and only one of them
// talks about this work. See scripts/state-paths.js for why the precedence is
// structural load-bearing.
//
// `rel` is the RELATIVE path of the file that was just resolved, and it travels
// all the way into the messages: the blocking warnings `composeHydration` puts
// together name the file, and in a slice's worktree naming `.agent/STATE.md`
// would send the agent to the coordinator's tracked file. Relative and not
// absolute because whoever reads the warning is inside this very directory.
const { path: statePath, rel: stateRel } = resolveStatePath(cwd)

if (statePath) {
  const stateText = readFileSync(statePath, 'utf8')
  let gitLog = ''
  try { gitLog = execFileSync('git', ['log', '--oneline', '-5'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { /* repo with no commits */ }
  const additionalContext = composeHydration(stateText, gitLog, { stateRel })
  if (additionalContext) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext },
    }))
  }
}
