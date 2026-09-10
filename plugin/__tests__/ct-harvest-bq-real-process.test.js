import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const script = join(here, '..', 'scripts', 'ct-harvest.mjs')
const fakeGhDir = join(here, 'fixtures', 'fake-gh-bin')
const fakeBqDir = join(here, 'fixtures', 'fake-bq-bin')

class Bench {
  static ISSUES = [
    { number: 12, title: 'Slice 1', state: 'closed', closedAt: '2026-08-20T10:00:00Z', labels: [{ name: 'type:infra' }], milestone: { title: 'E' }, closedByPullRequestsReferences: [] },
    { number: 13, title: 'Slice 2', state: 'closed', closedAt: '2026-08-20T11:00:00Z', labels: [{ name: 'type:infra' }], milestone: { title: 'E' }, closedByPullRequestsReferences: [] },
  ]

  static METRICS_DIR = JSON.stringify([{ name: 'issue-12.jsonl', type: 'file' }])

  static TELEMETRY = [
    {
      step: 'implement', outcome: 'done',
      tool: 'claude-code', tool_version: '2.1.266', tool_usage_status: 'measured',
      tool_input_tokens: 10, tool_cached_input_tokens: 1000, tool_output_tokens: 100, tool_total_tokens: 1110,
      tool_duration_status: 'unsupported', tool_active_duration_ms: null,
      tool_usage_evidence: ['req_a'], tool_usage_gaps: 0,
    },
    {
      step: 'judge', outcome: 'failed', ruling: 'FAIL',
      tool: 'claude-code', tool_version: '2.1.266', tool_usage_status: 'measured',
      tool_input_tokens: 5, tool_cached_input_tokens: 500, tool_output_tokens: 50, tool_total_tokens: 555,
      tool_duration_status: 'unsupported', tool_active_duration_ms: null,
      tool_usage_evidence: ['req_b'], tool_usage_gaps: 0,
    },
    {
      step: 'judge', outcome: 'corrections-ordered', ruling: 'PASS',
      tool: 'claude-code', tool_version: '2.1.266', tool_usage_status: 'measured',
      tool_input_tokens: 5, tool_cached_input_tokens: 500, tool_output_tokens: 50, tool_total_tokens: 555,
      tool_duration_status: 'unsupported', tool_active_duration_ms: null,
      tool_usage_evidence: ['req_c'], tool_usage_gaps: 0,
    },
    { step: 'slice-judge', outcome: 'failed', ruling: 'FAIL' },
    { step: 'slice-judge', outcome: 'failed', ruling: 'FAIL' },
    { step: 'judge', outcome: 'discarded', why: 'the judge wrote no verdict' },
  ].map((row) => `${JSON.stringify(row)}\n`).join('')

  static TIMELINE = JSON.stringify([
    { event: 'labeled', label: { name: 'status:ready' }, created_at: '2026-08-20T09:00:00Z' },
    { event: 'labeled', label: { name: 'status:in-progress' }, created_at: '2026-08-20T09:05:00Z' },
    { event: 'labeled', label: { name: 'status:in-review' }, created_at: '2026-08-20T09:50:00Z' },
  ])

  constructor() {
    this.dir = mkdtempSync(join(tmpdir(), 'ct-hv-bq-'))
    this.ghCounterFile = join(this.dir, 'gh-count')
    this.ghArgvLogFile = join(this.dir, 'gh-argv')
    this.bqArgvLogFile = join(this.dir, 'bq-argv')
  }

  env(overrides) {
    return {
      ...process.env,
      PATH: `${fakeGhDir}:${fakeBqDir}:${process.env.PATH}`,
      FAKE_GH_COUNTER_FILE: this.ghCounterFile,
      FAKE_GH_ARGV_LOG_FILE: this.ghArgvLogFile,
      FAKE_GH_LIST_SEQUENCE: JSON.stringify([Bench.ISSUES]),
      FAKE_GH_TIMELINE_JSON: Bench.TIMELINE,
      FAKE_BQ_ARGV_LOG_FILE: this.bqArgvLogFile,
      ...overrides,
    }
  }

  run(args, overrides = {}) {
    return spawnSync('node', [script, ...args], { encoding: 'utf8', env: this.env(overrides) })
  }

  githubWasRead() {
    return existsSync(this.ghArgvLogFile)
  }

  bqWasInvoked() {
    return existsSync(this.bqArgvLogFile)
  }

  cleanup() {
    rmSync(this.dir, { recursive: true, force: true })
  }
}

