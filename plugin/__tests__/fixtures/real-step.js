import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CtStep } from '../../scripts/ct-step.js'
import { CommandIo } from '../../scripts/command-io.js'
import { VERDICT_RULES } from '../../scripts/step-contracts.js'
import { StepPlanMother } from './step-plan.js'

export class RealStepRepo {
  static SCRIPT = fileURLToPath(new URL('../../scripts/ct-step.mjs', import.meta.url))
  static opened = []
  static WORK = StepPlanMother.WORK

  constructor(root) {
    this.root = root
    this.env = { ...process.env, CLAUDE_CONFIG_DIR: join(root, '.telemetry') }
    for (const variable of ['CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'AI_AGENT']) delete this.env[variable]
  }

  static prepared() {
    const repo = new RealStepRepo(realpathSync(mkdtempSync(join(tmpdir(), 'ct step boundary '))))
    RealStepRepo.opened.push(repo)
    repo.git('init', '-q', '-b', 'main')
    repo.git('config', 'user.email', 'fixture@example.test')
    repo.git('config', 'user.name', 'Fixture')
    repo.git('config', 'commit.gpgsign', 'false')
    repo.write('.gitignore', '.telemetry/\n.agent/run-*\n/*.json\n')
    repo.write('.agent/SLICE.md', '---\nissue: 7\nbase: main\n---\n')
    repo.write('plan.md', StepPlanMother.oneTask())
    repo.git('add', '-A')
    repo.git('commit', '-qm', 'fixture base')
    repo.base = repo.git('rev-parse', 'HEAD').trim()
    repo.git('update-ref', 'refs/remotes/origin/main', repo.base)
    repo.git('switch', '-q', '-c', 'feat/7')
    return repo
  }

  git(...argv) { return execFileSync('git', argv, { cwd: this.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }
  write(path, text) {
    const destination = join(this.root, path)
    mkdirSync(dirname(destination), { recursive: true })
    writeFileSync(destination, text)
  }
  read(path) { return readFileSync(join(this.root, path), 'utf8') }

  run(...argv) {
    let stdout = ''
    let stderr = ''
    const io = CommandIo.production({ cwd: this.root, env: this.env })
    io.out = (text) => { stdout += text }
    io.err = (text) => { stderr += text }
    const status = CtStep.run([...argv, '--plan', 'plan.md', '--issue', '7'], io)
    return { status, stdout, stderr }
  }

  executable(...argv) {
    return spawnSync(process.execPath, [RealStepRepo.SCRIPT, ...argv, '--plan', 'plan.md', '--issue', '7'], { cwd: this.root, env: this.env, encoding: 'utf8' })
  }

  approveWork() {
    this.write(RealStepRepo.WORK, 'approved work\n')
    this.write('report.json', JSON.stringify({ paths: [RealStepRepo.WORK], summary: 'work delivered' }))
    this.write('verdict.json', JSON.stringify({ ruling: 'PASS', findings: [], rubric: VERDICT_RULES.map((rule) => ({ rule, result: 'measured', outcome: 'conforme' })) }))
    for (const argv of [['report', 'report.json'], ['controls'], ['next'], ['verdict', 'verdict.json']]) {
      const result = this.run(...argv)
      if (result.status !== 0) throw new Error(`Could not arrange approved work: ${JSON.stringify(result)}`)
    }
    if (JSON.parse(this.read('.agent/run-7.json')).step !== 'commit') throw new Error('The work was not approved for commit')
  }

  static clean() {
    for (const repo of RealStepRepo.opened.splice(0)) rmSync(repo.root, { recursive: true, force: true })
  }
}
