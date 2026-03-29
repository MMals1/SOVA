// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  use: {
    browserName: 'chromium',
    headless: true,
  },
});
