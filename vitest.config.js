/** @type {import('vitest/config').UserConfig} */
module.exports = {
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.js', 'tests/integration/**/*.test.js'],
    globals: true,
    clearMocks: true,
  },
};
