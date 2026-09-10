import { describe, expect, it } from 'vitest'
import { RecoveryFixture, WorktreeDiscovery } from '../fixtures/parallel-workflows.ts'
import { WorkspaceNotRead, PlanStoryNotRead } from '../../src/domain/exceptions.ts'

describe('Worktree discovery completeness', () => {
  it('keeps partial evidence but refuses to call a failed survey an authoritative inventory', async () => {
    const discovery = new WorktreeDiscovery()
    discovery.survey.mockRejectedValueOnce(new WorkspaceNotRead('git worktree list refused'))

    const result = await discovery.plans.inFlight()

    expect(result.wereListed).toBe(false)
    expect(result.reason).toContain('git worktree list refused')
    expect(result.watches?.map((watch) => watch.repository.text)).toEqual(['owner/beta'])
  })

  it('does not infer absence when a relevant session hides its directory', async () => {
    const discovery = new WorktreeDiscovery()
    discovery.entries[0]!.cwdKnown = false

    const result = await discovery.plans.inFlight()

    expect(result.wereListed).toBe(false)
    expect(result.reason).toContain('directory')
  })

  it('can confirm an empty inventory when the checkouts were surveyed and no sessions remain', async () => {
    const discovery = new WorktreeDiscovery()
    discovery.entries = []

    const result = await discovery.plans.inFlight()

    expect(result.wereListed).toBe(true)
    expect(result.watches).toEqual([])
  })

  it('refuses an unreadable checkout registry instead of claiming there are no plans', async () => {
    const discovery = new WorktreeDiscovery()
    discovery.roots = null

    expect((await discovery.plans.inFlight()).wereListed).toBe(false)
  })

  it('reuses known story metadata while still checking sessions and worktrees', async () => {
    const discovery = new WorktreeDiscovery()

    const result = await discovery.plans.inFlight(discovery.watches)

    expect(result.wereListed).toBe(true)
    expect(discovery.story).not.toHaveBeenCalled()
    expect(discovery.survey).toHaveBeenCalledTimes(2)
    expect(result.watches?.map((watch) => watch.storyText())).toEqual(['ABC-7', 'ABC-7'])
  })

  it('does not reuse metadata for a different plan merely because issue numbers match', async () => {
    const discovery = new WorktreeDiscovery()

    await discovery.plans.inFlight([discovery.watches[0]!])

    expect(discovery.story).toHaveBeenCalledExactlyOnceWith({
      issueNumber: 7, repository: discovery.watches[1]!.repository,
    })
  })

  it('retains a discovered plan when only its story metadata is unavailable', async () => {
    const discovery = new WorktreeDiscovery()
    discovery.story.mockRejectedValueOnce(new PlanStoryNotRead('gh unavailable'))

    const result = await discovery.plans.inFlight()

    expect(result.wereListed).toBe(true)
    expect(result.watches).toHaveLength(2)
    expect(result.watches?.[0]?.storyText()).toBeNull()
  })

  it.each(['directory', 'title'])('does not declare a known live session absent after its %s changes', async (changed) => {
    const discovery = new WorktreeDiscovery()
    if (changed === 'directory') discovery.entries[0]!.cwd += '/backend'
    else discovery.entries[0]!.title = 'Interactive shell'

    const result = await discovery.plans.inFlight(discovery.watches)

    expect(result.wereListed).toBe(false)
    expect(result.reason).toContain(discovery.watches[0]!.agent)
    expect(result.watches?.map((watch) => watch.repository.text)).toEqual(['owner/beta'])
  })

  it('keeps the registry intact when a known live session cannot be matched to its worktree', async () => {
    const discovery = new WorktreeDiscovery()
    const fixture = new RecoveryFixture()
    fixture.plans.inFlight.mockImplementation((known) => discovery.plans.inFlight(known))
    await fixture.recovery.recover()
    discovery.entries[0]!.cwd += '/backend'

    expect(await fixture.refresh()).toContain('workspace:7')

    expect(fixture.activePlans.known()).toHaveLength(2)
    expect(fixture.reviews.stop).not.toHaveBeenCalled()
  })
})
