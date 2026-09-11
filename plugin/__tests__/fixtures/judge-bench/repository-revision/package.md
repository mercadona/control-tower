# Review package: task 1/1 of issue #1 (staged, not yet committed)
Review token: 48fc9b6d49ff46cf04d04d7155dd22d3aa28835def02160234b201168db4ed84

## Files changed
 src/application/queries/read-revision.js | 23 +++++++++++++++++++++++
 test/read-revision.js                    | 34 ++++++++++++++++++++++++++++++++++
 2 files changed, 57 insertions(+)

## Rutas tocadas
- src/application/queries/read-revision.js
- test/read-revision.js

## Diff
diff --git a/src/application/queries/read-revision.js b/src/application/queries/read-revision.js
new file mode 100644
index 0000000..ede8482
--- /dev/null
+++ b/src/application/queries/read-revision.js
@@ -0,0 +1,23 @@
+export class ReadRevisionParams {
+  constructor({ root }) {
+    this.root = root
+    Object.freeze(this)
+  }
+}
+
+export class ReadRevisionResult {
+  constructor({ revision }) {
+    this.revision = revision
+    Object.freeze(this)
+  }
+}
+
+export class ReadRevision {
+  constructor({ history }) {
+    this.history = history
+  }
+
+  async execute({ root }) {
+    return new ReadRevisionResult({ revision: await this.history.current(root) })
+  }
+}
diff --git a/test/read-revision.js b/test/read-revision.js
new file mode 100644
index 0000000..d53f853
--- /dev/null
+++ b/test/read-revision.js
@@ -0,0 +1,34 @@
+import { describe, it } from 'node:test'
+import assert from 'node:assert/strict'
+import { ReadRevision, ReadRevisionParams } from '../src/application/queries/read-revision.js'
+import { RepositoryHistory } from '../src/domain/ports/repository-history.js'
+import { Revision } from '../src/domain/value-objects/revision.js'
+import { RevisionNotRead } from '../src/domain/exceptions.js'
+
+class History extends RepositoryHistory {
+  constructor(answer) {
+    super()
+    this.answer = answer
+    this.roots = []
+  }
+
+  async current(root) {
+    this.roots.push(root)
+    if (this.answer instanceof Error) throw this.answer
+    return this.answer
+  }
+}
+
+describe('ReadRevision', () => {
+  it('returns the selected repository revision', async () => {
+    const history = new History(new Revision('a'.repeat(40)))
+    const result = await new ReadRevision({ history }).execute(new ReadRevisionParams({ root: '/repo' }))
+    assert.equal(result.revision.text, 'a'.repeat(40))
+    assert.deepEqual(history.roots, ['/repo'])
+  })
+
+  it('preserves an unreadable revision instead of inventing one', async () => {
+    const history = new History(new RevisionNotRead('repository unavailable'))
+    await assert.rejects(new ReadRevision({ history }).execute(new ReadRevisionParams({ root: '/repo' })), RevisionNotRead)
+  })
+})
