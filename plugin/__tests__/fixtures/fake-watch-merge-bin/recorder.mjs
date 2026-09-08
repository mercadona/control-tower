#!/usr/bin/env node
// Recorder for CT_WATCH_MERGE_BIN: writes down its argv in a file and dies.
//
// It stands in for the real merge watcher in the tests. Without it, every test
// that releases a slice would put a REAL process to poll GitHub every minute
// for 48 hours — and `--release` is exercised in many tests, not only in the
// ones that talk about this. It is the lesson of CT_WATCH_GO_BIN, which the
// suite learned by leaving 42 orphan processes behind on its first run.
//
// CT_WATCH_MERGE_BIN is not a covert test mode: it follows the pattern of
// CT_WATCH_GO_BIN and of CT_ACCOUNT_*_DIR, which is to say it changes NO
// decision of dispatch-check, only which program gets launched. What the test
// checks —that it is launched, and with which arguments— is exactly what
// matters about that seam.
import { appendFileSync } from 'node:fs'

const destino = process.env.FAKE_WATCH_MERGE_LOG
if (destino) appendFileSync(destino, JSON.stringify(process.argv.slice(2)) + '\n')
