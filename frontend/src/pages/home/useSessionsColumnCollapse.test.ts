import { act, renderHook } from '@testing-library/react'
import { useSessionsColumnCollapse } from 'pages/home/useSessionsColumnCollapse'

const STORAGE_KEY = 'ct.sessions-column-collapsed'

describe('useSessionsColumnCollapse', () => {
  it('starts open with nothing stored', () => {
    const { result } = renderHook(() => useSessionsColumnCollapse())

    expect(result.current.collapsed).toBe(false)
  })

  it('restores a collapsed rail', () => {
    localStorage.setItem(STORAGE_KEY, 'true')

    const { result } = renderHook(() => useSessionsColumnCollapse())

    expect(result.current.collapsed).toBe(true)
  })

  it('toggling flips and persists', () => {
    const { result } = renderHook(() => useSessionsColumnCollapse())

    act(() => result.current.toggle())

    expect(result.current.collapsed).toBe(true)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('a corrupt stored value reads as open instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not-a-boolean')

    const { result } = renderHook(() => useSessionsColumnCollapse())

    expect(result.current.collapsed).toBe(false)
  })
})
