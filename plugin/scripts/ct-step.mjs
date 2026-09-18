#!/usr/bin/env node
import { CtStep } from './ct-step.js'
import { CommandIo } from './command-io.js'

process.exitCode = CtStep.run(process.argv.slice(2), CommandIo.production())
