#!/usr/bin/env node
// Recorder for CT_WATCH_GO_BIN: writes down its argv in a file and dies.
//
// It stands in for the real watcher in the ct-next tests. Without it, every
// test that dispatches a slice would put a REAL process to poll GitHub every 30
// seconds for eight hours — and there are many tests that dispatch.
//
// CT_WATCH_GO_BIN is not a covert test mode: it follows the pattern of
// CT_ACCOUNT_*_DIR, which is to say it changes NO decision of ct-next, only
// which program gets launched. What the test checks —that it is launched, and
// with which arguments— is exactly what matters about that seam.
import { appendFileSync } from 'node:fs'

const destino = process.env.FAKE_WATCH_GO_LOG
if (destino) appendFileSync(destino, JSON.stringify(process.argv.slice(2)) + '\n')
