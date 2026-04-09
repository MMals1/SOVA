const { expect, test } = require('@playwright/test');
const { getActiveScreenId, openPopupWithMocks } = require('./helpers/popup-fixture');

test.describe('smoke', () => {
  test('opens the popup without fatal errors', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err.message || err)));

    await openPopupWithMocks(page, {
      local: {
        accounts: [],
      },
      session: {},
    });

    await expect.poll(() => getActiveScreenId(page)).toBe('screen-setup');
    await expect(page.locator('#screen-setup .brand-title')).toHaveText('SOVA Wallet');
    expect(pageErrors).toEqual([]);
  });

  test('allows switching between create and import tabs', async ({ page }) => {
    await openPopupWithMocks(page, {
      local: {
        accounts: [],
      },
      session: {},
    });

    await page.click('.tabs [data-tab="create"]');
    await expect(page.locator('#tab-create')).toHaveClass(/active/);
    await expect(page.locator('#tab-import')).not.toHaveClass(/active/);

    await page.click('.tabs [data-tab="import"]');
    await expect(page.locator('#tab-import')).toHaveClass(/active/);
    await expect(page.locator('#tab-create')).not.toHaveClass(/active/);
  });
});
