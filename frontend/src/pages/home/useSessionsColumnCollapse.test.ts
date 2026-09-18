import { act, renderHook } from '@testing-library/react'
import { useSessionsColumnCollapse } from 'pages/home/useSessionsColumnCollapse'

const STORAGE_KEY = 'ct.sessions-column-collapsed'

describe('useSessionsColumnCollapse', () => {
  it('starts collapsed with nothing stored', () => {
    const { result } = renderHook(() => useSessionsColumnCollapse())

    expect(result.current.collapsed).toBe(true)
  })

  it('restores an open rail', () => {
    localStorage.setItem(STORAGE_KEY, 'false')

    const { result } = renderHook(() => useSessionsColumnCollapse())

    expect(result.current.collapsed).toBe(false)
  })

  it('toggling flips and persists', () => {
    localStorage.setItem(STORAGE_KEY, 'false')
    const { result } = renderHook(() => useSessionsColumnCollapse())

    act(() => result.current.toggle())

    expect(result.current.collapsed).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('a corrupt stored value reads as collapsed instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-boolean')

    const { result } = renderHook(() => useSessionsColumnCollapse())

    expect(result.current.collapsed).toBe(true)
  })

  it('a same-target poll preserves the collapse choice the person made', () => {
    const { result, rerender } = renderHook(
      ({ target }) => useSessionsColumnCollapse(target),
      { initialProps: { target: 'target-a' } },
    )
    expect(result.current.collapsed).toBe(false)
    act(() => result.current.toggle())
    expect(result.current.collapsed).toBe(true)

    rerender({ target: 'target-a' })

    expect(result.current.collapsed).toBe(true)
  })
})
