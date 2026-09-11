import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { ReadRevision, ReadRevisionParams } from '../src/application/queries/read-revision.js'
import { RepositoryHistory } from '../src/domain/ports/repository-history.js'
import { Revision } from '../src/domain/value-objects/revision.js'
import { RevisionNotRead } from '../src/domain/exceptions.js'

class History extends RepositoryHistory {
  constructor(answer) {
    super()
    this.answer = answer
    this.roots = []
  }

  async current(root) {
    this.roots.push(root)
    if (this.answer instanceof Error) throw this.answer
    return this.answer
  }
}

describe('ReadRevision', () => {
  it('returns the selected repository revision', async () => {
    const history = new History(new Revision('a'.repeat(40)))
    const result = await new ReadRevision({ history }).execute(new ReadRevisionParams({ root: '/repo' }))
    assert.equal(result.revision.text, 'a'.repeat(40))
    assert.deepEqual(history.roots, ['/repo'])
  })

  it('preserves an unreadable revision instead of inventing one', async () => {
    const history = new History(new RevisionNotRead('repository unavailable'))
    await assert.rejects(new ReadRevision({ history }).execute(new ReadRevisionParams({ root: '/repo' })), RevisionNotRead)
  })
})
