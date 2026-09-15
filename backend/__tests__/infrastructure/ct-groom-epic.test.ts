import { describe, it, expect } from 'vitest'
import { CtGroomEpic } from '../../src/infrastructure/ct-groom-epic.ts'
import { GroomPlan, GroomPlanIssue } from '../../src/domain/value-objects/groom-plan.ts'
import { ProcessOutput } from '../../src/infrastructure/tool-runner.ts'
import { CheckoutRoot } from '../../src/domain/value-objects/checkout-root.ts'
import { EpicSpec } from '../../src/domain/value-objects/epic-spec.ts'
import { RepositoryName } from '../../src/domain/value-objects/repository-name.ts'
import { EpicNotGroomed, GroomPlanNotUnderstood } from '../../src/domain/exceptions.ts'

class Mother {
  static ROOT = new CheckoutRoot('/Users/you/repos/ct-loop-sandbox')
  static SPEC = new EpicSpec({
    path: 'docs/superpowers/specs/2026-09-14-issue-330.md',
    text: '# The groom and gate 2 — Execution spec',
  })

  static REPOSITORY = new RepositoryName('josemerca/ct-loop-sandbox')
  static HOME = Mother.REPOSITORY.text
  static MILESTONE = 'The groom and gate 2'

  static ISSUE_ONE_TITLE = '#1 The intermediate gate retires'
  static ISSUE_ONE_LABELS = ['type:backend', 'area:api', 'touches:plugin', 'gate:none', 'status:backlog']
  static ISSUE_TWO_TITLE = '#2 The session channel'
  static ISSUE_TWO_LABELS = ['type:ui', 'area:sessions', 'touches:frontend', 'gate:visual', 'status:backlog']

  static CAPTURE = 'node plugin/scripts/ct-groom.mjs docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md --repo mercadona/control-tower --milestone "start-in-correct-loop" --dry-run, on 2026-09-14: this fixture keeps issues #1 and #2 of that real dry run\'s stdout, every field of the plugin\'s table present so the projection is proved to drop what it does not consume, with body/epicContext/frozenDecisions cut to their first 300 characters'

  static grooming(): { root: CheckoutRoot, spec: EpicSpec, repository: RepositoryName, milestone: string } {
    return { root: Mother.ROOT, spec: Mother.SPEC, repository: Mother.REPOSITORY, milestone: Mother.MILESTONE }
  }

