import base from '../../plugin/vitest.config.js'

export default {
  ...base,
  test: {
    ...base.test,
    include: ['__tests__/ct-step-*.test.js', '__tests__/e2e-ct-step.test.js'],
    setupFiles: ['../docs/testing/record-step-conversations.mjs'],
    fileParallelism: true,
  },
}
