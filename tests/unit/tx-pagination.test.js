const { clampPage, getTotalPages, paginateItems } = require('../../extension/shared/wallet-core.js');

describe('transaction pagination', () => {
  it('shows 10 transactions per page', () => {
    const txs = Array.from({ length: 25 }, (_, index) => ({ id: index + 1 }));
    const page = paginateItems(txs, 2, 10);
    expect(page.items).toHaveLength(10);
    expect(page.items[0].id).toBe(11);
    expect(page.items[9].id).toBe(20);
  });

  it('computes total page count from transaction list length', () => {
    expect(getTotalPages(0, 10)).toBe(1);
    expect(getTotalPages(1, 10)).toBe(1);
    expect(getTotalPages(25, 10)).toBe(3);
  });

  it('clamps below-first page requests to page 1', () => {
    expect(clampPage(-4, 3)).toBe(1);
  });

  it('clamps above-last page requests to the final page', () => {
    expect(clampPage(99, 3)).toBe(3);
  });
});
