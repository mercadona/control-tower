// Composing the loop's state: it receives signals that have already been
// collected and returns the report's three buckets. It does NO I/O — no
// network, no processes, no disk.
//
// It does no I/O on purpose: every decision that matters —who is alive, who is
// merely starting up, which worktree nobody claims, and whether there is
// anything to review— is taken here, and can therefore be tested without
// setting up a repo, without launching processes and without a network.
// Whoever collects the signals is their own business.
//
// Three states for "is it alive?", not two: `true`, `false`, and `null` when it
// could not be checked. Collapsing the third into `false` would turn a missing
// tool into an accusation of abandonment.
export function buildState(entrada) {
  const {
    enProgreso, enRevision = [], mergeados, cerradosConStatus,
    worktreesEnDisco, ramasEnDisco,
    // sePuedeAtribuirWorktree: whether the list of issues (open and closed)
    // could be read WHOLE, which is what it takes to conclude that nobody
    // claims a worktree. It separates three questions that used to travel in
    // the same datum:
    //
    //   does .worktrees/N exist? → `worktreesEnDisco`, which is a DISK read and
    //                              does not depend on GitHub at all.
    //   does ANY of the issues   → answered with the issues that did arrive,
    //   that were read claim it?   even if the read was partial.
    //   does NOBODY claim it?    → only with the complete list. It is the only
    //                              one that turns this flag off, and the only
    //                              one that accuses.
    //
    // The caller used to empty `worktreesEnDisco` when it did not have the
    // issues, so as not to manufacture orphans. It protected the right thing,
    // but too much of it: that emptying also wiped the `hasWorktree` of the
    // slices IN FLIGHT and of the harvest, and the report ended up saying
    // `worktree ✗` about a directory its own warning had just named. Now the
    // real list always goes in and the only thing turned off is the residue
    // CONCLUSION — the attribution is still done with whatever arrived.
    sePuedeAtribuirWorktree = true,
    procesos, edadClaimMs, ventanaArranqueMs,
  } = entrada

  const sinComprobar = []
  if (!procesos.comprobado) sinComprobar.push(procesos.motivo)

  const worktreeSet = new Set(worktreesEnDisco)
  const ramaSet = new Set(ramasEnDisco)
  // A worktree stops being an orphan the moment SOME issue claims it. It is
  // accumulated from the THREE buckets that can claim it: in flight, delivered
  // and waiting for a merge (`enRevision`, which is the legitimate owner of
  // its own), and already merged (harvest). There were two of them until
  // `enRevision` became a bucket of its own: leaving it out made a healthy loop
  // with open PRs report its worktrees as residue.
  const worktreesExplicados = new Set()

  const enVuelo = enProgreso.map(({ n, nombre }) => {
    const hasWorktree = worktreeSet.has(String(n))
    const hasBranch = ramaSet.has(`feat/${n}`)
    if (hasWorktree) worktreesExplicados.add(String(n))

    // `null` when the process list could not be checked: it is never collapsed
    // into `false`, or the absence of the tool would read as the agent having
    // died.
    const vivo = procesos.comprobado ? procesos.porSlice.has(String(n)) : null
    const pid = procesos.comprobado ? (procesos.porSlice.get(String(n)) ?? null) : null

    const edadMs = edadClaimMs.has(n) ? edadClaimMs.get(n) : null
    // A claim just placed has not yet had time to start up the process that
    // proves it alive: below the start-up window it is reported as "starting
    // up", not as "no sign of life".
    const arrancando = vivo === false && edadMs !== null && edadMs < ventanaArranqueMs

    if (vivo === false && edadMs === null) {
      // Unknown age: nobody is accused. The issue is named in sinComprobar
      // instead of deciding on its behalf.
      sinComprobar.push(`#${n}: no se pudo determinar la antigüedad del claim`)
    }

    return { n, nombre, hasWorktree, hasBranch, pid, vivo, arrancando, edadMs }
  })

  // enRevision: the open issues in `status:in-review` — DELIVERED work waiting
  // for a merge. It is its own bucket, and it is none of the other three:
  //
  //   - It is not residue. §2.1 of the design enumerates the three cases of the
  //     orphaned worktree (abandoned, requeued, or from an issue closed without
  //     a merge) and an `in-review` is none of them: its worktree is usually
  //     there ON PURPOSE, because the PR has not been merged yet. Counting it
  //     as a finding made a HEALTHY loop with three open PRs return 3
  //     permanently — the coordinator learns to ignore the exit code and a
  //     watcher that gates on it becomes useless.
  //   - It is not harvest. The harvest is what is ALREADY MERGED and left
  //     remains on disk. The two can appear at once and they do not overlap.
  //
  // That is why it does NOT count as a finding (see `hayHallazgos` further
  // down): it is informative. And that is why its worktrees end up EXPLAINED:
  // an `in-review` is exactly the legitimate owner of its own.
  const enRevisionSalida = enRevision.map(({ n, nombre }) => {
    const hasWorktree = worktreeSet.has(String(n))
    if (hasWorktree) worktreesExplicados.add(String(n))
    return { n, nombre, hasWorktree, hasBranch: ramaSet.has(`feat/${n}`) }
  })

  const cosecha = []
  for (const n of mergeados) {
    const hasWorktree = worktreeSet.has(String(n))
    const hasBranch = ramaSet.has(`feat/${n}`)
    if (hasWorktree || hasBranch) {
      if (hasWorktree) worktreesExplicados.add(String(n))
      cosecha.push({ n, hasWorktree, hasBranch })
    }
  }

  // Orphan = "it is on disk and NO issue explains it". The second half demands
  // the COMPLETE list of issues, and mind why: it is not that nothing can be
  // attributed without it. With a partial read the attribution works perfectly
  // with the issues that did arrive —measured: with the closed ones down,
  // `enProgreso: [#7]` and `worktreesEnDisco: ['7','8']`,
  // `worktreesExplicados` comes out `["7"]`, not empty. What cannot be done is
  // to conclude RESIDUE about the rest: the `8` is not explained by what was
  // read, but it could be explained by an issue that did not arrive, and
  // accusing it would be manufacturing the finding. That is why what is turned
  // off is the conclusion, not the attribution: `worktreesExplicados` is still
  // computed and travels outwards, and it is what the caller uses so as not to
  // warn about what the report does explain. Different from pretending the
  // directory is not there, which is what the caller's emptying did.
  const worktreesHuerfanos = sePuedeAtribuirWorktree
    ? worktreesEnDisco.filter((w) => !worktreesExplicados.has(w))
    : []

  const residuo = {
    labels: cerradosConStatus,
    worktreesHuerfanos,
  }

  // An in-flight slice with no life counts as a finding only if its age is
  // known too: with no age, it already travels in `sinComprobar` with the
  // issue's number, and presenting it as a finding AS WELL would leave it
  // indistinguishable from a genuinely abandoned claim — precisely the
  // accusation that an unknown age avoids.
  const hayHallazgoEnVuelo = enVuelo.some((s) => s.vivo === false && !s.arrancando && s.edadMs !== null)
  const hayHallazgos = cosecha.length > 0
    || residuo.labels.length > 0
    || residuo.worktreesHuerfanos.length > 0
    || hayHallazgoEnVuelo

  // `worktreesExplicados` travels outwards because the caller needs the SAME
  // answer for something else: warning about the directories that were left
  // unexplained when the list of issues is incomplete. Recomputing it there
  // would duplicate the criterion of "who claims a worktree" in two places that
  // would drift apart — and the first victim of that drift would be exactly a
  // warning naming a directory the report does explain.
  return { enVuelo, enRevision: enRevisionSalida, cosecha, residuo, sinComprobar, hayHallazgos, worktreesExplicados: [...worktreesExplicados] }
}
