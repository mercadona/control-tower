// Pure logic of scripts/conventions.js. The black-box tests
// (conventions.test.js, ct-next-conventions.test.js) cover the real case end to
// end; these cover the edges that are not visible there, and in particular the
// TWO errors this detection cannot afford in the same way: a false positive
// costs one line of reading, a false negative costs a deadlock. That is why
// there are tests in both directions, and why the threshold always leans
// towards warning.
import { describe, it, expect } from 'vitest'
import { detectConventions, formatFindings, CONTRACT_MARKER_OPEN, CONTRACT_MARKER_CLOSE } from '../scripts/conventions.js'

const ids = (r) => r.map((f) => f.id).sort()
const doc = (content, path = 'AGENTS.md') => ({ path, content })

describe('detectConventions — claim', () => {
  it("the repository's own script is enough, even with no written instruction", () => {
    const r = detectConventions({ docs: [], files: ['scripts/dispatch-check.sh'] })
    expect(ids(r)).toEqual(['claim'])
  })

  it('a written instruction is enough, even if the script never appears in the tree', () => {
    const r = detectConventions({ docs: [doc('- claim: `bin/dispatch-check <issue>`')], files: [] })
    expect(ids(r)).toEqual(['claim'])
  })

  it('documentary evidence comes FIRST: it is the order the dispatched agent will obey', () => {
    const r = detectConventions({
      docs: [doc('# A\n- corre `scripts/dispatch-check.sh 42`')],
      files: ['scripts/dispatch-check.sh', 'scripts/tests/dispatch-check.test.sh'],
    })
    expect(r[0].evidence[0].path).toBe('AGENTS.md')
    expect(r[0].evidence[0].line).toBe(2)
  })

  it('a repository with none of this produces no finding at all', () => {
    const r = detectConventions({ docs: [doc('# A\n## Setup\n- npm ci')], files: ['src/index.js', 'README.md'] })
    expect(r).toEqual([])
  })
})

describe('detectConventions — worktrees', () => {
  it('`git worktree add` with the loop path does NOT warn, path before or after the flags', () => {
    expect(detectConventions({ docs: [doc('git worktree add .worktrees/9 -b feat/9 main')], files: [] })).toEqual([])
    expect(detectConventions({ docs: [doc('git worktree add -b feat/9 .worktrees/9 main')], files: [] })).toEqual([])
  })

  it('`git worktree add` with another path DOES warn', () => {
    const r = detectConventions({ docs: [doc('git worktree add .claude/worktrees/<slug> -b <rama> main')], files: [] })
    expect(ids(r)).toEqual(['worktrees'])
  })

  it('a worktrees directory of its own warns even when empty (no need to descend into it)', () => {
    const r = detectConventions({ docs: [], files: ['.claude/worktrees/'] })
    expect(ids(r)).toEqual(['worktrees'])
  })

  it("the LOOP's OWN directory (`.worktrees/`) is not a foreign convention", () => {
    expect(detectConventions({ docs: [], files: ['.worktrees/', '.worktrees/7/README.md'] })).toEqual([])
  })

  it('a hook with "worktree"/"branch" in its name warns: it can knock down every dispatch', () => {
    const r = detectConventions({ docs: [], files: ['.claude/hooks/menoplus-branch-isolation-guard.sh'] })
    expect(ids(r)).toEqual(['worktrees'])
    // Any other hook, by contrast, says nothing about the loop's terrain.
    expect(detectConventions({ docs: [], files: ['.claude/hooks/docker-guard.sh'] })).toEqual([])
  })
})

describe('detectConventions — the `estado` state finding', () => {
  it("a STATE.md outside .agent/ warns; the loop's own does not", () => {
    expect(ids(detectConventions({ docs: [], files: ['docs/STATE.md'] }))).toEqual(['estado'])
    expect(detectConventions({ docs: [], files: ['.agent/STATE.md'] })).toEqual([])
  })
})

describe('detectConventions — the block ct-init seeds is not a foreign convention', () => {
  const own = [
    CONTRACT_MARKER_OPEN,
    '- el claim lo hace `dispatch-check` del plugin',
    '- cada slice va a `.worktrees/<n>`',
    CONTRACT_MARKER_CLOSE,
  ].join('\n')

  it("it is pruned: otherwise ct-init's second run would report itself", () => {
    expect(detectConventions({ docs: [doc(`# A\n${own}\n`)], files: [] })).toEqual([])
  })

  // F14: the instruction in these two fixtures is an INVOCATION
  // (`./scripts/dispatch-check.sh <issue#>`), not the mere mention of the
  // script's name. What these tests prove is the PRUNING of the block itself,
  // not the grammar of the claim rule; with a bare mention they would prove
  // both things at once and the failure of one would be indistinguishable from
  // the failure of the other.
  it("what is OUTSIDE the block still counts, and its line number is the real file's", () => {
    const content = `# A\n${own}\n- claim propio: \`./scripts/dispatch-check.sh <issue#>\`\n`
    const r = detectConventions({ docs: [doc(content)], files: [] })
    expect(ids(r)).toEqual(['claim'])
    // The block occupies lines 2..5; the instruction is on line 6 of the
    // ORIGINAL file. Citing the line of the pruned text would send the human to
    // the wrong place, which is worse than citing nothing at all.
    expect(r[0].evidence[0].line).toBe(6)
    expect(content.split('\n')[5]).toContain('dispatch-check.sh')
  })

  it('an OPEN, unclosed block is not pruned: better to report yourself than to swallow the rest of the file', () => {
    // Real case: ct-init has a guard dedicated to partial traces. Pruning
    // "from the opening to the end" would hide every convention that came
    // after it — a false negative, the expensive error.
    const content = `# A\n${CONTRACT_MARKER_OPEN}\n- bla\n- claim propio: \`./scripts/dispatch-check.sh <issue#>\`\n`
    expect(ids(detectConventions({ docs: [doc(content)], files: [] }))).toEqual(['claim'])
  })

  it('CRLF: the markers are recognised just the same (an AGENTS.md edited on Windows does not break the pruning)', () => {
    const crlf = `# A\n${own}\n`.split('\n').join('\r\n')
    expect(detectConventions({ docs: [doc(crlf)], files: [] })).toEqual([])
  })
})

describe('formatFindings', () => {
  it('with no findings it prints NOTHING (an empty string, not an "all good")', () => {
    expect(formatFindings([])).toBe('')
  })

  it('it truncates the evidence list but says how many it left out', () => {
    const files = Array.from({ length: 9 }, (_, i) => `pkg${i}/dispatch-check.sh`)
    const text = formatFindings(detectConventions({ docs: [], files }))
    expect(text).toContain('(+3 más)')
  })

  it('every finding carries the decision to be taken, not just what was found', () => {
    const text = formatFindings(detectConventions({ docs: [], files: ['scripts/dispatch-check.sh'] }))
    expect(text).toMatch(/decisión:/)
    expect(text).toMatch(/Decide cuál manda/)
  })
})
