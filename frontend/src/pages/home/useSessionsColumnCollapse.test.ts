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

  it('open sets collapsed to false and persists it', () => {
    const { result } = renderHook(() => useSessionsColumnCollapse())

    act(() => result.current.open())

    expect(result.current.collapsed).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false')
  })

  it('open does nothing while already open', () => {
    localStorage.setItem(STORAGE_KEY, 'false')
    const { result } = renderHook(() => useSessionsColumnCollapse())

    act(() => result.current.open())

    expect(result.current.collapsed).toBe(false)
  })
})
