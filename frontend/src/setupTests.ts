import '@testing-library/jest-dom/vitest'

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver
}

const localStorageOfTheJsdomWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window
  .localStorage

if (localStorageOfTheJsdomWindow !== undefined) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageOfTheJsdomWindow,
    configurable: true,
  })
}

afterEach(() => {
  localStorage.clear()
})
