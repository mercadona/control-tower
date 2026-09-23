#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { analyzeSpecFreeze, HYPOTHESIS_REASONS, SCOPE_REASONS } from './groom.js'

export class SpecCheckCli {
  static USAGE = 'usage: ct-spec-check.mjs <spec>'

  static run(args) {
    if (args.length !== 1 || args[0].startsWith('--')) {
      console.error(SpecCheckCli.USAGE)
      process.exitCode = 1
      return
    }
    let text
    try {
      text = readFileSync(args[0], 'utf8')
    } catch (error) {
      console.error(`spec could not be checked: ${error.message}`)
      process.exitCode = 1
      return
    }
    const analysis = analyzeSpecFreeze(text)
    console.log(JSON.stringify(analysis))
    process.exitCode = analysis.hypothesis === HYPOTHESIS_REASONS.OK
      && analysis.scope === SCOPE_REASONS.OK
      && analysis.clarifications.length === 0
      && analysis.decisionsWithoutProvenance.length === 0 ? 0 : 2
  }
}

SpecCheckCli.run(process.argv.slice(2))