describe('ct-harvest.mjs accepts and validates --bq', () => {
  it('a_malformed_table_id_exits_2_before_reading_github', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'nope'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/invalid --bq/)
    expect(bench.githubWasRead()).toBe(false)
    bench.cleanup()
  })

  it('a_dangling_bq_flag_exits_2_naming_the_missing_value', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq'])
    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/invalid --bq: "\(no value\)"/)
    expect(bench.githubWasRead()).toBe(false)
    bench.cleanup()
  })

  it('without_the_flag_bq_is_never_invoked_and_the_harvest_exits_0', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E'])
    expect(result.status).toBe(0)
    expect(bench.bqWasInvoked()).toBe(false)
    bench.cleanup()
  })

  it('a_complete_harvest_loads_one_row_per_slice_and_says_so_on_stderr_with_exit_0', () => {
    const bench = new Bench()
    const captureDir = join(bench.dir, 'capture')
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'p:d.t'], {
      FAKE_GH_METRICS_DIR_JSON: Bench.METRICS_DIR,
      FAKE_GH_METRICS_FILES: JSON.stringify({ 'issue-12.jsonl': '' }),
      FAKE_BQ_CAPTURE_DIR: captureDir,
    })
    expect(result.status).toBe(0)
    expect(result.stderr).toMatch(/BigQuery: 2 rows loaded into p:d\.t/)
    expect(readFileSync(bench.bqArgvLogFile, 'utf8').trim())
      .toMatch(/^--project_id=p --headless load --source_format=NEWLINE_DELIMITED_JSON --schema_update_option=ALLOW_FIELD_ADDITION --schema=\S+\/schema\.json p:d\.t \S+\/rows\.ndjson$/)
    const rows = readFileSync(join(captureDir, 'rows.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(rows.map((row) => row.issue)).toEqual([12, 13])
    expect(rows.map((row) => row.telemetry_status)).toEqual(['ok', 'sin-fichero'])
    bench.cleanup()
  })

  it('the_loaded_row_carries_the_tool_the_tokens_and_the_judge_returns_of_the_slice_that_brought_telemetry', () => {
    const bench = new Bench()
    const captureDir = join(bench.dir, 'capture')
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'p:d.t'], {
      FAKE_GH_METRICS_DIR_JSON: Bench.METRICS_DIR,
      FAKE_GH_METRICS_FILES: JSON.stringify({ 'issue-12.jsonl': Bench.TELEMETRY }),
      FAKE_BQ_CAPTURE_DIR: captureDir,
    })
    expect(result.status).toBe(0)
    const rows = readFileSync(join(captureDir, 'rows.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    const [measured, withoutTelemetry] = rows
    expect(measured.tool).toBe('claude-code')
    expect(measured.tool_version).toBe('2.1.266')
    expect(measured.tool_usage_status).toBe('measured')
    expect(measured.tool_usage_attempts).toBe(3)
    expect(measured.tool_usage_measured).toBe(3)
    expect(measured.tool_input_tokens).toBe(20)
    expect(measured.tool_cached_input_tokens).toBe(2000)
    expect(measured.tool_output_tokens).toBe(200)
    expect(measured.tool_total_tokens).toBe(2220)
    expect(measured.tool_duration_status).toBe('unsupported')
    expect(measured.tool_active_duration_ms).toBeNull()
    expect(measured.judge_attempts).toBe(2)
    expect(measured.judge_vetoes).toBe(1)
    expect(measured.judge_corrections_ordered).toBe(1)
    expect(measured.judge_returns).toBe(2)
    expect(measured.verdicts_fail).toBe(3)
    expect(withoutTelemetry.tool).toBeNull()
    expect(withoutTelemetry.tool_total_tokens).toBeNull()
    expect(withoutTelemetry.judge_returns).toBeNull()
    bench.cleanup()
  })

  it('the_schema_bq_receives_declares_every_new_column_as_additive_and_nullable', () => {
    const bench = new Bench()
    const captureDir = join(bench.dir, 'capture')
    bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'p:d.t'], { FAKE_BQ_CAPTURE_DIR: captureDir })
    const schema = JSON.parse(readFileSync(join(captureDir, 'schema.json'), 'utf8'))
    const modes = Object.fromEntries(schema.map((column) => [column.name, column.mode]))
    for (const column of [
      'tool', 'tool_version', 'tool_usage_status', 'tool_usage_attempts', 'tool_usage_measured', 'tool_usage_gaps',
      'tool_input_tokens', 'tool_cached_input_tokens', 'tool_output_tokens', 'tool_total_tokens',
      'tool_duration_status', 'tool_active_duration_ms',
      'judge_attempts', 'judge_vetoes', 'judge_corrections_ordered', 'judge_returns',
    ]) {
      expect(modes[column]).toBe('NULLABLE')
    }
    bench.cleanup()
  })

  it('with_json_the_stdout_stays_a_single_json_document_when_loading', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'p:d.t', '--json'])
    expect(result.status).toBe(0)
    expect(bench.bqWasInvoked()).toBe(true)
    expect(() => JSON.parse(result.stdout)).not.toThrow()
    bench.cleanup()
  })

  it('an_incomplete_harvest_never_calls_bq_and_exits_1', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'p:d.t'], { FAKE_GH_TIMELINE_FAIL: '1' })
    expect(result.status).toBe(1)
    expect(bench.bqWasInvoked()).toBe(false)
    expect(result.stderr).toMatch(/BigQuery: nothing is loaded — the harvest is incomplete/)
    bench.cleanup()
  })

  it('a_bq_failure_is_a_motive_naming_the_exit_code_the_kept_directory_and_the_retry_command_with_exit_1', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'p:d.t'], { FAKE_BQ_EXIT_CODE: '2', FAKE_BQ_STDERR: 'quota exceeded' })
    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/bq exited with 2: quota exceeded/)
    const kept = result.stderr.match(/The files are kept in (\S+);/)
    expect(kept).not.toBeNull()
    expect(existsSync(kept[1])).toBe(true)
    expect(result.stderr).toMatch(/retry by hand: bq --project_id=p --headless load/)
    rmSync(kept[1], { recursive: true, force: true })
    bench.cleanup()
  })

  it('an_empty_milestone_does_not_call_bq_and_exits_0', () => {
    const bench = new Bench()
    const result = bench.run(['--repo', 'o/r', '--milestone', 'E', '--bq', 'p:d.t'], { FAKE_GH_LIST_SEQUENCE: JSON.stringify([[]]) })
    expect(result.status).toBe(0)
    expect(bench.bqWasInvoked()).toBe(false)
    expect(result.stderr).toMatch(/BigQuery: nothing to load — the milestone has no slices/)
    bench.cleanup()
  })
})
