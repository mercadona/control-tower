// The IO layer of scripts/conventions.js: reading the documents of the target
// repository and reading the acknowledgement. It lives apart so that
// conventions.js stays pure logic (testable with no disk) and so that ct-init
// (via detect-conventions.mjs) and ct-next read EXACTLY the same thing. The
// bootstrap and the dispatch looking at different sets of files is how you end
// up at "it showed up in /ct-init and not in /ct-next", which is worse than not
// warning at all.
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, relative, sep, isAbsolute } from 'node:path'
import { ACK_PATH, linkedDocPaths, parseAcks } from './conventions.js'

export { ACK_PATH }

// The documents where the instruction the dispatched agent will read as it
// hydrates lives. They are the DOOR: whatever they declare canonical is
// followed one hop.
export const ROOT_DOC_NAMES = ['AGENTS.md', 'CLAUDE.md']

// Bounds on the hop. A repository can have an AGENTS.md with thirty links and a
// 4 MB document; neither /ct-init nor a dispatch can pay for that. It is cut
// short and it is SAID that it was cut short — an incomplete scan presented as
// complete is the same lie as silence.
export const MAX_LINKED_DOCS = 20
export const MAX_DOC_BYTES = 512 * 1024

function readDoc(root, rel) {
  // Neither leave the repository nor follow a symlink that leaves it:
  // `docs/x.md → /etc/...` is not documentation of this repository, and reading
  // it would be looking where it should not. The root is resolved to its REAL
  // path before comparing: on macOS `/tmp` is a symlink to `/private/tmp`, so
  // comparing the real path of a file against an unresolved root declares
  // absolutely everything "outside the repository".
  let rootReal
  try {
    rootReal = realpathSync(resolve(root))
  } catch {
    rootReal = resolve(root)
  }
  const inside = (p) => {
    const r = relative(rootReal, p)
    return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)
  }
  const abs = resolve(rootReal, rel)
  if (!inside(abs)) return null
  let real
  try {
    real = realpathSync(abs)
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
  if (!inside(real)) return null
  const st = statSync(real)
  // "It is not a file" is NOT the same as "it does not exist". For a broken
  // link it makes no difference; for AGENTS.md/CLAUDE.md it is an anomaly that
  // has to be said (a real case covered by the tests: a DIRECTORY called
  // AGENTS.md — readFileSync fails with EISDIR, not with ENOENT, and keeping
  // quiet about it would be indistinguishable from "there is no conflict").
  if (!st.isFile()) return { notFile: true }
  if (st.size > MAX_DOC_BYTES) return { oversize: true, size: st.size }
  return { content: readFileSync(real, 'utf8') }
}

// readRepoDocs: the two root documents PLUS, one hop away, the `.md` files of
// the repository itself that they cite. It also returns what could NOT be
// looked at: the caller has to be able to say so instead of passing it off as
// "there is nothing".
//
//   { docs, failures: [string], truncated: bool }
//
// `docs[i].via` marks which root document the link came from; it is printed
// next to the evidence so that nobody has to wonder why it was looked at
// there.
export function readRepoDocs(root, { follow = true } = {}) {
  const docs = []
  const failures = []
  let truncated = false
  for (const name of ROOT_DOC_NAMES) {
    try {
      const r = readDoc(root, name)
      if (!r) continue // it does not exist: that is no signal of anything
      if (r.notFile) { failures.push(`${name}: it exists but it is not a file`); continue }
      if (r.oversize) { failures.push(`${name}: ${Math.round(r.size / 1024)} KB, over the read limit`); continue }
      docs.push({ path: name, content: r.content })
    } catch (e) {
      failures.push(`${name}: ${e.message}`)
    }
  }
  if (!follow) return { docs, failures, truncated }

  const rootPaths = new Set(docs.map((d) => d.path))
  const linked = []
  for (const d of docs) {
    for (const p of linkedDocPaths([d])) {
      if (rootPaths.has(p) || linked.some((l) => l.path === p)) continue
      linked.push({ path: p, via: d.path })
    }
  }
  if (linked.length > MAX_LINKED_DOCS) truncated = true
  for (const { path, via } of linked.slice(0, MAX_LINKED_DOCS)) {
    try {
      const r = readDoc(root, path)
      // A broken link (or one to something that is not a file of the
      // repository) says nothing about the repository's conventions: it is
      // skipped in silence, it is not our business.
      if (!r || r.notFile) continue
      if (r.oversize) { failures.push(`${path}: ${Math.round(r.size / 1024)} KB, over the read limit`); continue }
      docs.push({ path, content: r.content, via })
    } catch (e) {
      failures.push(`${path} (enlazado desde ${via}): ${e.message}`)
    }
  }
  return { docs, failures, truncated }
}

// readAck: `{ acks, problems, unreadable }`. `unreadable` is only filled in when
// the file EXISTS and the read failed — if it does not exist there simply are
// no acknowledgements, which is the normal state. The difference matters: "you
// acknowledged nothing" and "you acknowledged and I could not read it" take the
// human to different places. `prosaSinAcuses` (F15/H3) travels just like
// `problems`: it is the file's third state — it exists, it was read, and it
// silences nothing. When the file does not exist it is `false` (there is
// nothing to mislead anyone), not `undefined`.
export function readAck(root) {
  try {
    return { ...parseAcks(readFileSync(join(root, ACK_PATH), 'utf8')), unreadable: null }
  } catch (e) {
    if (e.code === 'ENOENT') return { acks: new Map(), problems: [], prosaSinAcuses: false, unreadable: null }
    return { acks: new Map(), problems: [], prosaSinAcuses: false, unreadable: e.message }
  }
}