  static planJson(): string {
    return JSON.stringify({
      captured: Mother.CAPTURE,
      milestone: Mother.MILESTONE,
      issues: [
        Mother.#realIssue({
          order: 1, title: Mother.ISSUE_ONE_TITLE, labels: Mother.ISSUE_ONE_LABELS,
          descripcion: 'The flow loses its intermediate human gate: the review endpoint and its wiring are gone, the `plan` gate stops being implied by every slice, and the pull request\'s fix loop is untouched',
          protectedLine: '- 🚫 `ReadFixesAsked` and `RequestFixes` and the second `ReviewWatch` wiring; the go protocol\'s own modules stay as they are',
          senal: 'a groom of any spec creates no `gate:plan` label and the plan stream emits only writing and ready',
          ac: [
            '`POST /review-plan` is no longer routed',
            'the plan events vocabulary is `writing` and `ready` only',
            'no slice is born with the plan gate unless its own row asks for it',
            'the pull request fixes still reach the agent through the surviving watch',
            '`API.md` no longer documents the retired endpoint',
          ],
          gates: [],
          gatesContent: '- (none) — this slice demands no human gate before merging.',
          body: '> Slice `#1` of the epic. Spec: [docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md § Tabla de slices](https://github.com/mercadona/control-tower/blob/main/docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md#tabla-de-slices)\n\n## Desc',
        }),
        Mother.#realIssue({
          order: 2, title: Mother.ISSUE_TWO_TITLE, labels: Mother.ISSUE_TWO_LABELS,
          descripcion: 'The page opens a live terminal fed by a backend session, with its stream, its input and the list of the live ones',
          protectedLine: '- 🚫 the eight existing endpoints and their contracts',
          senal: 'the session list names the live session and its stream carries bytes while the process runs',
          ac: [
            'the live sessions are listed by the backend',
            'output reaches the page while the process runs',
            'typed input reaches the process',
            'closing the page does not kill the session',
          ],
          gates: ['visual'],
          gatesContent: 'Before merging, these gates are closed by a HUMAN — the agent that implements the slice cannot consider them met:\n- **`visual`** — before merging, a human has to SEE the change: the PR must bring a screenshot (or video) of the before/after and the path to reproduce it. The agent cannot give it as met.',
          body: '> Slice `#2` of the epic. Spec: [docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md § Tabla de slices](https://github.com/mercadona/control-tower/blob/main/docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md#tabla-de-slices)\n\n## Desc',
        }),
      ],
      repo: Mother.REPOSITORY.text,
      project: null,
    })
  }

  static #realIssue({ order, title, labels, descripcion, protectedLine, senal, ac, gates, gatesContent, body }: {
    order: number, title: string, labels: string[], descripcion: string, protectedLine: string, senal: string,
    ac: string[], gates: string[], gatesContent: string, body: string,
  }) {
    return {
      order, title, labels, deps: [], ac, descripcion, protectedLine, senal,
      specLink: `> Slice \`#${order}\` of the epic. Spec: [docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md § Tabla de slices](https://github.com/mercadona/control-tower/blob/main/docs/superpowers/specs/2026-09-11-the-loop-enters-through-brainstorming-execution.md#tabla-de-slices)`,
      gates, gatesContent, e2eContent: null, body,
      epicContext: '- Stack: `backend/` is TypeScript on Node 24 with Express 5 — every module, test\n  and helper under it is `.ts`, which `backend/__tests__/typescript-only.test.ts`\n  keeps live. `frontend/` is React 19 with Vite in TypeScript. `plugin/` stays\n  JavaScript (`.js` / `.mjs`).\n- Direction of dependency: ',
      epicContextUnknown: false,
      frozenDecisions: '- **D-1 · The entrance is a conversation with a real terminal** — the cabin\n  hosts the brainstorming and spec session as an interactive `claude` in a PTY\n  streamed to the page, not a structured chat and not a step left outside the\n  app.\n\n- **D-2 · The backend automates the coordination between is',
      frozenDecisionsUnknown: false,
    }
  }
}

class NodeDouble {
  static CT_GROOM = '/plugin/scripts/ct-groom.mjs'

  readonly answer: ProcessOutput
  readonly calls: { argv: string[], options: { cwd?: string } | undefined }[]

  constructor(answer: ProcessOutput) {
    this.answer = answer
    this.calls = []
  }

  static exiting(code: number, { stdout = '', stderr = '' }: { stdout?: string, stderr?: string } = {}) {
    return new NodeDouble(new ProcessOutput({ code, stdout, stderr }))
  }

  epicGroom(): CtGroomEpic {
    return new CtGroomEpic({
      node: (argv, options) => {
        this.calls.push({ argv, options })

        return Promise.resolve(this.answer)
      },
      wholeOutput: (argv, options) => {
        this.calls.push({ argv, options })

        return Promise.resolve(this.answer)
      },
      ctGroom: NodeDouble.CT_GROOM,
    })
  }
}

