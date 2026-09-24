import { defaultExclude, defineConfig, mergeConfig } from 'vitest/config'
import base from '../vitest.config.ts'

export default mergeConfig(base, defineConfig({
  test: {
    setupFiles: ['./__tests__/coverage-flush.ts'],
    exclude: [...defaultExclude, '__tests__/infrastructure/work-progress-contract.test.ts'],
    experimental: { viteModuleRunner: false },
  },
}))
