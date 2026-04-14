// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    browserName: 'chromium',
    headless: true,
  },
  projects: [
    {
      name: 'mocked',
      testMatch: /^(?!.*extension-smoke).*\.spec\.js$/,
      use: { headless: true },
    },
    {
      name: 'extension',
      testMatch: /extension-smoke\.spec\.js$/,
      use: { headless: false },
    },
  ],
});
