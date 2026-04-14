/** @type {import('vitest/config').UserConfig} */
module.exports = {
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    globals: true,
    clearMocks: true,
    coverage: {
      provider: 'v8',
      include: ['extension/**/*.{js,ts}'],
      exclude: [
        'extension/libs/**',
        'extension/popup/popup.bundle.js',
        'extension/shared/*.js', // generated from .ts
        'extension/background/*.js', // generated from .ts
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
};
