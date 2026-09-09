import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync, cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { describe, it, expect } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// comprobarDist: answers ONE question — is HEAD's `dist/` exactly what HEAD's
// sources produce?
//
// The working tree is never read, not to compare and not to decide whether to
// skip. Hence the two behaviours that make this test usable: green while you
// edit without committing (HEAD is still coherent with itself) and red as soon
// as a commit exists carrying a stale bundle — which is the state the defect
// produces and the one `npm test` masks, because it rebuilds `dist/` before
// launching vitest.
async function comprobarDist(root) {
  const tmp = mkdtempSync(join(tmpdir(), 'ct-dist-'))
  try {
    // 1. HEAD's sources: EVERYTHING tracked, with no list of paths. A list is
    //    something to maintain, and it falls behind as soon as the bundle
    //    starts importing a file nobody added to it.
    //
    //    It goes through an intermediate .tar file and NOT through a `git
    //    archive | tar -x` pipe, deliberately. In a pipe the exit code the
    //    shell sees is `tar`'s, not `git`'s: if `root` is not a git repo, `git
    //    archive` fails but `tar -x` gets an empty input and exits 0, and the
    //    whole pipeline reports success. The temporary directory is left empty
    //    and what ends up throwing further down is the `import` of
    //    scripts/build.mjs, with a "cannot find module" that points at the
    //    wrong cause. That was fixed with `set -o pipefail`, but `pipefail` is
    //    NOT POSIX and under dash —which is Debian's and Ubuntu's `/bin/sh`—
    //    it aborts with "Illegal option -o pipefail" and exit 2, taking down
    //    the WHOLE test file on those machines, including the test that
    //    asserts HEAD is coherent. On macOS it went unnoticed: there `/bin/sh`
    //    is bash in sh mode and does accept it. With two separate commands
    //    each exit code is checked on its own, no shell is needed at all (nor
    //    interpolating `root` into a shell string), and `git`'s failure
    //    reaches the caller as it is. Do not "simplify" it back into a pipe.
    //    Since the plugin lives in plugin/, `root` may be a SUBDIRECTORY of
    //    the repo ('' as the prefix in the fake repos, whose root really is
    //    the repo's). That forces two things here. One: the tree that gets
    //    archived and compared is `HEAD:<prefix>` — ONLY the plugin's subtree,
    //    which is also the same boundary as the distribution: what lies
    //    outside `root` takes no part in the build and must not. And two:
    //    archive and ls-tree are launched from the TOPLEVEL, not from `root`,
    //    because git turns the cwd's prefix into an IMPLICIT pathspec — from
    //    plugin/, a `git archive HEAD:plugin` looks for `plugin/` INSIDE that
    //    subtree and produces an empty tar without complaining (reproduced).
    //    `git show` does not suffer this (the path after `:` is the tree's,
    //    not the cwd's), and `git log` and `git diff`, further down, want the
    //    exact opposite: their pathspecs relative to the cwd of `-C root`
    //    already point inside the plugin.
    const gitFacts = execFileSync('git', ['-C', root, 'rev-parse', '--show-toplevel', '--show-prefix'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).split('\n')
    const toplevel = gitFacts[0]
    const prefix = gitFacts[1].trim()
    const headTree = prefix ? `HEAD:${prefix.replace(/\/$/, '')}` : 'HEAD'
    const tar = join(tmp, 'head.tar')
    execFileSync('git', ['-C', toplevel, 'archive', '--format=tar', '-o', tar, headTree], { stdio: ['ignore', 'ignore', 'pipe'] })
    execFileSync('tar', ['-xf', tar, '-C', tmp], { stdio: ['ignore', 'ignore', 'pipe'] })
    // The .tar was written INSIDE `tmp`, which is where the build is going to
    // run: it is deleted first thing so as not to leave an intruder in the
    // directory that gets compared afterwards.
    rmSync(tar, { force: true })

    // 2. The `dist/` that came in the archive is in the way: what is left
    //    here after the build has to be EXACTLY what the build produces, or a
    //    file HEAD has and the build no longer emits would pass for good.
    rmSync(join(tmp, 'dist'), { recursive: true, force: true })

    // 3. node_modules is COPIED, not linked. esbuild embeds every input's
    //    path inside the bundle (comments and keys of the __commonJS shim);
    //    with a symlink it resolves to the real path outside the temporary
    //    directory and the bundle comes out with "../../../..//Users/..."
    //    baked in — 10 KB of difference over 273 KB, measured.
    //    `preserveSymlinks: true` would also give identical bytes today, and
    //    it was rejected: it is an option the real build does not have, so it
    //    would compare two different configurations while claiming identity. A
    //    repo without node_modules does not need the copy: with no npm
    //    dependencies to resolve, esbuild embeds no package path in the
    //    bundle.
    const nm = join(root, 'node_modules')
    if (existsSync(nm)) cpSync(nm, join(tmp, 'node_modules'), { recursive: true })

    // 4. HEAD's build configuration, IMPORTED and not duplicated: that way a
    //    change in build.mjs without a rebuild also comes out red.
    const mod = await import(pathToFileURL(join(tmp, 'scripts/build.mjs')).href)
    if (!mod.buildOptions) throw new Error(`scripts/build.mjs de HEAD no exporta buildOptions`)

    const res = await build({ ...mod.buildOptions, absWorkingDir: tmp, metafile: true })

    // 5. A SET comparison in both directions, not a list comparison.
    const construido = readdirSync(join(tmp, 'dist')).sort()
    const enHead = execFileSync('git', ['-C', toplevel, 'ls-tree', '--name-only', headTree, 'dist/'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).map((p) => p.replace(/^dist\//, '')).sort()

    const faltan = construido.filter((f) => !enHead.includes(f))
    const sobran = enHead.filter((f) => !construido.includes(f))
    const difieren = []
    for (const f of construido.filter((f) => enHead.includes(f))) {
      const nuevo = readFileSync(join(tmp, 'dist', f))
      const viejo = execFileSync('git', ['-C', root, 'show', `HEAD:${prefix}dist/${f}`], { maxBuffer: 256 * 1024 * 1024 })
      if (Buffer.compare(nuevo, viejo) !== 0) difieren.push(f)
    }

    const inputs = Object.keys(res.metafile.inputs).filter((k) => !k.includes('node_modules')).sort()
    return { faltan, sobran, difieren, inputs }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

// explicarIncoherencia: the message a human reads. A failure has two possible
// causes and the fix is the same for both, but knowing which one changes what
// the reader thinks they did wrong — so they are told apart without guessing.
//
// The list of inputs comes from the run's REAL metafile, not from the whole of
// `scripts/`: each hook imports only the scripts/ modules it actually uses
// (session-start.js and stop.js: state.js and state-paths.js; commit-keyword-
// guard.js: closing-keywords.js and governed-repo.js), so a change in any
// OTHER file of scripts/ does not enter any hook's bundle. Looking at the
// whole directory would have given a false positive on any change to those
// other files, even though no bundle depends on them.
function explicarIncoherencia(root, { faltan, sobran, difieren, inputs }) {
  const partes = ['el dist/ commiteado NO corresponde a los fuentes commiteados:']
  if (faltan.length) partes.push(`  el build produce ficheros que HEAD no tiene commiteados: ${faltan.join(', ')}`)
  if (sobran.length) partes.push(`  HEAD tiene ficheros en dist/ que el build ya no produce: ${sobran.join(', ')}`)
  if (difieren.length) partes.push(`  difieren en contenido: ${difieren.join(', ')}`)

  const ultimoDist = execFileSync('git', ['-C', root, 'log', '-1', '--format=%H', '--', 'dist/'], { encoding: 'utf8' }).trim()
  // An empty `inputs` cannot happen today (the metafile always carries at
  // least the entry points), but a `git diff -- ` with NO paths diffs the
  // WHOLE repo, and that would turn any documentation commit into a false
  // "needs a rebuild". It is cut off here instead of trusting it never
  // happens.
  if (ultimoDist && inputs.length) {
    const cambiados = execFileSync('git', ['-C', root, 'diff', '--name-only', `${ultimoDist}..HEAD`, '--', ...inputs], { encoding: 'utf8' })
      .split('\n').filter(Boolean)
    if (cambiados.length) {
      partes.push(`  falta un rebuild: estos inputs del bundle cambiaron desde el último commit que tocó dist/ (${ultimoDist.slice(0, 7)}): ${cambiados.join(', ')}`)
    } else {
      const v = esbuildVersion(root)
      partes.push(`  ningún input del bundle cambió desde el último commit que tocó dist/ (${ultimoDist.slice(0, 7)}) — lo que se movió es el toolchain (esbuild ${v} instalado), o alguien editó el bundle a mano`)
    }
  } else {
    // Never a silent skip, not here either: when the guard cuts in, the
    // message SAYS that it cannot give the cause and why, instead of just
    // omitting it. Without this line the reader cannot tell "the cause was
    // investigated and nothing came of it" from "it could not be
    // investigated".
    //
    // "outside node_modules" is not an ornament: `inputs` arrives already
    // filtered by that criterion from comprobarDist, so the condition that
    // holds here is not plainly "the build declared no inputs".
    const motivo = ultimoDist ? 'el build no declaró ningún input fuera de node_modules' : 'dist/ no tiene historia en este repo'
    partes.push(`  no se puede determinar la causa: ${motivo}`)
  }
  partes.push('  arreglo, en los dos casos: npm run build && git add dist/ && git commit')
  return partes.join('\n')
}

function esbuildVersion(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules/esbuild/package.json'), 'utf8')).version
  } catch {
    return '(versión no legible)'
  }
}

describe('the committed dist/ corresponds to the committed sources (F24)', () => {
  it('HEAD is coherent: the committed bundle is what the committed sources produce', async () => {
    const r = await comprobarDist(root)
    const incoherente = r.faltan.length || r.sobran.length || r.difieren.length
    expect(incoherente ? explicarIncoherencia(root, r) : 'coherente').toBe('coherente')
  }, 60_000)

  it('the bundle inputs come from the real metafile, not from a hand-written list', async () => {
    const { inputs } = await comprobarDist(root)
    // This literal is a canary, not a source of truth: when the bundle gains
    // or loses an input it has to be updated by hand, but nothing ELSE
    // depends on it — the diagnosis above (missing/left over/differing) takes
    // its list of inputs from the metafile on every run, never from here.
    expect(inputs).toEqual([
      'hooks/commit-keyword-guard.js',
      'hooks/dispatch-guard.js',
      'hooks/session-start.js',
      'hooks/stop.js',
      'scripts/closing-keywords.js',
      // The mark by which the `Stop` hook recognises a ct-step commit (#95).
      // It comes in through state.js, and it is also what writes it on the
      // other side, in step-contracts.js: one single source for both halves.
      'scripts/ct-step-commit.js',
      'scripts/dispatch-gate.js',
      'scripts/governed-repo.js',
      // The dispatch gate decides with the machine's table, so
      // dist/dispatch-guard.js drags in run-machine.js and, with it,
      // reconcile-outcome.js. They are pure: no disk, no processes, no yaml.
      'scripts/reconcile-outcome.js',
      'scripts/run-machine.js',
      // scope.js and scope-check-cli.js come in through dist/scope-check.js,
      // the conformance gate that gets vendored into the target repo's CI
      // (where the plugin is not installed). closing-keywords.js was already
      // there: scope.js reuses it instead of carrying its own recogniser of
      // closing keywords.
      'scripts/scope-check-cli.js',
      'scripts/scope.js',
      'scripts/state-paths.js',
      'scripts/state.js',
      // The `yaml` bundle: state.js imports it and not the package, because a
      // plugin installation does not bring node_modules along. It enters all
      // three hooks through state.js, and is built by the same
      // `npm run build`.
      'scripts/vendor/yaml.js',
    ])
  }, 60_000)
})

// repoDeMentira: a minimal and COHERENT git repo, so that it can be broken on
// purpose. Its scripts/build.mjs does not import esbuild at the top (unlike
// the real one): that way the checker can import it without the temporary
// directory needing node_modules, and these four tests do not pay for the
// 45 MB copy. The path that does import a build.mjs with real dependencies is
// covered by the HEAD test.
function repoDeMentira() {
  const dir = mkdtempSync(join(tmpdir(), 'ct-falso-'))
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
  git('init', '-q')
  git('config', 'user.email', 'test@test')
  git('config', 'user.name', 'test')
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'scripts/build.mjs'), [
    "export const buildOptions = {",
    "  entryPoints: ['src/a.js'],",
    "  bundle: true, platform: 'node', format: 'esm', outdir: 'dist',",
    "}",
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'src/a.js'), 'export const x = 1\nconsole.log(x)\n')
  return dir
}

// construirEnRepo: generates the fake repo's dist with the SAME configuration
// the checker will read afterwards, so that the starting point is really
// coherent and not coherent by accident.
async function construirEnRepo(dir) {
  const mod = await import(pathToFileURL(join(dir, 'scripts/build.mjs')).href + `?v=${Date.now()}`)
  await build({ ...mod.buildOptions, absWorkingDir: dir })
}

describe('the checker fails when it must (F24)', () => {
  it('a source changed without regenerating the bundle → it detects it and names the file', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })

    // F22's defect, reproduced: the source is changed and committed WITHOUT
    // regenerating the bundle.
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 999\nconsole.log(x)\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'fuente sin rebuild'], { stdio: 'ignore' })

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect(difieren).toEqual(['a.js'])
      expect({ faltan, sobran }).toEqual({ faltan: [], sobran: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('a file HEAD has in dist/ and the build no longer produces → comes out as LEFT OVER', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    writeFileSync(join(dir, 'dist/huerfano.js'), '// bundle de un entry point que ya no existe\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'con un sobrante'], { stdio: 'ignore' })

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect(sobran).toEqual(['huerfano.js'])
      expect({ faltan, difieren }).toEqual({ faltan: [], difieren: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('a file the build produces and HEAD has not committed → comes out as MISSING', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })

    // A second entry point is added to the build and committed without generating its bundle.
    writeFileSync(join(dir, 'src/b.js'), 'console.log("b")\n')
    writeFileSync(join(dir, 'scripts/build.mjs'), [
      "export const buildOptions = {",
      "  entryPoints: ['src/a.js', 'src/b.js'],",
      "  bundle: true, platform: 'node', format: 'esm', outdir: 'dist',",
      "}",
      '',
    ].join('\n'))
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'entry point nuevo sin bundle'], { stdio: 'ignore' })

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect(faltan).toEqual(['b.js'])
      expect({ sobran, difieren }).toEqual({ sobran: [], difieren: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('a dirty working tree turns NOTHING red: HEAD is still coherent with itself', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })

    // An edit WITHOUT committing — the ordinary red-green cycle. The test must
    // not interfere with it: this is the behaviour that makes this test usable
    // day to day, and without this case nobody would know it was preserved.
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 12345\nconsole.log(x)\n')

    try {
      const { faltan, sobran, difieren } = await comprobarDist(dir)
      expect({ faltan, sobran, difieren }).toEqual({ faltan: [], sobran: [], difieren: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('the diagnosis tells the two causes apart (F24)', () => {
  it('if any input changed since the last commit that touched dist/ → it says a rebuild is missing and names the files', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })
    writeFileSync(join(dir, 'src/a.js'), 'export const x = 999\nconsole.log(x)\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'fuente sin rebuild'], { stdio: 'ignore' })

    try {
      const r = await comprobarDist(dir)
      const msg = explicarIncoherencia(dir, r)
      expect(msg).toMatch(/falta un rebuild/i)
      expect(msg).toMatch(/src\/a\.js/)
      expect(msg).toMatch(/npm run build/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('if no input changed → it says the toolchain moved and names the esbuild version', async () => {
    const dir = repoDeMentira()
    await construirEnRepo(dir)
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'coherente'], { stdio: 'ignore' })
    // The committed bundle is corrupted without touching any source: from the
    // diagnosis's point of view that is indistinguishable from "esbuild
    // produces something else".
    writeFileSync(join(dir, 'dist/a.js'), '// bytes que ningún build produce\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'bundle tocado a mano'], { stdio: 'ignore' })

    try {
      const r = await comprobarDist(dir)
      expect(r.difieren).toEqual(['a.js'])

      // The fake esbuild is planted AFTER comprobarDist and after the last
      // commit, deliberately: that way it neither enters git's archive nor
      // pays for the node_modules copy comprobarDist makes when one exists.
      // The only thing that has to see it is esbuildVersion, which runs
      // inside explicarIncoherencia.
      //
      // Without it, asserting the version would be worth nothing: the word
      // "esbuild" is in the fixed text of the message template, so
      // `toMatch(/esbuild/)` matches just as well against "(versión no
      // legible)" —which is what was coming out— and esbuildVersion's happy
      // branch was left uncovered anywhere, with a `catch` that swallows any
      // error. Demanding the number 9.9.9 can only match by reading the
      // package.json below, and it proves along the way that esbuildVersion
      // reads from the DIAGNOSED repo and not from the real one (which has a
      // quite different version).
      mkdirSync(join(dir, 'node_modules/esbuild'), { recursive: true })
      writeFileSync(join(dir, 'node_modules/esbuild/package.json'), JSON.stringify({ version: '9.9.9' }))

      const msg = explicarIncoherencia(dir, r)
      expect(msg).toMatch(/toolchain/i)
      expect(msg).toMatch(/esbuild 9\.9\.9/)
      expect(msg).not.toMatch(/falta un rebuild/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})

describe('when it cannot answer, it fails with a reason (F24)', () => {
  it('a directory that is not a git repo → it throws naming the reason, it does not answer "coherente"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ct-nogit-'))
    try {
      // "It throws" is not enough: if step 1 let `git`'s failure slip through
      // (as a `git archive | tar -x` pipe would, whose exit code is `tar`'s),
      // this very directory would throw too, but with "Cannot find module
      // .../scripts/build.mjs" — a reason that points at a missing file, not
      // at `root` not being a git repo. The assertion has to tell the right
      // reason apart from the one that masks it.
      await expect(comprobarDist(dir)).rejects.toThrow(/not a git repository/i)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)

  it('a repo whose scripts/build.mjs does not export buildOptions → it throws saying so', async () => {
    const dir = repoDeMentira()
    writeFileSync(join(dir, 'scripts/build.mjs'), '// sin export\n')
    execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'build.mjs sin export'], { stdio: 'ignore' })
    try {
      await expect(comprobarDist(dir)).rejects.toThrow(/buildOptions/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