describe('CtGroomEpic', () => {
  it('the dry run asks for the plan and the real run is never mistaken for it', async () => {
    const dryRunArgv = CtGroomEpic.argvFor({
      ctGroom: NodeDouble.CT_GROOM, spec: Mother.SPEC.path, repository: Mother.REPOSITORY,
      milestone: Mother.MILESTONE, dryRun: true,
    })
    const realArgv = CtGroomEpic.argvFor({
      ctGroom: NodeDouble.CT_GROOM, spec: Mother.SPEC.path, repository: Mother.REPOSITORY,
      milestone: Mother.MILESTONE, dryRun: false,
    })
    expect(dryRunArgv.at(-1)).toBe('--dry-run')
    expect(realArgv).not.toContain('--dry-run')

    const node = NodeDouble.exiting(0, { stdout: Mother.planJson() })
    const plan = await node.epicGroom().planned(Mother.grooming())

    expect(node.calls).toEqual([{ argv: dryRunArgv, options: { cwd: Mother.ROOT.text } }])
    expect(plan).toBeInstanceOf(GroomPlan)
    expect(plan.milestone).toBe(Mother.MILESTONE)
    expect(plan.issues).toEqual([
      new GroomPlanIssue({ order: 1, title: Mother.ISSUE_ONE_TITLE, labels: Mother.ISSUE_ONE_LABELS, repo: Mother.HOME }),
      new GroomPlanIssue({ order: 2, title: Mother.ISSUE_TWO_TITLE, labels: Mother.ISSUE_TWO_LABELS, repo: Mother.HOME }),
    ])
  })

  it('exit 3 is the plan all the same and exit 2 is the plugin own words', async () => {
    const divergent = NodeDouble.exiting(CtGroomEpic.UNRECONCILED_DIVERGENCE, { stdout: Mother.planJson() })
    const plan = await divergent.epicGroom().planned(Mother.grooming())
    expect(plan.milestone).toBe(Mother.MILESTONE)

    const broken = NodeDouble.exiting(2, {
      stderr: 'the §9 table has no "#" column — without it there is no slice order and the dependencies (merge-after) cannot be resolved; add a "#" header column with a pure integer per row (1, 2, 3…)\n',
    })
    const refusal = await broken.epicGroom().planned(Mother.grooming()).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(EpicNotGroomed)
    expect(refusal.message).toBe('the §9 table has no "#" column — without it there is no slice order and the dependencies (merge-after) cannot be resolved; add a "#" header column with a pure integer per row (1, 2, 3…)')
  })

  it('the real run passes the spec the repository and the milestone in the documented order', async () => {
    const node = NodeDouble.exiting(0)

    await node.epicGroom().run(Mother.grooming())

    expect(node.calls).toEqual([{
      argv: [
        NodeDouble.CT_GROOM, Mother.SPEC.path, '--repo', Mother.REPOSITORY.text, '--milestone', Mother.MILESTONE,
      ],
      options: { cwd: Mother.ROOT.text },
    }])
  })

  it('every issue of the plan says which repository it lands in, and one printed without it lands home', async () => {
    const printed = JSON.parse(Mother.planJson())
    printed.issues[1].repo = 'mercadona/repo-pulse'
    delete printed.issues[0].repo
    const node = NodeDouble.exiting(0, { stdout: JSON.stringify(printed) })

    const plan = await node.epicGroom().planned(Mother.grooming())

    expect(plan.home).toBe(Mother.HOME)
    expect(plan.issues.map((issue) => issue.repo)).toEqual([Mother.HOME, 'mercadona/repo-pulse'])
    expect(plan.issues[0].landsOutside(Mother.HOME)).toBe(false)
    expect(plan.issues[1].landsOutside(Mother.HOME)).toBe(true)
  })

  it('the repository joins the plan canonical text, so a row that lands elsewhere is a different plan', async () => {
    const printed = JSON.parse(Mother.planJson())
    const home = await NodeDouble.exiting(0, { stdout: JSON.stringify(printed) }).epicGroom().planned(Mother.grooming())
    printed.issues[1].repo = 'mercadona/repo-pulse'
    const spread = await NodeDouble.exiting(0, { stdout: JSON.stringify(printed) }).epicGroom().planned(Mother.grooming())

    expect(spread.canonicalText()).not.toBe(home.canonicalText())
  })

  it('stdout that is not the json the plugin prints raises GroomPlanNotUnderstood', async () => {
    const node = NodeDouble.exiting(0, { stdout: 'not json at all' })

    const refusal = await node.epicGroom().planned(Mother.grooming()).catch((cause) => cause)

    expect(refusal).toBeInstanceOf(GroomPlanNotUnderstood)
  })
})
